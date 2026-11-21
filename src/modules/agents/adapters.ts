// Agent adapters: how each local CLI is launched, hooked and resumed. Uses the CLI's own login
// (never API keys). Adding a CLI = one entry here. Hook payload formats are CLI-version specific:
// verified against claude 2.1.330, codex-cli 0.171.0, gemini 0.70.0.

export type AgentId = "claude" | "codex" | "gemini";
export type AgentState = "unknown" | "working" | "idle" | "needs_input" | "exited";

export interface HookSignal {
  event?: string | null;
  notificationType?: string | null;
  sessionId?: string | null;
}

export interface LaunchOptions {
  /** config file name -> absolute path, for files returned by configs() */
  paths: Record<string, string>;
  sessionId?: string;
  resume: boolean;
}

export interface Launch {
  args: string[];
  env: Record<string, string>;
  /** set when the session id is chosen up front (otherwise it arrives via hooks) */
  sessionId?: string;
}

export interface AgentAdapter {
  id: AgentId;
  title: string;
  bin: string;
  configs(): Record<string, string>;
  launch(o: LaunchOptions): Launch;
  onHook(s: HookSignal): AgentState | undefined;
}

/** Constant hook command (resolvable via PATH) so Codex's hook-trust hash never changes. */
export const hookCommand = (provider: AgentId) => `cockpit --hook ${provider}`;

const commandHooks = (provider: AgentId, events: string[]) =>
  Object.fromEntries(
    events.map((e) => [e, [{ hooks: [{ type: "command", command: hookCommand(provider), timeout: 10 }] }]]),
  );

const CLAUDE_EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "PermissionRequest", "Notification", "Stop", "StopFailure", "SessionEnd"];
const CODEX_EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "PermissionRequest", "Stop", "SessionEnd"];
const GEMINI_EVENTS = ["SessionStart", "BeforeAgent", "AfterTool", "Notification", "AfterAgent", "SessionEnd"];

const claude: AgentAdapter = {
  id: "claude",
  title: "Claude",
  bin: "claude",
  configs: () => ({ "claude-settings.json": JSON.stringify({ hooks: commandHooks("claude", CLAUDE_EVENTS) }) }),
  launch({ paths, sessionId, resume }) {
    const id = sessionId ?? crypto.randomUUID();
    const session = resume && sessionId ? ["--resume", sessionId] : ["--session-id", id];
    return { args: ["--settings", paths["claude-settings.json"], ...session], env: {}, sessionId: id };
  },
  onHook({ event, notificationType }) {
    switch (event) {
      case "UserPromptSubmit":
      case "PostToolUse":
        return "working";
      case "PermissionRequest":
        return "needs_input";
      case "SessionStart":
      case "Stop":
      case "StopFailure":
        return "idle";
      case "SessionEnd":
        return "exited";
      case "Notification":
        if (notificationType === "idle_prompt") return "idle";
        if (["permission_prompt", "elicitation_dialog", "agent_needs_input"].includes(notificationType ?? "")) return "needs_input";
    }
    return undefined;
  },
};

const codex: AgentAdapter = {
  id: "codex",
  title: "Codex",
  bin: "codex",
  configs: () => ({}),
  launch({ sessionId, resume }) {
    // TOML literal strings only: PowerShell 5.1 mangles double quotes in native arguments.
    const hooks = CODEX_EVENTS.flatMap((e) => ["-c", `hooks.${e}=[{hooks=[{type='command',command='${hookCommand("codex")}'}]}]`]);
    return { args: resume && sessionId ? ["resume", ...hooks, sessionId] : hooks, env: {} };
  },
  onHook({ event }) {
    switch (event) {
      case "UserPromptSubmit":
      case "PostToolUse":
        return "working";
      case "PermissionRequest":
        return "needs_input";
      case "SessionStart":
      case "Stop":
        return "idle";
      case "SessionEnd":
        return "exited";
    }
    return undefined;
  },
};

const gemini: AgentAdapter = {
  id: "gemini",
  title: "Gemini",
  bin: "gemini",
  configs: () => ({ "gemini-system-settings.json": JSON.stringify({ hooks: commandHooks("gemini", GEMINI_EVENTS) }) }),
  launch({ paths, sessionId, resume }) {
    const id = sessionId ?? crypto.randomUUID();
    return {
      args: resume && sessionId ? ["--resume", sessionId] : ["--session-id", id],
      env: { GEMINI_CLI_SYSTEM_SETTINGS_PATH: paths["gemini-system-settings.json"] },
      sessionId: id,
    };
  },
  onHook({ event }) {
    switch (event) {
      case "BeforeAgent":
      case "AfterTool":
        return "working";
      case "Notification":
        return "needs_input";
      case "SessionStart":
      case "AfterAgent":
        return "idle";
      case "SessionEnd":
        return "exited";
    }
    return undefined;
  },
};

export const adapters: Record<AgentId, AgentAdapter> = { claude, codex, gemini };

/** One command line for the user's shell: PowerShell on Windows, POSIX sh elsewhere. */
export function shellLine(bin: string, args: string[], windows: boolean): string {
  if (windows) {
    const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
    return `& ${q(bin)} ${args.map(q).join(" ")}`.trimEnd();
  }
  const q = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  return [bin, ...args].map(q).join(" ");
}
