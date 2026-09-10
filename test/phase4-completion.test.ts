import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { getParser, parseText } from "../src/treeSitter/parser";
import type { Parser } from "../src/treeSitter/parser";
import { signatureHelpContext, getCursorContext } from "../src/treeSitter/queries";
import { boundaryConditionsForFieldType } from "../src/treeSitter/schema";

let parser: Parser;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

beforeAll(async () => {
  parser = await getParser();
  db = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "keyword-db.json"), "utf8"));
});

function parse(text: string) {
  return parseText(parser, text);
}

function fixture(relPath: string): string {
  return fs.readFileSync(path.join(__dirname, "fixtures", relPath), "utf8");
}

describe("boundaryConditionsForFieldType: editing U vs p yields different BCs", () => {
  it("a vector field (U) offers noSlip/pressureInletOutletVelocity but not scalar-only BCs", () => {
    const forU = boundaryConditionsForFieldType(db.boundaryConditions, "vector");
    expect(forU).toContain("noSlip");
    expect(forU).toContain("pressureInletOutletVelocity");
    expect(forU).not.toContain("totalPressure");
    expect(forU).not.toContain("fixedFluxPressure");
  });

  it("a scalar field (p) offers totalPressure/fixedFluxPressure but not vector-only BCs", () => {
    const forP = boundaryConditionsForFieldType(db.boundaryConditions, "scalar");
    expect(forP).toContain("totalPressure");
    expect(forP).toContain("fixedFluxPressure");
    expect(forP).not.toContain("noSlip");
    expect(forP).not.toContain("pressureInletOutletVelocity");
  });

  it("BCs with no appliesTo restriction (fixedValue) apply to both", () => {
    const forU = boundaryConditionsForFieldType(db.boundaryConditions, "vector");
    const forP = boundaryConditionsForFieldType(db.boundaryConditions, "scalar");
    expect(forU).toContain("fixedValue");
    expect(forP).toContain("fixedValue");
  });

  it("unknown field type falls back to offering everything (never hides options)", () => {
    const all = boundaryConditionsForFieldType(db.boundaryConditions, undefined);
    expect(all.length).toBe(Object.keys(db.boundaryConditions).length);
  });
});

describe("signatureHelpContext resolves composite scheme names from the entry's value, not its key", () => {
  it("resolves 'Gauss' (not the key 'div(phi,U)') as the scheme name", () => {
    const src = "divSchemes\n{\n    div(phi,U)   Gauss linearUpwind grad(U);\n}\n";
    const tree = parse(src);
    // cursor right after "Gauss " (about to type/typing "linearUpwind")
    const ctx = signatureHelpContext(tree, { line: 2, character: 22 });
    expect(ctx?.schemeName).toBe("Gauss");
  });

  it("activeParameter is 0 right after the scheme name", () => {
    const src = "divSchemes\n{\n    div(phi,U)   Gauss ;\n}\n";
    const tree = parse(src.replace(" ;", " linearUpwind grad(U);"));
    // position right after "Gauss " (18 = index right after the space following Gauss)
    const line = "    div(phi,U)   Gauss linearUpwind grad(U);";
    const col = line.indexOf("Gauss ") + "Gauss ".length;
    const ctx = signatureHelpContext(tree, { line: 2, character: col });
    expect(ctx?.schemeName).toBe("Gauss");
    expect(ctx?.activeParameter).toBe(0);
  });

  it("activeParameter advances to 1 once the first argument (linearUpwind) is complete", () => {
    const line = "    div(phi,U)   Gauss linearUpwind grad(U);";
    const tree = parse(`divSchemes\n{\n${line}\n}\n`);
    const col = line.indexOf("grad(U)"); // cursor right at the start of the 2nd argument
    const ctx = signatureHelpContext(tree, { line: 2, character: col });
    expect(ctx?.schemeName).toBe("Gauss");
    expect(ctx?.activeParameter).toBe(1);
  });

  it("returns null when the cursor isn't inside any entry", () => {
    const tree = parse("divSchemes\n{\n}\n");
    expect(signatureHelpContext(tree, { line: 1, character: 0 })).toBeNull();
  });

  it("resolves correctly for the deeply-nested real fvSchemes fixture line", () => {
    const src = fixture("openfoam/fvSchemes");
    const lines = src.split("\n");
    const li = lines.findIndex(l => l.includes("div(phi,alpha)"));
    const line = lines[li];
    const col = line.indexOf("Gauss") + "Gauss".length + 1;
    const tree = parse(src);
    const ctx = signatureHelpContext(tree, { line: li, character: col });
    expect(ctx?.schemeName).toBe("Gauss");
  });
});

describe("cursor context inside multi-line and nested one-liner entries (tree-sitter-backed, Phase 2)", () => {
  it("resolves key/value position correctly inside a multi-line nonuniform List<vector> value", () => {
    const src = fixture("edge-cases/multiline-list-value.foam");
    const lines = src.split("\n");
    // land inside the parenthesized list body, well past the key
    const li = lines.findIndex(l => /^\(2 0 0\)$/.test(l.trim()));
    const tree = parse(src);
    const ctx = getCursorContext(tree, { line: li, character: 3 });
    expect(ctx.cursorIn).toBe("value");
    expect(ctx.currentKey).toBe("internalField");
  });

  it("resolves the correct nested block path inside a nested one-liner entry", () => {
    const src = "boundaryField\n{\n    inlet\n    {\n        type            fixedValue;\n        value           uniform (0 0 0);\n    }\n}\n";
    const tree = parse(src);
    const ctx = getCursorContext(tree, { line: 5, character: 30 });
    expect(ctx.blockPath).toEqual(["boundaryField", "inlet"]);
    expect(ctx.cursorIn).toBe("value");
    expect(ctx.currentKey).toBe("value");
  });
});
