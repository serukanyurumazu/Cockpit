<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";

  let { url: startUrl = "https://tauri.app" }: { url?: string } = $props();

  const label = `browser-${crypto.randomUUID().slice(0, 8)}`;
  let host: HTMLDivElement;
  let address = $state(startUrl);
  let loading = $state(false);
  let error = $state("");

  const call = (cmd: string, args: Record<string, unknown> = {}) =>
    invoke(`plugin:browser|${cmd}`, { label, ...args });
  const act = (action: string) => call("action", { action }).catch(() => {});

  function rect() {
    const r = host.getBoundingClientRect();
    return { x: r.left, y: r.top, width: Math.max(1, r.width), height: Math.max(1, r.height) };
  }

  function go(e?: SubmitEvent) {
    e?.preventDefault();
    let target = address.trim();
    if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
    error = "";
    call("navigate", { url: target }).catch((err) => (error = String(err)));
  }

  onMount(() => {
    let opened = false;
    // Native webview paints above the HTML, so its rect is synced by hand.
    const sync = () => opened && call("set_bounds", rect()).catch(() => {});
    call("open", { url: startUrl, ...rect() })
      .then(() => (opened = true))
      .then(sync)
      .catch((err) => (error = String(err)));
    const ro = new ResizeObserver(sync);
    ro.observe(host);
    window.addEventListener("resize", sync);
    const page = listen<{ label: string; url: string; loading: boolean }>("browser:page", (e) => {
      if (e.payload.label !== label) return;
      address = e.payload.url;
      loading = e.payload.loading;
    });
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      page.then((un) => un());
      act("close");
    };
  });
</script>

<div class="browser">
  <form class="nav" onsubmit={go}>
    <button type="button" title="Geri" onclick={() => act("back")}>‹</button>
    <button type="button" title="İleri" onclick={() => act("forward")}>›</button>
    <button type="button" title="Yenile" onclick={() => act("reload")}>{loading ? "…" : "↻"}</button>
    <input bind:value={address} spellcheck="false" />
    <button type="button" title="DevTools" onclick={() => act("devtools")}>⚙</button>
  </form>
  {#if error}<div class="error">{error}</div>{/if}
  <div class="host" bind:this={host}></div>
</div>

<style>
  .browser { display: flex; flex-direction: column; height: 100%; }
  .nav { display: flex; gap: 4px; padding: 4px; }
  .nav input { flex: 1; background: #0f1115; color: inherit; border: 1px solid #353944; border-radius: 4px; padding: 2px 8px; }
  .nav button { background: #252830; color: inherit; border: 1px solid #353944; border-radius: 4px; min-width: 26px; cursor: pointer; }
  .error { color: #ff7b7b; padding: 2px 8px; font-size: 11px; }
  .host { flex: 1; min-height: 0; }
</style>
