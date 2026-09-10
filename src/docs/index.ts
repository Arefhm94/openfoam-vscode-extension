import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import { execFile } from "child_process";
import * as vscode from "vscode";
import {
  DocEntry,
  apiRoot,
  mergeEntries,
  parseAnnotated,
  parseClassIndex,
  rankLookup,
} from "./parse";
import { pageToMarkdown } from "./page";

export { DocEntry, apiRoot } from "./parse";

function nodeGet(url: string, redirectsLeft = 4): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: { "User-Agent": "openfoam-vscode-extension" },
        // Proxies / CDNs sometimes emit responses the strict HTTP parser
        // rejects ("Parse Error: JS Exception"); be lenient.
        insecureHTTPParser: true,
      },
      res => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          resolve(nodeGet(new URL(res.headers.location, url).toString(), redirectsLeft - 1));
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`HTTP ${status} for ${url}`));
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", chunk => (body += chunk));
        res.on("end", () => resolve(body));
      },
    );
    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("timeout")));
  });
}

/** `curl` fallback — its own HTTP stack, tolerant parser, honours proxy env. */
function curlGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "curl",
      ["-sSL", "--compressed", "--max-time", "20", "-A", "openfoam-vscode-extension", url],
      { maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(`curl: ${(stderr || err.message).trim()}`));
        else if (!stdout) reject(new Error("curl: empty response"));
        else resolve(stdout);
      },
    );
  });
}

/** Fetch text, falling back from Node's HTTP client to `curl` on any failure. */
async function httpGet(url: string): Promise<string> {
  try {
    return await nodeGet(url);
  } catch (e1) {
    try {
      return await curlGet(url);
    } catch (e2) {
      const m1 = e1 instanceof Error ? e1.message : String(e1);
      const m2 = e2 instanceof Error ? e2.message : String(e2);
      throw new Error(`${m1} — ${m2}`);
    }
  }
}

const ONLINE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The merged OpenFOAM C++ class index: a bundled offline baseline
 * (`data/openfoam-classes.json`) plus, when `openfoam.docs.onlineHelp` is
 * on, a disk-cached fetch of the live `annotated.html` + `classes.html`
 * (online entries win). Built once, lazily; all online failures are silent.
 */
export class DocsIndex {
  private byLower = new Map<string, DocEntry>();
  private all: DocEntry[] = [];
  private loaded = false;
  private onlineTried = false;

  constructor(private readonly context: vscode.ExtensionContext) {}

  private get version(): string {
    return vscode.workspace.getConfiguration("openfoam").get<string>("docs.apiVersion", "v14");
  }
  /** Master switch for any cpp.openfoam.org network access (index + pages). */
  get onlineEnabled(): boolean {
    return vscode.workspace.getConfiguration("openfoam").get<boolean>("docs.onlineHelp", false);
  }

  private ingest(entries: DocEntry[], override: boolean): void {
    for (const e of entries) {
      const key = e.name.toLowerCase();
      if (override || !this.byLower.has(key)) this.byLower.set(key, e);
    }
    this.all = [...this.byLower.values()];
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const p = path.join(this.context.extensionPath, "data", "openfoam-classes.json");
      this.ingest(JSON.parse(fs.readFileSync(p, "utf8")) as DocEntry[], true);
    } catch {
      /* no bundled index — online-only or empty */
    }
    this.loadOnlineCache();
  }

  private cachePath(): string {
    return path.join(this.context.globalStorageUri.fsPath, `doc-index-${this.version}.json`);
  }

  private loadOnlineCache(): void {
    try {
      const cached = JSON.parse(fs.readFileSync(this.cachePath(), "utf8")) as {
        fetchedAt: number;
        entries: DocEntry[];
      };
      if (Array.isArray(cached.entries)) this.ingest(cached.entries, true);
      if (Date.now() - cached.fetchedAt < ONLINE_TTL_MS) this.onlineTried = true;
    } catch {
      /* no cache yet */
    }
  }

  /** Fire-and-forget: refresh the on-disk online cache if stale + enabled. */
  private maybeRefreshOnline(): void {
    if (this.onlineTried || !this.onlineEnabled) return;
    this.onlineTried = true;
    void (async () => {
      try {
        const root = apiRoot(this.version);
        const [annotated, classes] = await Promise.all([
          httpGet(`${root}/annotated.html`).then(parseAnnotated, () => [] as DocEntry[]),
          httpGet(`${root}/classes.html`).then(parseClassIndex, () => [] as DocEntry[]),
        ]);
        const entries = mergeEntries(annotated, classes);
        if (!entries.length) return;
        this.ingest(entries, true);
        fs.mkdirSync(this.context.globalStorageUri.fsPath, { recursive: true });
        fs.writeFileSync(this.cachePath(), JSON.stringify({ fetchedAt: Date.now(), entries }));
      } catch {
        /* silent — bundled index still serves */
      }
    })();
  }

  lookup(query: string, limit = 50): DocEntry[] {
    this.ensureLoaded();
    this.maybeRefreshOnline();
    return rankLookup(this.all, query, limit);
  }

  /** The case-sensitive exact-name match, if the index has one. */
  exact(word: string): DocEntry | undefined {
    this.ensureLoaded();
    this.maybeRefreshOnline();
    const e = this.byLower.get(word.toLowerCase());
    return e && e.name === word ? e : undefined;
  }

  fullUrl(entry: DocEntry): string {
    return `${apiRoot(this.version)}/${entry.url}`;
  }

  // ── full page text (the "Detailed Description" of a class) ────────────────

  private pageMem = new Map<string, string>();

  private pageCachePath(entry: DocEntry): string {
    const safe = entry.url.replace(/[^A-Za-z0-9._-]/g, "_");
    return path.join(this.context.globalStorageUri.fsPath, "pages", this.version, `${safe}.json`);
  }

  /**
   * The class page's detailed description as Markdown, fetched from
   * cpp.openfoam.org and cached (memory + disk, 7-day TTL). Returns `null`
   * when `openfoam.docs.onlineHelp` is off or the fetch/parse yields
   * nothing.
   */
  async fetchDoc(entry: DocEntry): Promise<string | null> {
    const html = await this.fetchPageHtml(entry);
    if (html == null) return null;
    const key = `md:${this.version}/${entry.url}`;
    let md = this.pageMem.get(key);
    if (md == null) {
      md = pageToMarkdown(html, this.fullUrl(entry));
      this.pageMem.set(key, md);
    }
    return md || null;
  }

  /** Why the last `fetchPageHtml` returned null (for the panel to show). */
  lastPageError: string | null = null;

  /** Raw class-page HTML (for the doc panel). Same gating as `fetchDoc`. */
  async fetchPageHtml(entry: DocEntry, force = false): Promise<string | null> {
    if (!this.onlineEnabled) {
      this.lastPageError = "openfoam.docs.onlineHelp is off";
      return null;
    }
    this.lastPageError = null;
    const key = `html:${this.version}/${entry.url}`;
    if (!force) {
      const mem = this.pageMem.get(key);
      if (mem) return mem;
    }

    const disk = this.pageCachePath(entry);
    if (!force) {
      try {
        const c = JSON.parse(fs.readFileSync(disk, "utf8")) as { fetchedAt: number; html: string };
        if (c.html && Date.now() - c.fetchedAt < ONLINE_TTL_MS) {
          this.pageMem.set(key, c.html);
          return c.html;
        }
      } catch {
        /* not cached */
      }
    }

    try {
      const html = await httpGet(this.fullUrl(entry));
      this.pageMem.set(key, html);
      fs.mkdirSync(path.dirname(disk), { recursive: true });
      fs.writeFileSync(disk, JSON.stringify({ fetchedAt: Date.now(), html }));
      return html;
    } catch (e) {
      this.lastPageError = e instanceof Error ? e.message : String(e);
      return null; // not negative-cached — Retry re-attempts
    }
  }
}
