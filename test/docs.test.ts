import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  apiRoot,
  mergeEntries,
  parseAnnotated,
  parseClassIndex,
  rankLookup,
  DocEntry,
} from "../src/docs/parse";
import {
  extractDetailedDescription,
  htmlToMarkdown,
  pageToMarkdown,
  extractArticle,
  absolutizeUrls,
} from "../src/docs/page";

describe("apiRoot", () => {
  it("normalizes a bare or v-prefixed version", () => {
    expect(apiRoot("14")).toBe("https://cpp.openfoam.org/v14");
    expect(apiRoot("v14")).toBe("https://cpp.openfoam.org/v14");
  });
});

describe("parseAnnotated", () => {
  it("pulls name / url / brief out of Doxygen annotated rows", () => {
    const html = `
      <tr><td class="entry"><a class="el" href="classFoam_1_1fixedValueFvPatchField.html" target="_self">fixedValueFvPatchField</a></td><td class="desc">Fixed value constraint &amp; base class</td></tr>
      <tr><td class="entry"><a class="el" href="classFoam_1_1kOmegaSST.html">kOmegaSST</a></td><td class="desc">k-omega-SST model</td></tr>`;
    const rows = parseAnnotated(html);
    expect(rows).toEqual([
      { name: "fixedValueFvPatchField", url: "classFoam_1_1fixedValueFvPatchField.html", brief: "Fixed value constraint & base class" },
      { name: "kOmegaSST", url: "classFoam_1_1kOmegaSST.html", brief: "k-omega-SST model" },
    ]);
  });
});

describe("parseClassIndex", () => {
  it("pulls name / url (no brief) out of the alphabetical index", () => {
    const html = `<a class="el" href="classFoam_1_1noSlipFvPatchVectorField.html">noSlipFvPatchVectorField</a>
                  <a class="el" href="classFoam_1_1kOmegaSST.html">kOmegaSST</a>`;
    expect(parseClassIndex(html)).toEqual([
      { name: "noSlipFvPatchVectorField", url: "classFoam_1_1noSlipFvPatchVectorField.html", brief: "" },
      { name: "kOmegaSST", url: "classFoam_1_1kOmegaSST.html", brief: "" },
    ]);
  });
});

describe("mergeEntries", () => {
  it("dedupes by name and prefers the entry that carries a brief", () => {
    const withBrief: DocEntry = { name: "kOmegaSST", url: "a.html", brief: "the model" };
    const noBrief: DocEntry = { name: "kOmegaSST", url: "a.html", brief: "" };
    expect(mergeEntries([noBrief], [withBrief])).toEqual([withBrief]);
    expect(mergeEntries([withBrief], [noBrief])).toEqual([withBrief]);
  });
});

describe("rankLookup", () => {
  const entries: DocEntry[] = [
    { name: "fixedValue", url: "1", brief: "" },
    { name: "fixedValueFvPatchField", url: "2", brief: "" },
    { name: "codedFixedValueFvPatchField", url: "3", brief: "" },
    { name: "kOmegaSST", url: "4", brief: "" },
  ];

  it("ranks exact, then prefix, then substring; each tier alphabetical", () => {
    const names = rankLookup(entries, "fixedvalue").map(e => e.name);
    expect(names).toEqual([
      "fixedValue", // exact (case-insensitive)
      "fixedValueFvPatchField", // prefix
      "codedFixedValueFvPatchField", // substring
    ]);
  });

  it("returns [] for an empty query and respects the limit", () => {
    expect(rankLookup(entries, "")).toEqual([]);
    expect(rankLookup(entries, "fixed", 1)).toHaveLength(1);
  });
});

describe("class page → markdown", () => {
  const page = `
    <div class="header"><div class="title">Foam::kOmegaSST</div></div>
    <div class="contents">
      <div class="dynheader">Inheritance diagram</div><img src="x.png"/>
      <a name="details" id="details"></a>
      <h2 class="groupheader">Detailed Description</h2>
      <div class="textblock">
        <p>Implementation of the <a class="el" href="classFoam_1_1kOmega.html">k-omega</a> SST model.</p>
        <p>Reference: see <code>createFields.H</code>.</p>
        <div class="fragment">nut = k / omega;</div>
      </div>
      <h2 class="groupheader">Member Function Documentation</h2>
      <div class="memitem">noise</div>
    </div>`;

  it("extractDetailedDescription grabs the textblock and stops at the next section", () => {
    const body = extractDetailedDescription(page);
    expect(body).toContain("Implementation of the");
    expect(body).not.toContain("Member Function Documentation");
    expect(body).not.toContain("noise");
  });

  it("htmlToMarkdown resolves links relative to the page, keeps code and fences", () => {
    const md = htmlToMarkdown(
      extractDetailedDescription(page),
      "https://cpp.openfoam.org/v14/classFoam_1_1kOmegaSST.html",
    );
    expect(md).toContain("[k-omega](https://cpp.openfoam.org/v14/classFoam_1_1kOmega.html)");
    expect(md).toContain("`createFields.H`");
    expect(md).toMatch(/```\n?nut = k \/ omega;/);
  });

  it("pageToMarkdown returns '' when there is no textblock", () => {
    expect(pageToMarkdown("<div class='contents'>nothing</div>", "https://x/y.html")).toBe("");
  });

  it("extractArticle takes header→contents, drops scripts and the footer", () => {
    const full = `<div id="top">nav</div>
      <div class="header"><div class="title">Foam::x</div></div>
      <div class="contents"><p>body</p><script>bad()</script></div>
      <hr class="footer"/><address class="footer">doxygen</address>`;
    const art = extractArticle(full);
    expect(art).toContain('<div class="header">');
    expect(art).toContain("<p>body</p>");
    expect(art).not.toContain("bad()");
    expect(art).not.toContain("doxygen");
    expect(art).not.toContain('id="top"');
  });

  it("absolutizeUrls rewrites only relative href/src", () => {
    const s = absolutizeUrls(
      '<a href="classFoam_1_1y.html">y</a> <img src="graph.png"/> <a href="https://x/z">z</a> <a href="#det">d</a>',
      "https://cpp.openfoam.org/v14/",
    );
    expect(s).toContain('href="https://cpp.openfoam.org/v14/classFoam_1_1y.html"');
    expect(s).toContain('src="https://cpp.openfoam.org/v14/graph.png"');
    expect(s).toContain('href="https://x/z"');
    expect(s).toContain('href="#det"');
  });
});

describe("bundled data/openfoam-classes.json", () => {
  it("exists, is a non-trivial DocEntry[] and a lookup finds a known class", () => {
    const p = path.join(__dirname, "..", "data", "openfoam-classes.json");
    const data = JSON.parse(fs.readFileSync(p, "utf8")) as DocEntry[];
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(1000);
    for (const e of data.slice(0, 50)) {
      expect(typeof e.name).toBe("string");
      expect(e.url).toMatch(/^class.*\.html$/);
    }
    expect(rankLookup(data, "kOmegaSST")[0]?.name).toBe("kOmegaSST");
  });
});
