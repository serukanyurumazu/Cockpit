import { load, type Store } from "@tauri-apps/plugin-store";
import { Channel, invoke } from "@tauri-apps/api/core";
import { unityEventParser, type UnityEvent } from "../modules/project/parse";

const MAX = 300;
/** Important Unity events (compiles, builds), newest first. */
export const timeline = $state<UnityEvent[]>([]);
let store: Store | null = null;
let saveTimer = 0;

function save() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    if (!store) return;
    await store.set("events", $state.snapshot(timeline));
    await store.save();
  }, 500);
}

export function addUnityEvent(ev: Omit<UnityEvent, "t">) {
  timeline.unshift({ t: Date.now(), ...ev });
  if (timeline.length > MAX) timeline.length = MAX;
  save();
  return timeline[0];
}

export function clearTimeline() {
  timeline.length = 0;
  save();
}

/** A line feeder for one log source (Editor.log or one batch build's output). */
export function unityFeed(project?: string) {
  const parse = unityEventParser();
  let lastFail: UnityEvent | null = null;
  return (line: string) => {
    const r = parse(line);
    if (!r) return;
    if (!("kind" in r)) {
      // compiler errors follow the failure line; keep the first few on that event
      const d = lastFail && (lastFail.detail ??= []);
      if (d && d.length < 5 && !d.includes(r.detail)) {
        d.push(r.detail);
        save();
      }
      return;
    }
    const ev = addUnityEvent(project ? { ...r, project } : r);
    lastFail = ev.ok === false ? ev : null;
  };
}

/** Loads saved events and follows the default Editor.log for the whole app session. */
export async function startUnityTimeline() {
  store = await load("unity-timeline.json", { defaults: {}, autoSave: false });
  const saved = ((await store.get("events")) as UnityEvent[] | undefined) ?? [];
  timeline.push(...saved.slice(0, MAX));
  const path = await invoke<string>("plugin:project|unity_default_log");
  const feed = unityFeed();
  // shortcut: the first chunk is old backlog without timestamps, so events from while Cockpit was
  // closed are skipped; read Editor-prev.log / file offsets if that history is ever needed.
  let first = true;
  const ch = new Channel<{ text?: string; reset?: boolean }>();
  ch.onmessage = (m) => {
    if (m.text && first) return void (first = false);
    first = false;
    for (const line of (m.text ?? "").split(/\r?\n/)) if (line) feed(line);
  };
  await invoke("plugin:project|tail_start", { id: "unity-timeline", path, onData: ch });
}
