<script lang="ts">
  import { onMount } from "svelte";
  import { createDockview, themeAbyss, type DockviewApi } from "dockview";
  import "dockview/dist/styles/dockview.css";
  import "./modules";
  import { registry, type ModuleCtx } from "./core/module";
  import { loadSettings, type Settings } from "./core/settings";
  import { loadLayout, saveLayout } from "./core/layout";
  import { agents, anyWorking } from "./core/agents.svelte";
  import { adapters, type AgentId } from "./modules/agents/adapters";
  import { ask, open } from "@tauri-apps/plugin-dialog";
  import { getCurrentWindow } from "@tauri-apps/api/window";

  let host: HTMLDivElement;
  let api: DockviewApi | null = null;
  let settings: Settings;

  const isMac = navigator.userAgent.includes("Mac");
  let saveTimer = 0;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => api && saveLayout(api.toJSON()), 400);
  };
  // Native browser webviews paint above HTML, so they hide while a drag or modal covers them.
  const cover = (on: boolean) => window.dispatchEvent(new CustomEvent("cockpit:cover", { detail: on }));

  function addPanel(component: string, params: Record<string, unknown> = {}) {
    if (!api) return;
    const mod = registry.get(component);
    api.addPanel({
      id: `${component}-${crypto.randomUUID().slice(0, 8)}`,
      component,
      title: mod?.title ?? component,
      params,
      position: api.activeGroup ? { referenceGroup: api.activeGroup } : undefined,
    });
  }

  async function addAgent(agent: AgentId) {
    cover(true); // native dialog must not sit under a browser webview
    try {
      const dir = await open({ directory: true, title: `${adapters[agent].title}: proje klasörü`, defaultPath: localStorage.getItem("lastDir") ?? undefined });
      if (typeof dir !== "string") return;
      localStorage.setItem("lastDir", dir);
      addPanel("terminal", { agent, cwd: dir });
    } finally {
      cover(false);
    }
  }

  const focusPane = (id: string) => api?.getPanel(id)?.api.setActive();
  const stateLabel: Record<string, string> = { unknown: "?", working: "çalışıyor", idle: "boşta", needs_input: "onay bekliyor", exited: "bitti" };

  function cyclePanel(step: number) {
    const group = api?.activeGroup;
    const active = api?.activePanel;
    if (!group || !active || group.panels.length < 2) return;
    const i = group.panels.indexOf(active);
    group.panels[(i + step + group.panels.length) % group.panels.length].api.setActive();
  }

  // App shortcuts use Ctrl+Shift (Cmd on macOS) so plain Ctrl+W/T stay with the terminal.
  function onKey(e: KeyboardEvent) {
    const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey;
    const k = e.key.toLowerCase();
    let handled = true;
    if (e.ctrlKey && k === "tab") cyclePanel(e.shiftKey ? -1 : 1);
    else if (mod && k === "t") addPanel("terminal");
    else if (mod && k === "b") addPanel("browser");
    else if (mod && k === "w") api?.activePanel?.api.close();
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function addDefault() {
    addPanel("terminal");
  }

  onMount(() => {
    let disposed = false;
    const offs: { dispose(): void }[] = [];
    (async () => {
      settings = await loadSettings();
      const saved = await loadLayout();
      if (disposed) return;
      api = createDockview(host, {
        theme: themeAbyss,
        createComponent: ({ name }) => {
          const element = document.createElement("div");
          element.style.height = "100%";
          let view: { dispose(): void } | undefined;
          return {
            element,
            init: ({ api: panel, containerApi, params }) => {
              const mod = registry.get(name);
              if (!mod) {
                element.textContent = `Bilinmeyen modül: ${name}`;
                return;
              }
              const state = { ...(params ?? {}) } as Record<string, unknown>;
              const ctx: ModuleCtx = {
                paneId: panel.id,
                settings,
                state,
                saveState(patch) {
                  Object.assign(state, patch);
                  panel.updateParameters({ ...state });
                  scheduleSave();
                },
                setTitle: (t) => panel.setTitle(t),
                onVisibility(cb) {
                  const d = panel.onDidVisibilityChange((e) => cb(e.isVisible));
                  return () => d.dispose();
                },
                onLayout(cb) {
                  const d = containerApi.onDidLayoutChange(cb);
                  return () => d.dispose();
                },
              };
              view = mod.createView(element, ctx);
            },
            dispose: () => view?.dispose(),
          };
        },
      });
      try {
        if (saved) api.fromJSON(saved);
      } catch {
        api.clear(); // corrupt or incompatible layout: fall back to default
      }
      if (api.panels.length === 0) addDefault();
      if (import.meta.env.DEV) (window as any).__cockpit = { api }; // e2e hook
      offs.push(
        api.onDidLayoutChange(scheduleSave),
        api.onWillDragPanel(() => cover(true)),
        api.onWillDragGroup(() => cover(true)),
      );
    })();
    // Closing kills agent processes: confirm while one is mid-task (files may be half-written).
    const offClose = getCurrentWindow().onCloseRequested(async (e) => {
      if (!anyWorking()) return;
      cover(true);
      const ok = await ask("Çalışan bir ajan var. Kapatılırsa yarım kalan işi kaybolabilir. Yine de kapatılsın mı?", { title: "AI Dev Cockpit", kind: "warning" });
      cover(false);
      if (!ok) e.preventDefault();
    });
    const endDrag = () => cover(false);
    window.addEventListener("dragend", endDrag, true);
    window.addEventListener("drop", endDrag, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      disposed = true;
      offClose.then((un) => un());
      offs.forEach((o) => o.dispose());
      window.removeEventListener("dragend", endDrag, true);
      window.removeEventListener("drop", endDrag, true);
      window.removeEventListener("keydown", onKey, true);
      api?.dispose();
    };
  });

  const shortcut = isMac ? "⌘" : "Ctrl+Shift+";
</script>

<div class="shell">
  <header>
    <strong>AI Dev Cockpit</strong>
    <button title="{shortcut}T" onclick={() => addPanel("terminal")}>+ Terminal</button>
    <button title="{shortcut}B" onclick={() => addPanel("browser")}>+ Tarayıcı</button>
    <span class="sep"></span>
    {#each Object.values(adapters) as a (a.id)}
      <button onclick={() => addAgent(a.id)}>+ {a.title}</button>
    {/each}
    <span class="agents">
      {#each Object.values(agents) as a (a.paneId)}
        <button class="chip {a.state}" title={stateLabel[a.state]} onclick={() => focusPane(a.paneId)}>
          <i></i>{a.title}<small>{stateLabel[a.state]}</small>
        </button>
      {/each}
    </span>
  </header>
  <div class="dock" bind:this={host}></div>
</div>

<style>
  .shell { display: flex; flex-direction: column; height: 100%; }
  header { display: flex; gap: 12px; align-items: center; padding: 6px 10px; border-bottom: 1px solid #2a2d35; }
  button { background: #252830; color: inherit; border: 1px solid #353944; border-radius: 4px; padding: 2px 10px; cursor: pointer; }
  .dock { flex: 1; min-height: 0; }
  .sep { width: 1px; height: 18px; background: #353944; }
  .agents { margin-left: auto; display: flex; gap: 6px; }
  .chip { display: flex; align-items: center; gap: 6px; }
  .chip small { color: #8a90a0; }
  .chip i { width: 8px; height: 8px; border-radius: 50%; background: #6b7280; }
  .chip.working i { background: #3b82f6; }
  .chip.idle i { background: #22c55e; }
  .chip.needs_input i { background: #f59e0b; box-shadow: 0 0 6px #f59e0b; }
  .chip.exited i { background: #374151; }
  .chip.needs_input { border-color: #f59e0b; }
</style>
