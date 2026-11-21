import { Marked } from "marked";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Notes may contain text pasted from the web or written by agents: no raw HTML, no remote
// images (tracking pixels), links only as data attributes the panel handles (http(s) or [[wiki]]).
const marked = new Marked({
  gfm: true,
  renderer: {
    html: ({ text }) => esc(text),
    image: ({ text }) => `<span class="img">[görsel: ${esc(text)}]</span>`,
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      if (href.startsWith("wiki:")) return `<a href="#" data-wiki="${esc(decodeURIComponent(href.slice(5)))}">${label}</a>`;
      if (/^https?:\/\//i.test(href)) return `<a href="#" data-ext="${esc(href)}">${label}</a>`;
      return label;
    },
  },
});

export function renderMarkdown(md: string): string {
  const withWiki = md.replace(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g, (_m, name: string) => `[${name.trim()}](wiki:${encodeURIComponent(name.trim())})`);
  return marked.parse(withWiki, { async: false }) as string;
}

/** Highlights FTS snippet hits (\x01…\x02) after escaping. */
export function snippetHtml(s: string): string {
  return esc(s).replace(/\x01/g, "<mark>").replace(/\x02/g, "</mark>");
}

/** File name for a new note title. */
export function noteFile(title: string): string {
  const base = title.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").replace(/^\.+/, "").slice(0, 80);
  return `${base || "not"}.md`;
}
