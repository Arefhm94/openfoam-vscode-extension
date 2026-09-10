/**
 * Pure helpers for the OpenFOAM C++ API docs index — no `vscode`, so both
 * the extension (`src/docs/index.ts`) and `scripts/build-doc-index.js`
 * (via its own copy) and the unit tests can use them.
 */

/** One documented OpenFOAM C++ class. `url` is relative to the API root. */
export interface DocEntry {
  name: string;
  brief: string;
  url: string;
}

export function apiRoot(version: string): string {
  const v = /^v?\d+$/.test(version) ? version.replace(/^v?/, "v") : version;
  return `https://cpp.openfoam.org/${v}`;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Class list *with* one-line descriptions from a Doxygen `annotated.html`
 * (only a subset of classes — Doxygen truncates deep namespaces there).
 * Rows: `… <a class="el" href="classFoam_1_1X.html"…>X</a></td><td
 * class="desc">brief</td> …`.
 */
export function parseAnnotated(html: string): DocEntry[] {
  const out: DocEntry[] = [];
  const re =
    /<a\s+class="el"\s+href="(class[^"#]+\.html)"[^>]*>([^<]+)<\/a>\s*<\/td>\s*<td\s+class="desc">([^<]*)<\/td>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const name = decodeEntities(m[2]).trim();
    if (name) out.push({ name, url: m[1], brief: decodeEntities(m[3]).trim() });
  }
  return out;
}

/** `{ name, url }` (no brief) from a Doxygen `classes.html` — full index. */
export function parseClassIndex(html: string): DocEntry[] {
  const out: DocEntry[] = [];
  const re = /<a\s+class="el"\s+href="(class[^"#]+\.html)"[^>]*>([^<]+)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const name = decodeEntities(m[2]).trim();
    if (name) out.push({ name, url: m[1], brief: "" });
  }
  return out;
}

/** Dedupe by class name (first wins), preferring an entry that has a brief. */
export function mergeEntries(...lists: DocEntry[][]): DocEntry[] {
  const byName = new Map<string, DocEntry>();
  for (const list of lists) {
    for (const e of list) {
      const cur = byName.get(e.name);
      if (!cur) byName.set(e.name, e);
      else if (!cur.brief && e.brief) byName.set(e.name, e);
    }
  }
  return [...byName.values()];
}

/** Case-insensitive rank: exact → prefix → substring, each tier alphabetical. */
export function rankLookup(entries: DocEntry[], query: string, limit = 50): DocEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const exact: DocEntry[] = [];
  const prefix: DocEntry[] = [];
  const sub: DocEntry[] = [];
  for (const e of entries) {
    const n = e.name.toLowerCase();
    if (n === q) exact.push(e);
    else if (n.startsWith(q)) prefix.push(e);
    else if (n.includes(q)) sub.push(e);
  }
  const byName = (a: DocEntry, b: DocEntry) => a.name.localeCompare(b.name);
  return [...exact.sort(byName), ...prefix.sort(byName), ...sub.sort(byName)].slice(0, limit);
}
