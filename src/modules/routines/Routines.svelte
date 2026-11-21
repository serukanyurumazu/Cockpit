<script lang="ts">
  import { open } from "@tauri-apps/plugin-dialog";
  import type { ModuleCtx } from "../../core/module";
  import { routines, runRoutine, saveRoutines } from "../../core/routines.svelte";
  import { adapters, type AgentId } from "../agents/adapters";
  import { GRACE_MIN, type Routine } from "./schedule";

  // svelte-ignore state_referenced_locally
  let { ctx: _ctx }: { ctx: ModuleCtx } = $props(); // module contract; state lives in routines.json

  const DAYS = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
  const ORDER = [1, 2, 3, 4, 5, 6, 0];
  const blank = () => ({ name: "", time: "09:00", days: [] as number[], agent: "claude" as AgentId, cwd: "", prompt: "" });
  let draft = $state(blank());
  let editing = $state<string | null>(null);
  let msg = $state("");

  const cover = (on: boolean) => window.dispatchEvent(new CustomEvent("cockpit:cover", { detail: on }));
  async function pickFolder() {
    cover(true);
    try {
      const dir = await open({ directory: true, title: "Rutin: proje klasörü", defaultPath: draft.cwd || undefined });
      if (typeof dir === "string") draft.cwd = dir;
    } finally {
      cover(false);
    }
  }

  function toggleDay(d: number) {
    draft.days = draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d];
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!draft.name.trim() || !draft.cwd || !draft.prompt.trim()) return void (msg = "Ad, klasör ve prompt gerekli.");
    msg = "";
    const existing = routines.find((r) => r.id === editing);
    if (existing) Object.assign(existing, $state.snapshot(draft));
    else routines.push({ id: crypto.randomUUID(), enabled: true, ...$state.snapshot(draft) });
    saveRoutines();
    draft = blank();
    editing = null;
  }

  function edit(r: Routine) {
    editing = r.id;
    draft = { name: r.name, time: r.time, days: [...r.days], agent: r.agent, cwd: r.cwd, prompt: r.prompt };
  }

  function remove(r: Routine) {
    routines.splice(routines.indexOf(r), 1);
    if (editing === r.id) (editing = null), (draft = blank());
    saveRoutines();
  }

  const dayText = (days: number[]) => (days.length ? ORDER.filter((d) => days.includes(d)).map((d) => DAYS[d]).join(" ") : "Her gün");
  const folder = (p: string) => p.split(/[\\/]/).filter(Boolean).pop();
</script>

<div class="wrap">
  <h2>Rutinler</h2>
  <p class="hint">Belirlenen saatte seçilen ajanı o klasörde açar ve prompt'u gönderir. Cockpit açık olmalı; saatinden sonra {GRACE_MIN} dakika içinde açılmazsa o günün çalışması atlanır.</p>

  <ul class="list">
    {#each routines as r (r.id)}
      <li class:off={!r.enabled}>
        <label class="sw"><input type="checkbox" bind:checked={r.enabled} onchange={saveRoutines} /></label>
        <div class="main">
          <div><strong>{r.name}</strong> <span class="meta">{r.time} · {dayText(r.days)} · {adapters[r.agent]?.title} · {folder(r.cwd)}</span></div>
          <div class="prompt">{r.prompt}</div>
          {#if r.lastRun}<div class="meta">Son çalışma: {r.lastRun}</div>{/if}
        </div>
        <button onclick={() => runRoutine(r)}>Şimdi çalıştır</button>
        <button onclick={() => edit(r)}>Düzenle</button>
        <button onclick={() => remove(r)}>Sil</button>
      </li>
    {:else}
      <li class="meta">Henüz rutin yok.</li>
    {/each}
  </ul>

  <form onsubmit={submit}>
    <h3>{editing ? "Rutini düzenle" : "Yeni rutin"}</h3>
    <div class="row">
      <input placeholder="Ad (ör. Sabah özeti)" bind:value={draft.name} />
      <input type="time" bind:value={draft.time} />
      <select bind:value={draft.agent}>
        {#each Object.values(adapters) as a (a.id)}<option value={a.id}>{a.title}</option>{/each}
      </select>
    </div>
    <div class="row days">
      {#each ORDER as d (d)}
        <button type="button" class:on={draft.days.includes(d)} onclick={() => toggleDay(d)}>{DAYS[d]}</button>
      {/each}
      <span class="meta">{draft.days.length ? "" : "hiçbiri seçili değil = her gün"}</span>
    </div>
    <div class="row">
      <button type="button" onclick={pickFolder}>Klasör seç</button>
      <span class="meta">{draft.cwd || "klasör seçilmedi"}</span>
    </div>
    <textarea rows="4" placeholder="Prompt (ör. Dünkü commitleri özetle ve TASKS.md'yi güncelle)" bind:value={draft.prompt}></textarea>
    <div class="row">
      <button type="submit">{editing ? "Kaydet" : "Ekle"}</button>
      {#if editing}<button type="button" onclick={() => ((editing = null), (draft = blank()))}>Vazgeç</button>{/if}
      {#if msg}<span class="err">{msg}</span>{/if}
    </div>
  </form>
</div>

<style>
  .wrap { padding: 16px 20px; height: 100%; overflow-y: auto; box-sizing: border-box; max-width: 900px; }
  h2 { margin: 0 0 4px; font-size: 16px; }
  h3 { margin: 0 0 8px; font-size: 13px; }
  .hint, .meta { color: #8a90a0; }
  .list { list-style: none; padding: 0; margin: 12px 0 20px; }
  .list li { display: flex; gap: 8px; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid #23262e; }
  .list li.off { opacity: .55; }
  .main { flex: 1; min-width: 0; }
  .prompt { color: #b8bcc8; white-space: pre-wrap; overflow: hidden; text-overflow: ellipsis; max-height: 3.2em; }
  button, input, select, textarea { background: #252830; color: inherit; border: 1px solid #353944; border-radius: 4px; padding: 3px 8px; font: inherit; }
  textarea { width: 100%; box-sizing: border-box; resize: vertical; }
  form { border: 1px solid #2a2d35; border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .days button.on { background: #2b3a5c; border-color: #3b82f6; }
  .err { color: #f87171; }
</style>
