import { describe, it, expect } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import { resolveInclude, expandOpenFoamVars, findCaseRoot } from "../src/language-server/caseContext";

const CASE_ROOT = path.join(__dirname, "..", "examples", "Helyx", "complex");
const CASE_SETUP_DICT = path.join(CASE_ROOT, "system", "caseSetupDict");
const FROM_URI = pathToFileURL(CASE_SETUP_DICT).href;

describe("expandOpenFoamVars", () => {
  it("expands $FOAM_CASE to the case root", () => {
    expect(expandOpenFoamVars("$FOAM_CASE/system/x", CASE_ROOT)).toBe(`${CASE_ROOT}/system/x`);
  });

  it("expands the ${FOAM_CASE} brace form", () => {
    expect(expandOpenFoamVars("${FOAM_CASE}/system/x", CASE_ROOT)).toBe(`${CASE_ROOT}/system/x`);
  });

  it("expands $FOAM_CASENAME to the case directory name", () => {
    expect(expandOpenFoamVars("$FOAM_CASENAME", CASE_ROOT)).toBe(path.basename(CASE_ROOT));
  });

  it("leaves unknown variables untouched", () => {
    expect(expandOpenFoamVars("$NOT_A_REAL_VAR/foo", CASE_ROOT)).toBe("$NOT_A_REAL_VAR/foo");
  });

  it("is a no-op with no variables and no case root", () => {
    expect(expandOpenFoamVars("plain/relative/path", null)).toBe("plain/relative/path");
  });
});

describe("resolveInclude with $FOAM_CASE (regression for the false-positive #include diagnostic)", () => {
  const caseRoot = findCaseRoot(FROM_URI);

  it("finds a case root for the fixture", () => {
    expect(caseRoot).toBe(CASE_ROOT);
  });

  it("resolves $FOAM_CASE/system/includeDicts/<file> to the real file", () => {
    const resolved = resolveInclude(
      '"$FOAM_CASE/system/includeDicts/BCs_tracers_zeroGradient"',
      FROM_URI,
      caseRoot,
    );
    expect(resolved).toBe(path.join(CASE_ROOT, "system", "includeDicts", "BCs_tracers_zeroGradient"));
    expect(fs.existsSync(resolved!)).toBe(true);
  });

  it("resolves the ${FOAM_CASE} brace form too", () => {
    const resolved = resolveInclude(
      '"${FOAM_CASE}/system/includeDicts/BCs_environmental_conditions"',
      FROM_URI,
      caseRoot,
    );
    expect(resolved).toBe(path.join(CASE_ROOT, "system", "includeDicts", "BCs_environmental_conditions"));
  });

  it("still returns null for a genuinely missing file (no accidental match)", () => {
    expect(
      resolveInclude('"$FOAM_CASE/system/includeDicts/DoesNotExist"', FROM_URI, caseRoot),
    ).toBeNull();
  });

  it("still returns null for an unknown variable", () => {
    expect(resolveInclude('"$NOPE/system/x"', FROM_URI, caseRoot)).toBeNull();
  });

  it("still resolves a plain relative include (no regression)", () => {
    const resolved = resolveInclude('"includeDicts/BCs_tracers_zeroGradient"', FROM_URI, caseRoot);
    expect(resolved).toBe(path.join(CASE_ROOT, "system", "includeDicts", "BCs_tracers_zeroGradient"));
  });
});
