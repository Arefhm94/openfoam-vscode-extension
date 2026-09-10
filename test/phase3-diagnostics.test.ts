import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { getParser, parseText } from "../src/treeSitter/parser";
import type { Parser } from "../src/treeSitter/parser";
import { validate, validateBlock, validateBoundaryConditions } from "../src/treeSitter/schema";
import {
  FVSCHEMES_TOP_LEVEL,
  FVSOLUTION_TOP_LEVEL,
  TURBULENCE_PROPERTIES_TOP_LEVEL,
  SNAPPY_TOP_LEVEL,
  REGION_PROPERTIES,
  PHASE_PROPERTIES_TOP_LEVEL,
  MAP_FIELDS_DICT,
  HELYX_SNAPPY_TOP_LEVEL,
  helyxCastellatedSchema,
} from "../src/treeSitter/knownSchemas";

let parser: Parser;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

beforeAll(async () => {
  parser = await getParser();
  db = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "keyword-db.json"), "utf8"));
});

function fixture(relPath: string): string {
  return fs.readFileSync(path.join(__dirname, "fixtures", relPath), "utf8");
}

function parse(text: string) {
  return parseText(parser, text);
}

/**
 * Every file type covered by Phase 3's schema-driven diagnostics, per
 * context/openfoam-extension-treesitter-instruction.md's "8 file types
 * that currently get real diagnostics" list — one valid-fixture-zero-
 * diagnostics test plus one deliberately-broken test each.
 */
describe("controlDict", () => {
  it("real fixture: zero diagnostics", () => {
    expect(validate(parse(fixture("openfoam/controlDict")), db.controlDict.keywords)).toEqual([]);
  });
  it("unknown key + missing required key are flagged", () => {
    const diags = validate(parse("bogusKey 1;\napplication simpleFoam;\n"), db.controlDict.keywords);
    expect(diags.some(d => d.message.includes("bogusKey"))).toBe(true);
    expect(diags.some(d => d.message.includes("Missing required key 'stopAt'"))).toBe(true);
  });
});

describe("blockMeshDict", () => {
  it("real fixture: zero diagnostics", () => {
    expect(validate(parse(fixture("openfoam/blockMeshDict")), db.blockMesh.keywords)).toEqual([]);
  });
  it("missing required key (vertices) is flagged", () => {
    const diags = validate(parse("blocks (hex (0 1 2 3 4 5 6 7) (1 1 1) simpleGrading (1 1 1));\n"), db.blockMesh.keywords);
    expect(diags.some(d => d.severity === "error" && d.message.includes("vertices"))).toBe(true);
  });
});

describe("decomposeParDict", () => {
  it("real fixture: zero diagnostics", () => {
    expect(validate(parse(fixture("openfoam/decomposeParDict")), db.decomposePar)).toEqual([]);
  });
  it("unknown key is flagged", () => {
    const diags = validate(parse("numberOfSubdomains 4;\nmethod scotch;\nbogusOption true;\n"), db.decomposePar);
    expect(diags.some(d => d.message.includes("bogusOption"))).toBe(true);
  });
});

describe("fvSchemes (top-level block names)", () => {
  it("real fixture: zero diagnostics", () => {
    expect(validate(parse(fixture("openfoam/fvSchemes")), FVSCHEMES_TOP_LEVEL)).toEqual([]);
  });
  it("missing required ddtSchemes + unknown top-level block are flagged", () => {
    const diags = validate(parse("gradSchems\n{\n    default Gauss linear;\n}\n"), FVSCHEMES_TOP_LEVEL);
    expect(diags.some(d => d.message.includes("gradSchems"))).toBe(true); // typo'd block name
    expect(diags.some(d => d.message.includes("ddtSchemes"))).toBe(true);
  });
});

describe("fvSolution (top-level block names)", () => {
  it("real fixture: zero diagnostics", () => {
    expect(validate(parse(fixture("openfoam/fvSolution")), FVSOLUTION_TOP_LEVEL)).toEqual([]);
  });
  it("missing required solvers block is flagged", () => {
    const diags = validate(parse("SIMPLE\n{\n    nNonOrthogonalCorrectors 0;\n}\n"), FVSOLUTION_TOP_LEVEL);
    expect(diags.some(d => d.message.includes("solvers"))).toBe(true);
  });
});

describe("turbulenceProperties (top-level)", () => {
  it("real fixture: zero diagnostics", () => {
    expect(validate(parse(fixture("helyx/turbulenceProperties")), TURBULENCE_PROPERTIES_TOP_LEVEL)).toEqual([]);
  });
  it("invalid simulationType enum value is flagged", () => {
    const diags = validate(parse("simulationType bogusType;\n"), TURBULENCE_PROPERTIES_TOP_LEVEL);
    expect(diags.some(d => d.message.includes("bogusType"))).toBe(true);
  });
});

// Deliberately synthetic, not a copied real-world fixture: the only real
// snappyHexMeshDict-family examples in this repo are Helyx's
// helyxHexMeshDict, which has substantial real Helyx-specific keywords
// this OpenFOAM-only schema doesn't know about (confirmed by scanning
// every Helyx fixture — see server.ts's diagSchema() comment on why
// helyxHexMeshDict is excluded from this validation). This snippet uses
// only plain-OpenFOAM keywords so it exercises the schema without that
// mismatch.
const SNAPPY_VALID_SYNTHETIC = `
castellatedMesh true;
snap            true;
addLayers       true;

castellatedMeshControls
{
    refinementSurfaces {}
    locationInMesh (0 0 0);
}
snapControls {}
addLayersControls
{
    layers {}
}
meshQualityControls {}
`;

describe("snappyHexMeshDict", () => {
  it("synthetic valid file: zero top-level diagnostics", () => {
    expect(validate(parse(SNAPPY_VALID_SYNTHETIC), SNAPPY_TOP_LEVEL)).toEqual([]);
  });
  it("synthetic valid file: zero castellatedMeshControls diagnostics", () => {
    const tree = parse(SNAPPY_VALID_SYNTHETIC);
    expect(validateBlock(tree, "castellatedMeshControls", db.snappyHexMesh.castellatedMeshControls)).toEqual([]);
  });
  it("missing required castellatedMesh/snap/addLayers toggles are flagged", () => {
    const diags = validate(parse("geometry {}\n"), SNAPPY_TOP_LEVEL);
    expect(diags.filter(d => d.message.includes("Missing required key")).length).toBeGreaterThanOrEqual(3);
  });
  it("missing required locationInMesh inside castellatedMeshControls is flagged", () => {
    const tree = parse("castellatedMeshControls\n{\n    maxLocalCells 100000;\n}\n");
    const diags = validateBlock(tree, "castellatedMeshControls", db.snappyHexMesh.castellatedMeshControls);
    expect(diags.some(d => d.message.includes("locationInMesh"))).toBe(true);
  });
});

// Beyond the original 8 diagXxx() file types: coverage extended per Phase 3
// item 4, grounded in this repo's real example files (see
// treeSitter/knownSchemas.ts for why most of the doc's other candidates —
// fvOptions, topoSetDict, RASProperties, etc. — were deliberately left
// uncovered rather than hand-fabricated).
describe("regionProperties", () => {
  it("real fixture: zero diagnostics", () => {
    expect(validate(parse(fixture("helyx/regionProperties")), REGION_PROPERTIES)).toEqual([]);
  });
  it("missing required 'regions' is flagged", () => {
    const diags = validate(parse("// empty\n"), REGION_PROPERTIES);
    expect(diags.some(d => d.severity === "error" && d.message.includes("regions"))).toBe(true);
  });
});

describe("phaseProperties", () => {
  it("real fixture: zero diagnostics", () => {
    expect(validate(parse(fixture("openfoam/phaseProperties")), PHASE_PROPERTIES_TOP_LEVEL)).toEqual([]);
  });
  it("unknown key is flagged", () => {
    const diags = validate(parse("phases (water air);\nbogusPhaseKey true;\n"), PHASE_PROPERTIES_TOP_LEVEL);
    expect(diags.some(d => d.message.includes("bogusPhaseKey"))).toBe(true);
  });
});

describe("mapFieldsDict", () => {
  it("real fixture: zero diagnostics", () => {
    expect(validate(parse(fixture("helyx/mapFieldsDict")), MAP_FIELDS_DICT)).toEqual([]);
  });
  it("unknown key is flagged", () => {
    const diags = validate(parse("consistent false;\nbogusMapKey 1;\n"), MAP_FIELDS_DICT);
    expect(diags.some(d => d.message.includes("bogusMapKey"))).toBe(true);
  });
});

// Phase 5: helyxHexMeshDict used to be entirely excluded from schema
// validation (see git history / progress.md) since it shares
// snappyHexMeshDict's OpenFOAM-only schema, which false-positived on real
// Helyx keywords. Resolved with HELYX_*_EXTRA_KEYS, grounded in every real
// helyxHexMeshDict* file in examples/.
describe("helyxHexMeshDict (Helyx-extended snappy schema)", () => {
  it("real fixture: zero top-level diagnostics", () => {
    expect(validate(parse(fixture("helyx/helyxHexMeshDict")), HELYX_SNAPPY_TOP_LEVEL)).toEqual([]);
  });
  it("real fixture: zero castellatedMeshControls diagnostics (including Helyx-only keys)", () => {
    const tree = parse(fixture("helyx/helyxHexMeshDict"));
    const schema = helyxCastellatedSchema(db.snappyHexMesh.castellatedMeshControls);
    expect(validateBlock(tree, "castellatedMeshControls", schema)).toEqual([]);
  });
  it("a genuinely unknown key (typo) is still flagged", () => {
    const diags = validate(parse("autoBlockMesh true;\nbogusHelyxKey 1;\n"), HELYX_SNAPPY_TOP_LEVEL);
    expect(diags.some(d => d.message.includes("bogusHelyxKey"))).toBe(true);
    expect(diags.some(d => d.message.includes("autoBlockMesh"))).toBe(false);
  });
  it("locationInMesh is not required (Helyx substitutes locationsInMesh)", () => {
    const tree = parse("castellatedMeshControls\n{\n    locationsInMesh 1 ((0 0 0));\n}\n");
    const schema = helyxCastellatedSchema(db.snappyHexMesh.castellatedMeshControls);
    const diags = validateBlock(tree, "castellatedMeshControls", schema);
    expect(diags.some(d => d.message.includes("locationInMesh"))).toBe(false);
  });
});

describe("boundaryField (per-patch BC keyword schema)", () => {
  it("real fixture (fixedValue + quoted pattern): zero diagnostics", () => {
    const tree = parse(fixture("edge-cases/multiline-list-value.foam"));
    expect(validateBoundaryConditions(tree, db.boundaryConditions)).toEqual([]);
  });
  it("fixedValue patch missing required 'value' is flagged", () => {
    const src = "boundaryField\n{\n    inlet\n    {\n        type fixedValue;\n    }\n}\n";
    const diags = validateBoundaryConditions(parse(src), db.boundaryConditions);
    expect(diags.some(d => d.severity === "error" && d.message.includes("value"))).toBe(true);
  });
});
