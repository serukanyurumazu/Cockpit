<script lang="ts">
  import Terminal from "./modules/terminal/Terminal.svelte";

  let terminals = $state<string[]>([crypto.randomUUID()]);
  const addTerminal = () => (terminals = [...terminals, crypto.randomUUID()]);
  const close = (key: string) => (terminals = terminals.filter((k) => k !== key));
</script>

<div class="shell">
  <header>
    <strong>AI Dev Cockpit</strong>
    <button onclick={addTerminal}>+ Terminal</button>
  </header>
  <section class="grid">
    {#each terminals as key (key)}
      <div class="pane">
        <div class="bar">
          <span>terminal</span>
          <button title="Kapat" onclick={() => close(key)}>×</button>
        </div>
        <div class="body"><Terminal /></div>
      </div>
    {/each}
  </section>
</div>

<style>
  .shell { display: flex; flex-direction: column; height: 100%; }
  header { display: flex; gap: 12px; align-items: center; padding: 6px 10px; border-bottom: 1px solid #2a2d35; }
  button { background: #252830; color: inherit; border: 1px solid #353944; border-radius: 4px; padding: 2px 10px; cursor: pointer; }
  .grid { flex: 1; display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); grid-auto-rows: 1fr; gap: 4px; padding: 4px; min-height: 0; }
  .pane { display: flex; flex-direction: column; border: 1px solid #2a2d35; border-radius: 4px; min-height: 0; }
  .bar { display: flex; justify-content: space-between; align-items: center; padding: 2px 6px; font-size: 11px; color: #8a90a0; border-bottom: 1px solid #2a2d35; }
  .bar button { padding: 0 6px; }
  .body { flex: 1; min-height: 0; }
</style>
