<script lang="ts">
  import { agents } from "./core/agents.svelte";
  import { adapters, type AgentId } from "./modules/agents/adapters";

  let {
    active,
    terminalOpen,
    open,
    addAgent,
    addProject,
    addBrain,
    focusPane,
    toggleTerminal,
  }: {
    active: string;
    terminalOpen: boolean;
    open: (component: string) => void;
    addAgent: (id: AgentId) => void;
    addProject: () => void;
    addBrain: () => void;
    focusPane: (id: string) => void;
    toggleTerminal: () => void;
  } = $props();

  const stateLabel: Record<string, string> = { unknown: "?", working: "çalışıyor", idle: "boşta", needs_input: "onay bekliyor", exited: "bitti" };
</script>

<nav>
  <div class="brand">AI Dev Cockpit</div>

  <button class="item" class:on={active === "dashboard"} onclick={() => open("dashboard")}>Dashboard</button>

  <section>
    <h3>Repos</h3>
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
  .toggle { margin-top: auto; border: 1px solid #353944; padding: 4px 8px; }
</style>
