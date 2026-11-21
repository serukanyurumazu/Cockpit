import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { AgentId, AgentState } from "../modules/agents/adapters";

export interface AgentInfo {
  paneId: string;
  agent: AgentId;
  title: string;
  state: AgentState;
  since: number;
}

/** Live status of every agent pane, keyed by dockview panel id. */
export const agents = $state<Record<string, AgentInfo>>({});
if (import.meta.env.DEV) (globalThis as any).__cockpitAgents = agents; // e2e hook

async function notify(title: string, body: string) {
  let ok = await isPermissionGranted();
  if (!ok) ok = (await requestPermission()) === "granted";
  if (ok) sendNotification({ title, body });
}

export function trackAgent(info: Omit<AgentInfo, "since" | "state">) {
  agents[info.paneId] = { ...info, state: "unknown", since: Date.now() };
}

export function setAgentState(paneId: string, state: AgentState) {
  const a = agents[paneId];
  if (!a || a.state === state) return;
  const prev = a.state;
  a.state = state;
  a.since = Date.now();
  if (document.hasFocus()) return;
  if (state === "needs_input") notify(a.title, "Onay bekliyor").catch(() => {});
  else if (state === "idle" && prev === "working") notify(a.title, "Tamamlandı").catch(() => {});
}

export function untrackAgent(paneId: string) {
  delete agents[paneId];
}

export const anyWorking = () => Object.values(agents).some((a) => a.state === "working");
