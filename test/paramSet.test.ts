import { describe, it, expect } from "vitest";
import { cartesianVariants, ParamDef } from "../src/parametric/paramSet";

describe("cartesianVariants", () => {
  it("returns [] for no parameters", () => {
    expect(cartesianVariants([])).toEqual([]);
  });

  it("builds the full grid for a single parameter", () => {
    const params: ParamDef[] = [
      { name: "deltaT", file: "system/controlDict", blockPath: [], key: "deltaT", values: ["0.001", "0.01"] },
    ];
    const variants = cartesianVariants(params);
    expect(variants).toHaveLength(2);
    expect(variants[0]).toMatchObject({
      name: "variant_001",
      params: { deltaT: "0.001" },
      edits: [{ file: "system/controlDict", blockPath: [], key: "deltaT", value: "0.001" }],
    });
    expect(variants[1].params).toEqual({ deltaT: "0.01" });
  });

  it("builds every combination for two parameters (2 x 3 = 6)", () => {
    const params: ParamDef[] = [
      { name: "deltaT", file: "system/controlDict", blockPath: [], key: "deltaT", values: ["0.001", "0.01"] },
      { name: "nCorr", file: "system/fvSolution", blockPath: ["PIMPLE"], key: "nCorrectors", values: ["1", "2", "3"] },
    ];
    const variants = cartesianVariants(params);
    expect(variants).toHaveLength(6);
    // every combination is present, and each variant edits both files
    const pairs = variants.map(v => `${v.params.deltaT}/${v.params.nCorr}`).sort();
    expect(pairs).toEqual([
      "0.001/1", "0.001/2", "0.001/3", "0.01/1", "0.01/2", "0.01/3",
    ]);
    expect(variants[0].edits).toHaveLength(2);
    expect(variants[0].edits[1]).toMatchObject({ blockPath: ["PIMPLE"], key: "nCorrectors" });
  });

  it("numbers variants sequentially, zero-padded", () => {
    const params: ParamDef[] = [
      { name: "x", file: "f", blockPath: [], key: "x", values: Array.from({ length: 12 }, (_, i) => String(i)) },
    ];
    const names = cartesianVariants(params).map(v => v.name);
    expect(names[0]).toBe("variant_001");
    expect(names[11]).toBe("variant_012");
  });
});
