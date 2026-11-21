<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import type { ModuleCtx } from "../../core/module";
  import { cloneOf, loadClones, repos } from "../../core/repos.svelte";
  import { shellLine } from "../agents/adapters";

  let { ctx }: { ctx: ModuleCtx } = $props();
  // svelte-ignore state_referenced_locally
  const repo = ctx.state.repo as string;
  const path = $derived(cloneOf(repo));
  const isWindows = navigator.userAgent.includes("Windows");

  interface View {
    info: { description: string; url: string; defaultBranchRef: { name: string } | null; pushedAt: string; isPrivate: boolean };
    prs: { number: number; title: string; author: { login: string }; updatedAt: string; url: string; isDraft: boolean }[];
    issues: { number: number; title: string; updatedAt: string; url: string }[];
    commits: { sha: string; html_url: string; commit: { message: string; author: { name: string; date: string } } }[];
  }
  let view = $state<View | null>(null);
  let error = $state("");

  const ago = (iso: string) => {
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    return m < 60 ? `${m} dk` : m < 1440 ? `${Math.round(m / 60)} sa` : `${Math.round(m / 1440)} gün`;
  };
  const open = (url: string) => /^https:\/\//.test(url) && openUrl(url);
  const openPanel = (component: string, params: Record<string, unknown>) =>
    window.dispatchEvent(new CustomEvent("cockpit:open-panel", { detail: { component, params } }));

  async function load() {
    error = "";
    try {
      view = await invoke<View>("plugin:github|repo_view", { repo });
    } catch (e) {
      error = String(e);
    }
  }

  function openProject() {
    if (path) ctx.openPanel("project", { path });
  }

  function clone() {
    const name = repo.split("/")[1];
    const target = `${repos.root}${isWindows ? "\\" : "/"}${name}`;
    openPanel("terminal", { cwd: repos.root, run: shellLine("gh", ["repo", "clone", repo, target], isWindows), title: `Klonla · ${name}` });
  }

  onMount(() => {
    ctx.setTitle(repo.split("/")[1]);
    load();
  });
  // "both": GitHub info on top, the local project dashboard below it (once per pane;
  // clones may be found only after the pane mounted)
  $effect(() => {
    if (path && !ctx.state.projectOpened) {
      ctx.saveState({ projectOpened: true });
      openProject();
    }
  });
</script>

<div class="wrap">
  <header>
    <h2>{repo}</h2>
    {#if view?.info.isPrivate}<span class="badge">private</span>{/if}
    {#if view?.info.defaultBranchRef}<span class="meta">{view.info.defaultBranchRef.name}</span>{/if}
    <span class="spacer"></span>
    <button onclick={load}>Yenile</button>
    {#if view}<button onclick={() => open(view!.info.url)}>GitHub'da aç</button>{/if}
  </header>
  {#if view?.info.description}<p>{view.info.description}</p>{/if}

  <div class="local">
    {#if path}
      <span class="meta">Yerel klon: {path}</span>
      <button onclick={openProject}>Proje panelini aç</button>
    {:else if repos.root}
      <span class="meta">Klon klasöründe ({repos.root}) yerel kopya yok.</span>
      <button onclick={clone}>Klonla</button>
      <button onclick={loadClones}>Tekrar tara</button>
    {:else}
      <span class="meta">Yerel klonları bulmak için soldaki Repos bölümünden klon klasörünü seç.</span>
    {/if}
  </div>

  {#if error}<p class="err">{error}</p>{/if}
  {#if view}
    <div class="cols">
      <section>
        <h3>Açık PR'lar ({view.prs.length})</h3>
        {#each view.prs as p (p.number)}
          <button class="row" onclick={() => open(p.url)}><b>#{p.number}</b> {p.title}{#if p.isDraft}<em>taslak</em>{/if}<small>{p.author.login} · {ago(p.updatedAt)}</small></button>
        {:else}<p class="meta">Yok.</p>{/each}
      </section>
      <section>
        <h3>Açık issue'lar ({view.issues.length})</h3>
        {#each view.issues as i (i.number)}
          <button class="row" onclick={() => open(i.url)}><b>#{i.number}</b> {i.title}<small>{ago(i.updatedAt)}</small></button>
        {:else}<p class="meta">Yok.</p>{/each}
      </section>
      <section class="wide">
        <h3>Son commit'ler</h3>
        {#each view.commits as c (c.sha)}
          <button class="row" onclick={() => open(c.html_url)}><code>{c.sha.slice(0, 7)}</code> {c.commit.message.split("\n")[0]}<small>{c.commit.author.name} · {ago(c.commit.author.date)}</small></button>
        {:else}<p class="meta">Commit yok.</p>{/each}
      </section>
    </div>
  {:else if !error}
    <p class="meta">Yükleniyor…</p>
  {/if}
</div>

<style>
  .wrap { padding: 16px 20px; height: 100%; overflow-y: auto; box-sizing: border-box; }
  header { display: flex; gap: 8px; align-items: center; }
  h2 { margin: 0; font-size: 16px; }
  h3 { margin: 0 0 6px; font-size: 13px; color: #8a90a0; }
  .spacer { flex: 1; }
  .badge { border: 1px solid #f59e0b; color: #f59e0b; border-radius: 10px; padding: 0 6px; font-size: 11px; }
  .meta { color: #8a90a0; }
  .err { color: #f87171; }
  button { background: #252830; color: inherit; border: 1px solid #353944; border-radius: 4px; padding: 3px 8px; font: inherit; cursor: pointer; }
  .local { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 8px 0 14px; }
  .cols { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
  section { border: 1px solid #2a2d35; border-radius: 6px; padding: 10px 12px; background: #1a1c22; }
  .wide { grid-column: 1 / -1; }
  .row { display: flex; gap: 6px; align-items: baseline; width: 100%; text-align: left; background: none; border: 0; padding: 3px 0; }
  .row:hover { color: #93c5fd; }
  .row small { margin-left: auto; color: #8a90a0; white-space: nowrap; padding-left: 8px; }
  em { color: #8a90a0; font-size: 11px; }
  code { color: #8a90a0; }
</style>
