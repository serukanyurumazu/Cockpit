<script lang="ts">
  import type { ModuleCtx } from "../../core/module";
  // svelte-ignore state_referenced_locally
  let { ctx: _ctx }: { ctx: ModuleCtx } = $props(); // module contract; this view needs no pane state
  import { clearTimeline, timeline } from "../../core/unityTimeline.svelte";

  let filter = $state<"all" | "compile" | "build">("all");
  const shown = $derived(filter === "all" ? timeline : timeline.filter((e) => e.kind === filter));
  const fmt = (t: number) => new Date(t).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });</script>

<div class="wrap">
  <header>
    <h2>Unity zaman çizelgesi</h2>
    <select bind:value={filter}>
      <option value="all">Tümü</option>
      <option value="compile">Derleme</option>
      <option value="build">Build</option>
    </select>
    <button onclick={clearTimeline} disabled={!timeline.length}>Temizle</button>
  </header>
  <p class="hint">Editor.log ve Cockpit'ten başlatılan batch build'ler izlenir. Cockpit kapalıyken olanlar kaydedilmez.</p>
  {#if !shown.length}
    <p class="empty">Henüz olay yok. Unity'de bir script kaydedince ya da build alınca burada görünür.</p>
  {/if}
  <ol>
    {#each shown as e (e)}
      <li class={e.ok === null ? "run" : e.ok ? "ok" : "fail"}>
        <i></i>
        <time>{fmt(e.t)}</time>
        <span class="kind">{e.kind === "compile" ? "Derleme" : "Build"}</span>
        <span>{e.text}</span>
        {#if e.project}<small>{e.project}</small>{/if}
        {#if e.detail?.length}
          <ul>{#each e.detail as d (d)}<li>{d}</li>{/each}</ul>
        {/if}
      </li>
    {/each}
  </ol>
</div>

<style>
  .wrap { padding: 16px 20px; height: 100%; overflow-y: auto; box-sizing: border-box; }
  header { display: flex; gap: 8px; align-items: center; }
  h2 { margin: 0 auto 0 0; font-size: 16px; }
  select, button { background: #252830; color: inherit; border: 1px solid #353944; border-radius: 4px; padding: 2px 8px; }
  .hint, .empty { color: #8a90a0; }
  ol { list-style: none; padding: 0; margin: 0; }
  ol > li { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid #23262e; }
  i { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .ok i { background: #22c55e; }
  .fail i { background: #ef4444; }
  .run i { background: #3b82f6; }
  time { color: #8a90a0; font-variant-numeric: tabular-nums; }
  .kind { color: #8a90a0; width: 56px; }
  small { color: #8a90a0; margin-left: auto; }
  ul { flex-basis: 100%; margin: 2px 0 0 18px; padding: 0; list-style: none; font-family: "Cascadia Mono", Consolas, monospace; font-size: 12px; color: #fca5a5; }
</style>
