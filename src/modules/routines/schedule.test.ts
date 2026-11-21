import { describe, expect, it } from "vitest";
import { dueRoutines, type Routine } from "./schedule";

const r = (over: Partial<Routine> = {}): Routine => ({
  id: "1", name: "n", time: "09:00", days: [], agent: "claude", cwd: "C:/p", prompt: "p", enabled: true, ...over,
});
// Friday 2026-11-20
const at = (hh: number, mm: number) => new Date(2026, 10, 20, hh, mm);

describe("dueRoutines", () => {
  it("fires inside the grace window only", () => {
    expect(dueRoutines([r()], at(8, 59))).toHaveLength(0);
    expect(dueRoutines([r()], at(9, 0))).toHaveLength(1);
    expect(dueRoutines([r()], at(9, 9))).toHaveLength(1);
    expect(dueRoutines([r()], at(9, 10))).toHaveLength(0);
  });
  it("skips disabled, already-run-today and other weekdays", () => {
    expect(dueRoutines([r({ enabled: false })], at(9, 1))).toHaveLength(0);
    expect(dueRoutines([r({ lastRun: "2026-11-20" })], at(9, 1))).toHaveLength(0);
    expect(dueRoutines([r({ lastRun: "2026-11-19" })], at(9, 1))).toHaveLength(1);
    expect(dueRoutines([r({ days: [1, 2] })], at(9, 1))).toHaveLength(0);
    expect(dueRoutines([r({ days: [5] })], at(9, 1))).toHaveLength(1);
  });
});
