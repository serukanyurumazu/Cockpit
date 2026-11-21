<script lang="ts">
  import { onMount } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { WebglAddon } from "@xterm/addon-webgl";
  import "@xterm/xterm/css/xterm.css";
  import { Channel, invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { openUrl } from "@tauri-apps/plugin-opener";

  let {
    cwd = null,
    program = null,
  }: { cwd?: string | null; program?: string[] | null } = $props();

  let el: HTMLDivElement;
  const ACK_EVERY = 64 * 1024;

  onMount(() => {
    const id = crypto.randomUUID();
    const pty = (cmd: string, args: Record<string, unknown>) =>
      invoke(`plugin:pty|${cmd}`, { id, ...args }).catch(() => {});

    const term = new Terminal({
      fontFamily: '"Cascadia Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      scrollback: 5000,
      macOptionIsMeta: false, // Turkish Mac layout types @ with Option
      theme: { background: "#16181d" },
      // OSC 8 links: only http(s), opened in the system browser
      linkHandler: {
        activate: (_e, uri) => {
          if (/^https?:\/\//i.test(uri)) openUrl(uri);
        },
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    let webgl: WebglAddon | null = null;
    try {
      webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl?.dispose();
        webgl = null;
      });
      term.loadAddon(webgl);
    } catch {
      webgl = null; // DOM renderer fallback
    }
    fit.fit();

    // Input is wired before spawn so ConPTY's ESC[6n query is answered immediately.
    term.onData((data) => pty("write", { data }));
    term.onResize(({ cols, rows }) => pty("resize", { cols, rows }));

    // Image-only clipboard: forward Ctrl+V so CLIs (Claude Code) read the image themselves.
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData?.getData("text/plain")) {
        e.preventDefault();
        e.stopPropagation();
        pty("write", { data: "\x16" });
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
      el.removeEventListener("paste", onPaste, true);
      exited.then((un) => un());
      pty("kill", {});
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
