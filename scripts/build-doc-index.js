#!/usr/bin/env node
/*
 * Regenerates data/openfoam-classes.json — the bundled offline index for
 * the `?` OpenFOAM C++ API docs lookup / hover (src/docs/).
 *
 * Fetches the Doxygen class list and extracts { name, brief, url }. Run at
 * release time (and whenever bumping the default docs version):
 *
 *   node scripts/build-doc-index.js [version]        # default: v14
 *
 * The parse below is kept in sync with parseAnnotated() in src/docs/index.ts.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");

const version = (process.argv[2] || "v14").replace(/^v?/, "v");
const root = `https://cpp.openfoam.org/${version}`;
const outPath = path.join(__dirname, "..", "data", "openfoam-classes.json");

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function parseAnnotated(html) {
  const out = [];
  const re =
    /<a\s+class="el"\s+href="(class[^"#]+\.html)"[^>]*>([^<]+)<\/a>\s*<\/td>\s*<td\s+class="desc">([^<]*)<\/td>/g;
  let m;
  while ((m = re.exec(html))) {
    const name = decodeEntities(m[2]).trim();
    if (name) out.push({ name, url: m[1], brief: decodeEntities(m[3]).trim() });
  }
  return out;
}

function parseClassIndex(html) {
  const out = [];
  const re = /<a\s+class="el"\s+href="(class[^"#]+\.html)"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const name = decodeEntities(m[2]).trim();
    if (name) out.push({ name, url: m[1], brief: "" });
  }
  return out;
}

function mergeEntries(...lists) {
  const byName = new Map();
  for (const list of lists) {
    for (const e of list) {
      const cur = byName.get(e.name);
      if (!cur) byName.set(e.name, e);
      else if (!cur.brief && e.brief) byName.set(e.name, e);
    }
  }
  return [...byName.values()];
}

function httpGet(u, redirectsLeft = 4) {
  return new Promise((resolve, reject) => {
    https
      .get(
        u,
        {
          headers: { "User-Agent": "openfoam-vscode-extension build-doc-index" },
          insecureHTTPParser: true,
        },
        res => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          resolve(httpGet(new URL(res.headers.location, u).toString(), redirectsLeft - 1));
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`HTTP ${status} for ${u}`));
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", c => (body += c));
        res.on("end", () => resolve(body));
      })
      .on("error", reject);
  });
}

(async () => {
  process.stderr.write(`Fetching ${root}/{annotated,classes}.html …\n`);
  const [annotated, classes] = await Promise.all([
    httpGet(`${root}/annotated.html`).then(parseAnnotated),
    httpGet(`${root}/classes.html`).then(parseClassIndex),
  ]);
  const entries = mergeEntries(annotated, classes).sort((a, b) => a.name.localeCompare(b.name));
  if (!entries.length) {
    throw new Error("parsed 0 entries — the Doxygen page layout may have changed");
  }
  const withBrief = entries.filter(e => e.brief).length;
  fs.writeFileSync(outPath, JSON.stringify(entries));
  process.stderr.write(
    `Wrote ${entries.length} classes (${withBrief} with a description) to ${path.relative(process.cwd(), outPath)}\n`,
  );
})().catch(err => {
  process.stderr.write(`build-doc-index failed: ${err.message}\n`);
  process.exit(1);
});
