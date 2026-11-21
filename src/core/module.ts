import { mount, unmount, type Component } from "svelte";
import type { Settings } from "./settings";

/** What a module view gets from the shell. `state` is persisted with the layout. */
export interface ModuleCtx {
  paneId: string;
  settings: Settings;
  state: Record<string, unknown>;
  saveState(patch: Record<string, unknown>): void;
  setTitle(title: string): void;
  onVisibility(cb: (visible: boolean) => void): () => void;
  onLayout(cb: () => void): () => void;
  /** Opens another module's panel below this one (both stay visible). */
  openPanel(component: string, params: Record<string, unknown>): void;
}

export interface CockpitModule {
  id: string;
  title: string;
  createView(el: HTMLElement, ctx: ModuleCtx): { dispose(): void };
}

export const registry = new Map<string, CockpitModule>();

export function register(mod: CockpitModule): void {
  registry.set(mod.id, mod);
}

/** A module whose view is one Svelte component receiving `ctx`. */
export function svelteModule(id: string, title: string, view: Component<{ ctx: ModuleCtx }>): CockpitModule {
  return {
    id,
    title,
    createView(el, ctx) {
      const instance = mount(view, { target: el, props: { ctx } });
      return { dispose: () => unmount(instance) };
    },
  };
}
