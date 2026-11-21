// Pure parsers for the project dashboard (tested in parse.test.ts).

export interface GitFile { path: string; staged: boolean; unstaged: boolean; kind: "changed" | "untracked" | "conflict" }
export interface GitStatus { branch: string | null; ahead: number; behind: number; files: GitFile[] }

/** Parses `git status --porcelain=v2 --branch`. */
export function parseGitStatus(out: string): GitStatus {
  const s: GitStatus = { branch: null, ahead: 0, behind: 0, files: [] };
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith("# branch.head ")) s.branch = line.slice(14);
    else if (line.startsWith("# branch.ab ")) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) [s.ahead, s.behind] = [+m[1], +m[2]];
    } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const parts = line.split(" ");
      const xy = parts[1];
      // type 1 has 8 fields before the path; type 2 has 9 and "path<TAB>origPath"
      const path = parts.slice(line.startsWith("1 ") ? 8 : 9).join(" ").split("\t")[0];
      s.files.push({ path, staged: xy[0] !== ".", unstaged: xy[1] !== ".", kind: "changed" });
    } else if (line.startsWith("u ")) {
      s.files.push({ path: line.split(" ").slice(10).join(" "), staged: false, unstaged: true, kind: "conflict" });
    } else if (line.startsWith("? ")) {
      s.files.push({ path: line.slice(2), staged: false, unstaged: true, kind: "untracked" });
    }
  }
  return s;
}

export type LogLevel = "error" | "warning" | "trace" | "info";

/** Unity Editor.log line level. Deliberately strict: importer lines like "...Warning.png" are info. */
export function classifyLogLine(line: string): LogLevel {
  if (/\berror CS\d+|^[\w.]*Exception(: |$)|^\[[^\]]+\] Error:|^Error:|Scripts have compiler errors|^Compilation failed|^Failed to /.test(line)) return "error";
  if (/\bwarning CS\d+|^Warning:|^\[[^\]]+\] Warning:/.test(line)) return "warning";
  if (/^\s*at |^UnityEngine\.[\w.]+:\w+ \(|^System\.[\w.`<>]+:\w+ \(|^\(Filename: /.test(line)) return "trace";
  return "info";
}

export interface Task { line: number; done: boolean; text: string }

const TASK = /^(\s*[-*] \[)( |x|X)(\] )(.*)$/;

export function parseTasks(md: string): Task[] {
  return md.split("\n").flatMap((l, line) => {
    const m = l.match(TASK);
    return m ? [{ line, done: m[2] !== " ", text: m[4].trim() }] : [];
  });
}

export function toggleTask(md: string, line: number): string {
  const lines = md.split("\n");
  lines[line] = lines[line].replace(TASK, (_a, pre, mark, mid, rest) => `${pre}${mark === " " ? "x" : " "}${mid}${rest}`);
  return lines.join("\n");
}

export function addTask(md: string, text: string): string {
  const body = md.length === 0 ? "# Tasks\n\n" : md.endsWith("\n") ? md : md + "\n";
  return `${body}- [ ] ${text.replace(/\r?\n/g, " ").trim()}\n`;
}
