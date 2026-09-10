import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { getParser, parseText } from "../src/treeSitter/parser";
import type { Parser } from "../src/treeSitter/parser";
import { normalizeFields, renderBody, renderTemplate, renderSnippet, InsertableFeature } from "../src/scaffold/features";
import { collectFeatures } from "../src/scaffold/providers";
import { locateInsertion } from "../src/scaffold/blockLocator";

let parser: Parser;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
beforeAll(async () => {
  parser = await getParser();
  db = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "keyword-db.json"), "utf8"));
});

describe("normalizeFields", () => {
  it("flattens a keyword map, coercing default/options to strings", () => {
    const fields = normalizeFields({
      nOuterCorrectors: { type: "integer", required: true },
      nNonOrthogonalCorrectors: { type: "integer", default: 0 },
      method: { type: "word", options: ["scotch", "simple"] },
    });
    expect(fields.find(f => f.name === "nOuterCorrectors")).toMatchObject({ required: true, type: "integer" });
    expect(fields.find(f => f.name === "nNonOrthogonalCorrectors")?.default).toBe("0");
    expect(fields.find(f => f.name === "method")?.options).toEqual(["scotch", "simple"]);
  });
  it("returns [] for undefined", () => {
    expect(normalizeFields(undefined)).toEqual([]);
  });
});

describe("collectFeatures", () => {
  it("produces a boundary-condition feature with a typeKeyword and only required fields", () => {
    const features = collectFeatures(db, { category: "boundaryConditions" });
    const fixedValue = features.find(f => f.id === "bc:fixedValue")!;
    expect(fixedValue.typeKeyword).toBe("fixedValue");
    expect(fixedValue.categoryKey).toBe("boundaryConditions");
    expect(fixedValue.fields.map(f => f.name)).toContain("value");
    expect(fixedValue.fields.map(f => f.name)).not.toContain("type"); // rendered separately
    expect(fixedValue.fields.every(f => f.required)).toBe(true);
    expect(fixedValue.target).toMatchObject({ blockPath: ["boundaryField"], wrap: "namedBlock" });
  });

  it("filters BCs by field value type (vector field drops scalar-only BCs)", () => {
    const forU = collectFeatures(db, { category: "boundaryConditions", fieldValueType: "vector" }).map(f => f.label);
    expect(forU).toContain("noSlip");
    expect(forU).not.toContain("totalPressure");
  });

  it("produces PIMPLE with its required fields, targeting system/fvSolution", () => {
    const pimple = collectFeatures(db, { category: "algorithms" }).find(f => f.id === "algo:PIMPLE")!;
    expect(pimple.fields.map(f => f.name).sort()).toEqual(["nCorrectors", "nOuterCorrectors"]);
    expect(pimple.target).toMatchObject({ file: "system/fvSolution", blockPath: ["PIMPLE"], wrap: "entries" });
  });

  it("turbulence models are catalog-only with a ready block body", () => {
    const kw = collectFeatures(db, { category: "turbulenceModels" }).find(f => f.label === "kOmegaSST")!;
    expect(kw.fields).toEqual([]);
    expect(kw.catalogBody).toContain("RASModel        kOmegaSST;");
  });

  it("category filter restricts the result set", () => {
    const only = collectFeatures(db, { category: "algorithms" });
    expect(only.every(f => f.categoryKey === "algorithms")).toBe(true);
  });
});

describe("renderBody", () => {
  it("renders a filled boundary condition (type line + required values)", () => {
    const feature = collectFeatures(db, { category: "boundaryConditions" }).find(f => f.id === "bc:fixedValue")!;
    const body = renderBody(feature, { value: "uniform (0 0 0)" });
    expect(body).toBe("type        fixedValue;\nvalue        uniform (0 0 0);");
  });
  it("renders PIMPLE entries", () => {
    const feature = collectFeatures(db, { category: "algorithms" }).find(f => f.id === "algo:PIMPLE")!;
    const body = renderBody(feature, { nOuterCorrectors: "2", nCorrectors: "2" });
    expect(body).toContain("nOuterCorrectors        2;");
    expect(body).toContain("nCorrectors        2;");
  });
  it("returns catalogBody verbatim for a catalog-only feature", () => {
    const f: InsertableFeature = {
      id: "x", label: "x", categoryLabel: "x", categoryKey: "x", brief: "",
      fields: [], catalogBody: "someScheme;", target: { blockPath: [], wrap: "entries" },
    };
    expect(renderBody(f, {})).toBe("someScheme;");
  });
});

describe("renderTemplate", () => {
  it("emits every required field on its own line, seeded from its default", () => {
    const feature = collectFeatures(db, { category: "boundaryConditions" }).find(f => f.id === "bc:fixedValue")!;
    const tpl = renderTemplate(feature);
    expect(tpl.split("\n")[0]).toBe("type        fixedValue;");
    expect(tpl).toMatch(/^value {8}\S.*;$/m);
  });

  it("includes a line per field for a multi-field feature", () => {
    const feature = collectFeatures(db, { category: "algorithms" }).find(f => f.id === "algo:PIMPLE")!;
    const tpl = renderTemplate(feature);
    expect(tpl).toMatch(/^nCorrectors {8}.+;$/m);
    expect(tpl).toMatch(/^nOuterCorrectors {8}.+;$/m);
  });

  it("seeds an enum field from its first option, an untyped field with a <type> placeholder", () => {
    const f: InsertableFeature = {
      id: "x", label: "x", categoryLabel: "x", categoryKey: "x", brief: "",
      fields: [
        { name: "method", required: true, options: ["scotch", "simple"] },
        { name: "n", required: true, type: "integer" },
      ],
      target: { blockPath: [], wrap: "entries" },
    };
    expect(renderTemplate(f)).toBe("method        scotch;\nn        <integer>;");
  });

  it("returns the catalog body verbatim for a catalog-only feature", () => {
    const f: InsertableFeature = {
      id: "x", label: "x", categoryLabel: "x", categoryKey: "x", brief: "",
      fields: [], catalogBody: "grad(U) Gauss linear;", target: { blockPath: [], wrap: "entries" },
    };
    expect(renderTemplate(f)).toBe("grad(U) Gauss linear;");
  });
});

describe("renderSnippet", () => {
  it("makes each field a numbered tab-stop and wraps a namedBlock in <name> { }", () => {
    const feature = collectFeatures(db, { category: "boundaryConditions" }).find(f => f.id === "bc:fixedValue")!;
    const snip = renderSnippet(feature);
    // patch-name stop is last-numbered, wrapping a { } block
    expect(snip).toMatch(/^\$\{\d+:[^}]+\}\n\{\n/);
    expect(snip).toContain("    type        fixedValue;");
    expect(snip).toMatch(/\n\}$/);
    expect(snip).toContain("${1:");
  });

  it("emits entries (no wrapper) for an entries target, numbering 1..n", () => {
    const feature = collectFeatures(db, { category: "algorithms" }).find(f => f.id === "algo:PIMPLE")!;
    const snip = renderSnippet(feature);
    expect(snip.startsWith("${")).toBe(false);
    expect(snip).toContain("${1:");
    expect(snip).toContain("${2:");
  });

  it("renders enum fields as ${n|a,b,c|} choices", () => {
    const f: InsertableFeature = {
      id: "x", label: "x", categoryLabel: "x", categoryKey: "x", brief: "",
      fields: [{ name: "method", required: true, options: ["scotch", "simple"] }],
      target: { blockPath: [], wrap: "entries" },
    };
    expect(renderSnippet(f)).toBe("method        ${1|scotch,simple|};");
  });
});

describe("locateInsertion", () => {
  const parse = (t: string) => parseText(parser, t);

  it("inserts inside an existing block, just before its closing brace", () => {
    const src = "boundaryField\n{\n    inlet\n    {\n        type fixedValue;\n    }\n}\n";
    const ins = locateInsertion(parse(src), src, ["boundaryField"]);
    expect(ins.position.line).toBe(6); // the "}" line of boundaryField
    expect(ins.position.character).toBe(0);
    expect(ins.render("outlet\n{\n    type zeroGradient;\n}")).toBe(
      "    outlet\n    {\n        type zeroGradient;\n    }\n",
    );
  });

  it("creates a missing nested block path from a partially-present container", () => {
    const src = "boundaryField\n{\n}\n";
    const ins = locateInsertion(parse(src), src, ["boundaryField", "inlet"]);
    expect(ins.render("type fixedValue;\nvalue uniform 0;")).toBe(
      "    inlet\n    {\n        type fixedValue;\n        value uniform 0;\n    }\n",
    );
  });

  it("creates the whole path and appends at end-of-content when nothing matches", () => {
    const src = "FoamFile\n{\n    object U;\n}\n\ninternalField uniform (0 0 0);\n\n// ***** //\n";
    const ins = locateInsertion(parse(src), src, ["boundaryField", "walls"]);
    expect(ins.position.line).toBe(7); // the footer line
    const out = ins.render("type noSlip;");
    expect(out).toBe("\nboundaryField\n{\n    walls\n    {\n        type noSlip;\n    }\n}\n");
  });

  it("appends a top-level entry for an empty blockPath", () => {
    const src = "application simpleFoam;\n\n// ***** //\n";
    const ins = locateInsertion(parse(src), src, []);
    expect(ins.position.line).toBe(2);
    expect(ins.render("deltaT 0.001;")).toBe("\ndeltaT 0.001;\n");
  });
});
