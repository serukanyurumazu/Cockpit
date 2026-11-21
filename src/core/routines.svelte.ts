import { load, type Store } from "@tauri-apps/plugin-store";
import { dayKey, dueRoutines, type Routine } from "../modules/routines/schedule";

export const routines = $state<Routine[]>([]);
let store: Store | null = null;
let runner: (r: Routine) => void = () => {};

export async function saveRoutines() {
  if (!store) return;
  await store.set("routines", $state.snapshot(routines));
  await store.save();
}

export function runRoutine(r: Routine) {
  r.lastRun = dayKey(new Date());
  saveRoutines();
  runner(r);
}

/** Loads routines and checks every 20 s for due ones; run opens the agent pane. */
export async function startRoutines(run: (r: Routine) => void) {
  runner = run;
  store = await load("routines.json", { defaults: {}, autoSave: false });
  routines.push(...(((await store.get("routines")) as Routine[] | undefined) ?? []));
  const tick = () => dueRoutines(routines, new Date()).forEach(runRoutine);
  tick();
  setInterval(tick, 20_000);
}
