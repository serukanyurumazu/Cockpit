<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import type { ModuleCtx } from "../../core/module";
  import { noteFile, renderMarkdown, snippetHtml } from "./markdown";

  interface Note { path: string; title: string; tags: string; snippet?: string | null }
  let { ctx }: { ctx: ModuleCtx } = $props();
  // svelte-ignore state_referenced_locally
  const vault = ctx.state.vault as string;
  // svelte-ignore state_referenced_locally
  const project = (ctx.state.project as string | undefined) ?? null;

  let notes = $state<Note[]>([]);
  let query = $state("");
  let results = $state<Note[] | null>(null);
  // svelte-ignore state_referenced_locally
  let current = $state<string | null>((ctx.state.open as string | undefined) ?? null);
  let text = $state("");
  let original = $state("");
  let preview = $state(true);
  let backlinks = $state<Note[]>([]);
  let msg = $state("");
  let newTitle = $state("");
  const dirty = $derived(text !== original);
  const html = $derived(preview ? renderMarkdown(text) : "");

  const b = <T,>(cmd: string, args: Record<string, unknown> = {}) => invoke<T>(`plugin:brain|${cmd}`, { vault, ...args });

  async function refresh() {
    notes = await b<Note[]>("list");
    if (query.trim()) results = await b<Note[]>("search", { q: query });
    if (current) {
      backlinks = await b<Note[]>("backlinks", { path: current });
      // Pick up agent edits to the open note unless the user has unsaved changes.
      const disk = await b<string>("read", { path: current }).catch(() => null);
      if (disk === null) {
        msg = `${current} diskten silindi.`;
      } else if (disk !== original && !dirty) {
        text = original = disk;
      }
    }
  }

  async function open(path: string) {
    if (dirty && !confirm("Kaydedilmemiş değişiklikler var. Yine de açılsın mı?")) return;
    current = path;
    text = original = await b<string>("read", { path });
    msg = "";
    ctx.saveState({ open: path });
    backlinks = await b<Note[]>("backlinks", { path });
  }

  async function save() {
    if (!current || !dirty) return;
    const r = await b<{ conflict: string | null }>("write", { path: current, content: text, expected: original });
    if (r.conflict) {
      msg = `Not dışarıda değişti (ör. bir ajan). Senin metnin "${r.conflict}" olarak ayrıca kaydedildi.`;
      text = original = await b<string>("read", { path: current });
    } else {
      original = text;
      msg = "";
    }
    refresh();
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    const path = noteFile(newTitle);
    try {
      await b("write", { path, content: `# ${newTitle.trim()}\n\n`, expected: null });
      newTitle = "";
      await refresh();
      await open(path);
      preview = false;
    } catch (err) {
      msg = String(err);
    }
  }

  let searchTimer = 0;
  function onQuery() {
    clearTimeout(searchTimer);
    searchTimer = window.setTimeout(async () => {
      results = query.trim() ? await b<Note[]>("search", { q: query }) : null;
    }, 200);
  }

  function onPreviewClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    if (a.dataset.ext) openUrl(a.dataset.ext);
    else if (a.dataset.wiki) {
      const name = a.dataset.wiki.toLowerCase();
      const hit = notes.find((n) => n.path.toLowerCase().replace(/^.*\//, "").replace(/\.md$/, "") === name);
      if (hit) open(hit.path);
      else msg = `"${a.dataset.wiki}" adlı not yok.`;
    }
  }

  async function pointAgents() {
    if (!project) return;
    const touched = await invoke<string[]>("plugin:brain|add_agent_pointer", { project });
    msg = touched.length ? `Eklendi: ${touched.join(", ")}` : "Zaten ekli.";
  }

  onMount(() => {
    ctx.setTitle(`Beyin · ${(project ?? vault).split(/[\\/]/).filter(Boolean).pop()}`);
    if (current) open(current).catch(() => (current = null));
    refresh();
    let visible = true;
    const offVis = ctx.onVisibility((v) => (visible = v));
    const timer = setInterval(() => visible && refresh().catch(() => {}), 1500);
    return () => {
      clearInterval(timer);
      offVis();
    };
  });
</script>

<div class="brain">
  <aside>
    <input class="q" bind:value={query} oninput={onQuery} placeholder="Ara…" spellcheck="false" />
    <form onsubmit={create}><input bind:value={newTitle} placeholder="+ Yeni not başlığı" /></form>
    <ul>
      {#each results ?? notes as n (n.path)}
        <li class:on={n.path === current}>
          <button onclick={() => open(n.path)}>
            <span class="t">{n.title}</span>
            {#if n.snippet}<span class="snip">{@html snippetHtml(n.snippet)}</span>{/if}
            {#if n.tags}<span class="tags">{n.tags}</span>{/if}
          </button>
        </li>
      {:else}
        <li class="muted">{results ? "Sonuç yok" : "Henüz not yok"}</li>
      {/each}
    </ul>
    {#if project}<button class="mini" onclick={pointAgents} title="CLAUDE.md / AGENTS.md dosyasına vault yolunu ekler">Ajanlara tanıt</button>{/if}
  </aside>
  <main>
    {#if current}
      <div class="bar">
        <strong>{current}</strong>{#if dirty}<span class="dot" title="Kaydedilmedi">●</span>{/if}
        <span class="sp"></span>
        <button class="mini" class:on={!preview} onclick={() => (preview = false)}>Düzenle</button>
        <button class="mini" class:on={preview} onclick={() => (preview = true)}>Önizleme</button>
        <button class="mini" disabled={!dirty} onclick={save}>Kaydet</button>
      </div>
      {#if msg}<p class="msg">{msg}</p>{/if}
      {#if preview}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="md" onclick={onPreviewClick}>{@html html}</div>
      {:else}
        <textarea bind:value={text} spellcheck="false" onkeydown={(e) => (e.ctrlKey || e.metaKey) && e.key === "s" && (e.preventDefault(), save())}></textarea>
      {/if}
      <footer>
        <span class="muted">Geri bağlantılar:</span>
        {#each backlinks as l (l.path)}<button class="link" onclick={() => open(l.path)}>{l.title}</button>{:else}<span class="muted">yok</span>{/each}
      </footer>
    {:else}
      {#if msg}<p class="msg">{msg}</p>{/if}
      <p class="muted">Bir not seç ya da yeni not oluştur. Notlar: <code>{vault}</code></p>
    {/if}
  </main>
</div>

<style>
  .brain { display: flex; height: 100%; }
  aside { width: 240px; flex: none; display: flex; flex-direction: column; gap: 4px; padding: 6px; border-right: 1px solid #2a2d35; min-height: 0; }
  aside ul { list-style: none; margin: 0; padding: 0; overflow: auto; flex: 1; }
  aside li button { width: 100%; text-align: left; background: none; border: none; color: inherit; padding: 4px; border-radius: 4px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
  aside li.on button, aside li button:hover { background: #252830; }
  .t { font-weight: 600; }
  .snip { font-size: 11px; color: #a0a6b4; }
  .snip :global(mark) { background: #3b82f6; color: white; }
  .tags { font-size: 10px; color: #22c55e; }
  input { width: 100%; box-sizing: border-box; background: #0f1115; color: inherit; border: 1px solid #353944; border-radius: 4px; padding: 3px 6px; }
  main { flex: 1; display: flex; flex-direction: column; min-width: 0; padding: 6px; }
  .bar { display: flex; gap: 6px; align-items: center; margin-bottom: 4px; }
  .sp { flex: 1; }
  .dot { color: #f59e0b; }
  .mini { background: #252830; color: inherit; border: 1px solid #353944; border-radius: 4px; padding: 1px 8px; cursor: pointer; font-size: 11px; }
  .mini.on { border-color: #3b82f6; }
  .mini:disabled { opacity: 0.4; cursor: default; }
  textarea { flex: 1; resize: none; background: #0f1115; color: inherit; border: 1px solid #353944; border-radius: 4px; padding: 8px; font-family: "Cascadia Mono", Menlo, monospace; font-size: 12px; }
  .md { flex: 1; overflow: auto; padding: 0 8px; line-height: 1.5; }
  .md :global(a) { color: #60a5fa; }
  .md :global(.img) { color: #8a90a0; }
  .md :global(code) { background: #252830; padding: 0 3px; border-radius: 3px; }
  footer { display: flex; gap: 6px; flex-wrap: wrap; padding-top: 4px; border-top: 1px solid #2a2d35; font-size: 11px; }
  .link { background: none; border: none; color: #60a5fa; cursor: pointer; padding: 0; }
  .muted { color: #8a90a0; }
  .msg { color: #f59e0b; margin: 2px 0; }
</style>
