import { load } from "@tauri-apps/plugin-store";

export const SETTINGS_VERSION = 1;

/** User settings (app data dir/settings.json). Never holds credentials: CLIs keep their own logins. */
export interface Settings {
  version: number;
  terminal: { shell: string | null; fontSize: number; scrollback: number };
  browser: { home: string };
  /** Extra CLI arguments per agent, e.g. { claude: { args: ["--model", "opus"] } } */
  agents: Record<string, { args: string[] }>;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  terminal: { shell: null, fontSize: 13, scrollback: 5000 },
  browser: { home: "https://github.com" },
  agents: { claude: { args: [] }, codex: { args: [] }, gemini: { args: [] } },
};

/** Fills missing keys from defaults and upgrades old versions. Unknown/invalid input yields defaults. */
export function migrate(raw: unknown): Settings {
  const r = raw && typeof raw === "object" ? (raw as Partial<Settings>) : {};
  // No migrations yet: v1 is the first version. Add steps here keyed on r.version.
  return {
    version: SETTINGS_VERSION,
    terminal: { ...DEFAULT_SETTINGS.terminal, ...(r.terminal ?? {}) },
    browser: { ...DEFAULT_SETTINGS.browser, ...(r.browser ?? {}) },
    agents: { ...DEFAULT_SETTINGS.agents, ...(r.agents ?? {}) },
  };
}

export async function loadSettings(): Promise<Settings> {
  try {
    const store = await load("settings.json", { defaults: {}, autoSave: false });
    const settings = migrate(await store.get("settings"));
    await store.set("settings", settings); // writes defaults on first run so the file is editable
    await store.save();
    return settings;
  } catch {
    return migrate(null); // unreadable file: run with defaults, don't overwrite it
  }
}
