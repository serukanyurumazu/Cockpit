<script lang="ts">
  import { agents } from "./core/agents.svelte";
  import { adapters, type AgentId } from "./modules/agents/adapters";
  import { cloneOf, groupByArea, loadRepos, repos, type Repo } from "./core/repos.svelte";

  let {
    active,
    activeRepo,
    terminalOpen,
    open,
    addAgent,
    addProject,
    addBrain,
    focusPane,
    toggleTerminal,
    openRepo,
    chooseCloneRoot,
  }: {
    active: string;
    activeRepo: string;
    openRepo: (repo: string) => void;
    chooseCloneRoot: () => void;
    terminalOpen: boolean;
    open: (component: string) => void;
    addAgent: (id: AgentId) => void;
    addProject: () => void;
    addBrain: () => void;
    focusPane: (id: string) => void;
    toggleTerminal: () => void;
  } = $props();

  let expanded = $state<Record<string, boolean>>(JSON.parse(localStorage.getItem("reposExpanded") ?? "{}"));
  let q = $state("");
  function toggle(owner: string) {
    expanded[owner] = !expanded[owner];
    localStorage.setItem("reposExpanded", JSON.stringify(expanded));
  }
  const match = (r: Repo) => !q || r.name.toLowerCase().includes(q.toLowerCase());
  const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop();

  const stateLabel: Record<string, string> = { unknown: "?", working: "çalışıyor", idle: "boşta", needs_input: "onay bekliyor", exited: "bitti" };
</script>

{#snippet leaf(r: Repo, indent: number)}
  <button class="sub leaf" style:padding-left="{indent}px" class:on={activeRepo === r.nameWithOwner} class:dim={r.isArchived} title={r.description || r.nameWithOwner} onclick={() => openRepo(r.nameWithOwner)}>
    <i class:local={!!cloneOf(r.nameWithOwner)} title={cloneOf(r.nameWithOwner) ? "yerel klon var" : ""}></i>{r.name}{#if r.isPrivate}<small>özel</small>{/if}
  </button>
{/snippet}

<nav>
  <div class="brand">AI Dev Cockpit</div>

  <button class="item" class:on={active === "dashboard"} onclick={() => open("dashboard")}>Dashboard</button>

  <section>
    <h3>Repos <button class="icon" title="Yenile" onclick={loadRepos} disabled={repos.loading}>⟳</button></h3>
    {#if repos.loading && !repos.owners.length}<div class="note">Yükleniyor…</div>{/if}
    {#if repos.error}<div class="note err" title={repos.error}>{repos.error}</div>{/if}
    {#if repos.owners.length}
      <input class="filter" placeholder="Repo ara" bind:value={q} />
    {/if}
    {#each repos.owners as o, i (o.owner)}
      {@const shown = (i === 0 ? o.repos.filter((r) => cloneOf(r.nameWithOwner)) : o.repos).filter(match)}
      <button class="sub owner" onclick={() => toggle(o.owner)}>
        <span class="caret">{expanded[o.owner] || q ? "▾" : "▸"}</span>{o.owner}<small>{shown.length}</small>
      </button>
      {#if expanded[o.owner] || q}
        {#if i === 0}
          <!-- personal account: only repos cloned under the clone folder -->
          {#each shown as r (r.nameWithOwner)}
            {@render leaf(r, 28)}
          {:else}
            <div class="note">{repos.root ? "Klon klasöründe kişisel repo yok." : "Klon klasörü seçilmedi."}</div>
          {/each}
        {:else}
          {#each groupByArea(shown) as [area, list] (area)}
            <button class="sub area" onclick={() => toggle(o.owner + "/" + area)}>
              <span class="caret">{expanded[o.owner + "/" + area] || q ? "▾" : "▸"}</span>{area}<small>{list.length}</small>
            </button>
            {#if expanded[o.owner + "/" + area] || q}
              {#each list as r (r.nameWithOwner)}{@render leaf(r, 40)}{/each}
            {/if}
          {/each}
        {/if}
      {/if}
    {/each}
    <button class="sub" onclick={chooseCloneRoot} title={repos.root}>Klon klasörü: {repos.root ? folderName(repos.root) : "seç"}</button>
    <button class="sub" onclick={addProject}>+ Yerel klasör aç</button>
  </section>

  <button class="item" class:on={active === "routines"} onclick={() => open("routines")}>Rutinler</button>

  <section>
    <h3>Ajanlar</h3>
    {#each Object.values(agents) as a (a.paneId)}
      <button class="sub chip {a.state}" title={stateLabel[a.state]} onclick={() => focusPane(a.paneId)}>
        <i></i>{a.title}<small>{stateLabel[a.state]}</small>
      </button>
    {/each}
    <div class="add">
      {#each Object.values(adapters) as a (a.id)}
        <button onclick={() => addAgent(a.id)}>+ {a.title}</button>
      {/each}
    </div>
  </section>

  <button class="item" class:on={active === "unity"} onclick={() => open("unity")}>Unity</button>
  <button class="item" class:on={active === "cicd"} onclick={() => open("cicd")}>CI/CD</button>
  <button class="item" class:on={active === "brain"} onclick={addBrain}>İkinci beyin</button>
  <button class="item" class:on={active === "browser"} onclick={() => open("browser")}>Tarayıcı</button>

  <button class="toggle" onclick={toggleTerminal}>{terminalOpen ? "Terminali gizle" : "Terminali göster"}</button>
</nav>

<style>
  nav { width: 220px; flex: none; display: flex; flex-direction: column; gap: 2px; padding: 8px; border-right: 1px solid #2a2d35; overflow-y: auto; background: #1a1c22; }
  .brand { font-weight: 700; padding: 4px 8px 10px; }
  button { background: none; color: inherit; border: 0; border-radius: 4px; text-align: left; cursor: pointer; font: inherit; }
  .item { padding: 6px 8px; }
  .item:hover, .sub:hover { background: #252830; }
  .item.on { background: #2b3040; }
  section { padding: 4px 0; }
  h3 { margin: 6px 8px 2px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #8a90a0; }
  .sub { display: flex; align-items: center; gap: 6px; width: 100%; padding: 4px 8px 4px 16px; }
  .add { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 8px 4px 16px; }
  .add button { border: 1px solid #353944; padding: 1px 6px; font-size: 12px; }
  .chip small { margin-left: auto; color: #8a90a0; }
  .chip i { width: 8px; height: 8px; border-radius: 50%; background: #6b7280; flex: none; }
  .chip.working i { background: #3b82f6; }
  .chip.idle i { background: #22c55e; }
  .chip.needs_input i { background: #f59e0b; box-shadow: 0 0 6px #f59e0b; }
  .chip.exited i { background: #374151; }
  h3 { display: flex; align-items: center; }
  .icon { margin-left: auto; padding: 0 4px; font-size: 13px; color: #8a90a0; }
  .note { padding: 2px 8px 2px 16px; color: #8a90a0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .note.err { color: #f87171; }
  .filter { margin: 2px 8px 4px 16px; width: calc(100% - 24px); box-sizing: border-box; background: #252830; color: inherit; border: 1px solid #353944; border-radius: 4px; padding: 2px 6px; font: inherit; }
  .owner { font-weight: 600; }
  .area { padding-left: 28px; color: #b8bcc8; }
  .area small { margin-left: auto; color: #8a90a0; }
  .owner small { margin-left: auto; color: #8a90a0; font-weight: normal; }
  .caret { width: 10px; color: #8a90a0; }
  .leaf { padding-left: 28px; overflow: hidden; white-space: nowrap; }
  .leaf.on { background: #2b3040; }
  .leaf.dim { opacity: .5; }
  .leaf i { width: 6px; height: 6px; border-radius: 50%; flex: none; }
  .leaf i.local { background: #22c55e; }
  .leaf small { margin-left: auto; color: #8a90a0; font-size: 11px; }
  .toggle { margin-top: auto; border: 1px solid #353944; padding: 4px 8px; }
</style>
