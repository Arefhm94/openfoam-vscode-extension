/**
 * Turn a Doxygen class page into a compact Markdown blob for a hover /
 * completion-detail popup. Pure string work — no `vscode`, no `fs` — so
 * it's unit-testable and shared by the runtime and (conceptually) the
 * build tooling.
 */
import { decodeEntities } from "./parse";

const MAX_CHARS = 6000;

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

/**
 * The "Detailed Description" body of a Doxygen class page: everything in
 * the first `<div class="textblock">` up to the first member/section
 * marker that follows it.
 */
export function extractDetailedDescription(html: string): string {
  const open = html.match(/<div class="textblock">/i);
  if (!open || open.index == null) return "";
  const after = html.slice(open.index + open[0].length);
  let end = after.length;
  for (const re of [
    /<h2 class="groupheader">/i,
    /<div class="memitem">/i,
    /<!-- contents -->/i,
    /<div class="ttc"/i,
    /<hr\/>\s*<div class="contents">/i,
  ]) {
    const m = after.search(re);
    if (m >= 0 && m < end) end = m;
  }
  return after.slice(0, end);
}

/** Very small, tolerant HTML→Markdown for Doxygen description fragments. */
export function htmlToMarkdown(html: string, pageUrl: string): string {
  const dir = pageUrl.replace(/\/[^/]*$/, "/");
  let s = html;

  s = s.replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, txt: string) => {
    const t = stripTags(txt).trim();
    if (!t) return "";
    const url = /^https?:/i.test(href) || href.startsWith("#") ? href : dir + href;
    return href.startsWith("#") ? t : `[${t}](${url})`;
  });
  s = s.replace(/<(?:pre|div class="fragment")[^>]*>([\s\S]*?)<\/(?:pre|div)>/gi,
    (_m, code: string) => `\n\n\`\`\`\n${decodeEntities(stripTags(code)).trim()}\n\`\`\`\n\n`);
  s = s.replace(/<(?:code|tt)>([\s\S]*?)<\/(?:code|tt)>/gi,
    (_m, c: string) => "`" + stripTags(c).trim() + "`");
  s = s.replace(/<li>/gi, "\n- ").replace(/<\/li>/gi, "");
  s = s.replace(/<h[1-6][^>]*>/gi, "\n\n### ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(?:p|div|ul|ol|dl|table|tr|h[1-6])>/gi, "\n\n");
  s = decodeEntities(stripTags(s));
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/^\s+/, "").trimEnd();

  if (s.length > MAX_CHARS) {
    s = s.slice(0, MAX_CHARS).replace(/\s+\S*$/, "") + " …";
  }
  return s;
}

/** Full Markdown for a class page: the detailed description, or `""`. */
export function pageToMarkdown(html: string, pageUrl: string): string {
  const body = extractDetailedDescription(html);
  return body ? htmlToMarkdown(body, pageUrl) : "";
}

/**
 * The main article of a Doxygen page — from `<div class="header">` (title
 * + summary links) through the end of `<div class="contents">`, before
 * the footer. Returned as raw HTML for a webview, not Markdown.
 */
export function extractArticle(html: string): string {
  const start = html.search(/<div class="header">/i);
  const from = start >= 0 ? start : html.search(/<div class="contents">/i);
  if (from < 0) return "";
  let rest = html.slice(from);
  const end = rest.search(
    /<hr class="footer"|<address class="footer"|<!--\s*start footer|<div class="ttc"/i,
  );
  if (end >= 0) rest = rest.slice(0, end);
  return rest.replace(/<script[\s\S]*?<\/script>/gi, "");
}

/** Rewrite relative `href`/`src` to absolute, given the page's directory URL. */
export function absolutizeUrls(html: string, dirUrl: string): string {
  return html.replace(/\b(href|src)="([^"]+)"/gi, (whole, attr: string, val: string) =>
    /^(?:https?:|data:|#|mailto:)/i.test(val) ? whole : `${attr}="${dirUrl}${val}"`,
  );
}
