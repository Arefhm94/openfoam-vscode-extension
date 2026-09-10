// Exploratory broad scan (not part of the permanent suite's strictness
// contract): runs the schema validator against every real example file to
// surface false positives before locking in fixture tests. Prints findings
// rather than asserting zero — some are genuine, some are pre-existing data
// gaps worth knowing about, so this is a diagnostic aid, run manually.
import { describe, it, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { getParser, parseText } from "../src/treeSitter/parser";
import type { Parser } from "../src/treeSitter/parser";
import { validate, validateBlock, validateBoundaryConditions, DictSchema } from "../src/treeSitter/schema";
import {
  FVSCHEMES_TOP_LEVEL,
  FVSOLUTION_TOP_LEVEL,
  TURBULENCE_PROPERTIES_TOP_LEVEL,
  SNAPPY_TOP_LEVEL,
  REGION_PROPERTIES,
  PHASE_PROPERTIES_TOP_LEVEL,
  MAP_FIELDS_DICT,
  HELYX_SNAPPY_TOP_LEVEL,
  HELYX_SNAP_EXTRA_KEYS,
  HELYX_ADD_LAYERS_EXTRA_KEYS,
  HELYX_MESH_QUALITY_EXTRA_KEYS,
  withExtraKeys,
  helyxCastellatedSchema,
} from "../src/treeSitter/knownSchemas";

let parser: Parser;
let db: any;
beforeAll(async () => {
  parser = await getParser();
  db = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "keyword-db.json"), "utf8"));
});

const EXAMPLES = path.join(__dirname, "..", "examples");

function findAllInDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => path.join(dir, e.name));
}

function findAll(dir: string, basename: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findAll(full, basename));
    else if (entry.name === basename || entry.name.startsWith(basename + ".")) out.push(full);
  }
  return out;
}

function scan(label: string, files: string[], schema: DictSchema, block?: string) {
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const tree = parseText(parser, src);
    const diags = block ? validateBlock(tree, block, schema) : validate(tree, schema);
    if (diags.length) {
      console.log(`\n[${label}] ${path.relative(EXAMPLES, f)}:`);
      for (const d of diags) console.log(`  ${d.severity} L${d.range.start.line + 1}: ${d.message}`);
    }
  }
}

describe.skip("broad scan (manual diagnostic aid, run with --no-skip)", () => {
  it("scans all real example files for false positives", () => {
    scan("controlDict", findAll(EXAMPLES, "controlDict"), db.controlDict.keywords);
    scan("blockMeshDict", findAll(EXAMPLES, "blockMeshDict"), db.blockMesh.keywords);
    scan("decomposeParDict", findAll(EXAMPLES, "decomposeParDict"), db.decomposePar);
    scan("fvSchemes(top)", findAll(EXAMPLES, "fvSchemes"), FVSCHEMES_TOP_LEVEL);
    scan("fvSolution(top)", findAll(EXAMPLES, "fvSolution"), FVSOLUTION_TOP_LEVEL);
    scan("turbulenceProperties(top)", findAll(EXAMPLES, "turbulenceProperties"), TURBULENCE_PROPERTIES_TOP_LEVEL);
    // helyxHexMeshDict excluded from the plain OpenFOAM-only schema scans
    // below (matches server.ts's diagSchema()) — scanned separately further
    // down against the Helyx-extended schemas instead.
    const snappyFiles = findAll(EXAMPLES, "snappyHexMeshDict");
    scan("snappy(top)", snappyFiles, SNAPPY_TOP_LEVEL);
    scan("snappy(castellated)", snappyFiles, db.snappyHexMesh.castellatedMeshControls, "castellatedMeshControls");
    scan("snappy(snap)", snappyFiles, db.snappyHexMesh.snapControls, "snapControls");
    scan("snappy(addLayers)", snappyFiles, db.snappyHexMesh.addLayersControls, "addLayersControls");
    scan("snappy(meshQuality)", snappyFiles, db.snappyHexMesh.meshQualityControls, "meshQualityControls");

    const helyxFiles = findAll(EXAMPLES, "helyxHexMeshDict");
    scan("helyx-snappy(top)", helyxFiles, HELYX_SNAPPY_TOP_LEVEL);
    scan("helyx-snappy(castellated)", helyxFiles, helyxCastellatedSchema(db.snappyHexMesh.castellatedMeshControls), "castellatedMeshControls");
    scan("helyx-snappy(snap)", helyxFiles, withExtraKeys(db.snappyHexMesh.snapControls, HELYX_SNAP_EXTRA_KEYS), "snapControls");
    scan("helyx-snappy(addLayers)", helyxFiles, withExtraKeys(db.snappyHexMesh.addLayersControls, HELYX_ADD_LAYERS_EXTRA_KEYS), "addLayersControls");
    scan("helyx-snappy(meshQuality)", helyxFiles, withExtraKeys(db.snappyHexMesh.meshQualityControls, HELYX_MESH_QUALITY_EXTRA_KEYS), "meshQualityControls");

    scan("regionProperties", findAll(EXAMPLES, "regionProperties"), REGION_PROPERTIES);
    scan("phaseProperties", findAll(EXAMPLES, "phaseProperties"), PHASE_PROPERTIES_TOP_LEVEL);
    scan("mapFieldsDict", findAll(EXAMPLES, "mapFieldsDict"), MAP_FIELDS_DICT);

    // boundaryField: every field file under a 0/ directory
    const zeroDirFiles = [
      ...findAllInDir(path.join(EXAMPLES, "OpenFOAM", "damBreak3D", "0")),
      ...findAllInDir(path.join(EXAMPLES, "Helyx", "simple", "boundaryConditions")),
    ];
    for (const f of zeroDirFiles) {
      const tree = parseText(parser, fs.readFileSync(f, "utf8"));
      const diags = validateBoundaryConditions(tree, db.boundaryConditions);
      if (diags.length) {
        console.log(`\n[boundaryField] ${path.relative(EXAMPLES, f)}:`);
        for (const d of diags) console.log(`  ${d.severity} L${d.range.start.line + 1}: ${d.message}`);
      }
    }
  });
});
