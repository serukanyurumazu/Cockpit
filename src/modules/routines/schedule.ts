import type { AgentId } from "../agents/adapters";

export interface Routine {
  id: string;
  name: string;
  /** "HH:MM", local time */
  time: string;
  /** 0 = Sunday … 6 = Saturday; empty = every day */
  days: number[];
  agent: AgentId;
  cwd: string;
  prompt: string;
  enabled: boolean;
  /** local date (YYYY-MM-DD) of the last run */
  lastRun?: string;
}

/** Runs only this long after the scheduled time, so opening Cockpit late does not fire old routines. */
export const GRACE_MIN = 10;

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function dueRoutines(list: Routine[], now: Date): Routine[] {
  const today = dayKey(now);
  const minutes = now.getHours() * 60 + now.getMinutes();
  return list.filter((r) => {
    if (!r.enabled || r.lastRun === today) return false;
    if (r.days.length && !r.days.includes(now.getDay())) return false;
    const [h, m] = r.time.split(":").map(Number);
    const late = minutes - (h * 60 + m);
    return late >= 0 && late < GRACE_MIN;
  });
}
