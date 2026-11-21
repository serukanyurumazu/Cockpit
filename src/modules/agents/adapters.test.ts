import { describe, expect, it } from "vitest";
import { adapters, shellLine } from "./adapters";

describe("claude adapter", () => {
  const a = adapters.claude;
  it("maps hook events to states", () => {
    expect(a.onHook({ event: "UserPromptSubmit" })).toBe("working");
    expect(a.onHook({ event: "PermissionRequest" })).toBe("needs_input");
    expect(a.onHook({ event: "Stop" })).toBe("idle");
    expect(a.onHook({ event: "Notification", notificationType: "permission_prompt" })).toBe("needs_input");
    expect(a.onHook({ event: "Notification", notificationType: "auth_success" })).toBeUndefined();
  });
  it("starts with a fixed session id and resumes it", () => {
    const paths = { "claude-settings.json": "C:/x/s.json" };
    const fresh = a.launch({ paths, resume: false });
    expect(fresh.args).toEqual(["--settings", "C:/x/s.json", "--session-id", fresh.sessionId]);
    expect(a.launch({ paths, resume: true, sessionId: "abc" }).args).toEqual(["--settings", "C:/x/s.json", "--resume", "abc"]);
  });
  it("hooks use the constant forwarder command", () => {
    const cfg = JSON.parse(a.configs()["claude-settings.json"]);
    expect(cfg.hooks.Stop[0].hooks[0].command).toBe("cockpit --hook claude");
  });
});

describe("codex adapter", () => {
  it("passes hooks as TOML without double quotes", () => {
    const { args } = adapters.codex.launch({ paths: {}, resume: false });
    expect(args.filter((x) => x === "-c").length).toBeGreaterThan(0);
    expect(args.join(" ")).not.toContain('"');
    expect(adapters.codex.launch({ paths: {}, resume: true, sessionId: "s1" }).args.at(-1)).toBe("s1");
  });
});

describe("antigravity adapter", () => {
  it("maps file-hook events and resumes by conversation id", () => {
    const a = adapters.antigravity;
    expect(a.onHook({ event: "PreInvocation" })).toBe("working");
    expect(a.onHook({ event: "Stop" })).toBe("idle");
    expect(a.launch({ paths: {}, resume: true, sessionId: "c1" }).args).toEqual(["--conversation", "c1"]);
  });
});

describe("shellLine", () => {
  it("quotes for PowerShell", () => {
    expect(shellLine("claude", ["--settings", "C:/a b/it's.json"], true)).toBe("& 'claude' '--settings' 'C:/a b/it''s.json'");
  });
  it("quotes for sh", () => {
    expect(shellLine("claude", ["--settings", "/a b/it's.json"], false)).toBe("claude --settings '/a b/it'\\''s.json'");
  });
});
