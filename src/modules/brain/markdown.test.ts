import { describe, expect, it } from "vitest";
import { noteFile, renderMarkdown, snippetHtml } from "./markdown";

describe("renderMarkdown", () => {
  it("escapes raw HTML and scripts", () => {
    const out = renderMarkdown("hi <script>alert(1)</script> <img src=x onerror=alert(1)>");
    expect(out).not.toMatch(/<script|<img/);
  });
  it("does not load remote images", () => {
    expect(renderMarkdown("![pixel](https://tracker.example/p.gif)")).not.toContain("<img");
  });
  it("turns [[wiki]] and http links into data attributes, drops javascript: links", () => {
    const out = renderMarkdown("[[Gravity|g]] [site](https://unity.com) [x](javascript:alert(1))");
    expect(out).toContain('data-wiki="Gravity"');
    expect(out).toContain('data-ext="https://unity.com"');
    expect(out).not.toContain("javascript:");
  });
});

describe("helpers", () => {
  it("highlights snippets safely", () => {
    expect(snippetHtml("a \x01<b>\x02 c")).toBe("a <mark>&lt;b&gt;</mark> c");
  });
  it("makes safe note file names", () => {
    expect(noteFile("Zıplama: fizik/notları?")).toBe("Zıplama fiziknotları.md");
    expect(noteFile("..")).toBe("not.md");
  });
});
