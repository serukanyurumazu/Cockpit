// Agent adapters: how each local CLI is launched, hooked and resumed. Uses the CLI's own login
// (never API keys). Adding a CLI = one entry here. Hook payload formats are CLI-version specific:
// verified against claude 2.1.330, codex-cli 0.171.0, agy 1.5.13.

export type AgentId = "claude" | "codex" | "antigravity";
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
  /** command that installs hooks a CLI only reads from a global file */
  globalHooks?: string;
}

/** Constant hook command (resolvable via PATH) so Codex's hook-trust hash never changes. */
export const hookCommand = (provider: AgentId) => `cockpit --hook ${provider}`;

const commandHooks = (provider: AgentId, events: string[]) =>
  Object.fromEntries(
    events.map((e) => [e, [{ hooks: [{ type: "command", command: hookCommand(provider), timeout: 10 }] }]]),
  );

const CLAUDE_EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "PermissionRequest", "Notification", "Stop", "StopFailure", "SessionEnd"];
const CODEX_EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "PermissionRequest", "Stop", "SessionEnd"];

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

// Antigravity CLI (agy), Google's successor to Gemini CLI. Hooks are file-only, so they live in the
// global hooks.json (see ensure_antigravity_hooks); events carry no permission signal.
const antigravity: AgentAdapter = {
  id: "antigravity",
  title: "Antigravity",
  bin: "agy",
  configs: () => ({}),
  globalHooks: "plugin:hooks|ensure_antigravity_hooks",
  launch({ sessionId, resume }) {
    return { args: resume && sessionId ? ["--conversation", sessionId] : [], env: {} };
  },
  onHook({ event }) {
    switch (event) {
      case "PreInvocation":
        return "working";
      case "SessionStart":
      case "Stop":
        return "idle";
    }
    return undefined;
  },
};

export const adapters: Record<AgentId, AgentAdapter> = { claude, codex, antigravity };

/**
 * Unity batch build/run line. On Windows, Unity.exe is a GUI-subsystem binary: PowerShell would not
 * wait for it, so stdout is piped through Out-Host (waits, streams -logFile - output).
 */
export function unityBuildLine(editor: string, project: string, method: string, windows: boolean): string {
  const args = ["-batchmode", "-quit", "-projectPath", project, "-executeMethod", method, "-logFile", "-"];
  return windows
    ? `${shellLine(editor, args, true)} | Out-Host; "Unity çıkış kodu: $LASTEXITCODE"`
    : `${shellLine(editor, args, false)}; echo "Unity çıkış kodu: $?"`;
}

/** One command line for the user's shell: PowerShell on Windows, POSIX sh elsewhere. */
export function shellLine(bin: string, args: string[], windows: boolean): string {
  if (windows) {
    const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
    return `& ${q(bin)} ${args.map(q).join(" ")}`.trimEnd();
  }
  const q = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  return [bin, ...args].map(q).join(" ");
}
