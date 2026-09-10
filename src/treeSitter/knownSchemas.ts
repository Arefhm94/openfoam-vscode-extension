import type { DictSchema } from "./schema";

/**
 * Hand-authored, deliberately coarse top-level schemas for file types whose
 * real content is mostly *dynamic* (user-chosen field names mapped to
 * scheme/solver selections looked up against `data/keyword-db.json`'s
 * `schemes`/`linearSolvers`/`algorithms` tables — not a fixed keyword set,
 * so the generic `validate()` engine doesn't apply to their inner content).
 * These only check the outer, well-established block names — unknown
 * top-level blocks (typos) and the couple of blocks OpenFOAM genuinely
 * always requires. Kept separate from `data/keyword-db.json` since they
 * aren't extracted from source, just standard, stable OpenFOAM structure.
 */

export const FVSCHEMES_TOP_LEVEL: DictSchema = {
  ddtSchemes: { type: "dict", required: true, description: "Time derivative discretisation" },
  gradSchemes: { type: "dict", required: false },
  divSchemes: { type: "dict", required: false },
  laplacianSchemes: { type: "dict", required: false },
  interpolationSchemes: { type: "dict", required: false },
  snGradSchemes: { type: "dict", required: false },
  fluxRequired: { type: "dict", required: false },
  wallDist: { type: "dict", required: false },
};

export const FVSOLUTION_TOP_LEVEL: DictSchema = {
  solvers: { type: "dict", required: true, description: "Linear solver settings per field" },
  relaxationFactors: { type: "dict", required: false },
  SIMPLE: { type: "dict", required: false },
  PIMPLE: { type: "dict", required: false },
  PISO: { type: "dict", required: false },
  potentialFlow: { type: "dict", required: false },
  stressAnalysis: { type: "dict", required: false },
  cache: { type: "dict", required: false, description: "Caches (e.g. viscosity model) between iterations" },
  blockSolver: { type: "dict", required: false, description: "Block-coupled solver settings" },
};

export const TURBULENCE_PROPERTIES_TOP_LEVEL: DictSchema = {
  simulationType: { type: "word", required: true, options: ["laminar", "RAS", "LES"] },
  RAS: { type: "dict", required: false },
  LES: { type: "dict", required: false },
};

/**
 * Below: schemas for file types the original 8 `diagXxx()` functions never
 * covered at all (Phase 3 item 4 — extending coverage). Deliberately
 * conservative: only added where this repo's real example files gave
 * enough grounded evidence to be confident the keyword list won't produce
 * false positives on legitimate content (regionProperties, phaseProperties,
 * mapFieldsDict). Other candidates from the instruction doc's list
 * (fvOptions, topoSetDict, setFieldsDict, RASProperties, dynamicMeshDict,
 * materialProperties, surfaceFeatureExtractDict, createPatchDict,
 * refineMeshDict, sampleDict) were deliberately left uncovered rather than
 * hand-fabricated: their real top-level structure is either highly
 * model-/version-dependent (RASProperties' `<Model>Coeffs`,
 * dynamicMeshDict's `topoChanger`/`motionSolver` variants) or this repo's
 * only example of them is empty/too thin to ground a keyword list against
 * (setFieldsDict). See context/progress.md for the full per-type table.
 */

export const REGION_PROPERTIES: DictSchema = {
  regions: { type: "list", required: true, description: "Region-to-domain-type mapping, e.g. `1 ( fluid 1 ( region0 ) )`" },
};

export const PHASE_PROPERTIES_TOP_LEVEL: DictSchema = {
  phases: { type: "list", required: true, description: "Names of the phases, e.g. `(water air)`" },
  sigma: { type: "scalar", required: false, description: "Surface tension coefficient" },
};

export const MAP_FIELDS_DICT: DictSchema = {
  patchMap: { type: "list", required: false },
  cuttingPatches: { type: "list", required: false },
  // Real Helyx files write this with no space before an empty `()`, which
  // OpenFOAM's own word tokenizer (and this grammar, faithfully) reads as
  // one atomic keyword "cuttingPatches()" rather than key "cuttingPatches"
  // + an empty-list value — see the `roots()` case noted in progress.md.
  "cuttingPatches()": { type: "list", required: false },
  parallelSource: { type: "boolean", required: false },
  sourceTimeOption: { type: "word", required: false, options: ["latestTime", "sourceTimeValue"] },
  sourceTimeValue: { type: "scalar", required: false },
  targetTimeOption: { type: "word", required: false, options: ["latestTime", "targetTimeValue"] },
  targetTimeValue: { type: "scalar", required: false },
  consistent: { type: "boolean", required: false },
};

export const SNAPPY_TOP_LEVEL: DictSchema = {
  castellatedMesh: { type: "boolean", required: true },
  snap: { type: "boolean", required: true },
  addLayers: { type: "boolean", required: true },
  geometry: { type: "dict", required: false },
  castellatedMeshControls: { type: "dict", required: false },
  snapControls: { type: "dict", required: false },
  addLayersControls: { type: "dict", required: false },
  meshQualityControls: { type: "dict", required: false },
  mergeTolerance: { type: "scalar", required: false },
  debug: { required: false },
};

/**
 * Helyx-specific `helyxHexMeshDict` extension keywords (Phase 5 gap
 * resolution): `helyxHexMeshDict` used to share `snappyHexMeshDict`'s
 * OpenFOAM-only schema wholesale, which Phase 3 found produced 60+
 * false-positive "unknown key" warnings on real Helyx files and so
 * excluded it from generic schema validation entirely. Rather than leave
 * that gap open, these lists were extracted by diffing every real key
 * actually used across every `helyxHexMeshDict*` file in `examples/`
 * against `data/keyword-db.json`'s OpenFOAM-only `snappyHexMesh` schema
 * (see the extraction note in context/progress.md for the exact method —
 * not hand-typed from memory). Marked `required: false` throughout since
 * only the key *names* are grounded in real usage, not their required/
 * type/enum semantics, which would need real Helyx documentation or
 * source to state with confidence.
 */
export const HELYX_SNAPPY_EXTRA_TOP_LEVEL_KEYS = [
  "autoBlockMesh", "blockData", "crackDetection", "crackTol",
  "allowTopoChanges", "finalDecomposition", "meshMode", "meshAlgorithm",
  "meshOptimization", "cellRemoval",
];

export const HELYX_CASTELLATED_EXTRA_KEYS = [
  "featureRefineAngle", "refineSurfaceBoundary", "minBaffleAngle",
  "balanceThenRefine", "nGapRefinements", "minZoneRegionSize",
  "additionalInsideCheck", "moveCentroidsTol", "interfaceRefine",
  "splitCells", "singleCellGapClosure", "locationsInMesh",
  "locationsOutsideMesh", "wrapper", "interZonesBaffle", "fullLeakChecks",
];

export const HELYX_SNAP_EXTRA_KEYS = [
  "nOuterIter", "nPreFeatureIter", "nFeatureIter", "globalFeatureEdges",
  "globalRegionSnap", "zoneFeatureSnapping", "directFeatureSnapping",
  "geometryFeatureLines", "snapSurfBoundary", "collapseTol",
  "enlargeStencil", "smoothSnappedSurface", "featureSnapChecks",
  "concaveTol", "nSliverSmooths", "mergeBoundaryFaces",
  "averageSurfaceNormal", "repatchOverlapping", "acuteReflexSnapAngle",
  "minAcuteReflexSnapAngle", "featureEdges",
];

export const HELYX_ADD_LAYERS_EXTRA_KEYS = [
  "featureAngleMerge", "featureAngleTerminate", "maxLayerIter",
  "growConvexEdge", "growConcaveEdge", "growUpPatches", "rebalance",
  "layerRecovery", "maxProjectionDistance", "maxCellDistortion",
  "medialRatioExp", "growZoneLayers", "writeVTK", "fixedFCH",
  "dualConcaveCollapse", "dualZoneLayersScaling",
  "dualLayerInterfaceWeights", "dualMaxOrtho", "dualReSnapZones",
  "extrudeBlend",
];

export const HELYX_MESH_QUALITY_EXTRA_KEYS = [
  "minVolCollapseRatio", "faceFaceCells", "minSnapRelativeVolume",
  "smoothAlignedEdges", "minSnapRelativeTetVolume",
  "maxGaussGreenCentroid", "nVolSmoothIter", "maxCellAspectRatio",
  "maxFaceCentreNonOrtho", "minEdgeLength",
];

/** Merges `base` (a real `data/keyword-db.json` schema slice) with a flat
 * list of additional (name-only, `required: false`) keys — used to build
 * a Helyx-aware variant of an OpenFOAM-only schema at runtime, since
 * `base` comes from the loaded `KeywordDb`, not a static import. */
export function withExtraKeys(base: DictSchema, extraKeys: string[]): DictSchema {
  const merged: DictSchema = { ...base };
  for (const key of extraKeys) {
    if (!(key in merged)) {
      merged[key] = { required: false, description: "Helyx-specific extension (name only — real semantics not yet documented here)" };
    }
  }
  return merged;
}

export const HELYX_SNAPPY_TOP_LEVEL: DictSchema = withExtraKeys(SNAPPY_TOP_LEVEL, HELYX_SNAPPY_EXTRA_TOP_LEVEL_KEYS);

/** Builds the Helyx-aware `castellatedMeshControls` schema from the real
 * OpenFOAM `base` (`db.snappyHexMesh.castellatedMeshControls`): adds the
 * Helyx-specific extension keys, and relaxes `locationInMesh` from
 * required to optional since Helyx substitutes the plural
 * `locationsInMesh` instead (both are in `HELYX_CASTELLATED_EXTRA_KEYS`
 * as name-only additions; this is the one case where an *existing*
 * OpenFOAM field's required-ness needed overriding, not just new keys
 * added). */
export function helyxCastellatedSchema(base: DictSchema): DictSchema {
  const merged = withExtraKeys(base, HELYX_CASTELLATED_EXTRA_KEYS);
  if (merged.locationInMesh) merged.locationInMesh = { ...merged.locationInMesh, required: false };
  return merged;
}
