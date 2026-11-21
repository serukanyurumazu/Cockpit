<script lang="ts">
  import { onMount } from "svelte";
  import { createDockview, themeAbyss, type DockviewApi } from "dockview";
  import "dockview/dist/styles/dockview.css";
  import "./modules";
  import { registry, type ModuleCtx } from "./core/module";
  import { loadSettings, type Settings } from "./core/settings";
  import { loadLayout, saveLayout } from "./core/layout";
  import { anyWorking } from "./core/agents.svelte";
  import Sidebar from "./Sidebar.svelte";
  import { startUnityTimeline } from "./core/unityTimeline.svelte";
  import { startRoutines } from "./core/routines.svelte";
  import { adapters, type AgentId } from "./modules/agents/adapters";
  import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { invoke } from "@tauri-apps/api/core";

  let host: HTMLDivElement;
  let termHost: HTMLDivElement;
  // Center shows what the sidebar selects; the right dock holds terminals and agents on every tab.
  let api: DockviewApi | null = null;
  let termApi: DockviewApi | null = null;
  let settings: Settings;
  let active = $state("");
  let terminalOpen = $state(localStorage.getItem("terminalOpen") !== "0");
  let termWidth = $state(Number(localStorage.getItem("termWidth")) || 520);
  const TERMINAL = new Set(["terminal"]);

  const isMac = navigator.userAgent.includes("Mac");
  let saveTimer = 0;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      if (api) await saveLayout(api.toJSON());
      if (termApi) await saveLayout(termApi.toJSON(), "terminalLayout");
    }, 400);
  };
  // Native browser webviews paint above HTML, so they hide while a drag or modal covers them.
  const cover = (on: boolean) => window.dispatchEvent(new CustomEvent("cockpit:cover", { detail: on }));

  function addPanel(component: string, params: Record<string, unknown> = {}, below?: string, target?: DockviewApi | null) {
    const dock = target ?? (TERMINAL.has(component) ? termApi : api);
    if (!dock) return;
    if (dock === termApi && !terminalOpen) showTerminal(true);
    const mod = registry.get(component);
    dock.addPanel({
      id: `${component}-${crypto.randomUUID().slice(0, 8)}`,
      component,
      title: mod?.title ?? component,
      params,
      position: below
        ? { referencePanel: below, direction: "below" }
        : dock.activeGroup
          ? { referenceGroup: dock.activeGroup }
          : undefined,
    });
  }

  async function pickFolder(title: string): Promise<string | null> {
    cover(true); // native dialog must not sit under a browser webview
    try {
      const dir = await openDialog({ directory: true, title, defaultPath: localStorage.getItem("lastDir") ?? undefined });
      if (typeof dir !== "string") return null;
      localStorage.setItem("lastDir", dir);
      return dir;
    } finally {
      cover(false);
    }
  }

  async function addAgent(agent: AgentId) {
    const dir = await pickFolder(`${adapters[agent].title}: proje klasörü`);
    if (!dir) return;
    let cwd = dir;
    const isRepo = await invoke("plugin:project|git_status", { path: dir, untracked: false }).then(() => true, () => false);
    if (isRepo) {
      const unity = await invoke<boolean>("plugin:project|is_unity_project", { path: dir });
      cover(true);
      const separate = await ask(
        "Ajan ayrı bir git worktree'de (yeni dal: cockpit/…) çalışsın mı? Böylece ana çalışma kopyan değişmez; birleştirmeyi git ile sen yaparsın." +
          (unity ? "\n\nUnity: Library/ yeni worktree'de yeniden içe aktarılır. İlk açılış dakikalar sürebilir ve birkaç GB disk kullanır." : ""),
        { title: "Worktree", kind: "info", okLabel: "Ayrı worktree", cancelLabel: "Aynı klasör" },
      );
      cover(false);
      if (separate) {
        const name = `${agent}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
        try {
          cwd = await invoke<string>("plugin:project|create_worktree", { path: dir, name });
        } catch (e) {
          await ask(`Worktree oluşturulamadı: ${e}\n\nAynı klasörde devam edilsin mi?`, { title: "Worktree", kind: "warning" }).then((ok) => { if (!ok) throw e; });
        }
      }
    }
    addPanel("terminal", { agent, cwd });
  }

  async function addBrain() {
    const dir = await pickFolder("Beyin: proje klasörü (notlar .cockpit/brain içinde)");
    if (!dir) return;
    const vault = await invoke<string>("plugin:brain|vault_for_project", { project: dir });
    addPanel("brain", { vault, project: dir });
  }

  async function addProject() {
    const dir = await pickFolder("Proje klasörü");
    if (dir) addPanel("project", { path: dir });
  }

  function focusPane(id: string) {
    const p = api?.getPanel(id) ?? termApi?.getPanel(id);
    if (p && termApi?.getPanel(id)) setTerminalOpen(true);
    p?.api.setActive();
  }

  const notes: Record<string, string> = {
    dashboard: "Özet kartları: ajan durumları, bugünkü rutinler, Unity son olaylar, açık PR'lar.",
    cicd: "İçeriği sonra tanımlanacak.",
  };
  /** Sidebar sections are one panel each: focus it if open, else add it to the center. */
  function open(component: string) {
    const existing = api?.panels.find((p) => p.id.startsWith(component + "-"));
    if (existing) existing.api.setActive();
    else addPanel(component, notes[component] ? { title: registry.get(component)?.title, note: notes[component] } : {});
  }

  function showTerminal(on: boolean) {
    terminalOpen = on;
    localStorage.setItem("terminalOpen", on ? "1" : "0");
  }
  function setTerminalOpen(on: boolean) {
    showTerminal(on);
    if (on && termApi && termApi.panels.length === 0) addPanel("terminal");
  }

  function startResize(e: PointerEvent) {
    const startX = e.clientX, startW = termWidth;
    cover(true);
    const move = (ev: PointerEvent) => (termWidth = Math.max(240, Math.min(window.innerWidth - 500, startW + startX - ev.clientX)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      localStorage.setItem("termWidth", String(termWidth));
      cover(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // Keyboard actions apply to the dock that has focus.
  const focusedDock = () => (termHost?.contains(document.activeElement) ? termApi : api);

  function cyclePanel(step: number) {
    const dock = focusedDock();
    const group = dock?.activeGroup;
    const active = dock?.activePanel;
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
    else if (mod && k === "w") focusedDock()?.activePanel?.api.close();
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  onMount(() => {
    let disposed = false;
    const offs: { dispose(): void }[] = [];
    (async () => {
      await invoke("plugin:browser|close_all").catch(() => {}); // orphans from a reload
      startUnityTimeline().catch(() => {}); // no Editor.log yet is fine
      settings = await loadSettings();
      const saved = await loadLayout();
      const savedTerm = await loadLayout("terminalLayout");
      if (disposed) return;
      const options: Parameters<typeof createDockview>[1] = {
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
                // opened next to (below) the caller so both stay visible, e.g. build output under Proje
                openPanel: (component, params) => addPanel(component, params, panel.id, containerApi),
              };
              view = mod.createView(element, ctx);
            },
            dispose: () => view?.dispose(),
          };
        },
      };
      api = createDockview(host, options);
      termApi = createDockview(termHost, options);
      for (const [dock, layout] of [[api, saved], [termApi, savedTerm]] as const) {
        try {
          if (layout) dock.fromJSON(layout);
        } catch {
          dock.clear(); // corrupt or incompatible layout: fall back to default
        }
        offs.push(
          dock.onDidLayoutChange(scheduleSave),
          dock.onWillDragPanel(() => cover(true)),
          dock.onWillDragGroup(() => cover(true)),
        );
      }
      // Older layouts kept terminals in the center: move them to the right dock.
      for (const p of api.panels.filter((p) => p.id.startsWith("terminal-"))) {
        const { id, title, params } = p;
        p.api.close();
        termApi.addPanel({ id, component: "terminal", title, params });
      }
      offs.push(api.onDidActivePanelChange((e) => (active = e.panel?.id.split("-")[0] ?? "")));
      if (api.panels.length === 0) open("dashboard");
      if (terminalOpen && termApi.panels.length === 0) addPanel("terminal");
      startRoutines((r) => addPanel("terminal", { agent: r.agent, cwd: r.cwd, prompt: r.prompt })).catch(() => {});
      if (import.meta.env.DEV) (window as any).__cockpit = { api, termApi }; // e2e hook
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
      termApi?.dispose();
    };
  });

</script>

<div class="shell">
  <Sidebar {active} {terminalOpen} {open} {addAgent} {addProject} {addBrain} {focusPane} toggleTerminal={() => setTerminalOpen(!terminalOpen)} />
  <div class="dock" bind:this={host}></div>
  <div class="split" class:hidden={!terminalOpen} onpointerdown={startResize} role="separator" aria-orientation="vertical"></div>
  <div class="dock right" class:hidden={!terminalOpen} style:width="{termWidth}px" bind:this={termHost}></div>
</div>

<style>
  .shell { display: flex; height: 100%; }
  .dock { flex: 1; min-width: 0; }
  .dock.right { flex: none; }
  .split { width: 4px; flex: none; cursor: col-resize; background: #2a2d35; }
  .split:hover { background: #3b82f6; }
  .hidden { display: none; }
</style>
