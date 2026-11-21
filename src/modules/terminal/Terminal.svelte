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

  let { ctx }: { ctx: ModuleCtx } = $props();

  let el: HTMLDivElement;
  const ACK_EVERY = 64 * 1024;

  onMount(() => {
    const id = crypto.randomUUID();
    const { terminal: opts } = ctx.settings;
    const cwd = (ctx.state.cwd as string | undefined) ?? null;
    const program = (ctx.state.program as string[] | undefined) ?? (opts.shell ? [opts.shell] : null);
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
    term.onData((data) => pty("write", { data }));

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
    term.onResize(({ cols, rows }) => pty("resize", { cols, rows }));

    // Image-only clipboard: send the CLI's own image-paste key so it reads the clipboard itself.
    // Claude Code binds this to Alt+V on Windows and Ctrl+V elsewhere.
    const imagePasteKey = navigator.userAgent.includes("Windows") ? "\x1bv" : "\x16";
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData?.getData("text/plain")) {
        e.preventDefault();
        e.stopPropagation();
        pty("write", { data: imagePasteKey });
      }
    };
    el.addEventListener("paste", onPaste, true);

    let unacked = 0;
    const onData = new Channel<ArrayBuffer>();
    onData.onmessage = (buf) => {
      const bytes = new Uint8Array(buf);
      term.write(bytes, () => {
        unacked += bytes.length;
        if (unacked >= ACK_EVERY) {
          pty("ack", { bytes: unacked });
          unacked = 0;
        }
      });
    };

    const exited = listen<{ id: string; code: number | null }>("pty:exit", (e) => {
      if (e.payload.id === id) term.write(`\r\n\x1b[2m[süreç bitti: ${e.payload.code ?? "?"}]\x1b[0m\r\n`);
    });

    invoke("plugin:pty|spawn", { id, cols: term.cols, rows: term.rows, cwd, program, onData }).catch(
      (err) => term.write(`\x1b[31mPTY başlatılamadı: ${err}\x1b[0m\r\n`),
    );

    const ro = new ResizeObserver(() => fit.fit());
    ro.observe(el);
    term.focus();

    return () => {
      ro.disconnect();
      offVisibility();
      el.removeEventListener("paste", onPaste, true);
      exited.then((un) => un());
      pty("kill", {});
      if (import.meta.env.DEV) delete (window as any).__cockpitTerms?.[ctx.paneId];
      term.dispose();
    };
  });
</script>

<div class="term" bind:this={el}></div>

<style>
  .term {
    width: 100%;
    height: 100%;
    padding: 4px;
    box-sizing: border-box;
  }
</style>
