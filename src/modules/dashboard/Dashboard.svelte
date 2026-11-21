<script lang="ts">
  import type { ModuleCtx } from "../../core/module";
  import { agents } from "../../core/agents.svelte";
  import { routines } from "../../core/routines.svelte";
  import { timeline } from "../../core/unityTimeline.svelte";
  import { adapters } from "../agents/adapters";
  import { dayKey } from "../routines/schedule";
  import { invoke } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";

  interface Pr { repository: { nameWithOwner: string }; title: string; number: number; url: string; isDraft: boolean }
  let prs = $state<Pr[] | null>(null);
  let prError = $state("");
  async function loadPrs() {
    try {
      prs = await invoke<Pr[]>("plugin:github|my_prs");
      prError = "";
    } catch (e) {
      prError = String(e);
    }
  }
  $effect(() => {
    loadPrs();
    const t = setInterval(loadPrs, 5 * 60_000);
    return () => clearInterval(t);
  });

  // svelte-ignore state_referenced_locally
  let { ctx: _ctx }: { ctx: ModuleCtx } = $props(); // module contract; reads shared stores only

  const stateLabel: Record<string, string> = { unknown: "?", working: "çalışıyor", idle: "boşta", needs_input: "onay bekliyor", exited: "bitti" };
  let now = $state(new Date());
  $effect(() => {
    const t = setInterval(() => (now = new Date()), 30_000);
    return () => clearInterval(t);
  });
  const today = $derived(
    routines
      .filter((r) => r.enabled && (!r.days.length || r.days.includes(now.getDay())))
      .sort((a, b) => a.time.localeCompare(b.time)),
  );
  const agentList = $derived(Object.values(agents));
  const recent = $derived(timeline.slice(0, 6));
  const time = (t: number) => new Date(t).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
</script>

<div class="grid">
  <section>
    <h3>Ajanlar</h3>
    {#each agentList as a (a.paneId)}
      <div class="row {a.state}"><i></i>{a.title}<small>{stateLabel[a.state]}</small></div>
    {:else}
      <p class="empty">Açık ajan yok. Soldaki Ajanlar bölümünden başlat.</p>
    {/each}
  </section>

  <section>
    <h3>Bugünkü rutinler</h3>
    {#each today as r (r.id)}
      <div class="row {r.lastRun === dayKey(now) ? 'idle' : 'pending'}"><i></i><b>{r.time}</b> {r.name}<small>{adapters[r.agent]?.title} · {r.lastRun === dayKey(now) ? "çalıştı" : "bekliyor"}</small></div>
    {:else}
      <p class="empty">Bugün için rutin yok.</p>
    {/each}
  </section>

  <section>
    <h3>Unity son olaylar</h3>
    {#each recent as e (e)}
      <div class="row {e.ok === null ? 'working' : e.ok ? 'idle' : 'fail'}"><i></i><b>{time(e.t)}</b> {e.text}{#if e.project}<small>{e.project}</small>{/if}</div>
    {:else}
      <p class="empty">Henüz derleme veya build olayı yok.</p>
    {/each}
  </section>

  <section>
    <h3>Açık PR'lar (seninle ilgili)</h3>
    {#if prError}
      <p class="empty">{prError}</p>
    {:else if !prs}
      <p class="empty">Yükleniyor…</p>
    {:else}
      {#each prs as p (p.url)}
        <button class="row link" onclick={() => openUrl(p.url)}><b>#{p.number}</b> {p.title}<small>{p.repository.nameWithOwner}{p.isDraft ? " · taslak" : ""}</small></button>
      {:else}
        <p class="empty">Açık PR yok.</p>
      {/each}
    {/if}
  </section>
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; padding: 16px; align-content: start; height: 100%; overflow-y: auto; box-sizing: border-box; }
  section { border: 1px solid #2a2d35; border-radius: 6px; padding: 10px 12px; background: #1a1c22; min-height: 120px; }
  h3 { margin: 0 0 8px; font-size: 13px; color: #8a90a0; }
  .row { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
  .row small { margin-left: auto; color: #8a90a0; }
  b { font-weight: 600; font-variant-numeric: tabular-nums; }
  i { width: 8px; height: 8px; border-radius: 50%; background: #6b7280; flex: none; }
  .working i { background: #3b82f6; }
  .idle i { background: #22c55e; }
  .needs_input i { background: #f59e0b; box-shadow: 0 0 6px #f59e0b; }
  .fail i { background: #ef4444; }
  .exited i, .pending i { background: #374151; }
  .link { width: 100%; background: none; border: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .link:hover { color: #93c5fd; }
  .empty { color: #8a90a0; margin: 0; }
</style>
