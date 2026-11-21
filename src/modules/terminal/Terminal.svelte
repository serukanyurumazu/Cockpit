<script lang="ts">
  import { onMount } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { WebglAddon } from "@xterm/addon-webgl";
  import "@xterm/xterm/css/xterm.css";
  import { Channel, invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import type { ModuleCtx } from "../../core/module";
  import { adapters, shellLine, type AgentId, type HookSignal } from "../agents/adapters";
  import { agents, setAgentState, trackAgent, untrackAgent } from "../../core/agents.svelte";
  import { unityFeed } from "../../core/unityTimeline.svelte";

  let { ctx }: { ctx: ModuleCtx } = $props();

  let el: HTMLDivElement;
  const ACK_EVERY = 64 * 1024;
  const isWindows = navigator.userAgent.includes("Windows");
  // svelte-ignore state_referenced_locally
  const adapter = adapters[ctx.state.agent as AgentId] ?? null;
  // A restored agent pane offers resume instead of silently starting a new session.
  // svelte-ignore state_referenced_locally
  let choosing = $state(!!(adapter && ctx.state.launched && ctx.state.sessionId));
  let start: (resume: boolean) => void = () => {};

  onMount(() => {
    const id = crypto.randomUUID();
    const { terminal: opts } = ctx.settings;
    const cwd = (ctx.state.cwd as string | undefined) ?? null;
    const pty = (cmd: string, args: Record<string, unknown>) =>
      invoke(`plugin:pty|${cmd}`, { id, ...args }).catch(() => {});

    const term = new Terminal({
      fontFamily: '"Cascadia Mono", Menlo, Consolas, monospace',
      fontSize: opts.fontSize,
      scrollback: opts.scrollback,
      macOptionIsMeta: false, // Turkish Mac layout types @ with Option
      theme: { background: "#16181d" },
      // OSC 8 links: only http(s), opened in the system browser
      linkHandler: {
        activate: (_e, uri) => {
          if (/^https?:\/\//i.test(uri)) openUrl(uri);
        },
      },
    });
    if (import.meta.env.DEV) ((window as any).__cockpitTerms ??= {})[ctx.paneId] = term; // e2e hook
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    // WebGL contexts are capped (~16 per page): only visible panes hold one; DOM renderer otherwise.
    let webgl: WebglAddon | null = null;
    const enableWebgl = () => {
      if (webgl) return;
      try {
        webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          webgl?.dispose();
          webgl = null;
        });
        term.loadAddon(webgl);
      } catch {
        webgl = null;
      }
    };
    enableWebgl();
    fit.fit();
    const offVisibility = ctx.onVisibility((visible) => {
      if (visible) {
        enableWebgl();
        fit.fit();
      } else {
        webgl?.dispose();
        webgl = null;
      }
    });

    // Input is wired before spawn so ConPTY's ESC[6n query is answered immediately.
    term.onData((data) => {
      pty("write", { data });
      // The user answered a permission prompt. Deny/Esc sends no hook, so leave needs_input here;
      // Claude's idle_prompt notification later corrects to idle if the turn ended.
      if (adapter && !/^\x1b\[[IO]$/.test(data) && agents[ctx.paneId]?.state === "needs_input") setAgentState(ctx.paneId, "working");
    });
    term.onResize(({ cols, rows }) => pty("resize", { cols, rows }));

    // On Windows/Linux xterm turns Ctrl+V into ^V and swallows the paste event; let the browser
    // paste instead (text via xterm's paste handler, images via onPaste below).
    // Ctrl+C with a selection copies instead of interrupting.
    const isMac = navigator.userAgent.includes("Mac");
    term.attachCustomKeyEventHandler((ev) => {
      if (isMac || ev.type !== "keydown" || !ev.ctrlKey || ev.altKey || ev.metaKey) return true;
      const k = ev.key.toLowerCase();
      if (k === "v") return false;
      if (k === "c" && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection()).catch(() => {});
        term.clearSelection();
        ev.preventDefault();
        return false;
      }
      return true;
    });

    // Image-only clipboard: send the CLI's own image-paste key so it reads the clipboard itself.
    // Claude Code binds this to Alt+V on Windows and Ctrl+V elsewhere.
    const imagePasteKey = isWindows ? "\x1bv" : "\x16";
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData?.getData("text/plain")) {
        e.preventDefault();
        e.stopPropagation();
        pty("write", { data: imagePasteKey });
      }
    };
    el.addEventListener("paste", onPaste, true);

    // A Unity batch build pane also feeds its output to the Unity timeline.
    const unityBuild = ctx.state.unityBuild as string | undefined;
    const feed = unityBuild ? unityFeed(unityBuild) : null;
    const decoder = new TextDecoder();
    let pendingLine = "";

    let unacked = 0;
    const onData = new Channel<ArrayBuffer>();
    onData.onmessage = (buf) => {
      const bytes = new Uint8Array(buf);
      if (feed) {
        // ConPTY may move the cursor instead of sending a newline, so cursor moves split lines too.
        const parts = (pendingLine + decoder.decode(bytes, { stream: true })).split(/\r?\n|\x1b\[\d*(?:;\d*)?H/);
        pendingLine = parts.pop() ?? "";
        for (const l of parts) feed(l.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[A-Za-z]/g, ""));
      }
      term.write(bytes, () => {
        unacked += bytes.length;
        if (unacked >= ACK_EVERY) {
          pty("ack", { bytes: unacked });
          unacked = 0;
        }
      });
    };

    const exited = listen<{ id: string; code: number | null }>("pty:exit", (e) => {
      if (e.payload.id !== id) return;
      term.write(`\r\n\x1b[2m[süreç bitti: ${e.payload.code ?? "?"}]\x1b[0m\r\n`);
      if (adapter) setAgentState(ctx.paneId, "exited");
    });

    let hookToken: string | null = null;
    const hooked = adapter
      ? listen<HookSignal & { paneId: string }>("agent:hook", (e) => {
          if (e.payload.paneId !== ctx.paneId) return;
          if (import.meta.env.DEV) ((window as any).__cockpitHookLog ??= []).push({ t: Date.now(), ...e.payload }); // e2e hook
          if (e.payload.sessionId && !ctx.state.sessionId) ctx.saveState({ sessionId: e.payload.sessionId });
          const s = adapter.onHook(e.payload);
          if (s) setAgentState(ctx.paneId, s);
        })
      : null;

    const fail = (err: unknown) => term.write(`\x1b[31mBaşlatılamadı: ${err}\x1b[0m\r\n`);
    start = (resume: boolean) => {
      choosing = false;
      (async () => {
        let env: Record<string, string> | undefined;
        let shell_line: string | undefined;
        const program = !adapter && opts.shell && !ctx.state.run ? [opts.shell] : null;
        if (!adapter && typeof ctx.state.run === "string") {
          shell_line = ctx.state.run; // e.g. a Unity batch build started from the Proje panel
          if (typeof ctx.state.title === "string") ctx.setTitle(ctx.state.title);
        }
        if (adapter) {
          const folder = cwd?.split(/[\\/]/).filter(Boolean).pop();
          ctx.setTitle(folder ? `${adapter.title} · ${folder}` : adapter.title);
          trackAgent({ paneId: ctx.paneId, agent: adapter.id, title: adapter.title });
          if (adapter.globalHooks) await invoke(adapter.globalHooks);
          const reg = await invoke<{ port: number; token: string }>("plugin:hooks|register", { paneId: ctx.paneId });
          hookToken = reg.token;
          const paths: Record<string, string> = {};
          for (const [name, contents] of Object.entries(adapter.configs())) {
            paths[name] = await invoke<string>("plugin:hooks|write_config", { token: reg.token, name, contents });
          }
          const sessionId = ctx.state.sessionId as string | undefined;
          const plan = adapter.launch({ paths, sessionId, resume });
          ctx.saveState({ launched: true, ...(plan.sessionId ? { sessionId: plan.sessionId } : {}) });
          env = { ...plan.env, COCKPIT_HOOK_PORT: String(reg.port), COCKPIT_HOOK_TOKEN: reg.token };
          const extra = [
            ...(ctx.settings.agents[adapter.id]?.args ?? []),
            ...((ctx.state.args as string[] | undefined) ?? []),
          ];
          shell_line = shellLine(adapter.bin, [...plan.args, ...extra], isWindows);
        }
        await invoke("plugin:pty|spawn", { id, cols: term.cols, rows: term.rows, cwd, program, env, shellLine: shell_line, onData });
      })().catch(fail);
    };
    if (!choosing) start(false);

    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(el);
    term.focus();

    return () => {
      ro.disconnect();
      offVisibility();
      el.removeEventListener("paste", onPaste, true);
      exited.then((un) => un());
      hooked?.then((un) => un());
      if (hookToken) invoke("plugin:hooks|unregister", { token: hookToken }).catch(() => {});
      if (adapter) untrackAgent(ctx.paneId);
      pty("kill", {});
      if (import.meta.env.DEV) delete (window as any).__cockpitTerms?.[ctx.paneId];
      term.dispose();
    };
  });
</script>

<div class="wrap">
  <div class="term" bind:this={el}></div>
  {#if choosing && adapter}
    <div class="resume">
      <span>Önceki {adapter.title} oturumu</span>
      <button onclick={() => start(true)}>Sürdür</button>
      <button onclick={() => start(false)}>Yeni oturum</button>
    </div>
  {/if}
</div>

<style>
  .wrap { position: relative; width: 100%; height: 100%; }
  .term { width: 100%; height: 100%; padding: 4px; box-sizing: border-box; }
  .resume { position: absolute; inset: 0; z-index: 10; display: flex; gap: 8px; align-items: center; justify-content: center; background: rgba(22, 24, 29, 0.92); }
  .resume button { background: #252830; color: inherit; border: 1px solid #353944; border-radius: 4px; padding: 4px 12px; cursor: pointer; }
</style>
