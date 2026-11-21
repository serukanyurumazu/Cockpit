import { describe, expect, it } from "vitest";
import { addTask, classifyLogLine, parseGitStatus, parseTasks, toggleTask, unityEventParser } from "./parse";

describe("parseGitStatus", () => {
  it("reads branch, ahead/behind and file kinds", () => {
    const out = [
      "# branch.oid abc",
      "# branch.head main",
      "# branch.ab +2 -1",
      "1 .M N... 100644 100644 100644 aaa bbb Assets/Scripts/Player Controller.cs",
      "1 A. N... 000000 100644 100644 000 ccc src/new.ts",
      "2 R. N... 100644 100644 100644 ddd eee R100 b.txt\ta.txt",
      "u UU N... 100644 100644 100644 100644 f1 f2 f3 conflict.txt",
      "? notes.md",
    ].join("\n");
    const s = parseGitStatus(out);
    expect(s.branch).toBe("main");
    expect([s.ahead, s.behind]).toEqual([2, 1]);
    expect(s.files).toEqual([
      { path: "Assets/Scripts/Player Controller.cs", staged: false, unstaged: true, kind: "changed" },
      { path: "src/new.ts", staged: true, unstaged: false, kind: "changed" },
      { path: "b.txt", staged: true, unstaged: false, kind: "changed" },
      { path: "conflict.txt", staged: false, unstaged: true, kind: "conflict" },
      { path: "notes.md", staged: false, unstaged: true, kind: "untracked" },
    ]);
  });
});

describe("classifyLogLine (samples from a real Editor.log)", () => {
  it.each([
    ["Assets/Scripts/Player.cs(12,5): error CS0103: The name 'x' does not exist", "error"],
    ["NullReferenceException: Object reference not set to an instance of an object", "error"],
    ["[Licensing::Client] Error: Code 404 while processing request", "error"],
    ["Assets/A.cs(3,1): warning CS0168: The variable 'e' is declared but never used", "warning"],
    ["Warning: [Unity.TextMeshPro] - System.Void TMPro.TextMeshPro::GenerateTextMesh()", "warning"],
    ["UnityEngine.Debug:LogWarning (object)", "trace"],
    ["System.Threading.Tasks.Task:TrySetException (object)", "trace"],
    ["Start importing Packages/com.unity.timeline/Editor/StyleSheets/Images/Shared/TimelineWarning.png using Guid(1)", "info"],
    ["Start importing Packages/com.unity.render-pipelines.universal/Shaders/Utils/FallbackError.shader using Guid(2)", "info"],
  ])("%s -> %s", (line, level) => expect(classifyLogLine(line)).toBe(level));
});

describe("tasks", () => {
  const md = "# Tasks\n\n- [ ] jump physics\n- [x] main menu\nnot a task\n";
  it("parses checkbox lines with line numbers", () => {
    expect(parseTasks(md)).toEqual([
      { line: 2, done: false, text: "jump physics" },
      { line: 3, done: true, text: "main menu" },
    ]);
  });
  it("toggles only the given line", () => {
    expect(toggleTask(md, 2)).toBe("# Tasks\n\n- [x] jump physics\n- [x] main menu\nnot a task\n");
    expect(toggleTask(md, 3)).toContain("- [ ] main menu");
  });
  it("adds tasks, creating a heading for a new file", () => {
    expect(addTask("", "first")).toBe("# Tasks\n\n- [ ] first\n");
    expect(addTask("- [ ] a", "b\nc")).toBe("- [ ] a\n- [ ] b c\n");
  });
});

describe("unityEventParser", () => {
  it("reads compile, build and batch exit lines from a real log sequence", () => {
    const parse = unityEventParser();
    const lines = [
      "*** Tundra build success (1.85 seconds), 11 items updated, 1532 evaluated",
      "Reloading assemblies after finishing script compilation.",
      "*** Tundra build failed (0.40 seconds), 2 items updated, 1532 evaluated",
      "Assets/Player.cs(10,5): error CS0103: The name 'x' does not exist in the current context",
      "BuildPlayer: start building target 13",
      "*** Tundra build success (11.96 seconds), 486 items updated, 642 evaluated",
      "Build Finished, Result: Success.",
      "Build completed with a result of 'Failed' in 3 seconds (3012 ms)",
      "Unity çıkış kodu: 1",
      "  Pass  (vp, vulkan) finished in 0.00 seconds.",
    ];
    expect(lines.map(parse)).toEqual([
      null,
      { kind: "compile", ok: true, text: "Derleme başarılı (1.85 sn)" },
      { kind: "compile", ok: false, text: "Derleme hatası" },
      { detail: "Assets/Player.cs(10,5): error CS0103: The name 'x' does not exist in the current context" },
      { kind: "build", ok: null, text: "Build başladı (hedef 13)" },
      null, // Tundra inside a player build is not a script compile
      { kind: "build", ok: true, text: "Build başarılı" },
      { kind: "build", ok: false, text: "Build başarısız (Failed)" },
      { kind: "build", ok: false, text: "Batch build hata kodu 1" },
      null,
    ]);
  });
});
