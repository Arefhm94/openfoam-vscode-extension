import { describe, it, expect } from "vitest";
import { buildDakotaInput, buildAnalysisDriverScript } from "../src/parametric/dakotaExport";
import { ParamDef } from "../src/parametric/paramSet";

const params: ParamDef[] = [
  { name: "deltaT", file: "system/controlDict", blockPath: [], key: "deltaT", values: ["0.001", "0.01", "0.1"] },
  { name: "nCorr", file: "system/fvSolution", blockPath: ["PIMPLE"], key: "nCorrectors", values: ["2", "4"] },
];

describe("buildDakotaInput", () => {
  it("declares one discrete_state_set descriptor per parameter, with its values and partition count", () => {
    const deck = buildDakotaInput(params, "driver.js");
    expect(deck).toContain("discrete_state_set string = 2");
    expect(deck).toContain("num_set_values = 3 2");
    expect(deck).toContain("set_values '0.001' '0.01' '0.1'");
    expect(deck).toContain("set_values '2' '4'");
    expect(deck).toContain("descriptors 'deltaT' 'nCorr'");
    expect(deck).toContain("partitions = 2 1"); // len(values) - 1 per param
    expect(deck).toContain("analysis_drivers = 'driver.js'");
  });

  it("sanitizes parameter names into valid Dakota identifiers", () => {
    const weird: ParamDef[] = [
      { name: "my param!", file: "f", blockPath: [], key: "k", values: ["1", "2"] },
    ];
    expect(buildDakotaInput(weird, "d")).toContain("'my_param_'");
  });
});

describe("buildAnalysisDriverScript", () => {
  it("embeds the case root and every target's file/blockPath/key", () => {
    const script = buildAnalysisDriverScript("/tmp/mycase", params, "/tmp/ext");
    expect(script).toContain('"/tmp/mycase"');
    expect(script).toContain("/tmp/ext");
    expect(script).toContain('"file": "system/controlDict"');
    expect(script).toContain('"key": "deltaT"');
    expect(script).toContain('"blockPath": [\n      "PIMPLE"\n    ]');
    expect(script).toContain("substituteEntryValue");
  });
});
