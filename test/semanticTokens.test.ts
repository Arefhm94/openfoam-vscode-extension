import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { getParser, parseText } from "../src/treeSitter/parser";
import type { Parser } from "../src/treeSitter/parser";
import {
  computeSemanticTokens,
  TOK,
  SemanticResolverContext,
} from "../src/treeSitter/semanticTokens";

let parser: Parser;
beforeAll(async () => {
  parser = await getParser();
});

function parse(text: string) {
  return parseText(parser, text);
}

function ctx(overrides: Partial<SemanticResolverContext> = {}): SemanticResolverContext {
  return {
    surfaceNames: new Set(),
    surfaceFilenames: new Set(),
    eMeshNames: new Set(),
    patchNames: new Set(),
    varNames: new Set(),
    includeResolves: () => false,
    ...overrides,
  };
}

describe("computeSemanticTokens — only resolvable references get a token", () => {
  it("colours a geometry filename (with and without extension) that exists in triSurface", () => {
    const src = `geometry
{
    building01.stl { type triSurfaceMesh; name building01; }
    ghost.stl      { type triSurfaceMesh; name ghost; }
}
`;
    const tree = parse(src);
    const tokens = computeSemanticTokens(tree, ctx({
      surfaceNames: new Set(["building01"]),
      surfaceFilenames: new Set(["building01.stl"]),
    }));
    // "building01.stl" (the block name) and "building01" (the `name` value) both resolve.
    const geom = tokens.filter(t => t.tokenType === TOK.geometryFile);
    expect(geom.length).toBe(2);
    expect(geom.every(t => t.line === 2)).toBe(true);
    // "ghost.stl" / "ghost" do not exist → no token
    expect(tokens.some(t => t.line === 3)).toBe(false);
  });

  it("colours a $reference that resolves to a case variable, not one that doesn't", () => {
    const src = "value    $inletVelocity;\nother    $nope;\n";
    const tree = parse(src);
    const tokens = computeSemanticTokens(tree, ctx({ varNames: new Set(["inletVelocity"]) }));
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tokenType).toBe(TOK.caseVariable);
    expect(tokens[0].line).toBe(0);
  });

  it("colours the ${VAR} brace form", () => {
    const tree = parse("x  ${p_rgh};\n");
    const tokens = computeSemanticTokens(tree, ctx({ varNames: new Set(["p_rgh"]) }));
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tokenType).toBe(TOK.caseVariable);
  });

  it("colours a boundary-patch name that exists in polyMesh/boundary", () => {
    const src = "boundaryField\n{\n    inlet   { type fixedValue; value uniform 0; }\n    madeup  { type zeroGradient; }\n}\n";
    const tree = parse(src);
    const tokens = computeSemanticTokens(tree, ctx({ patchNames: new Set(["inlet"]) }));
    const patch = tokens.filter(t => t.tokenType === TOK.boundaryPatch);
    expect(patch).toHaveLength(1);
    expect(patch[0].line).toBe(2);
  });

  it("colours an #include path that resolves, not one that doesn't", () => {
    const src = '#include "$FOAM_CASE/system/includeDicts/real"\n#include "missing"\n';
    const tree = parse(src);
    const tokens = computeSemanticTokens(tree, ctx({
      includeResolves: raw => raw.includes("real"),
    }));
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tokenType).toBe(TOK.includePath);
    expect(tokens[0].line).toBe(0);
  });

  it("colours a feature-edge .eMesh reference", () => {
    const tree = parse('features ( { file "building01.eMesh"; level 2; } );\n');
    const tokens = computeSemanticTokens(tree, ctx({ eMeshNames: new Set(["building01.eMesh"]) }));
    const fe = tokens.filter(t => t.tokenType === TOK.featureEdge);
    expect(fe).toHaveLength(1);
  });

  it("emits nothing for a file with no resolvable references (stays default colour)", () => {
    const src = "ddtSchemes\n{\n    default   Euler;\n}\ndivSchemes\n{\n    div(phi,U)  Gauss upwind;\n}\n";
    const tree = parse(src);
    expect(computeSemanticTokens(tree, ctx())).toEqual([]);
  });

  it("returns tokens sorted by (line, char)", () => {
    const src = "a  $v2;\nb  $v1;\nc  $v1;\n";
    const tree = parse(src);
    const tokens = computeSemanticTokens(tree, ctx({ varNames: new Set(["v1", "v2"]) }));
    expect(tokens.map(t => t.line)).toEqual([0, 1, 2]);
  });
});

describe("integration against a real HELYX geometry block", () => {
  it("colours the STL block names in examples/Helyx/complex helyxHexMeshDict geometry", () => {
    const caseDir = path.join(__dirname, "..", "examples", "Helyx", "complex");
    const triSurfDir = path.join(caseDir, "constant", "triSurface");
    const stlNames = fs.readdirSync(triSurfDir).filter(f => f.endsWith(".stl"));
    const dictPath = path.join(caseDir, "system", "helyxHexMeshDict");
    const tree = parse(fs.readFileSync(dictPath, "utf8"));
    const tokens = computeSemanticTokens(tree, ctx({
      surfaceNames: new Set(stlNames.map(f => f.replace(/\.stl$/i, ""))),
      surfaceFilenames: new Set(stlNames),
    }));
    // The fixture's geometry block references real STL names — expect at least a few.
    expect(tokens.filter(t => t.tokenType === TOK.geometryFile).length).toBeGreaterThan(0);
  });
});
