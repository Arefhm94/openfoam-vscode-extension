import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { getParser, parseText } from "../src/treeSitter/parser";
import type { Parser, Tree } from "../src/treeSitter/parser";
import {
  getBlockPath,
  getCursorContext,
  wordAt,
  dollarReferenceAt,
  isInsideComment,
  buildOutline,
} from "../src/treeSitter/queries";

const FIXTURES_DIR = path.join(__dirname, "fixtures");

let parser: Parser;

beforeAll(async () => {
  parser = await getParser();
});

function parse(text: string): Tree {
  return parseText(parser, text);
}

function fixture(relPath: string): string {
  return fs.readFileSync(path.join(FIXTURES_DIR, relPath), "utf8");
}

describe("tree-sitter grammar loads and parses real fixtures error-free", () => {
  const files = [
    "openfoam/fvSchemes",
    "openfoam/fvSolution",
    "openfoam/controlDict",
    "openfoam/U",
    "helyx/helyxHexMeshDict",
    "helyx/boundary",
    "edge-cases/block-comment-with-braces.foam",
    "edge-cases/multiline-list-value.foam",
  ];

  it.each(files)("%s has no ERROR nodes", relPath => {
    const tree = parse(fixture(relPath));
    expect(tree.rootNode.hasError).toBe(false);
  });
});

describe("getBlockPath / getCursorContext replace the old text-scanning heuristics", () => {
  const src = fixture("openfoam/U");
  // boundaryField { atmosphere { type ...; value ...; } walls {...} }
  const typeLine = src.split("\n").findIndex(l => l.includes("pressureInletOutletVelocity"));

  it("reports the enclosing block path for a nested one-liner entry", () => {
    const tree = parse(src);
    const path_ = getBlockPath(tree, { line: typeLine, character: 12 });
    expect(path_).toEqual(["boundaryField", "atmosphere"]);
  });

  it("identifies the cursor as being on the key when positioned over it", () => {
    const tree = parse(src);
    const ctx = getCursorContext(tree, { line: typeLine, character: 10 });
    expect(ctx.cursorIn).toBe("key");
    expect(ctx.blockPath).toEqual(["boundaryField", "atmosphere"]);
  });

  it("identifies the cursor as being on the value and reports currentKey", () => {
    const tree = parse(src);
    const ctx = getCursorContext(tree, { line: typeLine, character: 35 });
    expect(ctx.cursorIn).toBe("value");
    expect(ctx.currentKey).toBe("type");
  });

  it("defaults to key/empty on a blank line inside a block", () => {
    const src2 = "boundaryField\n{\n\n}\n";
    const tree = parse(src2);
    const ctx = getCursorContext(tree, { line: 2, character: 0 });
    expect(ctx.cursorIn).toBe("key");
    expect(ctx.blockPath).toEqual(["boundaryField"]);
  });
});

describe("wordAt resolves multi-character tokens as one word (fixing the old \\w-only regex)", () => {
  it("resolves a dotted identifier like alpha.water as a single token", () => {
    const tree = parse("alpha.water    uniform 0;\n");
    const w = wordAt(tree, { line: 0, character: 8 });
    expect(w?.text).toBe("alpha.water");
  });

  it("resolves a composite scheme key like div(phi,U) as a single token", () => {
    const tree = parse("divSchemes\n{\n    div(phi,U)   Gauss upwind;\n}\n");
    const w = wordAt(tree, { line: 2, character: 8 });
    expect(w?.text).toBe("div(phi,U)");
  });
});

describe("dollarReferenceAt replaces the duplicated $-rescan in hover/definition", () => {
  it("strips the leading $ from a $reference value", () => {
    const src = fixture("openfoam/U");
    const lines = src.split("\n");
    const line = lines.findIndex(l => l.includes("$internalField"));
    const character = lines[line].indexOf("$internalField") + 5;
    const tree = parse(src);
    const varName = dollarReferenceAt(tree, { line, character });
    expect(varName).toBe("internalField");
  });

  it("returns null when not on a $reference", () => {
    const tree = parse("key value;\n");
    expect(dollarReferenceAt(tree, { line: 0, character: 1 })).toBeNull();
  });
});

describe("isInsideComment", () => {
  it("is true inside a block comment containing braces", () => {
    const tree = parse(fixture("edge-cases/block-comment-with-braces.foam"));
    // line 13 (0-indexed): "    that must NOT affect nesting depth ..." — inside the /* */ block starting at line 11
    expect(isInsideComment(tree, { line: 13, character: 10 })).toBe(true);
  });

  it("is false on a real entry outside any comment", () => {
    const tree = parse("key value;\n");
    expect(isInsideComment(tree, { line: 0, character: 1 })).toBe(false);
  });
});

describe("buildOutline replaces the outline provider's independent regex parser", () => {
  it("builds a nested block/entry tree", () => {
    const tree = parse(
      "boundaryField\n{\n    inlet\n    {\n        type fixedValue;\n    }\n}\n",
    );
    const outline = buildOutline(tree);
    expect(outline).toHaveLength(1);
    expect(outline[0].name).toBe("boundaryField");
    expect(outline[0].kind).toBe("block");
    expect(outline[0].children).toHaveLength(1);
    expect(outline[0].children[0].name).toBe("inlet");
    expect(outline[0].children[0].children[0]).toMatchObject({
      name: "type",
      kind: "entry",
      detail: "fixedValue",
    });
  });

  it("flattens blocks nested inside a sized list (constant/polyMesh/boundary)", () => {
    const tree = parse(fixture("helyx/boundary"));
    const outline = buildOutline(tree);
    const names = outline.map(n => n.name);
    expect(names).toContain("ffminx");
    expect(names).toContain("ffmaxx");
  });
});
