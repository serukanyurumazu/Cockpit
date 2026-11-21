import { load, type Store } from "@tauri-apps/plugin-store";
import type { SerializedDockview } from "dockview";

// Kept apart from settings.json so a corrupt layout never costs the user their settings.
let store: Store | null = null;

export async function loadLayout(key = "layout"): Promise<SerializedDockview | null> {
  try {
    store ??= await load("layout.json", { defaults: {}, autoSave: false });
    return ((await store.get(key)) as SerializedDockview | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function saveLayout(layout: SerializedDockview, key = "layout"): Promise<void> {
  if (!store) return;
  await store.set(key, layout);
  await store.save();
}
