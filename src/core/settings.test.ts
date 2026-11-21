import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, migrate } from "./settings";

describe("migrate", () => {
  it("returns defaults for missing or invalid input", () => {
    expect(migrate(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(migrate("garbage")).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps user values and fills missing keys", () => {
    const s = migrate({ terminal: { fontSize: 16 } });
    expect(s.terminal.fontSize).toBe(16);
    expect(s.terminal.scrollback).toBe(DEFAULT_SETTINGS.terminal.scrollback);
    expect(s.browser.home).toBe(DEFAULT_SETTINGS.browser.home);
  });
});
