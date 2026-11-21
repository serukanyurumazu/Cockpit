<script lang="ts">
  import { onMount, tick } from "svelte";
  import { Channel, invoke } from "@tauri-apps/api/core";
  import type { ModuleCtx } from "../../core/module";
  import { addTask, classifyLogLine, parseGitStatus, parseTasks, toggleTask, type GitStatus, type LogLevel } from "./parse";

  let { ctx }: { ctx: ModuleCtx } = $props();
  // svelte-ignore state_referenced_locally
  const path = ctx.state.path as string;
  const MAX_LINES = 2000;

  let git = $state<GitStatus | null>(null);
  let gitErr = $state("");
  let isUnity = $state(false);
  // svelte-ignore state_referenced_locally
  let logPath = $state((ctx.state.logPath as string | undefined) ?? "");
  let lines = $state<{ id: number; text: string; level: LogLevel | "sep" }[]>([]);
  let filter = $state<"all" | "error" | "warning">("all");
  let tasksMd = $state("");
  let tasksFile = $state("");
  let newTask = $state("");
  let taskMsg = $state("");
  let logEl = $state<HTMLDivElement>();

  const shown = $derived(filter === "all" ? lines : lines.filter((l) => l.level === filter || l.level === "sep"));
  const errors = $derived(lines.filter((l) => l.level === "error").length);
  const warnings = $derived(lines.filter((l) => l.level === "warning").length);
  const tasks = $derived(parseTasks(tasksMd));

  const p = (cmd: string, args: Record<string, unknown> = {}) => invoke<any>(`plugin:project|${cmd}`, args);
  let lineId = 0;

  async function refreshGit() {
    try {
      git = parseGitStatus(await p("git_status", { path, untracked: true }));
      gitErr = "";
    } catch (e) {
      git = null;
      gitErr = String(e);
    }
  }

  async function loadTasks() {
    const t = await p("read_tasks", { path });
    tasksFile = t.path;
    if (t.content !== tasksMd) tasksMd = t.content;
  }

  async function saveTasks(next: string) {
    try {
      await p("write_tasks", { path, expected: tasksMd, content: next });
      tasksMd = next;
      taskMsg = "";
    } catch (e) {
      if (String(e).includes("conflict")) taskMsg = "TASKS.md dışarıda değişti (ör. bir ajan). Yeniden yüklendi, tekrar dene.";
      else taskMsg = String(e);
      await loadTasks();
    }
  }

  function onAdd(e: SubmitEvent) {
    e.preventDefault();
    if (!newTask.trim()) return;
    saveTasks(addTask(tasksMd, newTask));
    newTask = "";
  }

  let stopTail = () => {};
  async function startTail(file: string) {
    stopTail();
    lines = [];
    const ch = new Channel<{ text?: string; reset?: boolean }>();
    ch.onmessage = async (m) => {
      const stick = logEl ? logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 20 : true;
      if (m.reset) lines.push({ id: lineId++, text: "── log yeniden başladı (Unity yeniden açıldı) ──", level: "sep" });
      for (const text of (m.text ?? "").split(/\r?\n/)) {
        if (text) lines.push({ id: lineId++, text, level: classifyLogLine(text) });
      }
      if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
      if (stick) {
        await tick();
        logEl?.scrollTo({ top: logEl.scrollHeight });
      }
    };
    await p("tail_start", { id: ctx.paneId, path: file, onData: ch });
    stopTail = () => p("tail_stop", { id: ctx.paneId }).catch(() => {});
  }

  function changeLog(e: SubmitEvent) {
    e.preventDefault();
    ctx.saveState({ logPath });
    startTail(logPath);
  }

  onMount(() => {
    const folder = path.split(/[\\/]/).filter(Boolean).pop();
    ctx.setTitle(`Proje · ${folder}`);
    let visible = true;
    let stamp = "";
    let lastFull = 0;
    // Cheap stamp poll; full git status only on change (or every 15 s for worktree edits).
    const timer = setInterval(async () => {
      if (!visible) return;
      const s = await p("git_stamp", { path }).catch(() => "");
      if (s !== stamp || Date.now() - lastFull > 15000) {
        stamp = s;
        lastFull = Date.now();
        refreshGit();
      }
      loadTasks().catch(() => {});
    }, 2000);
    const offVis = ctx.onVisibility((v) => (visible = v));
    const onFocus = () => refreshGit();
    window.addEventListener("focus", onFocus);
    refreshGit();
    loadTasks().catch((e) => (taskMsg = String(e)));
    (async () => {
      isUnity = await p("is_unity_project", { path });
      if (!logPath) logPath = await p("unity_default_log");
      if (isUnity || ctx.state.logPath) startTail(logPath);
    })();
    return () => {
      clearInterval(timer);
      offVis();
      window.removeEventListener("focus", onFocus);
      stopTail();
    };
  });
</script>

<div class="proj">
  <div class="col">
    <section>
      <h3>Git <button class="mini" onclick={refreshGit} title="Yenile">↻</button></h3>
      {#if gitErr}
        <p class="muted">{gitErr.includes("not a git repository") ? "Git reposu değil" : gitErr}</p>
      {:else if git}
        <p>
          <strong>{git.branch ?? "?"}</strong>
          {#if git.ahead}<span class="pill">↑{git.ahead}</span>{/if}
          {#if git.behind}<span class="pill">↓{git.behind}</span>{/if}
          <span class="muted">{git.files.length ? `${git.files.length} değişiklik` : "temiz"}</span>
        </p>
        <ul class="files">
          {#each git.files.slice(0, 200) as f (f.path)}
            <li class={f.kind}><code>{f.kind === "untracked" ? "??" : f.kind === "conflict" ? "UU" : `${f.staged ? "S" : " "}${f.unstaged ? "M" : " "}`}</code> {f.path}</li>
          {/each}
        </ul>
      {/if}
    </section>
    <section>
      <h3>Görevler <span class="muted small" title={tasksFile}>TASKS.md</span></h3>
      <form onsubmit={onAdd}><input bind:value={newTask} placeholder="Yeni görev…" /></form>
      {#if taskMsg}<p class="warn">{taskMsg}</p>{/if}
      <ul class="tasks">
        {#each tasks as t (t.line)}
          <li class:done={t.done}>
            <label><input
                type="checkbox"
                checked={t.done}
                onchange={(e) => {
                  e.currentTarget.checked = t.done; // stays controlled: only a successful write flips it
                  saveTasks(toggleTask(tasksMd, t.line));
                }}
              /> {t.text}</label>
          </li>
        {/each}
      </ul>
    </section>
  </div>
  <section class="log">
    <h3>
      Unity log
      <span class="pill err">{errors} hata</span><span class="pill warn">{warnings} uyarı</span>
      <span class="tabs">
        {#each [["all", "Hepsi"], ["error", "Hatalar"], ["warning", "Uyarılar"]] as [k, label] (k)}
          <button class="mini" class:on={filter === k} onclick={() => (filter = k as typeof filter)}>{label}</button>
        {/each}
        <button class="mini" onclick={() => (lines = [])}>Temizle</button>
      </span>
    </h3>
    <form class="src" onsubmit={changeLog}><input bind:value={logPath} spellcheck="false" title="Log dosyası" /></form>
    {#if !isUnity && !ctx.state.logPath}
      <p class="muted">Unity projesi değil (Assets/ ve ProjectSettings/ yok). Bir log yolu girip Enter'a basarak yine de izleyebilirsin.</p>
    {/if}
    <div class="lines" bind:this={logEl}>
      {#each shown as l (l.id)}<div class={l.level}>{l.text}</div>{/each}
    </div>
  </section>
</div>

<style>
  .proj { display: flex; gap: 8px; height: 100%; padding: 8px; box-sizing: border-box; overflow: hidden; }
  .col { flex: 0 0 38%; display: flex; flex-direction: column; gap: 8px; min-height: 0; overflow: auto; }
  section { border: 1px solid #2a2d35; border-radius: 4px; padding: 6px 8px; min-height: 0; }
  h3 { margin: 0 0 6px; font-size: 12px; display: flex; gap: 6px; align-items: center; }
  .muted { color: #8a90a0; }
  .small { font-size: 11px; font-weight: normal; }
  .warn { color: #f59e0b; }
  .pill { font-size: 11px; padding: 0 6px; border-radius: 8px; background: #252830; }
  .pill.err { color: #f87171; }
  .pill.warn { color: #fbbf24; }
  .mini { background: #252830; color: inherit; border: 1px solid #353944; border-radius: 4px; padding: 0 6px; cursor: pointer; font-size: 11px; }
  .mini.on { border-color: #3b82f6; }
  .tabs { margin-left: auto; display: flex; gap: 4px; }
  ul { list-style: none; margin: 0; padding: 0; }
  .files li { font-family: "Cascadia Mono", Menlo, monospace; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .files code { color: #22c55e; }
  .files .untracked code { color: #8a90a0; }
  .files .conflict code { color: #f87171; }
  .tasks li.done { color: #8a90a0; text-decoration: line-through; }
  input:not([type]) { width: 100%; box-sizing: border-box; background: #0f1115; color: inherit; border: 1px solid #353944; border-radius: 4px; padding: 2px 6px; }
  .log { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .src { margin-bottom: 4px; }
  .lines { flex: 1; overflow: auto; font-family: "Cascadia Mono", Menlo, monospace; font-size: 11px; white-space: pre-wrap; word-break: break-all; }
  .lines .error { color: #f87171; }
  .lines .warning { color: #fbbf24; }
  .lines .trace { color: #6b7280; }
  .lines .sep { color: #3b82f6; margin: 4px 0; }
</style>
