import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { getParser, parseText } from "../src/treeSitter/parser";
import type { Parser } from "../src/treeSitter/parser";
import { validate, validateBlock, collectParseErrors, DictSchema } from "../src/treeSitter/schema";

let parser: Parser;
beforeAll(async () => {
  parser = await getParser();
});

const controlDictSchema: DictSchema = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "keyword-db.json"), "utf8"),
).controlDict.keywords;

describe("validate() against the real controlDict schema", () => {
  it("flags no diagnostics on a valid file", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "fixtures", "openfoam", "controlDict"),
      "utf8",
    );
    const tree = parseText(parser, src);
    const diags = validate(tree, controlDictSchema);
    expect(diags).toEqual([]);
  });

  it("flags an unknown key", () => {
    const tree = parseText(parser, 'totallyBogusKeyword   5;\napplication  simpleFoam;\n');
    const diags = validate(tree, controlDictSchema);
    expect(diags.some(d => d.severity === "warning" && d.message.includes("totallyBogusKeyword"))).toBe(true);
  });

  it("flags a missing required key (stopAt)", () => {
    const tree = parseText(parser, 'application simpleFoam;\nstartFrom   startTime;\n');
    const diags = validate(tree, controlDictSchema);
    expect(diags.some(d => d.severity === "error" && d.message.includes("stopAt"))).toBe(true);
  });

  it("flags an invalid enum value for startFrom", () => {
    const tree = parseText(parser, 'application simpleFoam;\nstartFrom bogusValue;\n');
    const diags = validate(tree, controlDictSchema);
    expect(diags.some(d => d.message.includes("bogusValue") && d.message.includes("startFrom"))).toBe(true);
  });

  it("does not flag a $reference value against an enum", () => {
    const tree = parseText(parser, 'application simpleFoam;\nstartFrom $someVar;\n');
    const diags = validate(tree, controlDictSchema);
    expect(diags.some(d => d.message.includes("someVar"))).toBe(false);
  });
});

describe("validateBlock() for a nested dict (snappyHexMesh castellatedMeshControls)", () => {
  const db = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "keyword-db.json"), "utf8"));
  const castellatedSchema: DictSchema = db.snappyHexMesh.castellatedMeshControls;

  it("flags the missing required locationInMesh on an empty block", () => {
    const tree = parseText(parser, "castellatedMeshControls\n{\n}\n");
    const diags = validateBlock(tree, "castellatedMeshControls", castellatedSchema);
    expect(diags.some(d => d.severity === "error" && d.message.includes("locationInMesh"))).toBe(true);
  });

  it("passes when locationInMesh is present", () => {
    const tree = parseText(parser, "castellatedMeshControls\n{\n    locationInMesh (0 0 0);\n}\n");
    const diags = validateBlock(tree, "castellatedMeshControls", castellatedSchema);
    expect(diags.some(d => d.message.includes("locationInMesh"))).toBe(false);
  });
});

describe("collectParseErrors surfaces raw parse ERROR/MISSING nodes", () => {
  it("finds no errors in a well-formed fixture", () => {
    const src = fs.readFileSync(path.join(__dirname, "fixtures", "openfoam", "fvSchemes"), "utf8");
    const tree = parseText(parser, src);
    expect(collectParseErrors(tree)).toEqual([]);
  });

  it("finds a MISSING node for an unbalanced brace", () => {
    const tree = parseText(parser, "outer\n{\n    key value;\n");
    const errs = collectParseErrors(tree);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.some(e => e.severity === "error")).toBe(true);
  });
});
