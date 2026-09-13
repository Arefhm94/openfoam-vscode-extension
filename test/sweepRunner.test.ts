import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runSweep } from "../src/parametric/sweepRunner";
import { cartesianVariants, ParamDef } from "../src/parametric/paramSet";

let tmpRoot: string | undefined;

afterEach(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = undefined;
});

function makeFixtureCase(): string {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openfoam-sweep-"));
  const caseDir = path.join(tmpRoot, "case");
  fs.mkdirSync(path.join(caseDir, "system"), { recursive: true });
  fs.mkdirSync(path.join(caseDir, "postProcessing", "forces"), { recursive: true });
  fs.writeFileSync(path.join(caseDir, "postProcessing", "forces", "stale.dat"), "old run output\n");
  fs.writeFileSync(
    path.join(caseDir, "system", "controlDict"),
    "application     simpleFoam;\ndeltaT          0.001;\nendTime         100;\n",
  );
  fs.writeFileSync(
    path.join(caseDir, "system", "fvSolution"),
    "PIMPLE\n{\n    nCorrectors      2;\n}\n",
  );
  return caseDir;
}

describe("runSweep", () => {
  it("creates one sibling case dir per variant with the substituted values applied", async () => {
    const caseDir = makeFixtureCase();
    const params: ParamDef[] = [
      { name: "deltaT", file: "system/controlDict", blockPath: [], key: "deltaT", values: ["0.001", "0.01"] },
    ];
    const results = await runSweep(caseDir, cartesianVariants(params));

    expect(results).toHaveLength(2);
    for (const r of results) expect(r.missedEdits).toEqual([]);

    const v1 = fs.readFileSync(path.join(`${caseDir}_variant_001`, "system", "controlDict"), "utf8");
    const v2 = fs.readFileSync(path.join(`${caseDir}_variant_002`, "system", "controlDict"), "utf8");
    expect(v1).toContain("deltaT    0.001;");
    expect(v2).toContain("deltaT    0.01;");
    // untouched entries survive verbatim
    expect(v1).toContain("endTime         100;");
  });

  it("applies multiple edits across different files for the same variant", async () => {
    const caseDir = makeFixtureCase();
    const params: ParamDef[] = [
      { name: "deltaT", file: "system/controlDict", blockPath: [], key: "deltaT", values: ["0.02"] },
      { name: "nCorr", file: "system/fvSolution", blockPath: ["PIMPLE"], key: "nCorrectors", values: ["4"] },
    ];
    const [result] = await runSweep(caseDir, cartesianVariants(params));

    const controlDict = fs.readFileSync(path.join(result.caseDir, "system", "controlDict"), "utf8");
    const fvSolution = fs.readFileSync(path.join(result.caseDir, "system", "fvSolution"), "utf8");
    expect(controlDict).toContain("deltaT    0.02;");
    expect(fvSolution).toContain("nCorrectors    4;");
  });

  it("does not copy postProcessing/ into the variant clones", async () => {
    const caseDir = makeFixtureCase();
    const params: ParamDef[] = [
      { name: "deltaT", file: "system/controlDict", blockPath: [], key: "deltaT", values: ["0.001"] },
    ];
    const [result] = await runSweep(caseDir, cartesianVariants(params));
    expect(fs.existsSync(path.join(result.caseDir, "postProcessing"))).toBe(false);
  });

  it("reports a missed edit (and leaves the file otherwise intact) when the key isn't found", async () => {
    const caseDir = makeFixtureCase();
    const params: ParamDef[] = [
      { name: "bogus", file: "system/controlDict", blockPath: [], key: "notARealKey", values: ["1"] },
    ];
    const [result] = await runSweep(caseDir, cartesianVariants(params));
    expect(result.missedEdits).toEqual([{ file: "system/controlDict", key: "notARealKey" }]);
    const text = fs.readFileSync(path.join(result.caseDir, "system", "controlDict"), "utf8");
    expect(text).toContain("deltaT          0.001;"); // untouched
  });
});
