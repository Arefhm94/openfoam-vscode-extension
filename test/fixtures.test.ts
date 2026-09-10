import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const FIXTURES_DIR = path.join(__dirname, "fixtures");

const expectedFixtures = [
  "openfoam/fvSchemes",
  "openfoam/fvSolution",
  "openfoam/controlDict",
  "openfoam/U",
  "helyx/helyxHexMeshDict",
  "helyx/boundary",
  "edge-cases/block-comment-with-braces.foam",
  "edge-cases/multiline-list-value.foam",
];

describe("test/fixtures", () => {
  it.each(expectedFixtures)("%s exists and is non-empty", (relPath) => {
    const fullPath = path.join(FIXTURES_DIR, relPath);
    expect(fs.existsSync(fullPath)).toBe(true);
    const content = fs.readFileSync(fullPath, "utf8");
    expect(content.length).toBeGreaterThan(0);
  });

  it("edge-cases/block-comment-with-braces.foam contains an unbalanced brace inside a block comment", () => {
    const content = fs.readFileSync(
      path.join(FIXTURES_DIR, "edge-cases/block-comment-with-braces.foam"),
      "utf8",
    );
    expect(content).toContain("unbalanced { nested }");
  });

  it("edge-cases/multiline-list-value.foam contains a nonuniform List<vector> spanning many lines", () => {
    const content = fs.readFileSync(
      path.join(FIXTURES_DIR, "edge-cases/multiline-list-value.foam"),
      "utf8",
    );
    expect(content).toMatch(/nonuniform List<vector>/);
    expect(content.split("\n").filter((l) => /^\(\d/.test(l)).length).toBeGreaterThan(10);
  });

  it("openfoam/U uses a $reference value", () => {
    const content = fs.readFileSync(path.join(FIXTURES_DIR, "openfoam/U"), "utf8");
    expect(content).toContain("$internalField");
  });
});
