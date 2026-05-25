import {
  createConnection, TextDocuments, ProposedFeatures, InitializeParams,
  CompletionItem, CompletionItemKind, TextDocumentPositionParams,
  TextDocumentSyncKind, Hover, MarkupKind, SignatureHelp, SignatureInformation,
  ParameterInformation, InitializeResult, Diagnostic, DiagnosticSeverity,
  Range, Position,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import * as fs from "fs";
import * as path from "path";

// ── Types ─────────────────────────────────────────────────────────────────────

type OpenFOAMFileType =
  | "fvSchemes" | "fvSolution" | "controlDict" | "blockMeshDict"
  | "snappyHexMeshDict" | "decomposeParDict" | "turbulenceProperties"
  | "transportProperties" | "thermophysicalProperties" | "boundaryField"
  | "unknown";

interface CursorContext {
  fileType:   OpenFOAMFileType;
  blockPath:  string[];          // e.g. ["gradSchemes", "default"]
  cursorIn:   "key" | "value";
  currentKey: string;
}

interface KeywordDb {
  version:          string;
  schemes:          Record<string, Record<string, SchemeInfo>>;
  linearSolvers:    Record<string, SolverInfo>;
  algorithms:       Record<string, AlgoInfo>;
  boundaryConditions: Record<string, BcInfo>;
  turbulenceModels: { RAS: Record<string, TurbModel>; LES: Record<string, TurbModel> };
  controlDict:      Record<string, FieldSpec>;
  snappyHexMesh:    Record<string, FieldSpec>;
  blockMesh:        Record<string, FieldSpec>;
  decomposePar:     Record<string, FieldSpec>;
  contexts:         Record<string, unknown>;
}

interface SchemeInfo  { format: string; brief: string; arguments: SchemeArg[]; detail?: string; usage?: string; notes?: string[]; warnings?: string[]; see?: string[] }
interface SchemeArg   { position: number; name: string; type: string; schemeCategory?: string; required: boolean; range?: number[]; description?: string }
interface SolverInfo  { brief: string; appliesTo?: string; keywords: Record<string, FieldSpec> }
interface AlgoInfo    { keywords: Record<string, FieldSpec> }
interface BcInfo      { brief: string; appliesTo: string[]; keywords: Record<string, FieldSpec> }
interface TurbModel   { brief: string; requiredFields?: string[]; coefficients: Record<string, { type: string; default?: unknown }> }
interface FieldSpec   { type?: string; options?: string[]; required?: boolean; default?: unknown; description?: string; keywords?: Record<string, FieldSpec> }

// ── Scheme category by file/block context ────────────────────────────────────
const BLOCK_TO_SCHEME: Record<string, string> = {
  gradSchemes:          "gradScheme",
  divSchemes:           "divScheme",
  laplacianSchemes:     "laplacianScheme",
  interpolationSchemes: "interpolationScheme",
  snGradSchemes:        "snGradScheme",
  ddtSchemes:           "ddtScheme",
  d2dt2Schemes:         "d2dt2Scheme",
};

// ── Static hover descriptions for well-known block/keyword names ──────────────
const BLOCK_DESCRIPTIONS: Record<string, string> = {
  // ── fvSchemes sub-dicts ──
  ddtSchemes:           `### ddtSchemes\n*fvSchemes — time derivative schemes*\n\nDefines the discretisation scheme for the first time derivative ∂/∂t. Common choices:\n- \`Euler\` — first-order implicit (robust)\n- \`backward\` — second-order implicit\n- \`CrankNicolson\` — blended Crank-Nicolson (0=Euler, 1=fully C-N)\n- \`steadyState\` — suppress time terms (steady-state runs)\n- \`localEuler\` — local time-stepping for pseudo-transient`,
  d2dt2Schemes:         `### d2dt2Schemes\n*fvSchemes — second time derivative schemes*\n\nDefines discretisation for ∂²/∂t². Used in solid mechanics / wave problems. Typical value: \`steadyState\` or \`Euler\`.`,
  gradSchemes:          `### gradSchemes\n*fvSchemes — gradient schemes*\n\nSpecifies how cell-centred gradients are computed. Format:\n\`\`\`\ngrad(<field>)  <scheme>;\n\`\`\`\nCommon schemes: \`Gauss linear\`, \`leastSquares\`, \`cellLimited Gauss linear 1\``,
  divSchemes:           `### divSchemes\n*fvSchemes — divergence schemes*\n\nSpecifies convection discretisation. Format:\n\`\`\`\ndiv(phi,U)  Gauss <interpolationScheme>;\n\`\`\`\nCommon interpolation schemes: \`linear\`, \`linearUpwind grad(U)\`, \`limitedLinear\`, \`LUST\``,
  laplacianSchemes:     `### laplacianSchemes\n*fvSchemes — Laplacian schemes*\n\nSpecifies diffusion discretisation. Format:\n\`\`\`\nlaplacian(nu,U)  Gauss linear <snGradScheme>;\n\`\`\`\nCommon snGrad schemes: \`corrected\`, \`uncorrected\`, \`limited corrected 0.333\``,
  interpolationSchemes: `### interpolationSchemes\n*fvSchemes — face interpolation schemes*\n\nControls interpolation of cell-centred values to faces. Default is usually \`linear\`.`,
  snGradSchemes:        `### snGradSchemes\n*fvSchemes — surface-normal gradient schemes*\n\nSpecifies the scheme used for the surface-normal gradient (∇φ·n̂) at faces. Options: \`corrected\`, \`uncorrected\`, \`limited corrected 0.33\`, \`orthogonal\``,
  fluxScheme:           `### fluxScheme\n*fvSchemes*\n\nCompressible-solver flux splitting scheme. Typical value: \`Kurganov\` or \`AUSM\`.`,

  // ── fvSolution algorithm blocks ──
  SIMPLE:   `### SIMPLE\n*fvSolution — SIMPLE algorithm*\n\nSemi-Implicit Method for Pressure-Linked Equations. Used for steady-state solvers (simpleFoam, buoyantSimpleFoam, …).\n\n**Key keywords:**\n- \`nNonOrthogonalCorrectors\` — extra pressure corrections for non-orthogonal meshes\n- \`consistent\` — enables SIMPLEC variant (faster convergence)\n- \`residualControl\` — per-field convergence tolerances`,
  PIMPLE:   `### PIMPLE\n*fvSolution — PIMPLE algorithm*\n\nCombines PISO outer corrections with SIMPLE inner iterations. Used in transient solvers (pimpleFoam, buoyantPimpleFoam, …).\n\n**Key keywords:**\n- \`nOuterCorrectors\` — SIMPLE outer loops (1 = pure PISO)\n- \`nCorrectors\` — PISO inner pressure correctors (typically 2–3)\n- \`nNonOrthogonalCorrectors\` — extra non-orthogonal sweeps\n- \`turbOnFinalIterOnly\` — update turbulence only on last outer iteration`,
  PISO:     `### PISO\n*fvSolution — PISO algorithm*\n\nPressure-Implicit Split-Operator. Pure transient pressure-velocity coupling (no outer iterations).\n\n**Key keywords:**\n- \`nCorrectors\` — pressure correction loops (typically 2)\n- \`nNonOrthogonalCorrectors\` — non-orthogonal correction sweeps`,
  FLUID:    `### FLUID\n*fvSolution — fluid coupling block*\n\nUsed in fluid-structure interaction or coupled solvers. Contains PIMPLE/PISO sub-settings for the fluid domain.`,
  solvers:  `### solvers\n*fvSolution*\n\nContains one sub-dict per field specifying the linear algebraic solver. Example:\n\`\`\`\nsolvers\n{\n    p   { solver GAMG; tolerance 1e-6; relTol 0.1; smoother GaussSeidel; }\n    U   { solver PBiCGStab; preconditioner DILU; tolerance 1e-8; relTol 0; }\n}\n\`\`\``,
  relaxationFactors: `### relaxationFactors\n*fvSolution*\n\nUnder-relaxation factors for field equations (SIMPLE / PIMPLE). Values 0–1; smaller = more stable but slower convergence.\n\`\`\`\nrelaxationFactors { fields { p 0.3; } equations { U 0.7; k 0.7; } }\n\`\`\``,
  residualControl: `### residualControl\n*fvSolution (inside SIMPLE/PIMPLE)*\n\nPer-field convergence tolerances that stop the run when all residuals drop below the specified values.\n\`\`\`\nresidualControl { p 1e-4; U 1e-4; }\n\`\`\``,

  // ── fvSolution solver keywords ──
  solver:        `### solver\n*fvSolution — solvers block*\n\nName of the linear algebraic solver. Options: \`GAMG\`, \`PCG\`, \`PBiCGStab\`, \`PBiCG\`, \`smoothSolver\`, \`diagonal\``,
  preconditioner:`### preconditioner\n*fvSolution — solvers block*\n\nPreconditioner for Krylov solvers. Options: \`DIC\` (symmetric), \`DILU\` (asymmetric), \`FDIC\`, \`diagonal\`, \`GAMG\``,
  tolerance:     `### tolerance\n*fvSolution — solvers block*\n\nAbsolute convergence tolerance for the linear solver. Typical values: \`1e-6\` (pressure), \`1e-8\` (velocity).`,
  relTol:        `### relTol\n*fvSolution — solvers block*\n\nRelative convergence tolerance (reduction ratio). Set to \`0\` on final PISO step. Typical: \`0.1\` for intermediate SIMPLE steps.`,
  smoother:      `### smoother\n*fvSolution — GAMG / smoothSolver*\n\nSmoothing operator. Options: \`GaussSeidel\`, \`symGaussSeidel\`, \`DICGaussSeidel\`, \`DILU\``,
  nSweeps:       `### nSweeps\n*fvSolution — smoothSolver*\n\nNumber of smoother sweeps per iteration of the \`smoothSolver\`. Increasing improves convergence per iteration at higher cost per step. Typical: \`1\`–\`3\`.`,
  cacheAgglomeration: `### cacheAgglomeration\n*fvSolution — GAMG*\n\nCache the agglomeration hierarchy between time steps. Usually \`true\`.`,
  nCellsInCoarsestLevel: `### nCellsInCoarsestLevel\n*fvSolution — GAMG*\n\nTarget number of cells in the coarsest GAMG level. Typical: \`10\`–\`16\`.`,
  agglomerator:  `### agglomerator\n*fvSolution — GAMG*\n\nAlgorithm to build coarse levels. Default: \`faceAreaPair\`.`,
  mergeLevels:   `### mergeLevels\n*fvSolution — GAMG*\n\nNumber of levels to merge in one step. Default: \`1\`.`,

  // ── Turbulence ──
  simulationType: `### simulationType\n*turbulenceProperties*\n\nSelects the turbulence modelling framework.\n- \`laminar\` — no turbulence model\n- \`RAS\` — Reynolds-Averaged Simulation (RANS)\n- \`LES\` — Large Eddy Simulation`,
  RAS:           `### RAS\n*turbulenceProperties*\n\nSub-dict for RANS settings:\n\`\`\`\nRAS\n{\n    RASModel    kOmegaSST;\n    turbulence  on;\n    printCoeffs on;\n}\n\`\`\`\n\nCommon models: \`kOmegaSST\`, \`kEpsilon\`, \`SpalartAllmaras\`, \`realizableKE\`, \`laminar\``,
  LES:           `### LES\n*turbulenceProperties*\n\nSub-dict for LES settings:\n\`\`\`\nLES\n{\n    LESModel    Smagorinsky;\n    turbulence  on;\n    printCoeffs on;\n    delta       cubeRootVol;\n}\n\`\`\`\n\nCommon models: \`Smagorinsky\`, \`WALE\`, \`dynamicKEqn\`, \`kEqn\``,
  RASModel:      `### RASModel\n*turbulenceProperties — RAS block*\n\nName of the RANS turbulence model. Common choices:\n\n| Model | Description |\n|-------|-------------|\n| \`kOmegaSST\` | Menter SST — best for adverse pressure gradient, separation |\n| \`kEpsilon\` | Standard k-ε — robust for free shear flows |\n| \`realizableKE\` | Realizable k-ε — better for swirl and curvature |\n| \`SpalartAllmaras\` | One-equation — fast, external aero |\n| \`kOmega\` | Wilcox k-ω — near-wall accurate but freestream sensitive |\n| \`v2f\` | v²-f model — accurate transitional/separated flows |\n| \`laminar\` | No turbulence model (override to suppress) |`,
  LESModel:      `### LESModel\n*turbulenceProperties — LES block*\n\nName of the LES sub-grid scale model. Common choices:\n\n| Model | Description |\n|-------|-------------|\n| \`Smagorinsky\` | Classic SGS, Cs ≈ 0.1–0.2 |\n| \`WALE\` | Wall-adapting, zero νSGS in laminar zones |\n| \`dynamicKEqn\` | Dynamic one-equation, adapts locally |\n| \`kEqn\` | One-equation SGS energy transport |\n| \`dynamicSmagorinsky\` | Germano dynamic procedure |\n| \`Smagorinsky2\` | Smagorinsky with dynamic coefficient |`,

  // ── Turbulence models — expanded ──
  kOmegaSST:    `### kOmegaSST\n*turbulenceProperties — RANS model*\n\nMenter's k-ω Shear Stress Transport model (Menter, 1994). Blends k-ω near walls with k-ε in the freestream using a blending function F1.\n\n**Transport equations:** k (TKE) and ω (specific dissipation rate).\n\n**Key features:**\n- Turbulent viscosity limiter: νt = a1·k / max(a1·ω, S·F2) — prevents stagnation-point overproduction\n- Automatic wall treatment: low-Re near walls (y⁺ ≈ 1) blended to wall functions (y⁺ > 30)\n- No explicit wall function needed if y⁺ < 5\n\n**Recommended for:** Adverse pressure gradient flows, separation, external aerodynamics, turbomachinery.\n\n**Wall BCs:** kqRWallFunction (k), omegaWallFunction (omega), nutkWallFunction (nut)\n\n**y⁺:** Aim for y⁺ ≈ 1 for full resolution or y⁺ 30–300 with wall functions.`,
  kEpsilon:     `### kEpsilon\n*turbulenceProperties — RANS model*\n\nStandard k-ε model (Launder & Spalding, 1974). Two transport equations: k (TKE) and ε (dissipation rate).\n\n**Strengths:** Robust, well-validated for free shear flows, jets, wakes, and industrial flows.\n\n**Weaknesses:** Poor in adverse pressure gradients, recirculating flows, rotating systems. Over-predicts mixing-layer spread.\n\n**Wall treatment:** Requires wall functions (y⁺ 30–300).\n\n**Wall BCs:** kqRWallFunction (k), epsilonWallFunction (epsilon), nutkWallFunction (nut)`,
  SpalartAllmaras:`### SpalartAllmaras\n*turbulenceProperties — RANS model*\n\nOne-equation model (Spalart & Allmaras, 1992). Solves a single transport equation for modified turbulent viscosity ν̃.\n\n**Strengths:** Fast (one equation), robust, validated for attached external aerodynamics, boundary layers.\n\n**Weaknesses:** Less accurate for free shear flows, jets, wakes, strong separation.\n\n**Required field:** nuTilda (instead of k/epsilon)\n\n**Wall BCs:** nutkSpalartAllmarasWallFunction (nut) or fixedValue 0 (nuTilda at wall)\n\n**y⁺:** Designed for y⁺ ≈ 1 (low-Re near-wall resolution).`,
  realizableKE: `### realizableKE\n*turbulenceProperties — RANS model*\n\nRealizable k-ε model (Shih et al., 1995). Satisfies realizability constraints (non-negative normal stresses, Schwarz inequality). Significantly better than standard k-ε for flows with strong streamline curvature, swirl, and separation.\n\n**Wall BCs:** Same as kEpsilon (wall functions, y⁺ 30–300).`,
  kOmega:       `### kOmega\n*turbulenceProperties — RANS model*\n\nWilcox k-ω model (Wilcox, 1988). Two-equation model: k and specific dissipation ω. Performs well in near-wall regions without wall functions (y⁺ ≈ 1).\n\n**Weakness:** Sensitive to freestream ω values — small changes in inlet ω can change the solution.\n\n**Prefer kOmegaSST:** The SST variant overcomes the freestream sensitivity by blending to k-ε away from walls.`,
  Smagorinsky:  `### Smagorinsky\n*turbulenceProperties — LES model*\n\nSmagorinsky SGS model (Smagorinsky, 1963). νSGS = (Cs·Δ)²·|S̃| where Cs is the Smagorinsky coefficient and Δ is the filter width.\n\n**Typical Cs:** 0.168 (channel flow), 0.1–0.13 (general turbulence).\n\n**Strengths:** Simple, robust, widely used.\n\n**Weaknesses:** Cs is flow-dependent; too dissipative near walls and in transitional flows. Needs van Driest damping near walls.`,
  WALE:         `### WALE\n*turbulenceProperties — LES model*\n\nWall-Adapting Local Eddy-viscosity model (Nicoud & Ducros, 1999). Uses the square of the velocity gradient tensor to detect SGS activity.\n\n**Advantage over Smagorinsky:** Automatically returns νSGS = 0 in laminar/near-wall regions (νSGS ∝ y³) without explicit wall damping. Better for transitional flows and wall-bounded LES.`,
  dynamicKEqn:  `### dynamicKEqn\n*turbulenceProperties — LES model*\n\nDynamic one-equation SGS model. Solves a transport equation for SGS kinetic energy k_sgs and uses the dynamic Germano procedure to compute the model coefficient Ck locally.\n\n**Advantage:** Adapts to local flow conditions — recommended for inhomogeneous turbulence, separated flows, and transition.`,
  turbulence:    `### turbulence\n*turbulenceProperties — RAS/LES block*\n\nEnable (\`on\`) or disable (\`off\`) turbulence modelling.`,
  printCoeffs:   `### printCoeffs\n*turbulenceProperties — RAS/LES block*\n\nPrint model coefficients at run start (\`on\`/\`off\`).`,
  delta:         `### delta\n*turbulenceProperties — LES block*\n\nFilter-width model. Options: \`cubeRootVol\`, \`maxDeltaxyz\`, \`smooth\`, \`Prandtl\`, \`vanDriest\``,

  // ── controlDict ──
  application:   `### application\n*controlDict*\n\nName of the OpenFOAM solver executable to run (e.g. \`simpleFoam\`, \`pimpleFoam\`, \`rhoPimpleFoam\`).`,
  startFrom:     `### startFrom\n*controlDict*\n\nWhere to start the simulation:\n- \`firstTime\` — earliest time directory\n- \`startTime\` — use the \`startTime\` value\n- \`latestTime\` — latest available time directory`,
  startTime:     `### startTime\n*controlDict*\n\nStart time (used when \`startFrom startTime\`).`,
  stopAt:        `### stopAt\n*controlDict*\n\nStop condition:\n- \`endTime\` — run until \`endTime\`\n- \`writeNow\` — write and stop at next step\n- \`noWriteNow\` — stop without writing\n- \`nextWrite\` — stop after next write`,
  endTime:       `### endTime\n*controlDict*\n\nSimulation end time.`,
  deltaT:        `### deltaT\n*controlDict*\n\nTime step size. For adjustable time stepping, this is the initial value.`,
  writeControl:  `### writeControl\n*controlDict*\n\nControls when results are written:\n- \`timeStep\` — every N time steps\n- \`runTime\` — every N seconds of simulation time\n- \`adjustableRunTime\` — adjustable to hit write intervals exactly\n- \`cpuTime\` — every N seconds of CPU time\n- \`clockTime\` — every N seconds of wall-clock time`,
  writeInterval: `### writeInterval\n*controlDict*\n\nInterval between writes (in units set by \`writeControl\`).`,
  purgeWrite:    `### purgeWrite\n*controlDict*\n\nNumber of latest time directories to keep (0 = keep all).`,
  writeFormat:   `### writeFormat\n*controlDict*\n\nFormat for writing field data: \`ascii\` or \`binary\`.`,
  writePrecision:`### writePrecision\n*controlDict*\n\nNumber of significant digits when writing in ASCII format. Default: \`6\`.`,
  writeCompression: `### writeCompression\n*controlDict*\n\nCompress written files (\`on\`/\`off\`). Requires gzip.`,
  timeFormat:    `### timeFormat\n*controlDict*\n\nFormat of time directory names: \`fixed\`, \`scientific\`, \`general\`. Default: \`general\`.`,
  timePrecision: `### timePrecision\n*controlDict*\n\nSignificant digits in time directory names. Default: \`6\`.`,
  runTimeModifiable: `### runTimeModifiable\n*controlDict*\n\nIf \`true\`, OpenFOAM re-reads dictionaries every time step, allowing parameter changes during a run.`,
  adjustTimeStep:`### adjustTimeStep\n*controlDict*\n\nEnables automatic time-step adjustment to maintain target Co (\`on\`/\`off\`).`,
  maxCo:         `### maxCo\n*controlDict*\n\nMaximum Courant number for automatic time stepping. Typical: \`0.5\`–\`1.0\`.`,
  maxAlphaCo:    `### maxAlphaCo\n*controlDict*\n\nMaximum interface Courant number for VOF / multiphase solvers.`,
  maxDeltaT:     `### maxDeltaT\n*controlDict*\n\nUpper bound on the time step when using adjustable time stepping.`,
  libs:          `### libs\n*controlDict*\n\nList of shared libraries to load at runtime:\n\`\`\`\nlibs ("libincompressibleTurbulenceModels.so");\n\`\`\``,
  functions:     `### functions\n*controlDict — function objects*\n\nSub-dict containing function object definitions (postprocessing, sampling, probes, forces, …).`,

  // ── Mesh ──
  vertices:      `### vertices\n*blockMeshDict*\n\nList of vertex coordinates defining the block mesh geometry.\n\`\`\`\nvertices ( (0 0 0) (1 0 0) (1 1 0) ... );\n\`\`\``,
  blocks:        `### blocks\n*blockMeshDict*\n\nDefines hexahedral blocks connecting vertices:\n\`\`\`\nhex (0 1 2 3 4 5 6 7) (20 20 1) simpleGrading (1 1 1)\n\`\`\``,
  edges:         `### edges\n*blockMeshDict*\n\nOptional curved-edge definitions (arc, spline, polyLine).`,
  boundary:      `### boundary\n*blockMeshDict or constant/polyMesh/boundary*\n\nDefines named boundary patches with their face sets and types.`,
  mergePatchPairs: `### mergePatchPairs\n*blockMeshDict*\n\nPairs of patches to merge (for multi-block meshes with coincident faces).`,
  scale:         `### scale\n*blockMeshDict*\n\nUniform scale factor applied to all vertex coordinates (e.g. \`0.001\` to convert mm → m).`,

  // ── Field / boundary ──
  internalField: `### internalField\n*field file (0/ directory)*\n\nInitial / uniform value of the field in the mesh interior.\n\`\`\`\ninternalField   uniform 0;      // scalar\ninternalField   uniform (0 0 0); // vector\n\`\`\``,
  boundaryField: `### boundaryField\n*field file (0/ directory)*\n\nContains one sub-dict per boundary patch specifying the boundary condition type and parameters.`,
  dimensions:    `### dimensions\n*field file*\n\nDimensional units as a 7-element SI set: \`[ kg m s K mol A cd ]\`\nExamples: \`[0 2 -2 0 0 0 0]\` (m²/s²), \`[0 1 -1 0 0 0 0]\` (m/s)`,

  // ── FoamFile header ──
  FoamFile:      `### FoamFile\n*OpenFOAM file header*\n\nEvery OpenFOAM dictionary begins with a FoamFile header block:\n\`\`\`\nFoamFile\n{\n    version  2.0;\n    format   ascii;\n    class    dictionary;\n    object   fvSchemes;\n}\n\`\`\``,
  version:       `### version\n*FoamFile header*\n\nOpenFOAM file format version. Always \`2.0\`.`,
  format:        `### format\n*FoamFile header*\n\nSerialization format: \`ascii\` or \`binary\`.`,
  class:         `### class\n*FoamFile header*\n\nC++ class name for the top-level object (e.g. \`dictionary\`, \`volScalarField\`, \`volVectorField\`).`,
  object:        `### object\n*FoamFile header*\n\nName of the file (e.g. \`fvSchemes\`, \`U\`, \`p\`). Determines how the file is interpreted.`,
  location:      `### location\n*FoamFile header*\n\nRelative path of the file within the case directory (e.g. \`"system"\`).`,

  // ── decomposeParDict ──
  numberOfSubdomains: `### numberOfSubdomains\n*decomposeParDict*\n\nNumber of parallel partitions (= number of MPI processes).`,
  method:        `### method\n*decomposeParDict*\n\nDecomposition algorithm:\n- \`scotch\` — graph-based, automatic (recommended)\n- \`simple\` — axis-aligned slicing\n- \`hierarchical\` — multi-level axis slicing\n- \`manual\` — user-supplied cell→processor map`,

  // ── snappyHexMeshDict ──
  castellatedMesh: `### castellatedMesh\n*snappyHexMeshDict*\n\nEnable (\`true\`) or skip the castellated meshing phase.`,
  snap:          `### snap\n*snappyHexMeshDict*\n\nEnable (\`true\`) or skip the snapping phase that moves surface points onto the geometry.`,
  addLayers:     `### addLayers\n*snappyHexMeshDict*\n\nEnable (\`true\`) or skip the boundary layer insertion phase.`,
  geometry:      `### geometry\n*snappyHexMeshDict*\n\nDefines the input geometry surfaces (STL files, searchable boxes/spheres) used for refinement and snapping.`,
  locationInMesh:`### locationInMesh\n*snappyHexMeshDict*\n\nA point guaranteed to be inside the final mesh domain (used to determine which cells to keep).`,

  // ── Linear solvers ──
  GAMG:          `### GAMG\n*fvSolution — linear solver*\n\nGeometric-Algebraic Multi-Grid solver. The most efficient solver for the pressure equation on large meshes — scales as O(N) vs O(N^1.5) for PCG.\n\n**How it works:** Builds a hierarchy of coarser meshes (by face-area-pair agglomeration), solves on the coarsest and corrects back to fine level. Each V-cycle reduces low-frequency error components.\n\n**Typical setup:**\n\`\`\`\np\n{\n    solver           GAMG;\n    smoother         GaussSeidel;\n    cacheAgglomeration true;\n    nCellsInCoarsestLevel 10;\n    agglomerator    faceAreaPair;\n    mergeLevels     1;\n    tolerance       1e-6;\n    relTol          0.1;\n}\n\`\`\`\n\n**Best for:** Pressure (p, p_rgh) on meshes > 100k cells.\n\n*See also:* smoother, cacheAgglomeration`,
  PCG:           `### PCG\n*fvSolution — linear solver*\n\nPreconditioned Conjugate Gradient. Requires a symmetric positive-definite matrix — valid for pressure and symmetric scalar equations.\n\n**Typical setup:**\n\`\`\`\np\n{\n    solver          PCG;\n    preconditioner  DIC;\n    tolerance       1e-6;\n    relTol          0.05;\n}\n\`\`\`\n\n**Best for:** Pressure on smaller meshes or when GAMG is hard to tune. Use \`DIC\` or \`FDIC\` preconditioner.\n\n*See also:* DIC, FDIC`,
  PBiCGStab:     `### PBiCGStab\n*fvSolution — linear solver*\n\nPreconditioned Bi-Conjugate Gradient Stabilised. Works for non-symmetric (asymmetric) matrices — required for velocity, turbulence fields, and momentum equations.\n\n**Typical setup:**\n\`\`\`\nU\n{\n    solver          PBiCGStab;\n    preconditioner  DILU;\n    tolerance       1e-8;\n    relTol          0;\n}\n\`\`\`\n\n**Best for:** U, k, epsilon, omega, nuTilda — any non-symmetric matrix. The recommended replacement for PBiCG in OpenFOAM 8+.\n\n*See also:* DILU`,
  PBiCG:         `### PBiCG\n*fvSolution — linear solver*\n\nPreconditioned Bi-Conjugate Gradient. Non-symmetric matrices. Older variant — prefer \`PBiCGStab\` in OpenFOAM 8+ (more numerically stable, same cost).`,
  smoothSolver:  `### smoothSolver\n*fvSolution — linear solver*\n\nIterative smoother-based solver — applies a smoother (e.g. GaussSeidel) directly without multi-grid. Slower than GAMG for large problems but sometimes more robust on poor-quality meshes.\n\n**Required keywords:** \`smoother\`, \`nSweeps\` (typically 1–3), \`tolerance\`, \`relTol\`\n\n**Best for:** Coarse runs, small cases, or as a fallback when GAMG diverges.`,
  diagonal:      `### diagonal\n*fvSolution — linear solver*\n\nExplicit diagonal inversion — only valid for fully diagonal (explicitly decoupled) equations. Rarely used; mostly as a no-op placeholder for explicit terms.`,

  // ── Preconditioners ──
  DIC:           `### DIC\n*fvSolution — preconditioner*\n\nDiagonal Incomplete Cholesky — symmetric preconditioner. Use with \`PCG\` for pressure equations on orthogonal meshes.`,
  DILU:          `### DILU\n*fvSolution — preconditioner*\n\nDiagonal Incomplete LU — asymmetric preconditioner. The standard choice with \`PBiCGStab\` for velocity and turbulence fields.`,
  FDIC:          `### FDIC\n*fvSolution — preconditioner*\n\nFaster Diagonal Incomplete Cholesky — a faster variant of DIC with similar convergence properties.`,
  none:          `### none\n*fvSolution — preconditioner*\n\nNo preconditioning — rarely used in practice; significantly slows convergence.`,

  // ── Smoothers ──
  GaussSeidel:     `### GaussSeidel\n*fvSolution — smoother*\n\nPoint Gauss-Seidel smoother. Asymmetric — suited for \`smoothSolver\` and as GAMG smoother for non-symmetric matrices.`,
  symGaussSeidel:  `### symGaussSeidel\n*fvSolution — smoother*\n\nSymmetric Gauss-Seidel (forward + backward sweep). More effective than plain GaussSeidel per iteration; recommended as default GAMG smoother.`,
  DICGaussSeidel:  `### DICGaussSeidel\n*fvSolution — smoother*\n\nDIC + Gauss-Seidel combined smoother. Symmetric, good for pressure with GAMG.`,
  DILUGaussSeidel: `### DILUGaussSeidel\n*fvSolution — smoother*\n\nDILU + Gauss-Seidel combined smoother. Asymmetric, often used with \`smoothSolver\` for velocity.`,

  // ── Decomposition methods ──
  scotch:        `### scotch\n*decomposeParDict — method*\n\nGraph-based domain decomposition using the Scotch/PT-Scotch library. Minimises inter-processor face count automatically — the recommended default method. No extra coefficients required:\n\`\`\`\nmethod    scotch;\nscotchCoeffs { processorWeights (1 1 1 1); }\n\`\`\``,
  simple:        `### simple\n*decomposeParDict — method*\n\nSlices the domain with axis-aligned cuts. Fast but often gives poor load balancing on irregular geometries.\n\`\`\`\nsimpleCoeffs { n (4 2 1); delta 0.001; }\n\`\`\``,
  hierarchical:  `### hierarchical\n*decomposeParDict — method*\n\nLike \`simple\` but applies cuts in a user-specified order (xyz, xzy, …).\n\`\`\`\nhierarchicalCoeffs { n (2 2 1); delta 0.001; order xyz; }\n\`\`\``,
  manual:        `### manual\n*decomposeParDict — method*\n\nUser-supplied cell-to-processor mapping from a file.\n\`\`\`\nmanualCoeffs { dataFile "decompositionData"; }\n\`\`\``,
  multiLevel:    `### multiLevel\n*decomposeParDict — method*\n\nApplies decomposition methods in multiple levels (e.g. scotch, then simple). Useful for hierarchical clusters.`,
  structured:    `### structured\n*decomposeParDict — method*\n\nDecomposition following the block structure of blockMesh meshes.`,
  scotchCoeffs:  `### scotchCoeffs\n*decomposeParDict*\n\nOptional coefficients for the \`scotch\` method:\n- \`processorWeights\` — relative weights per processor (default: equal)`,
  simpleCoeffs:  `### simpleCoeffs\n*decomposeParDict*\n\nCoefficients for the \`simple\` method:\n- \`n\` — number of cuts per axis, e.g. \`(4 2 1)\`\n- \`delta\` — perturbation to avoid degenerate cuts (default: \`0.001\`)`,
  hierarchicalCoeffs: `### hierarchicalCoeffs\n*decomposeParDict*\n\nCoefficients for \`hierarchical\` method:\n- \`n\` — cuts per axis\n- \`delta\` — perturbation\n- \`order\` — cut order (\`xyz\`, \`xzy\`, \`yxz\`, …)`,

  // ── Scheme names — time ──
  Euler:          `### Euler\n*fvSchemes — ddtSchemes*\n\nFirst-order implicit Euler time scheme: φⁿ⁺¹ = φⁿ + Δt·F(φⁿ⁺¹). Robust and unconditionally stable. The standard choice for most transient simulations.`,
  backward:       `### backward\n*fvSchemes — ddtSchemes*\n\nSecond-order implicit backward differencing time scheme. More accurate than Euler but can exhibit minor non-physical oscillations with large time steps.`,
  CrankNicolson:  `### CrankNicolson\n*fvSchemes — ddtSchemes*\n\nBlended Crank-Nicolson scheme: \`CrankNicolson <ocCoeff>\`. \`ocCoeff\` blends from Euler (0) to fully C-N (1). Values 0.5–0.9 are typical for second-order accuracy with stability.`,
  steadyState:    `### steadyState\n*fvSchemes — ddtSchemes*\n\nSuppresses time-derivative terms. Used for steady-state solvers (simpleFoam, etc.). Setting this in a transient solver will suppress all time evolution.`,
  localEuler:     `### localEuler\n*fvSchemes — ddtSchemes*\n\nLocal time-stepping: each cell advances with its own maximum stable Δt. Speeds up pseudo-transient convergence to steady state.`,
  SLTS:           `### SLTS\n*fvSchemes — ddtSchemes*\n\nSmooth local time-stepping variant. Reduces the jaggedness of local Δt across cells compared to \`localEuler\`.`,

  // ── Scheme names — gradient ──
  leastSquares:   `### leastSquares\n*fvSchemes — gradSchemes*\n\nGradient by weighted least-squares fit over all cell neighbours: min Σ_N w_N|∇φ_P·(r_N − r_P) − (φ_N − φ_P)|².\n\n**Order:** 2nd order on any mesh topology.\n\n**Advantages over Gauss linear:**\n- More accurate on skewed, distorted, or unstructured meshes\n- Better conditioned on irregular polyhedral cells\n\n**Cost:** Slightly more expensive than \`Gauss linear\`.\n\n**When to use:** Unstructured meshes with high skewness; as the gradient argument for \`linearUpwind\` in RANS (\`linearUpwind leastSquares\`).`,
  fourth:         `### fourth\n*fvSchemes — gradSchemes*\n\nFourth-order gradient scheme — requires a high-quality, low-skewness mesh. Use for DNS/high-accuracy LES on structured grids.`,
  cellLimited:    `### cellLimited\n*fvSchemes — gradSchemes*\n\nCell-based limiter applied to the base gradient scheme. Limits the gradient magnitude so that face-interpolated values stay within the cell's neighbour range.\n\n**Usage:** \`cellLimited Gauss linear 1;\`\nCoefficient 0–1: 1 = full limiting (monotone), 0 = no limiting.\n\n**When to use:** RANS with \`linearUpwind\` to prevent unbounded gradients on coarse/distorted meshes. The most common gradient limiter choice.`,
  faceLimited:    `### faceLimited\n*fvSchemes — gradSchemes*\n\nFace-based gradient limiter — limits at each individual face rather than at the cell level. Slightly less diffusive than \`cellLimited\` in some flows.\n\n**Usage:** \`faceLimited Gauss linear 1;\``,
  cellMDLimited:  `### cellMDLimited\n*fvSchemes — gradSchemes*\n\nMulti-directional cell-based gradient limiter. Applies independent limiting in each coordinate direction, preserving gradient direction information better than scalar \`cellLimited\`. Generally more accurate.`,
  faceMDLimited:  `### faceMDLimited\n*fvSchemes — gradSchemes*\n\nMulti-directional face-based gradient limiter. Same advantage over \`faceLimited\` as \`cellMDLimited\` over \`cellLimited\`.`,

  // ── Scheme names — div / interpolation ──
  Gauss:          `### Gauss\n*fvSchemes — divSchemes / laplacianSchemes*\n\nApplies the Gauss divergence theorem: ∫_V ∇·F dV = Σ_f F_f·S_f. The keyword \`Gauss\` is the discretisation framework — it must be followed by an interpolation scheme (for div) or interpolation + snGrad scheme (for laplacian).\n\n\`\`\`\ndivSchemes\n{\n    div(phi,U)       Gauss linear;\n    div(phi,k)       Gauss linearUpwind grad(k);\n    div(phi,alpha)   Gauss MPLIC;\n}\nlaplacianSchemes\n{\n    laplacian(nu,U)  Gauss linear corrected;\n}\n\`\`\`\n\n**Note:** \`Gauss\` is not itself a scheme — the interpolation scheme determines accuracy and stability.`,
  linear:         `### linear\n*fvSchemes — interpolation*\n\nCentral differencing: φ_f = λ·φ_P + (1-λ)·φ_N where λ is the geometric interpolation factor.\n\n**Order:** 2nd order, unbounded (no TVD limiter).\n\n**Stability:** Inherently neutral — no numerical diffusion. Can produce oscillations at high Re on coarse meshes (Pe = |U|Δx/Γ > 2).\n\n**When to use:**\n- Well-resolved LES\n- Low-Re / laminar flows\n- Laplacian diffusion terms (always safe paired with \`corrected\`)\n- Pressure interpolation\n\n**Avoid:** High-Re RANS on coarse meshes — use \`linearUpwind\` or \`limitedLinear\` instead.`,
  linearUpwind:   `### linearUpwind\n*fvSchemes — interpolation*\n\nSecond-order upwind with gradient correction: φ_f = φ_P + ∇φ_P·(r_f − r_P), with upwind-side selection.\n\n**Usage:** \`linearUpwind grad(U);\` — the gradient argument should match the grad entry for that field in gradSchemes.\n\n**Order:** 2nd order in smooth regions, bounded by the upwind direction.\n\n**When to use:**\n- Velocity U in RANS simulations (most common production choice)\n- Turbulent scalars where bounded 2nd-order accuracy is needed\n- Use \`linearUpwindV grad(U)\` for vector fields\n\n**Notes:** Significantly less diffusive than \`upwind\`. Use \`cellLimited\` gradient on coarse meshes to prevent unbounded gradients.`,
  linearUpwindV:  `### linearUpwindV\n*fvSchemes — interpolation*\n\nVector form of \`linearUpwind\` — uses the full velocity gradient tensor for reconstruction. Usage: \`linearUpwindV grad(U)\`.`,
  upwind:         `### upwind\n*fvSchemes — interpolation*\n\nFirst-order upwind: φ_f = φ_P (upwind cell value). Unconditionally stable.\n\n**Numerical diffusion:** Adds ~|U|·Δx/2 equivalent diffusivity — smears boundary layers and shear layers.\n\n**Order:** 1st order.\n\n**When to use:**\n- Emergency fallback when the run diverges\n- Very coarse or highly skewed meshes\n- Initial run-up before switching to a higher-order scheme\n\n> ⚠ Always switch to \`linearUpwind\` or \`limitedLinear\` for final production runs.`,
  limitedLinear:  `### limitedLinear\n*fvSchemes — interpolation*\n\nTVD-limited central scheme. Coefficient controls limiting strength: 0 = no limiting (pure central), 1 = full limiting (monotone).\n\n**Usage:** \`limitedLinear 1;\`\n\n**Order:** 2nd order in smooth regions, 1st order near extrema.\n\n**Bounded:** Yes (TVD) when coefficient = 1.\n\n**When to use:** Turbulence scalars (k, ε, ω), temperature, scalar transport — a good default when boundedness and 2nd-order accuracy are both required.`,
  limitedLinearV: `### limitedLinearV\n*fvSchemes — interpolation*\n\nVector form of \`limitedLinear\`. Usage: \`limitedLinearV 1\`.`,
  limitedCubic:   `### limitedCubic\n*fvSchemes — interpolation*\n\nCubic scheme with TVD limiter. More accurate than \`limitedLinear\` in smooth regions — useful when 3rd-order accuracy with boundedness is needed.`,
  vanLeer:        `### vanLeer\n*fvSchemes — interpolation*\n\nvan Leer TVD flux limiter (van Leer, 1974). Blends between upwind and central differencing based on the local gradient ratio r = (φ_P − φ_UU)/(φ_N − φ_P).\n\n**Order:** 2nd order in smooth regions, 1st order near extrema.\n\n**Bounded:** Yes — monotone, introduces no new extrema.\n\n**When to use:** Turbulence scalars (k, ε, ω, nuTilda), temperature. More accurate than \`minmod\`, less compressive than \`SuperBee\`. A well-balanced default for scalar RANS transport.\n\n*See also:* limitedLinear, MUSCL, SuperBee`,
  MUSCL:          `### MUSCL\n*fvSchemes — interpolation*\n\nMonotone Upstream Scheme for Conservation Laws (van Leer, 1979). Symmetric TVD reconstruction using the average of upwind-biased left and right face states.\n\n**Order:** 2nd order, bounded.\n\n**When to use:** Scalar transport (k, ε, ω), temperature. Comparable to \`vanLeer\` — standard choice for RANS turbulence transport.\n\n*See also:* vanLeer, limitedLinear`,
  QUICK:          `### QUICK\n*fvSchemes — interpolation*\n\nQuadratic Upwind Interpolation for Convective Kinematics (Leonard, 1979). 3-point stencil: φ_f = 3/8·φ_N + 3/4·φ_P − 1/8·φ_UU.\n\n**Order:** 3rd order on uniform orthogonal meshes.\n\n**Bounded:** No — produces overshoots/undershoots near sharp gradients.\n\n**When to use:** Well-resolved laminar or transitional flows on regular grids.\n\n> ⚠ Can diverge on coarse meshes or near steep gradients. Use \`linearUpwind\` for robust 2nd-order upwinding.`,
  SuperBee:       `### SuperBee\n*fvSchemes — interpolation*\n\nSuperBee TVD limiter (Roe, 1985). The most compressive of common TVD schemes — maximises sharpness at discontinuities.\n\n**Order:** 2nd order in smooth regions, 1st order at extrema.\n\n**Bounded:** Yes (TVD).\n\n**When to use:** Discontinuous scalar transport where sharpness is critical.\n\n> ⚠ Can clip smooth extrema (peak-value reduction) in flows without sharp gradients. Use \`vanLeer\` or \`limitedLinear\` for smooth fields.`,
  minmod:         `### minmod\n*fvSchemes — interpolation*\n\nMinmod TVD limiter — the most conservative (most diffusive) of common TVD schemes. Always selects the smaller gradient estimate.\n\n**Order:** 2nd order in smooth regions, 1st order at extrema.\n\n**Bounded:** Yes (TVD).\n\n**When to use:** Stiff problems or highly distorted meshes where other limiters cause divergence. Safest TVD choice at the cost of extra diffusion.`,
  SFCD:           `### SFCD\n*fvSchemes — interpolation*\n\nSelf-Filtered Central Differencing. Transitions from central differencing (low Pe) to upwind (high Pe) based on the local cell Peclet number Pe = |U|Δx/Γ.`,
  Gamma:          `### Gamma\n*fvSchemes — interpolation*\n\nGamma NVD differencing scheme (Jasak, 1996). Smooth bounded blending between central and upwind differencing.\n\n**Usage:** \`Gamma 0.2\` — coefficient in NVD space (typical range 0.1–0.5). Lower = more compressive.\n\n**Bounded:** Yes (monotone).`,
  blended:        `### blended\n*fvSchemes — interpolation*\n\nExplicit linear blend: \`blended 0.5\` = 50% central + 50% upwind. Simple but non-TVD — prefer \`limitedLinear\` or \`LUST\` for physically motivated blending.`,
  LUST:           `### LUST\n*fvSchemes — interpolation*\n\nLinear-Upwind Stabilised Transport. Fixed blend: 75% \`linear\` + 25% \`linearUpwind\`.\n\n**Order:** ~1.75th order — a practical LES compromise.\n\n**Bounded:** Partially — more stable than pure \`linear\` but not TVD.\n\n**When to use:** LES velocity field. Reduces odd-even oscillations from pure central schemes while preserving most spectral accuracy.\n\n*See also:* linear, linearUpwind`,
  midPoint:       `### midPoint\n*fvSchemes — interpolation*\n\nMidpoint interpolation to the geometric face centre rather than the flux-weighted interpolation point. Reduces spatial error on skewed meshes.`,
  downwind:       `### downwind\n*fvSchemes — interpolation*\n\nFirst-order downwind (anti-diffusive). Almost never used in production — included for algorithm research and testing.`,
  cubic:          `### cubic\n*fvSchemes — interpolation*\n\nCubic interpolation: 3rd-order accurate on uniform meshes. Unbounded — only suitable for smooth, well-resolved flows.`,
  harmonic:       `### harmonic\n*fvSchemes — interpolation*\n\nHarmonic mean interpolation: φ_f = 2·φ_P·φ_N/(φ_P + φ_N). Preserves gradients across large property jumps. Primarily used for diffusivity (ν, κ) at material interfaces with large property contrasts.`,
  weighted:       `### weighted\n*fvSchemes — interpolation*\n\nUser-specified weighted interpolation between cell centres — weight factors supplied as a field.`,
  skewCorrected:  `### skewCorrected\n*fvSchemes — interpolation*\n\nWrapper that adds a skewness-correction term to any other scheme. Usage: \`skewCorrected linear\`. Reduces face-interpolation error on highly skewed meshes.`,
  pointLinear:    `### pointLinear\n*fvSchemes — interpolation*\n\nInterpolation via mesh-point (corner) values rather than cell-centre values. The face value is computed at the geometric face centre, reducing skewness error on distorted meshes.`,
  linearFit:      `### linearFit\n*fvSchemes — interpolation*\n\nLeast-squares polynomial fit-based interpolation. High accuracy on irregular mesh topologies at the cost of a wider stencil.`,

  // ── VOF / multiphase schemes ──
  MPLIC:              `### MPLIC\n*fvSchemes — divSchemes (VOF / multiphase)*\n\nMultidimensional Piecewise Linear Interface Calculation. A geometric VOF scheme that reconstructs the sharp gas–liquid interface as a planar segment within each cell and computes face fluxes geometrically.\n\n**Usage:**\n\`\`\`\ndivSchemes\n{\n    div(phi,alpha.water)   Gauss MPLIC;\n}\n\`\`\`\n\n**Requires:** interIsoFoam or compressibleInterIsoFoam (OpenFOAM 8+).\n\n**Advantages over algebraic MULES:**\n- Sharper interface (1–2 cells vs 3–5 for MULES)\n- Mass-conservative by construction\n- Less sensitive to Courant number\n\n*See also:* MPLICT, isoAdvector, interfaceCompression`,
  MPLICT:             `### MPLICT\n*fvSchemes — divSchemes (VOF / multiphase)*\n\nTransient/consistent variant of MPLIC. Uses implicit coupling between interface reconstruction and velocity for improved mass conservation and stability at higher Courant numbers.\n\n**Usage:** \`div(phi,alpha.water)  Gauss MPLICT;\`\n\n*See also:* MPLIC, isoAdvector`,
  isoAdvector:        `### isoAdvector\n*fvSchemes — divSchemes (VOF / multiphase)*\n\nGeometric VOF advection scheme (Roenby, Bredmose & Jasak, 2016). Reconstructs the interface as an isosurface of alpha and computes swept face areas geometrically.\n\n**Enabled via:** MPLIC/MPLICT in divSchemes with interIsoFoam or compressibleInterIsoFoam.\n\n**Advantages:**\n- Very sharp interface (< 2 cells)\n- Exact flux for planar interfaces\n- Allows larger time steps than algebraic VOF\n\n*See also:* MPLIC, interfaceCompression`,
  PLIC:               `### PLIC\n*fvSchemes — divSchemes (VOF)*\n\nPiecewise Linear Interface Calculation — the general family of geometric VOF methods. A planar interface segment is reconstructed in each mixed cell and used to compute geometrically exact face fluxes. MPLIC is the OpenFOAM multidimensional variant.`,
  interfaceCompression:`### interfaceCompression\n*fvSchemes — divSchemes (VOF)*\n\nAlgebraic interface compression scheme for interFoam (MULES-based VOF). Adds an anti-diffusion flux to counteract alpha-field smearing.\n\n**Usage:**\n\`\`\`\ndiv(phirb,alpha.water)  Gauss interfaceCompression 1;\n\`\`\`\nCoefficient 0–1: 0 = no compression, 1 = standard, >1 = extra compression (can cause instability).\n\n**Notes:** Less sharp than geometric VOF (MPLIC/isoAdvector) but compatible with standard interFoam. Typical choice for most interFoam cases.`,

  // ── Flux field names ──
  phi:    `### phi\n*OpenFOAM — face volumetric flux field*\n\nThe volumetric face flux (m³/s): φ_f = U_f · S_f. Holds the volumetric flow rate across each mesh face, computed by the velocity-pressure coupling (SIMPLE/PIMPLE).\n\n**Used in divSchemes as the flux argument:**\n\`\`\`\ndiv(phi,U)       Gauss linearUpwind grad(U);\ndiv(phi,k)       Gauss limitedLinear 1;\ndiv(phi,alpha)   Gauss MPLIC;\n\`\`\`\n\n**Incompressible solvers:** \`phi\` (m³/s) — computed from continuity.\n**Compressible solvers:** Use \`rhoPhi\` (mass flux, kg/s) instead.`,
  rhoPhi: `### rhoPhi\n*OpenFOAM — density-weighted face flux field (compressible)*\n\nThe mass flux field (kg/s): ρφ_f = ρ_f · U_f · S_f. Used in compressible (rhoPimpleFoam, buoyantPimpleFoam) and variable-density multiphase solvers.\n\n**Used in divSchemes as:**\n\`\`\`\ndiv(rhoPhi,U)      Gauss linearUpwind grad(U);\ndiv(rhoPhi,h)      Gauss limitedLinear 1;\n\`\`\`\n\n*See also:* phi`,

  // ── Scheme names — snGrad ──
  corrected:      `### corrected\n*fvSchemes — snGradSchemes*\n\nFull non-orthogonal correction to the surface-normal gradient:\n(∇φ·n̂)_f = (φ_N − φ_P)/|d| + ∇φ_f · (n̂ − d̂)\n\nThe second term explicitly corrects for mesh non-orthogonality (lagged explicit correction).\n\n**When to use:** Meshes with average non-orthogonality < 70°, max < 85°. Verify with \`checkMesh\`.\n\n> ⚠ Can become unstable for very high non-orthogonality (>85°). Use \`limited corrected 0.333\` in that case.`,
  uncorrected:    `### uncorrected\n*fvSchemes — snGradSchemes*\n\nNo non-orthogonal correction — only the direct component (φ_N − φ_P)/|d|.\n\n**When to use:** Nearly orthogonal meshes (max non-ortho < 20°), e.g. structured hex or O-grid meshes. Faster but introduces error proportional to the deviation angle.\n\n**Avoid:** Unstructured, polyhedral, or snappyHexMesh-generated meshes.`,
  limited:        `### limited\n*fvSchemes — snGradSchemes*\n\nPartial non-orthogonal correction: blends \`uncorrected\` (coefficient 0) and \`corrected\` (coefficient 1).\n\n**Usage:** \`limited corrected 0.333\`\n\n**Guidelines by mesh quality (from checkMesh):**\n- Max non-ortho < 70° → \`corrected\`\n- Max non-ortho 70–85° → \`limited corrected 0.333\`\n- Max non-ortho > 85° → \`limited corrected 0.1\` and improve the mesh`,
  orthogonal:     `### orthogonal\n*fvSchemes — snGradSchemes*\n\nAssumes a perfectly orthogonal mesh — equivalent to \`uncorrected\`. Only valid when \`checkMesh\` confirms maximum non-orthogonality < 5°.`,

  // ── Boundary conditions — patch types ──
  patch:          `### patch\n*boundary — patch type*\n\nGeneric computational boundary. Applies the boundary condition specified in the field's \`boundaryField\` without any geometric constraints.`,
  wall:           `### wall\n*boundary — patch type*\n\nSolid wall patch. Wall functions and wall-distance calculations use patches of this type. Required for turbulence wall functions to activate.`,
  symmetry:       `### symmetry\n*boundary — patch type*\n\nSymmetry plane — normal velocity set to zero, all other quantities reflected. Can be used for any orientation.`,
  symmetryPlane:  `### symmetryPlane\n*boundary — patch type*\n\nFlat symmetry plane (more restrictive than \`symmetry\`; must be a planar face).`,
  empty:          `### empty\n*boundary — patch type*\n\nUsed for the front and back faces of 2D / axisymmetric cases. Tells OpenFOAM to treat these directions as having no extent.`,
  wedge:          `### wedge\n*boundary — patch type*\n\nUsed for axisymmetric cases on a wedge-shaped mesh (one cell thick). Applied to the two wedge-angle faces.`,
  cyclic:         `### cyclic\n*boundary — patch type*\n\nPeriodic (cyclic) boundary — values from one patch are copied to its matching \`neighbourPatch\`. The two patches must have identical geometry.`,
  cyclicAMI:      `### cyclicAMI\n*boundary — patch type*\n\nArbitrary Mesh Interface cyclic condition. Like \`cyclic\` but the two sides can have different mesh resolution. Used for sliding meshes and non-conformal interfaces.`,
  processor:      `### processor\n*boundary — patch type*\n\nAuto-generated inter-processor boundary after \`decomposePar\`. Do not edit manually.`,

  // ── Boundary conditions — field BCs ──
  fixedValue:     `### fixedValue\n*boundary condition — Dirichlet*\n\nPrescribes a fixed value at all faces of the patch.\n\n**Syntax:**\n\`\`\`\ntype    fixedValue;\nvalue   uniform (1 0 0);          // vector\n// or:\nvalue   uniform 1;               // scalar\n// or:\nvalue   nonuniform List<scalar> N ( v1 v2 ... );  // non-uniform\n\`\`\`\n\n**Notes:**\n- \`value\` also initialises the patch data when the field is created from \`0/\`\n- For time-varying inlets use \`uniformFixedValue\` or \`timeVaryingMappedFixedValue\`\n- For turbulent inflow profiles use \`atmBoundaryLayerInletVelocity\` or \`turbulentDFSEMInlet\``,
  zeroGradient:   `### zeroGradient\n*boundary condition — Neumann*\n\nZero normal gradient: ∂φ/∂n = 0. The face value equals the adjacent internal cell value.\n\n**Syntax:** \`type zeroGradient;\` (no other keywords required)\n\n**When to use:**\n- Outlet velocity (fully-developed flow assumption)\n- Pressure at inlets when velocity is specified\n- Scalars (T, k, ε) at symmetry planes\n- Turbulence scalars (k, ε, ω) at inlets if turbulence enters prescribed\n\n**Do not confuse with \`fixedFluxPressure\`** — use \`fixedFluxPressure\` on pressure at walls and inlets when the velocity flux is fixed.`,
  calculated:     `### calculated\n*boundary condition*\n\nThe patch field is derived from other fields at run time — not specified by the user. Used for post-processed or dependent quantities (e.g. \`nut\`, \`alphat\`, \`p_rgh\` when computed from other fields).`,
  fixedGradient:  `### fixedGradient\n*boundary condition — Neumann*\n\nSpecifies a fixed (non-zero) normal gradient at the patch:\n\n**Syntax:**\n\`\`\`\ntype      fixedGradient;\ngradient  uniform 0;   // or nonuniform List<scalar>\n\`\`\`\n\n**Use case:** Wall heat flux specification when combined with a constant heat flux thermal BC.`,
  mixed:          `### mixed\n*boundary condition*\n\nBase mixed BC — blends \`fixedValue\` (Dirichlet) and \`fixedGradient\` (Neumann) via a per-face mixing coefficient \`valueFraction\` (0 = Neumann, 1 = Dirichlet).\n\nRarely set directly by the user — most higher-level BCs (\`inletOutlet\`, \`totalPressure\`, etc.) derive from this class.`,
  inletOutlet:    `### inletOutlet\n*boundary condition — outflow scalar*\n\nSwitches between \`fixedValue\` (inflow faces) and \`zeroGradient\` (outflow faces) based on the local flux direction at each face.\n\n**When to use:** Outflow/open boundaries for scalars (k, ε, ω, T, alpha) — the standard outflow scalar BC.\n\n**Syntax:**\n\`\`\`\ntype         inletOutlet;\ninletValue   uniform 0;    // applied on back-flow faces\nvalue        uniform 0;    // initial/boundary data\n\`\`\``,
  outletInlet:    `### outletInlet\n*boundary condition*\n\nInverse of \`inletOutlet\` — \`fixedValue\` on outflow faces, \`zeroGradient\` on inflow faces. Used for pressure outlets where back-flow must be controlled.`,
  pressureInletOutletVelocity: `### pressureInletOutletVelocity\n*boundary condition — U*\n\nVelocity BC for pressure-driven boundaries. Uses \`zeroGradient\` on outflow; reconstructs velocity from flux on inflow. Pair with \`totalPressure\` on p.`,
  totalPressure:  `### totalPressure\n*boundary condition — p*\n\nSpecifies total (stagnation) pressure p₀. Static pressure is back-calculated from velocity:\n\`\`\`\ntype      totalPressure;\np0        uniform 0;\n\`\`\``,
  fixedFluxPressure: `### fixedFluxPressure\n*boundary condition — p*\n\nAdjusts the pressure gradient at the boundary to be consistent with the prescribed velocity flux. Used at walls and symmetry planes instead of \`zeroGradient\` for pressure when the flux is fixed.`,
  freestreamPressure:`### freestreamPressure\n*boundary condition — p*\n\nFar-field pressure BC for external aerodynamics. Sets pressure to freestream value on inflow faces.`,
  freestreamVelocity:`### freestreamVelocity\n*boundary condition — U*\n\nFar-field velocity BC. Applies fixed freestream velocity on inflow, zero gradient on outflow.`,
  freestream:     `### freestream\n*boundary condition*\n\nGeneral far-field BC that applies a user-specified value on inflow faces and zero gradient on outflow.`,
  slip:           `### slip\n*boundary condition — U*\n\nSlip wall — normal velocity is zero, tangential velocity is unconstrained (free-slip). Zero wall shear stress.`,
  noSlip:         `### noSlip\n*boundary condition — U*\n\nNo-slip wall — velocity fixed to zero (0 0 0). Standard BC for viscous walls.`,
  movingWallVelocity: `### movingWallVelocity\n*boundary condition — U*\n\nNo-slip condition on a moving wall. Corrects the normal velocity component to ensure zero flux through the wall (for AMI / dynamic mesh).`,
  uniformFixedValue: `### uniformFixedValue\n*boundary condition*\n\nTime-varying fixed value — value is a \`Function1\` that can vary with time:\n\`\`\`\ntype            uniformFixedValue;\nuniformValue    constant (1 0 0);\n\`\`\``,
  timeVaryingMappedFixedValue: `### timeVaryingMappedFixedValue\n*boundary condition*\n\nInterpolates inlet data from a time series of spatial field snapshots stored in \`constant/boundaryData/<patchName>/\`. Commonly used for precursor-generated inflow turbulence.`,
  codedFixedValue: `### codedFixedValue\n*boundary condition*\n\nAllows writing a C++ expression for the fixed value, compiled at run time:\n\`\`\`\ntype            codedFixedValue;\nvalue           uniform 0;\nname            myBC;\ncode\n#{\n    operator== scalarField(patch().size(), 1.0);\n#};\n\`\`\``,
  waveTransmissive: `### waveTransmissive\n*boundary condition — p (compressible)*\n\nNon-reflective outflow condition. Absorbs outgoing pressure waves by computing the wave speed and extrapolating:\n\`\`\`\ntype         waveTransmissive;\ngamma        1.4;\nfieldInf     1e5;\nlInf         1.0;\n\`\`\``,
  surfaceNormalFixedValue: `### surfaceNormalFixedValue\n*boundary condition*\n\nFixedValue in the surface-normal direction only. Useful for setting normal velocity at an inlet.`,
  fixedMeanValue: `### fixedMeanValue\n*boundary condition*\n\nScales the boundary value so that its area-weighted mean equals a target value. Useful for mass-flow normalisation.`,

  // ── Turbulence wall functions ──
  kqRWallFunction:   `### kqRWallFunction\n*boundary condition — k, q, R at wall*\n\nWall function for turbulent kinetic energy k (and Reynolds stress R). Sets zero gradient — wall production is handled internally.`,
  omegaWallFunction: `### omegaWallFunction\n*boundary condition — omega at wall*\n\nWall function for specific dissipation rate ω. Blends the viscous sublayer and log-law solutions automatically.`,
  epsilonWallFunction:`### epsilonWallFunction\n*boundary condition — epsilon at wall*\n\nWall function for turbulent dissipation rate ε. Applies standard log-law near-wall formulation.`,
  nutkWallFunction:  `### nutkWallFunction\n*boundary condition — nut at wall*\n\nTurbulent viscosity wall function based on k. Standard choice for \`kOmegaSST\` and \`kEpsilon\` with wall functions.`,
  nutWallFunction:   `### nutWallFunction\n*boundary condition — nut at wall*\n\nGeneral turbulent viscosity wall function. Computes nut from the local wall shear stress and the law of the wall.`,
  nutUWallFunction:  `### nutUWallFunction\n*boundary condition — nut at wall*\n\nTurbulent viscosity wall function based on velocity profile. Used when y⁺ is not well controlled.`,
  nutUSpaldingWallFunction: `### nutUSpaldingWallFunction\n*boundary condition — nut*\n\nWall function based on Spalding's composite law of the wall. Valid across the full y⁺ range (viscous sublayer through log layer) without a blending coefficient. Recommended when y⁺ is not well controlled.`,
  alphatJayatillekeWallFunction: `### alphatJayatillekeWallFunction\n*boundary condition — alphat at wall (heat transfer)*\n\nThermal wall function based on Jayatilleke's P-function. Used for the turbulent thermal diffusivity in conjugate heat transfer.`,
  compressible:   `### compressible\n*namespace / keyword prefix*\n\nPrefix indicating the compressible variant of a model or BC (e.g. \`compressible::alphatJayatillekeWallFunction\`).`,

  // ── RANS turbulence models (additional) ──
  RNGkEpsilon:    `### RNGkEpsilon\n*RAS turbulence model*\n\nRenormalization Group k-ε model (Yakhot & Orszag, 1986). Improved performance for flows with rapid strain and swirl compared to standard k-ε.`,
  LaunderSharmaKE:`### LaunderSharmaKE\n*RAS turbulence model*\n\nLaunder-Sharma low-Reynolds-number k-ε model. Integrates to the wall without wall functions — requires fine near-wall mesh (y⁺ ≈ 1).`,
  LienLeschziner: `### LienLeschziner\n*RAS turbulence model*\n\nLien-Leschziner k-ε model with non-linear eddy viscosity terms. Improved prediction of anisotropic turbulence.`,
  v2f:            `### v2f\n*RAS turbulence model*\n\nDurbin's v2-f model. Solves equations for k, ε, v² (wall-normal stress), and an elliptic relaxation factor f. Excellent near-wall predictions without wall functions.`,
  qZeta:          `### qZeta\n*RAS turbulence model*\n\nq-ζ model — a k-ε variant using alternative variables q=√k and ζ=ε/q.`,
  LamBremhorstKE: `### LamBremhorstKE\n*RAS turbulence model*\n\nLam-Bremhorst low-Re k-ε model. Another wall-integrating k-ε variant.`,
  laminar:        `### laminar\n*turbulence model (simulationType)*\n\nNo turbulence model — fully laminar flow. Valid for low Re flows or DNS.`,

  // ── LES turbulence models (additional) ──
  kEqn:           `### kEqn\n*LES sub-grid stress model*\n\nOne-equation model — transports subgrid k with a fixed model coefficient Ck. Simpler than dynamicKEqn but requires tuning Ck.`,
  dynamicLagrangian: `### dynamicLagrangian\n*LES sub-grid stress model*\n\nDynamic model with Lagrangian (path-line) averaging of the model coefficient (Meneveau et al., 1996). Better than plane-averaging for non-homogeneous flows.`,
  Smagorinsky2:   `### Smagorinsky2\n*LES sub-grid stress model*\n\nVariant of Smagorinsky that separates the trace from the deviatoric SGS stress tensor.`,
  DeardorffDiffStress: `### DeardorffDiffStress\n*LES sub-grid stress model*\n\nDeardorff's differential stress model — solves transport equations for all 6 components of the SGS stress tensor.`,
  SpalartAllmarasDDES: `### SpalartAllmarasDDES\n*LES/RANS hybrid — turbulence model*\n\nDelayed Detached-Eddy Simulation based on Spalart-Allmaras. Uses RANS near walls and LES elsewhere. The DDES formulation delays the LES region to prevent premature switching inside the boundary layer.`,
  kOmegaSSTDES:   `### kOmegaSSTDES\n*LES/RANS hybrid — turbulence model*\n\nDetached-Eddy Simulation based on kOmegaSST. Couples the SST RANS model with LES in separated regions.`,

  // ── LES delta models ──
  cubeRootVol:    `### cubeRootVol\n*LES delta model*\n\nFilter width Δ = V^(1/3) — the cube root of cell volume. The most common LES filter width. Usage: \`delta cubeRootVol; cubeRootVolCoeffs { deltaCoeff 1; }\``,
  maxDeltaxyz:    `### maxDeltaxyz\n*LES delta model*\n\nFilter width = max(Δx, Δy, Δz) — maximum cell dimension. Conservative choice for anisotropic meshes.`,
  smooth:         `### smooth\n*LES delta model*\n\nSmoothed filter width — applies averaging over neighbour cells to produce a spatially smooth Δ field. Reduces noise in regions of rapid mesh size change.`,
  vanDriest:      `### vanDriest\n*LES delta model*\n\nApplies van Driest near-wall damping: Δ_eff = Δ · (1 − exp(−y⁺/26)). Reduces effective filter width close to the wall to partially mimic wall damping in Smagorinsky.`,
  Prandtl:        `### Prandtl\n*LES delta model*\n\nFilter width based on Prandtl mixing length theory.`,

  // ── Field names (common 0/ fields) ──
  U:              `### U\n*field — velocity (m/s)*\n\nVelocity vector field. \`dimensions [0 1 -1 0 0 0 0]\`\nTypical BCs: \`fixedValue\` (inlet), \`zeroGradient\` / \`inletOutlet\` (outlet), \`noSlip\` (wall).`,
  p:              `### p\n*field — kinematic pressure (m²/s²)*\n\nKinematic pressure p/ρ used in incompressible solvers. \`dimensions [0 2 -2 0 0 0 0]\`\nTypical BCs: \`fixedValue\` (outlet), \`zeroGradient\` (inlet/wall), \`totalPressure\` (pressure inlet).`,
  p_rgh:          `### p_rgh\n*field — modified pressure (m²/s²)*\n\nPressure minus hydrostatic head: p_rgh = p − ρgh. Used in buoyancy-driven and free-surface solvers.`,
  k:              `### k\n*field — turbulent kinetic energy (m²/s²)*\n\nTurbulent kinetic energy. \`dimensions [0 2 -2 0 0 0 0]\`\nInlet: estimate from turbulence intensity I: k = 1.5(U·I)²\nWall: \`kqRWallFunction\``,
  epsilon:        `### epsilon\n*field — turbulent dissipation rate (m²/s³)*\n\nTurbulent dissipation rate ε. \`dimensions [0 2 -3 0 0 0 0]\`\nInlet: estimate from mixing length l: ε = Cμ^0.75 · k^1.5 / l\nWall: \`epsilonWallFunction\``,
  omega:          `### omega\n*field — specific dissipation rate (1/s)*\n\nSpecific turbulent dissipation rate ω = ε/(Cμ k). \`dimensions [0 0 -1 0 0 0 0]\`\nInlet: ω = k^0.5 / (Cμ^0.25 · l)\nWall: \`omegaWallFunction\``,
  nut:            `### nut\n*field — turbulent kinematic viscosity (m²/s)*\n\nTurbulent eddy viscosity νₜ. Computed from the turbulence model — do not set at inlet.\n\`dimensions [0 2 -1 0 0 0 0]\`\nWall: \`nutkWallFunction\` or \`nutWallFunction\``,
  nuTilda:        `### nuTilda\n*field — modified eddy viscosity (Spalart-Allmaras)*\n\nModified turbulent viscosity ν̃ in the Spalart-Allmaras model. \`dimensions [0 2 -1 0 0 0 0]\``,
  T:              `### T\n*field — temperature (K)*\n\nStatic temperature. \`dimensions [0 0 0 1 0 0 0]\`\nTypical BCs: \`fixedValue\` (heated/cooled wall), \`zeroGradient\` (adiabatic wall), \`inletOutlet\` (outlet).`,
  rho:            `### rho\n*field — density (kg/m³)*\n\nFluid density. \`dimensions [1 -3 0 0 0 0 0]\`\nIn incompressible solvers this is a constant in \`transportProperties\`; in compressible solvers it is a computed field.`,
  mu:             `### mu\n*field — dynamic viscosity (kg/m·s)*\n\nDynamic viscosity μ. \`dimensions [1 -1 -1 0 0 0 0]\``,
  nu:             `### nu\n*field / transportProperties — kinematic viscosity (m²/s)*\n\nKinematic viscosity ν = μ/ρ. \`dimensions [0 2 -1 0 0 0 0]\`\nSet in \`constant/transportProperties\` for incompressible solvers.`,
  alphat:         `### alphat\n*field — turbulent thermal diffusivity (kg/m·s)*\n\nTurbulent thermal diffusivity αₜ used in heat transfer. Computed from turbulent Prandtl number: αₜ = νₜ/Prₜ.`,
  alpha1:         `### alpha1\n*field — phase fraction (VOF)*\n\nVolume fraction of phase 1 in VoF multiphase solvers (interFoam, etc.). Values: 0 (pure phase 2) to 1 (pure phase 1).`,

  // ── transportProperties ──
  transportProperties: `### transportProperties\n*constant/transportProperties*\n\nSpecifies fluid physical properties for incompressible solvers.\n\`\`\`\ntransportModel  Newtonian;\nnu              [0 2 -1 0 0 0 0]  1e-6;  // water at 20°C\n\`\`\``,
  transportModel: `### transportModel\n*transportProperties*\n\nViscosity model for the fluid:\n- \`Newtonian\` — constant viscosity (ν set by keyword \`nu\`)\n- \`powerLaw\` — η = K γ̇^(n-1)\n- \`CrossPowerLaw\` — Cross model for shear-thinning fluids\n- \`BirdCarreau\` — Carreau model\n- \`HerschelBulkley\` — yield-stress fluid`,
  Newtonian:      `### Newtonian\n*transportModel*\n\nConstant kinematic viscosity ν. The standard model for water, air, and most single-phase flows:\n\`\`\`\ntransportModel  Newtonian;\nnu              [0 2 -1 0 0 0 0]  1e-6;\n\`\`\``,
  powerLaw:       `### powerLaw\n*transportModel*\n\nPower-law viscosity model: η = K γ̇^(n−1). Useful for polymer melts and some biological fluids.\n\`\`\`\npowerLawCoeffs { k 0.01; n 0.8; nuMin 1e-6; nuMax 1e2; }\n\`\`\``,
  BirdCarreau:    `### BirdCarreau\n*transportModel*\n\nCarreau (Bird-Carreau) viscosity model for shear-thinning fluids with Newtonian plateaus at low and high shear rates.`,
  CrossPowerLaw:  `### CrossPowerLaw\n*transportModel*\n\nCross model — smooth shear-thinning from zero-shear viscosity η₀ to infinite-shear viscosity η∞.`,
  HerschelBulkley:`### HerschelBulkley\n*transportModel*\n\nYield-stress fluid model: flows only when shear stress exceeds the yield stress τ₀.`,

  // ── thermophysical ──
  thermoType:     `### thermoType\n*constant/thermophysicalProperties*\n\nSelects the thermophysical model combination:\n\`\`\`\nthermoType\n{\n    type            heRhoThermo;\n    mixture         pureMixture;\n    transport       const;\n    thermo          hConst;\n    equationOfState perfectGas;\n    specie          specie;\n    energy          sensibleEnthalpy;\n}\n\`\`\``,
  mixture:        `### mixture\n*thermoType / thermophysicalProperties*\n\nMixture model: \`pureMixture\` (single species), \`multiComponentMixture\`, \`reactingMixture\`, \`homogeneousMixture\`.`,
  transport:      `### transport\n*thermoType*\n\nTransport (viscosity/conductivity) model: \`const\` (constant μ, Pr), \`sutherland\` (Sutherland's law), \`polynomial\`.`,
  thermo:         `### thermo\n*thermoType*\n\nThermodynamics model: \`hConst\` (constant Cp), \`janaf\` (polynomial Cp), \`hPolynomial\`, \`eConst\`.`,
  equationOfState:`### equationOfState\n*thermoType*\n\nEquation of state:\n- \`perfectGas\` — ideal gas (p = ρRT)\n- \`incompressiblePerfectGas\` — Boussinesq approximation\n- \`rhoConst\` — constant density\n- \`Boussinesq\` — Boussinesq approximation with reference density`,
  specie:         `### specie\n*thermoType / mixture*\n\nSpecifies molecular weight and other species-level properties.`,
  energy:         `### energy\n*thermoType*\n\nEnergy variable: \`sensibleEnthalpy\` (h), \`sensibleInternalEnergy\` (e), \`absoluteEnthalpy\`, \`absoluteInternalEnergy\`.`,

  // ── snappyHexMesh detailed ──
  castellatedMeshControls: `### castellatedMeshControls\n*snappyHexMeshDict*\n\nSub-dict controlling the refinement/castellated phase:\n- \`maxLocalCells\` — max cells per process during refinement\n- \`maxGlobalCells\` — global cell limit\n- \`minRefinementCells\` — min cells to refine in a layer\n- \`nCellsBetweenLevels\` — buffer cells between refinement levels\n- \`resolveFeatureAngle\` — angle threshold for feature refinement\n- \`refinementSurfaces\` — per-surface level ranges\n- \`refinementRegions\` — volumetric refinement regions`,
  snapControls:   `### snapControls\n*snappyHexMeshDict*\n\nControls the surface snapping phase:\n- \`nSmoothPatch 3\` — surface point smoothing iterations\n- \`tolerance 4.0\` — snap tolerance (cell size units)\n- \`nSolveIter 30\` — point relaxation iterations\n- \`nRelaxIter 5\` — outer relaxation loops\n- \`nFeatureSnapIter 10\` — edge feature snap iterations\n- \`implicitFeatureSnap false\` — use implicit edge detection\n- \`explicitFeatureSnap true\` — use \`eMesh\` feature files`,
  addLayersControls: `### addLayersControls\n*snappyHexMeshDict*\n\nControls boundary layer insertion:\n- \`relativeSizes true\` — layer thicknesses relative to cell size\n- \`expansionRatio 1.2\` — layer-to-layer growth ratio\n- \`finalLayerThickness 0.3\` — outermost layer thickness\n- \`minThickness 0.1\` — abort layer insertion if below this\n- \`nGrow 0\` — cells to grow from boundary\n- \`featureAngle 60\` — angle above which layers are terminated`,
  meshQualityControls: `### meshQualityControls\n*snappyHexMeshDict*\n\nDefines mesh quality thresholds that trigger local mesh repair:\n- \`maxNonOrtho 65\` — max non-orthogonality angle\n- \`maxBoundarySkewness 20\` — max boundary skewness\n- \`maxInternalSkewness 4\` — max internal face skewness\n- \`maxConcave 80\` — max concavity\n- \`minFlatness 0.5\`\n- \`minVol 1e-13\` — minimum cell volume\n- \`minDeterminant 0.001\` — min Jacobian determinant`,
  resolveFeatureAngle: `### resolveFeatureAngle\n*snappyHexMeshDict — castellatedMeshControls*\n\nRefine cells that span a surface feature (edge/point) whose angle exceeds this value (degrees). Typical: \`30\`.`,
  nCellsBetweenLevels: `### nCellsBetweenLevels\n*snappyHexMeshDict — castellatedMeshControls*\n\nNumber of buffer cells between adjacent refinement levels. Minimum: \`1\`. Increasing to \`2\`–\`3\` reduces transition abruptness.`,
  refinementSurfaces: `### refinementSurfaces\n*snappyHexMeshDict — castellatedMeshControls*\n\nPer-surface refinement settings:\n\`\`\`\nrefinementSurfaces\n{\n    hull { level (3 4); }\n}\n\`\`\`\nValues are \`(minLevel maxLevel)\`.`,
  refinementRegions:  `### refinementRegions\n*snappyHexMeshDict — castellatedMeshControls*\n\nVolumetric refinement inside a geometry region:\n\`\`\`\nrefinementRegions\n{\n    box { mode inside; levels ((3 3)); }\n}\n\`\`\`\nModes: \`inside\`, \`outside\`, \`distance\`.`,
  layers:             `### layers\n*snappyHexMeshDict — addLayersControls*\n\nDefines the number of boundary layers per patch:\n\`\`\`\nlayers { hull { nSurfaceLayers 5; } }\n\`\`\``,
  expansionRatio:     `### expansionRatio\n*snappyHexMeshDict — addLayersControls*\n\nRatio of successive boundary layer thicknesses (outer/inner). Typical: \`1.2\`–\`1.4\`.`,
  finalLayerThickness:`### finalLayerThickness\n*snappyHexMeshDict — addLayersControls*\n\nThickness of the outermost (surface-adjacent) layer, as a fraction of the adjacent cell size (if \`relativeSizes true\`).`,
  minThickness:       `### minThickness\n*snappyHexMeshDict — addLayersControls*\n\nMinimum layer thickness fraction below which layer insertion is abandoned for that region.`,
  nGrow:              `### nGrow\n*snappyHexMeshDict — addLayersControls*\n\nGrow layers from faces near a boundary instead of on the boundary itself. Usually \`0\`.`,
  featureAngle:       `### featureAngle\n*snappyHexMeshDict*\n\nSurface patches whose normals differ by more than this angle (degrees) are treated as separate features, terminating layer growth at the edge.`,
  allowFreeStandingZoneFaces: `### allowFreeStandingZoneFaces\n*snappyHexMeshDict — castellatedMeshControls*\n\nAllow faces of faceZones that are not on the interface between two cell zones (\`true\`/\`false\`).`,
  maxLocalCells:   `### maxLocalCells\n*snappyHexMeshDict*\n\nMaximum number of cells per process during the refinement phase. Increase if refinement stops early due to this limit.`,
  maxGlobalCells:  `### maxGlobalCells\n*snappyHexMeshDict*\n\nGlobal upper limit on cell count during refinement. A rough guide for the final mesh size.`,
  minRefinementCells: `### minRefinementCells\n*snappyHexMeshDict*\n\nMinimum number of cells in a refinement iteration — prevents refining tiny isolated regions.`,
  features:        `### features\n*snappyHexMeshDict — castellatedMeshControls*\n\nList of \`.eMesh\` edge feature files to snap to:\n\`\`\`\nfeatures ( { file "hull.eMesh"; level 3; } );\n\`\`\``,
  implicitFeatureSnap: `### implicitFeatureSnap\n*snappyHexMeshDict — snapControls*\n\nDetect and snap to surface features automatically without an \`.eMesh\` file (\`true\`/\`false\`).`,
  explicitFeatureSnap: `### explicitFeatureSnap\n*snappyHexMeshDict — snapControls*\n\nSnap to features listed in \`.eMesh\` files in the \`features\` list (\`true\`/\`false\`).`,
  nSmoothPatch:    `### nSmoothPatch\n*snappyHexMeshDict — snapControls*\n\nIterations of surface patch smoothing before snapping. Improves snapping quality on curved surfaces.`,
  nSolveIter:      `### nSolveIter\n*snappyHexMeshDict — snapControls*\n\nInternal point relaxation iterations during snapping. More iterations = better quality but slower.`,
  nRelaxIter:      `### nRelaxIter\n*snappyHexMeshDict — snapControls*\n\nOuter relaxation iterations during snapping.`,
  nFeatureSnapIter:`### nFeatureSnapIter\n*snappyHexMeshDict — snapControls*\n\nIterations dedicated to snapping to feature edges. Increase for sharp-edged geometries.`,
  relativeSizes:   `### relativeSizes\n*snappyHexMeshDict — addLayersControls*\n\nIf \`true\`, \`finalLayerThickness\` and \`minThickness\` are fractions of the adjacent cell size. If \`false\`, they are absolute lengths.`,

  // ── blockMesh detailed ──
  hex:             `### hex\n*blockMeshDict — blocks*\n\nDefines a hexahedral block:\n\`\`\`\nhex (v0 v1 v2 v3 v4 v5 v6 v7)  // 8 vertex indices\n    (nx ny nz)                   // cells per direction\n    simpleGrading (gx gy gz)     // grading ratios\n\`\`\`\nVertex ordering follows the right-hand rule; v0–v3 are one face, v4–v7 the opposite.`,
  simpleGrading:   `### simpleGrading\n*blockMeshDict — blocks*\n\nUniform grading in each direction. Value is the ratio of last cell size to first cell size:\n\`\`\`\nsimpleGrading (1 1 1)    // uniform\nsimpleGrading (2 1 1)    // cells grow in x-direction\n\`\`\`\nValue > 1: cells grow toward the end; < 1: cells shrink.`,
  edgeGrading:     `### edgeGrading\n*blockMeshDict — blocks*\n\nIndependently specifies grading for each of the 12 block edges. 12 values in the same order as block edges.`,
  arc:             `### arc\n*blockMeshDict — edges*\n\nDefines a circular arc between two vertices through a midpoint:\n\`\`\`\narc v0 v1 (x y z)  // midpoint on the arc\n\`\`\``,
  spline:          `### spline\n*blockMeshDict — edges*\n\nDefines a spline curve between two vertices through a list of intermediate points.`,
  polyLine:        `### polyLine\n*blockMeshDict — edges*\n\nPiecewise-linear edge between two vertices through multiple intermediate points.`,
  nFaces:          `### nFaces\n*blockMeshDict / polyMesh boundary*\n\nNumber of faces in a patch.`,
  startFace:       `### startFace\n*polyMesh boundary*\n\nIndex of the first face in the patch within the global face list.`,

  // ── Function objects ──
  forces:          `### forces\n*controlDict — function objects*\n\nComputes the total force and moment on one or more patches:\n\`\`\`\nforces\n{\n    type    forces;\n    libs    ("libforces.so");\n    patches (hull);\n    rho     rhoInf; rhoInf 1.2;\n    CofR    (0 0 0);\n    writeControl timeStep; writeInterval 1;\n}\n\`\`\``,
  forceCoeffs:     `### forceCoeffs\n*controlDict — function objects*\n\nLike \`forces\` but also outputs non-dimensional lift (CL), drag (CD), and moment (CM) coefficients. Requires \`magUInf\`, \`lRef\`, \`Aref\`.`,
  fieldAverage:    `### fieldAverage\n*controlDict — function objects*\n\nComputes time-averaged fields (mean + prime²). Activates after a specified start time.`,
  probes:          `### probes\n*controlDict — function objects*\n\nSamples field values at fixed probe locations and writes time series:\n\`\`\`\nprobes { type probes; libs ("libsampling.so"); fields (p U); probeLocations ((0.5 0 0) (1 0 0)); }\n\`\`\``,
  surfaces:        `### surfaces\n*controlDict — function objects*\n\nExtracts field data on surfaces (iso-surfaces, cutting planes, patches) at specified write intervals.`,
  residuals:       `### residuals\n*controlDict — function objects*\n\nWrites solver residuals for selected fields at each time step — useful for convergence monitoring without parsing log files.`,
  streamlines:     `### streamlines\n*controlDict — function objects*\n\nComputes and writes streamlines seeded from specified points.`,
  wallShearStress: `### wallShearStress\n*controlDict — function objects*\n\nComputes wall shear stress vector τ_w on wall patches. Useful for boundary layer analysis.`,
  yPlus:           `### yPlus\n*controlDict — function objects*\n\nComputes the dimensionless wall distance y⁺ = u_τ y / ν on wall patches. Use to check mesh resolution for chosen near-wall model.`,
  turbulenceFields:`### turbulenceFields\n*controlDict — function objects*\n\nOutputs additional turbulence quantities not written by default (e.g. L, R, devReff, nuEff).`,
  MachNumber:      `### MachNumber\n*controlDict — function objects*\n\nComputes local Mach number from velocity and speed of sound.`,
  vorticity:       `### vorticity\n*controlDict — function objects*\n\nComputes the vorticity field ω = ∇ × U.`,
  Q:               `### Q\n*controlDict — function objects*\n\nComputes the Q-criterion for vortex identification: Q = 0.5(|Ω|² − |S|²) where Ω is the rotation tensor and S the strain rate tensor.`,
  Lambda2:         `### Lambda2\n*controlDict — function objects*\n\nComputes the λ₂ vortex identification criterion (Jeong & Hussain, 1995).`,
  writeObjects:    `### writeObjects\n*controlDict — function objects*\n\nForces specified fields to be written even if they are not in the main write list.`,
  writeRegisteredObject: `### writeRegisteredObject\n*controlDict — function objects*\n\nWrites fields registered in the object registry by name.`,
  singleGraph:     `### singleGraph\n*controlDict — function objects*\n\nSamples fields along a line and writes an XY plot.`,
  graphUniform:    `### graphUniform\n*controlDict — function objects*\n\nCreates a uniform-spacing line sample (number of points specified rather than a list).`,
  patchProbes:     `### patchProbes\n*controlDict — function objects*\n\nLike \`probes\` but positions are snapped to the nearest face on specified patches.`,

  // ── Miscellaneous common keywords ──
  value:           `### value\n*boundary condition*\n\nThe initial / reference field value at the boundary patch (required by most BCs):\n\`\`\`\nvalue   uniform 0;      // scalar\nvalue   uniform (0 0 0); // vector\n\`\`\`\nFor a \`fixedValue\` BC this is also the imposed value.`,
  type:            `### type\n*boundary / field / sub-dict*\n\nSpecifies the type of a patch, boundary condition, model, or function object. The most common keyword in OpenFOAM dictionaries.`,
  nFaces2:         `### nFaces\n*polyMesh boundary*\n\nNumber of faces belonging to this patch.`,
  matchTolerance:  `### matchTolerance\n*cyclic / cyclicAMI patch*\n\nGeometric tolerance for matching face centres on the two sides of a cyclic interface.`,
  transform:       `### transform\n*cyclic patch*\n\nType of transformation between cyclic half-pairs: \`translational\`, \`rotational\`, or \`noOrdering\`.`,
  separationVector:`### separationVector\n*cyclic translational patch*\n\nVector from the master patch centre to the slave patch centre (translational periodicity).`,
  neighbourPatch:  `### neighbourPatch\n*cyclic / cyclicAMI patch*\n\nName of the matching periodic patch on the other side.`,
  mapMethod:       `### mapMethod\n*cyclicAMI*\n\nInterpolation method for AMI face mapping: \`faceAreaWeightAMI\` (default), \`partialFaceAreaWeightAMI\`.`,
  offset:          `### offset\n*cyclicAMI — translational*\n\nSeparation vector (same as \`separationVector\` in newer syntax).`,
  rotationAxis:    `### rotationAxis\n*cyclic rotational patch*\n\nUnit vector defining the rotation axis for rotationally periodic patches.`,
  rotationCentre:  `### rotationCentre\n*cyclic rotational patch*\n\nPoint on the rotation axis.`,
  processorWeights:`### processorWeights\n*decomposeParDict — scotchCoeffs*\n\nRelative weighting of processors. Useful for heterogeneous clusters. Length must equal \`numberOfSubdomains\`.`,

  // ── g (gravity) ──
  g:               `### g\n*constant/g*\n\nGravitational acceleration vector:\n\`\`\`\ndimensions   [ 0 1 -2 0 0 0 0 ];\nvalue        ( 0 -9.81 0 );\n\`\`\`\nUsed by buoyancy-driven and free-surface solvers.`,

  // ── Pressure BCs (buoyancy / p_rgh) ──
  prghTotalPressure: `### prghTotalPressure\n*boundary condition — p_rgh*\n\nTotal pressure BC for the modified pressure p_rgh = p − ρgh. Sets p_rgh such that total pressure equals p0:\n\`\`\`\ntype    prghTotalPressure;\np0      uniform 0;\n\`\`\`\nUse at pressure inlets in buoyancy-driven or free-surface solvers (buoyantPimpleFoam, interFoam).`,

  prghPressure:    `### prghPressure\n*boundary condition — p_rgh*\n\nFixed modified pressure BC: p_rgh = p − ρgh. Specifies p directly and subtracts the hydrostatic head:\n\`\`\`\ntype    prghPressure;\np       uniform 101325;\n\`\`\``,

  prghPressureInletOutletVelocity: `### prghPressureInletOutletVelocity\n*boundary condition — U (buoyant solvers)*\n\nVelocity BC for pressure-driven buoyant boundaries. Applies zero gradient on outflow, reconstructed velocity from flux on inflow. Pair with \`prghTotalPressure\` on p_rgh.`,

  buoyantPressure: `### buoyantPressure\n*boundary condition — p_rgh at walls*\n\nAdjusts p_rgh gradient at a wall to account for the hydrostatic component, ensuring zero net flux through the wall. Use at walls in buoyancy-driven solvers instead of \`zeroGradient\`:\n\`\`\`\ntype    buoyantPressure;\n\`\`\``,

  fixedFluxExtrapolatedPressure: `### fixedFluxExtrapolatedPressure\n*boundary condition — p*\n\nExtrapolated variant of \`fixedFluxPressure\`. More accurate on skewed or non-orthogonal meshes; adjusts the pressure gradient to maintain the prescribed face flux.`,

  hydrostaticPressure: `### hydrostaticPressure\n*boundary condition — p_rgh*\n\nSets p_rgh to the hydrostatic profile (p_rgh = p_ref − ρ g·h). Used at the top boundary of tall domains in natural convection cases.`,

  uniformDensityHydrostaticPressure: `### uniformDensityHydrostaticPressure\n*boundary condition — p_rgh*\n\nHydrostatic pressure with a uniform reference density. Simpler than \`hydrostaticPressure\`; suitable when density variation is small.`,

  // ── Atmospheric BCs ──
  atmBoundaryLayerInletVelocity: `### atmBoundaryLayerInletVelocity\n*boundary condition — U (atmospheric BL inlet)*\n\nPrescribes a log-law atmospheric boundary layer velocity profile:\n\`\`\`\ntype        atmBoundaryLayerInletVelocity;\nflowDir     (1 0 0);\nzDir        (0 0 1);\nUref        10;      // reference wind speed [m/s]\nZref        10;      // reference height [m]\nz0          uniform 0.01;  // roughness length [m]\nzGround     uniform 0;\n\`\`\``,

  atmBoundaryLayerInletK: `### atmBoundaryLayerInletK\n*boundary condition — k (atmospheric BL inlet)*\n\nPrescribes turbulent kinetic energy consistent with the atmospheric boundary layer log-law profile. Requires the same \`Uref\`, \`Zref\`, \`z0\` as \`atmBoundaryLayerInletVelocity\`.`,

  atmBoundaryLayerInletEpsilon: `### atmBoundaryLayerInletEpsilon\n*boundary condition — epsilon (atmospheric BL inlet)*\n\nPrescribes ε consistent with the ABL log-law: ε = u*³ / (κ z). Use together with \`atmBoundaryLayerInletVelocity\` and \`atmBoundaryLayerInletK\`.`,

  atmBoundaryLayerInletOmega: `### atmBoundaryLayerInletOmega\n*boundary condition — omega (atmospheric BL inlet)*\n\nPrescribes ω consistent with the ABL log-law for k-ω based models. Use with \`atmBoundaryLayerInletVelocity\` and \`atmBoundaryLayerInletK\`.`,

  atmNutkWallFunction:    `### atmNutkWallFunction\n*boundary condition — nut (atmospheric rough wall)*\n\nTurbulent viscosity wall function that accounts for surface roughness in atmospheric flow simulations. Requires roughness length \`z0\`.`,

  atmEpsilonWallFunction: `### atmEpsilonWallFunction\n*boundary condition — epsilon (atmospheric rough wall)*\n\nEpsilon wall function for atmospheric boundary layer simulations with surface roughness.`,

  atmOmegaWallFunction:   `### atmOmegaWallFunction\n*boundary condition — omega (atmospheric rough wall)*\n\nOmega wall function for atmospheric boundary layer simulations.`,

  nutkRoughWallFunction:  `### nutkRoughWallFunction\n*boundary condition — nut (rough wall)*\n\nTurbulent viscosity wall function for hydraulically rough walls. Requires:\n- \`Ks\` — equivalent sand roughness height [m]\n- \`Cs\` — roughness constant (typically 0.5)\n\`\`\`\ntype   nutkRoughWallFunction;\nKs     uniform 1e-3;\nCs     uniform 0.5;\n\`\`\``,

  nutURoughWallFunction:  `### nutURoughWallFunction\n*boundary condition — nut (rough wall)*\n\nRough-wall nut function based on velocity profile. Alternative to \`nutkRoughWallFunction\` when k is not available.`,

  nutkAtmRoughWallFunction: `### nutkAtmRoughWallFunction\n*boundary condition — nut (atmospheric rough wall)*\n\nAtmospheric rough-wall nut function using roughness length z0 (as used in ABL flows) rather than equivalent sand roughness Ks.`,

  // ── Low-Re wall functions ──
  kLowReWallFunction:       `### kLowReWallFunction\n*boundary condition — k (low-Re near-wall)*\n\nWall BC for k that integrates to the wall (y⁺ ≈ 1). Sets k using a blended viscous-sublayer / log-law formulation. Requires a fine mesh (first cell y⁺ < 5).`,

  epsilonLowReWallFunction: `### epsilonLowReWallFunction\n*boundary condition — epsilon (low-Re near-wall)*\n\nWall BC for ε that integrates to the wall. Applies the low-Reynolds-number boundary condition ε = 2ν k / y². Requires y⁺ ≈ 1.`,

  omegaLowReWallFunction:   `### omegaLowReWallFunction\n*boundary condition — omega (low-Re near-wall)*\n\nWall BC for ω that integrates to the wall. Blends between the viscous sublayer solution (ω = 6ν/(β₁ y²)) and log-layer solution. Requires y⁺ ≈ 1.`,

  nutLowReWallFunction:     `### nutLowReWallFunction\n*boundary condition — nut (low-Re near-wall)*\n\nTurbulent viscosity wall function for low-Re (wall-resolving) meshes. Sets nut = 0 at the wall (no-slip viscous sublayer).`,

  // ── Velocity inlet BCs ──
  flowRateInletVelocity:   `### flowRateInletVelocity\n*boundary condition — U (inlet)*\n\nSets velocity profile to achieve a target volumetric or mass flow rate:\n\`\`\`\ntype           flowRateInletVelocity;\nvolumetricFlowRate  constant 0.01;  // m³/s\n// or:\nmassFlowRate        constant 1.0;   // kg/s\n\`\`\``,

  swirlInletVelocity:      `### swirlInletVelocity\n*boundary condition — U (swirling inlet)*\n\nPrescribes a swirling inlet velocity with axial, radial, and tangential components as functions of radius. Used for rotating machinery inlets.`,

  swirlFlowRateInletVelocity: `### swirlFlowRateInletVelocity\n*boundary condition — U (swirling inlet)*\n\nCombines \`flowRateInletVelocity\` with a swirl component. Achieves a target flow rate while imposing a tangential velocity profile.`,

  pressureDirectedInletVelocity: `### pressureDirectedInletVelocity\n*boundary condition — U*\n\nDirects the inlet velocity along the patch face normal, with magnitude determined by the pressure field. Used with \`totalPressure\` BCs.`,

  pressureDirectedInletOutletVelocity: `### pressureDirectedInletOutletVelocity\n*boundary condition — U*\n\nLike \`pressureDirectedInletVelocity\` but switches to \`zeroGradient\` on outflow faces.`,

  pressureNormalInletVelocity: `### pressureNormalInletVelocity\n*boundary condition — U*\n\nSets inlet velocity normal to the patch, with magnitude from the adjacent cell pressure. Simple pressure-velocity coupling at inlets.`,

  pressureInletUniformVelocity: `### pressureInletUniformVelocity\n*boundary condition — U*\n\nSets a spatially uniform inlet velocity whose magnitude is adjusted to match the pressure-driven flux.`,

  rotatingPressureInletOutletVelocity: `### rotatingPressureInletOutletVelocity\n*boundary condition — U (rotating frame)*\n\nPressure inlet/outlet velocity in a rotating reference frame. Applies the rotation correction to the velocity.`,

  translatingWallVelocity: `### translatingWallVelocity\n*boundary condition — U (moving wall)*\n\nNo-slip condition on a wall translating at a fixed velocity:\n\`\`\`\ntype       translatingWallVelocity;\nU          (1 0 0);  // wall speed [m/s]\n\`\`\``,

  rotatingWallVelocity:    `### rotatingWallVelocity\n*boundary condition — U (rotating wall)*\n\nNo-slip condition on a rotating wall. Velocity is v = ω × r:\n\`\`\`\ntype    rotatingWallVelocity;\norigin  (0 0 0);\naxis    (0 0 1);\nomega   100;  // rad/s\n\`\`\``,

  fixedNormalSlip:         `### fixedNormalSlip\n*boundary condition — U*\n\nFixed normal component with slip tangential component. Useful for specifying a wall-normal inflow while allowing tangential slip.`,

  partialSlip:             `### partialSlip\n*boundary condition — U (partial slip wall)*\n\nBlends between no-slip and free-slip based on a slip coefficient (0 = no-slip, 1 = full slip):\n\`\`\`\ntype           partialSlip;\nvalueFraction  uniform 0.5;\n\`\`\``,

  fixedShearStress:        `### fixedShearStress\n*boundary condition — U*\n\nApplies a fixed shear stress τ at the wall rather than a velocity:\n\`\`\`\ntype    fixedShearStress;\ntau     uniform (1 0 0);  // [Pa]\n\`\`\``,

  turbulentDFSEMInlet:     `### turbulentDFSEMInlet\n*boundary condition — U, k, R (turbulent inlet)*\n\nDiscrete Fractal Synthetic Eddy Method inlet. Generates synthetic turbulent fluctuations with prescribed length scales and intensities. Requires a pre-computed turbulent statistics file.`,

  // ── Turbulence inlet BCs ──
  turbulentIntensityKineticEnergyInlet: `### turbulentIntensityKineticEnergyInlet\n*boundary condition — k (turbulent inlet)*\n\nSets k from turbulence intensity I and reference velocity Uref:\nk = 1.5 (Uref · I)²\n\`\`\`\ntype              turbulentIntensityKineticEnergyInlet;\nturbIntensity     uniform 0.05;  // 5%\nvalue             uniform 0.1;\n\`\`\``,

  turbulentMixingLengthFrequencyInlet: `### turbulentMixingLengthFrequencyInlet\n*boundary condition — omega (turbulent inlet)*\n\nSets ω from mixing length Lm:\nω = k^0.5 / (Cμ^0.25 · Lm)\n\`\`\`\ntype         turbulentMixingLengthFrequencyInlet;\nmixingLength uniform 0.01;\nvalue        uniform 1;\n\`\`\``,

  turbulentMixingLengthDissipationRateInlet: `### turbulentMixingLengthDissipationRateInlet\n*boundary condition — epsilon (turbulent inlet)*\n\nSets ε from mixing length Lm:\nε = Cμ^0.75 · k^1.5 / Lm\n\`\`\`\ntype         turbulentMixingLengthDissipationRateInlet;\nmixingLength uniform 0.01;\nvalue        uniform 1;\n\`\`\``,

  // ── Heat transfer BCs ──
  externalWallHeatFluxTemperature: `### externalWallHeatFluxTemperature\n*boundary condition — T (conjugate heat transfer)*\n\nApplies a heat flux or heat transfer coefficient at a wall. Modes:\n- \`fixedHeatFlux\` — prescribed q [W/m²]\n- \`fixedHeatTransferCoeff\` — h and T_ambient\n\`\`\`\ntype        externalWallHeatFluxTemperature;\nmode        fixedHeatFlux;\nq           uniform 1000;  // W/m²\nvalue       uniform 300;\n\`\`\``,

  turbulentHeatFluxTemperature: `### turbulentHeatFluxTemperature\n*boundary condition — T (turbulent heat flux)*\n\nSets temperature such that the turbulent heat flux q = ρ Cp αt ∂T/∂n equals a prescribed value:\n\`\`\`\ntype       turbulentHeatFluxTemperature;\nheatSource flux;\nq          uniform 5000;\n\`\`\``,

  fixedHeatFlux:           `### fixedHeatFlux\n*boundary condition — T or mode in externalWallHeatFluxTemperature*\n\nPrescribed heat flux q [W/m²] at the wall. Positive = heat into domain.`,

  fixedHeatTransferCoeff:  `### fixedHeatTransferCoeff\n*boundary condition — mode in externalWallHeatFluxTemperature*\n\nSpecifies convective heat transfer: q = h·(T_w − T_amb).\nRequires \`h\` (W/m²K) and \`Ta\` (ambient temperature).`,

  temperatureJump:         `### temperatureJump\n*boundary condition — T (rarefied gas)*\n\nApplies Smoluchowski temperature jump condition for rarefied gas flows:\nT_w − T_gas = ζ · (2−αT)/αT · (2γ/(γ+1)) · (λ/Pr) · ∂T/∂n`,

  convectiveHeatTransfer:  `### convectiveHeatTransfer\n*boundary condition — T*\n\nConvective (Robin) heat transfer condition combining a convective flux with a wall temperature.`,

  alphatWallFunction:      `### alphatWallFunction\n*boundary condition — alphat (thermal wall function)*\n\nTurbulent thermal diffusivity wall function. Computes αt from nut and turbulent Prandtl number Prt.`,

  alphatConductivity:      `### alphatConductivity\n*boundary condition — alphat*\n\nSets turbulent thermal diffusivity from prescribed conductivity. Used in conjugate heat transfer.`,

  // ── Mapped / interpolated BCs ──
  mappedFixedValue:        `### mappedFixedValue\n*boundary condition*\n\nInterpolates field values from another patch (possibly in another mesh). Used for domain coupling and recycling turbulence from a precursor simulation:\n\`\`\`\ntype          mappedFixedValue;\nfieldName     U;\naveraged      false;\n\`\`\``,

  mappedFlowRate:          `### mappedFlowRate\n*boundary condition*\n\nMaps the flow rate from a source patch, scaling the velocity profile to match.`,

  mappedVelocityFluxFixedValue: `### mappedVelocityFluxFixedValue\n*boundary condition — U*\n\nMaps velocity and ensures flux consistency for mapped interfaces.`,

  outletMappedUniformInlet: `### outletMappedUniformInlet\n*boundary condition*\n\nSets the inlet value to the area-weighted average of the outlet. Used to create a fully-developed flow recycling boundary condition.`,

  oscillatingFixedValue:   `### oscillatingFixedValue\n*boundary condition*\n\nTime-varying fixed value oscillating sinusoidally:\n\`\`\`\ntype       oscillatingFixedValue;\noffset     (1 0 0);\namplitude  (0.1 0 0);\nomega      6.28;  // rad/s\n\`\`\``,

  fixedProfile:            `### fixedProfile\n*boundary condition*\n\nSets a spatially non-uniform fixed value from a 1D profile (table of position vs. value). Useful for imposing measured inlet profiles.`,

  // ── Compressible BCs ──
  subsonicInflow:          `### subsonicInflow\n*boundary condition (compressible)*\n\nCharacteristic-based subsonic inflow: prescribes total pressure and total temperature; extrapolates tangential velocity from interior.`,

  subsonicOutflow:         `### subsonicOutflow\n*boundary condition (compressible)*\n\nCharacteristic-based subsonic outflow: prescribes static pressure; extrapolates all other quantities from interior.`,

  supersonicFreeStream:    `### supersonicFreeStream\n*boundary condition (compressible)*\n\nFar-field BC for supersonic flows. Applies freestream values on inflow faces; zero gradient on outflow.`,

  characteristic:          `### characteristic\n*boundary condition (compressible)*\n\nFull characteristic (Riemann invariant) BC. Applies inflow or outflow conditions based on the local wave speeds.`,

  smoluchowskiJumpT:       `### smoluchowskiJumpT\n*boundary condition — T (rarefied gas)*\n\nSmoluchowski temperature jump for micro/nano-scale or rarefied gas flows. Applies a temperature discontinuity at the wall proportional to the Knudsen number.`,

  maxwellSlipU:            `### maxwellSlipU\n*boundary condition — U (rarefied gas)*\n\nMaxwell velocity slip condition for rarefied gas flows. Slip velocity ∝ mean free path · ∂U/∂n.`,

  // ── VOF / multiphase BCs ──
  variableHeightFlowRate:  `### variableHeightFlowRate\n*boundary condition — alpha (VOF)*\n\nSets inlet flow rate for two-phase (VOF) simulations where the free-surface height at the inlet varies in time.`,

  // ── Fan / jump BCs ──
  fanPressure:             `### fanPressure\n*boundary condition — p (fan)*\n\nApplies a pressure jump across a fan boundary using a fan curve (pressure rise vs. flow rate table):\n\`\`\`\ntype       fanPressure;\npFanCurve  table ((0 100) (0.1 80) (0.2 0));\n\`\`\``,

  fixedJump:               `### fixedJump\n*boundary condition — cyclic jump*\n\nApplies a fixed jump in value across a cyclic interface. Used for fan pressure rise and periodic pressure gradients.`,

  jumpCyclic:              `### jumpCyclic\n*boundary condition — cyclic with jump*\n\nCyclic BC that includes a prescribed scalar jump between the two periodic faces.`,

  // ── Radiation BCs ──
  greyDiffusiveRadiation:  `### greyDiffusiveRadiation\n*boundary condition — G / Qr (radiation)*\n\nGrey diffuse radiation BC for the incident radiation G field. Sets the boundary emissive flux based on wall emissivity and temperature.`,

  greyDiffusiveViewFactor: `### greyDiffusiveViewFactor\n*boundary condition — Qr (view factor radiation)*\n\nDiffuse grey radiation BC using pre-computed view factors. Requires the view factor field on the boundary.`,

  MarshakRadiation:        `### MarshakRadiation\n*boundary condition — G (P1 radiation)*\n\nMarshak boundary condition for the P1 radiation model. Sets the incident radiation flux at the boundary based on emissivity.`,

  // ── Coded / expression BCs ──
  codedMixed:              `### codedMixed\n*boundary condition*\n\nCoded version of the \`mixed\` BC — write C++ to set \`refValue\`, \`refGrad\`, and \`valueFraction\` at run time.`,

  directionMixed:          `### directionMixed\n*boundary condition — vector fields*\n\nApplies different conditions in different vector component directions — e.g. fixed value in normal direction, zero gradient in tangential directions.`,

  fixedInternalValue:      `### fixedInternalValue\n*boundary condition*\n\nSets both the boundary face value and the adjacent internal cell value to the prescribed value. Stronger than \`fixedValue\`.`,

  exprFixedValue:          `### exprFixedValue\n*boundary condition*\n\nExpression-based fixed value using OpenFOAM expression language (no compilation needed):\n\`\`\`\ntype        exprFixedValue;\nvalue       uniform 0;\nexpr        \"pos().x * 2\";\n\`\`\``,

  uniformNormalFixedValue: `### uniformNormalFixedValue\n*boundary condition*\n\nApplies a fixed value in the surface-normal direction only, with the magnitude specified as a scalar.`,

  // ── fvSolution — PIMPLE / SIMPLE extra keywords ──
  momentumPredictor: `### momentumPredictor\n*fvSolution — PIMPLE / PISO*\n\nEnable (\`true\`) or disable (\`false\`) the explicit momentum predictor step before pressure correction. Disabling can improve stability for buoyancy-dominated or incompressible flows at the cost of accuracy.`,

  correctPhi:        `### correctPhi\n*fvSolution — PIMPLE*\n\nApply a flux correction step after mesh motion or pressure solve to enforce global continuity (\`true\`/\`false\`). Recommended when using dynamic mesh or AMI.`,

  pRefCell:          `### pRefCell\n*fvSolution — SIMPLE / PIMPLE*\n\nIndex of the reference cell for pressure. Required for fully-enclosed domains (no pressure BC) to remove the pressure null space. Typically \`0\`.`,

  pRefValue:         `### pRefValue\n*fvSolution — SIMPLE / PIMPLE*\n\nPressure value assigned to the reference cell. Usually \`0\` for relative pressure.`,

  nAlphaCorr:        `### nAlphaCorr\n*fvSolution — multiphase (interFoam)*\n\nNumber of alpha (phase fraction) corrector loops per time step. Typical: \`1\`–\`2\`.`,

  nAlphaSubCycles:   `### nAlphaSubCycles\n*fvSolution — multiphase (interFoam)*\n\nNumber of sub-cycles within each alpha corrector loop. Increasing improves interface sharpness but raises cost. Typical: \`1\`–\`3\`.`,

  cAlpha:            `### cAlpha\n*fvSolution — multiphase (interFoam)*\n\nInterface compression coefficient for the MULES scheme. \`cAlpha = 0\`: no compression (diffuse interface). \`cAlpha = 1\`: maximum compression (sharp interface). Default: \`1\`.`,

  icAlpha:           `### icAlpha\n*fvSolution — multiphase*\n\nInitial compression coefficient for alpha. Usually set equal to \`cAlpha\`.`,

  maxIter:           `### maxIter\n*fvSolution — solvers block*\n\nMaximum number of linear solver iterations before giving up, even if tolerance is not met. Default: \`1000\`.`,

  minIter:           `### minIter\n*fvSolution — solvers block*\n\nMinimum number of iterations regardless of convergence. Useful to prevent premature exit on the first iteration.`,

  // ── fvSchemes — wallDist ──
  wallDist:          `### wallDist\n*fvSchemes*\n\nSpecifies the method used to compute wall distance (used by turbulence models and some BCs):\n\`\`\`\nwallDist { method meshWave; }\n\`\`\`\nMethods:\n- \`meshWave\` — fast wave propagation (default, recommended)\n- \`Poisson\` — solves a Poisson equation for distance (smooth on bad meshes)\n- \`exactDistance\` — exact geometric distance (very slow, rarely needed)`,

  meshWave:          `### meshWave\n*wallDist method*\n\nFast wave-propagation algorithm for computing wall distances. Propagates distance values from wall faces through the mesh. Default and recommended method.`,

  Poisson:           `### Poisson\n*wallDist method*\n\nSolves −∇²φ = 1 and approximates wall distance from the solution. Produces smooth distance fields on meshes where meshWave gives noisy results.`,

  exactDistance:     `### exactDistance\n*wallDist method*\n\nComputes exact geometric distance from each cell centre to the nearest wall face. Very accurate but O(N·M) cost — only practical for small cases.`,

  // ── Grading entries (blockMesh) ──
  grading:           `### grading\n*blockMeshDict — blocks*\n\nSpecifies cell size expansion within a block. Two variants:\n- \`simpleGrading (gx gy gz)\` — uniform grading per direction\n- \`edgeGrading (g0 g1 ... g11)\` — independent grading on each of the 12 edges`,

  convertToMeters:   `### convertToMeters\n*blockMeshDict*\n\nScale factor applied to all vertex coordinates (same as \`scale\` in newer OF versions). Common values: \`0.001\` (mm→m), \`0.0254\` (inch→m).`,

  // ── PIMPLE keywords not yet covered ──
  turbOnFinalIterOnly: `### turbOnFinalIterOnly\n*fvSolution — PIMPLE*\n\nUpdate turbulence quantities only on the final outer corrector iteration (\`true\`/\`false\`). Reduces cost when \`nOuterCorrectors\` > 1.`,

  consistent:        `### consistent\n*fvSolution — SIMPLE*\n\nEnable the SIMPLEC (Consistent) variant of SIMPLE (\`true\`/\`false\`). SIMPLEC allows higher under-relaxation factors (closer to 1) and often converges faster than standard SIMPLE.`,

  // ── Function object common keywords ──
  executeControl:    `### executeControl\n*controlDict — function object*\n\nWhen to execute the function object:\n- \`timeStep\` — every N time steps\n- \`runTime\` — every N seconds of simulation time\n- \`onEnd\` — only at end of run`,

  writeControl2:     `### writeControl\n*controlDict — function object*\n\nWhen to write output from the function object. Same options as \`executeControl\`: \`timeStep\`, \`runTime\`, \`onEnd\`.`,

  executeInterval:   `### executeInterval\n*controlDict — function object*\n\nInterval (in units of \`executeControl\`) between function object executions.`,

  writeInterval2:    `### writeInterval\n*controlDict — function object*\n\nInterval (in units of \`writeControl\`) between function object output writes.`,

  log:               `### log\n*controlDict — function object*\n\nWrite results to the log file as well as output files (\`true\`/\`false\`).`,

  patches:           `### patches\n*controlDict — function object*\n\nList of patch names on which the function object operates:\n\`\`\`\npatches  (inlet outlet wall);\n\`\`\``,

  fields:            `### fields\n*controlDict — function object / fvSolution*\n\nList of field names. In function objects: the fields to process. In \`relaxationFactors\`: under-relaxation for field equations (p, U, …).`,

  // ── Mesh quality thresholds ──
  maxNonOrtho:       `### maxNonOrtho\n*snappyHexMeshDict / mesh quality*\n\nMaximum non-orthogonality angle [degrees] allowed. OpenFOAM can handle up to ~70° with non-orthogonal correctors, but quality degrades above 85°. Typical snappyHexMesh limit: \`65\`.`,

  maxBoundarySkewness: `### maxBoundarySkewness\n*snappyHexMeshDict / mesh quality*\n\nMaximum skewness of boundary faces. Typical limit: \`20\`.`,

  maxInternalSkewness: `### maxInternalSkewness\n*snappyHexMeshDict / mesh quality*\n\nMaximum skewness of internal faces. Skewness > 4 typically causes convergence problems.`,

  maxConcave:        `### maxConcave\n*snappyHexMeshDict / mesh quality*\n\nMaximum concavity angle [degrees] of a face. Faces with concavity above this value are split or removed. Typical: \`80\`.`,

  minVol:            `### minVol\n*snappyHexMeshDict / mesh quality*\n\nMinimum cell volume [m³]. Cells below this threshold are flagged as invalid. Typical: \`1e-13\`.`,

  minTetQuality:     `### minTetQuality\n*snappyHexMeshDict / mesh quality*\n\nMinimum tet decomposition quality. Negative values indicate inverted tets. Minimum acceptable: \`-1e30\` (allow some negative) or \`1e-15\` (strict).`,

  minDeterminant:    `### minDeterminant\n*snappyHexMeshDict / mesh quality*\n\nMinimum Jacobian determinant of the hex cell mapping. Values < 0 indicate inverted cells. Minimum: \`0.001\`.`,

  minFaceWeight:     `### minFaceWeight\n*snappyHexMeshDict / mesh quality*\n\nMinimum face interpolation weight (owner face-centre to face-centre ratio). Values close to 0 indicate highly non-orthogonal faces. Typical minimum: \`0.05\`.`,

  minVolRatio:       `### minVolRatio\n*snappyHexMeshDict / mesh quality*\n\nMinimum ratio of the smallest to largest cell volume sharing a face. Typical minimum: \`0.01\`.`,

  minTwist:          `### minTwist\n*snappyHexMeshDict / mesh quality*\n\nMinimum face twist (the cos of the angle between adjacent face-triangle normals). Typical minimum: \`0.02\`.`,

  minFlatness:       `### minFlatness\n*snappyHexMeshDict / mesh quality*\n\nMinimum face flatness — ratio of projected area to actual area. Faces below this threshold are non-planar. Typical minimum: \`0.5\`.`,

  minArea:           `### minArea\n*snappyHexMeshDict / mesh quality*\n\nMinimum face area [m²]. Typical: \`-1\` (disabled) or a small positive value.`,

  // ── Solver application names (common) ──
  simpleFoam:        `### simpleFoam\n*OpenFOAM solver*\n\nSteady-state incompressible turbulent flow solver using the SIMPLE algorithm. Suitable for single-phase flows with RANS turbulence.`,

  pimpleFoam:        `### pimpleFoam\n*OpenFOAM solver*\n\nTransient incompressible turbulent flow solver using the PIMPLE algorithm. Supports large time steps via SIMPLE outer iterations combined with PISO inner corrections.`,

  icoFoam:           `### icoFoam\n*OpenFOAM solver*\n\nTransient incompressible laminar flow solver using PISO. Simple and fast for laminar flows.`,

  pisoFoam:          `### pisoFoam\n*OpenFOAM solver*\n\nTransient incompressible turbulent flow solver using PISO. Similar to pimpleFoam with \`nOuterCorrectors 1\`.`,

  buoyantSimpleFoam: `### buoyantSimpleFoam\n*OpenFOAM solver*\n\nSteady-state buoyancy-driven (natural convection) incompressible solver. Solves energy equation; uses p_rgh formulation.`,

  buoyantPimpleFoam: `### buoyantPimpleFoam\n*OpenFOAM solver*\n\nTransient buoyancy-driven (natural / forced convection) solver. Handles both incompressible and low-Mach compressible flows with heat transfer.`,

  interFoam:         `### interFoam\n*OpenFOAM solver*\n\nTransient incompressible two-phase free-surface flow solver using VOF (Volume of Fluid). Solves for volume fraction α with MULES interface compression.`,

  rhoPimpleFoam:     `### rhoPimpleFoam\n*OpenFOAM solver*\n\nTransient compressible turbulent flow solver (density-based PIMPLE). Handles subsonic to transonic flows.`,

  rhoSimpleFoam:     `### rhoSimpleFoam\n*OpenFOAM solver*\n\nSteady-state compressible turbulent flow solver (density-based SIMPLE). For subsonic to supersonic steady flows.`,

  sonicFoam:         `### sonicFoam\n*OpenFOAM solver*\n\nTransient sonic (supersonic/transonic) compressible flow solver. Handles strong shocks.`,

  potentialFoam:     `### potentialFoam\n*OpenFOAM solver*\n\nPotential flow solver — computes irrotational velocity field. Used to initialize pressure/velocity fields before running a full solver.`,

  laplacianFoam:     `### laplacianFoam\n*OpenFOAM solver*\n\nSolves a simple Laplace equation ∇²T = 0. Used for steady-state heat conduction or diffusion test cases.`,

  scalarTransportFoam: `### scalarTransportFoam\n*OpenFOAM solver*\n\nTransient scalar transport solver: ∂T/∂t + ∇·(U T) = ∇·(D ∇T). Useful for tracer studies and verification.`,

  // ── Check mesh utilities ──
  checkMesh:         `### checkMesh\n*OpenFOAM utility*\n\nChecks mesh quality and reports statistics: cell counts, non-orthogonality, skewness, aspect ratio, and volume ratio. Run before any simulation to verify mesh quality.`,

  blockMesh:         `### blockMesh\n*OpenFOAM utility*\n\nGenerates structured hexahedral mesh from blockMeshDict. Must be run before the solver. Supports grading and curved edges.`,

  snappyHexMesh:     `### snappyHexMesh\n*OpenFOAM utility*\n\nGenerates unstructured hex-dominant mesh by refining a background blockMesh around CAD geometry (STL). Three phases: castellated → snap → layer addition.`,

  decomposePar:      `### decomposePar\n*OpenFOAM utility*\n\nDecomposes the mesh and fields for parallel computation. Run before any parallel solver execution.`,

  reconstructPar:    `### reconstructPar\n*OpenFOAM utility*\n\nReconstructs the parallel decomposed case back into a single-processor case after a parallel run.`,

  mapFields:         `### mapFields\n*OpenFOAM utility*\n\nInterpolates fields from one mesh to another. Used for mesh refinement restarts and grid convergence studies.`,

  topoSet:           `### topoSet\n*OpenFOAM utility*\n\nCreates and manipulates cell, face, and point sets (topological sets) using topoSetDict. Used for refinement regions, sources, and post-processing zones.`,
};

// ── Language Server ───────────────────────────────────────────────────────────
class OpenFOAMLanguageServer {
  private conn = createConnection(ProposedFeatures.all);
  private docs  = new TextDocuments(TextDocument);
  private db!:  KeywordDb;
  private debounce = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    this.conn.onInitialize(this.onInit.bind(this));
    this.conn.onInitialized(this.onInited.bind(this));
    this.conn.onHover(this.onHover.bind(this));
    this.conn.onCompletion(this.onCompletion.bind(this));
    this.conn.onCompletionResolve(i => i);
    this.conn.onSignatureHelp(this.onSigHelp.bind(this));
    this.docs.onDidChangeContent(e => this.scheduleDiagnostics(e.document));
    this.docs.onDidOpen(e => this.scheduleDiagnostics(e.document));
    this.docs.listen(this.conn);
  }

  listen() { this.docs.listen(this.conn); this.conn.listen(); }

  // ── Init ──────────────────────────────────────────────────────────────────
  private onInit(_p: InitializeParams): InitializeResult {
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        hoverProvider: true,
        completionProvider: { resolveProvider: false, triggerCharacters: [" ", "\n", "{"] },
        signatureHelpProvider: { triggerCharacters: [" "] },
      },
    };
  }

  private onInited() { this.loadDb(); }

  private loadDb() {
    const candidates = [
      path.join(__dirname, "..", "data", "keyword-db.json"),
      path.join(__dirname, "..", "..", "data", "keyword-db.json"),
      path.join(__dirname, "..", "data", "openfoam-keywords.json"),
      path.join(__dirname, "..", "..", "data", "openfoam-keywords.json"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          this.db = JSON.parse(fs.readFileSync(p, "utf-8")) as KeywordDb;
          this.conn.console.log(`OpenFOAM LSP loaded keyword-db from ${p}`);
          return;
        } catch { /* try next */ }
      }
    }
    this.conn.console.error("OpenFOAM LSP: keyword-db.json not found");
    this.db = { version:"?", schemes:{}, linearSolvers:{}, algorithms:{},
      boundaryConditions:{}, turbulenceModels:{RAS:{},LES:{}},
      controlDict:{}, snappyHexMesh:{}, blockMesh:{}, decomposePar:{}, contexts:{} };
  }

  // ── Context detection ─────────────────────────────────────────────────────
  private detectFileType(doc: TextDocument): OpenFOAMFileType {
    const uri = doc.uri;
    const fname = path.basename(uri);
    const text  = doc.getText();

    // 1. FoamFile header object field
    const objM = text.match(/\bobject\s+([\w.]+)\s*;/);
    if (objM) {
      const obj = objM[1];
      if (obj in FT_MAP) return FT_MAP[obj];
    }

    // 2. FoamFile class field
    const clsM = text.match(/\bclass\s+([\w.]+)\s*;/);
    if (clsM && /Field|volScalar|volVector/.test(clsM[1])) return "boundaryField";

    // 3. Filename
    if (fname in FT_MAP) return FT_MAP[fname];

    // 4. Path segments
    if (/\/0\//.test(uri)) return "boundaryField";
    return "unknown";
  }

  private getBlockPath(text: string, offset: number): string[] {
    const path_: string[] = [];
    let depth = 0;
    let i = 0;
    let lastWord = "";
    while (i < offset) {
      const ch = text[i];
      if (ch === '/' && text[i+1] === '/') { while (i < offset && text[i] !== '\n') i++; continue; }
      if (ch === '/' && text[i+1] === '*') { i += 2; while (i < offset-1 && !(text[i]==='*' && text[i+1]==='/')) i++; i += 2; continue; }
      if (/\w/.test(ch)) {
        let w = ''; while (i < offset && /[\w.()]/.test(text[i])) w += text[i++];
        lastWord = w; continue;
      }
      if (ch === '{') { if (lastWord) path_[depth] = lastWord; depth++; lastWord = ''; }
      if (ch === '}') { depth = Math.max(0, depth-1); path_.splice(depth); lastWord = ''; }
      if (ch === ';') lastWord = '';
      i++;
    }
    return path_.filter(Boolean);
  }

  private getCursorContext(doc: TextDocument, pos: Position): CursorContext {
    const text   = doc.getText();
    const offset = doc.offsetAt(pos);
    const blockPath = this.getBlockPath(text, offset);

    // Determine key vs value: look back from cursor to previous ; or {
    const before = text.slice(Math.max(0, offset - 200), offset);
    const lastBreak = Math.max(before.lastIndexOf(';'), before.lastIndexOf('{'));
    const segment = before.slice(lastBreak + 1).trim();
    const cursorIn: "key" | "value" = segment.split(/\s+/).length > 1 ? "value" : "key";
    const currentKey = segment.split(/\s+/)[0] || '';

    return {
      fileType:  this.detectFileType(doc),
      blockPath,
      cursorIn,
      currentKey,
    };
  }

  // ── Hover ─────────────────────────────────────────────────────────────────
  private onHover(params: TextDocumentPositionParams): Hover | null {
    const doc = this.docs.get(params.textDocument.uri);
    if (!doc || !this.db) return null;

    const word = this.wordAt(doc, params.position);
    if (!word) return null;

    const md = this.lookupHover(word, doc);
    if (!md) return null;
    return { contents: { kind: MarkupKind.Markdown, value: md } };
  }

  private lookupHover(word: string, doc: TextDocument): string | null {
    if (!this.db) return null;

    // Check static block / keyword descriptions first
    if (word in BLOCK_DESCRIPTIONS) return BLOCK_DESCRIPTIONS[word];

    // Check each scheme category
    for (const [cat, members] of Object.entries(this.db.schemes || {})) {
      if (word in members) {
        const s = members[word];
        let md = `### ${word}\n*${cat}*\n\n${s.brief || ''}`;
        if (s.detail) md += `\n\n${s.detail}`;
        md += `\n\n**Format:** \`${s.format}\``;
        if (s.arguments?.length) {
          md += '\n\n**Arguments:**\n';
          for (const a of s.arguments) {
            const req = a.required ? '*(required)*' : '*(optional)*';
            const range = a.range ? ` — range: ${a.range[0]}..${a.range[1]}` : '';
            md += `- \`${a.name}\` ${req}${range}\n`;
          }
        }
        if (s.usage) md += `\n\n**Usage:**\n\`\`\`\n${s.usage}\n\`\`\``;
        if (s.notes?.length) md += '\n\n**Note:** ' + s.notes.join('\n\n**Note:** ');
        if (s.warnings?.length) md += '\n\n> ⚠ ' + s.warnings.join('\n> ⚠ ');
        if (s.see?.length) md += `\n\n*See also:* ${s.see.join(', ')}`;
        return md;
      }
    }

    // Check linear solvers
    if (word in (this.db.linearSolvers || {})) {
      const s = this.db.linearSolvers[word];
      let md = `### ${word}\n*Linear solver*\n\n${s.brief || ''}\n\n**Keywords:**\n`;
      for (const [k, v] of Object.entries(s.keywords || {})) {
        const req = v.required ? ' *(required)*' : v.default !== undefined ? ` *(default: ${v.default})*` : '';
        md += `- \`${k}\`${req}\n`;
      }
      return md;
    }

    // Check boundary conditions
    if (word in (this.db.boundaryConditions || {})) {
      const bc = this.db.boundaryConditions[word];
      let md = `### ${word}\n*Boundary condition*\n\n${bc.brief || ''}\n\n**Applies to:** ${bc.appliesTo?.join(', ')}\n`;
      if (Object.keys(bc.keywords || {}).length) {
        md += '\n**Keywords:**\n';
        for (const [k, v] of Object.entries(bc.keywords)) {
          const req = v.required ? ' *(required)*' : '';
          md += `- \`${k}\`${req}\n`;
        }
      }
      return md;
    }

    // Turbulence models
    for (const [regime, models] of Object.entries(this.db.turbulenceModels || {})) {
      if (word in models) {
        const m = (models as Record<string, TurbModel>)[word];
        let md = `### ${word}\n*${regime} turbulence model*\n\n${m.brief || ''}`;
        if (m.requiredFields?.length) md += `\n\n**Required fields:** ${m.requiredFields.join(', ')}`;
        if (Object.keys(m.coefficients || {}).length) {
          md += '\n\n**Coefficients:**\n';
          for (const [k, v] of Object.entries(m.coefficients)) {
            md += `- \`${k}\` = ${v.default ?? '?'}\n`;
          }
        }
        return md;
      }
    }

    // controlDict keywords
    if (word in (this.db.controlDict || {})) {
      const f = this.db.controlDict[word];
      let md = `### ${word}\n*controlDict*\n\n${f.description || ''}`;
      if (f.options?.length) md += `\n\n**Valid values:** ${f.options.map(o => `\`${o}\``).join(', ')}`;
      if (f.default !== undefined) md += `\n\n**Default:** \`${f.default}\``;
      return md;
    }

    return null;
  }

  // ── Completion ────────────────────────────────────────────────────────────
  private onCompletion(params: TextDocumentPositionParams): CompletionItem[] {
    const doc = this.docs.get(params.textDocument.uri);
    if (!doc || !this.db) return [];

    const ctx = this.getCursorContext(doc, params.position);
    const items: CompletionItem[] = [];

    const addSchemes = (cat: string) => {
      const members = this.db.schemes?.[cat] || {};
      for (const [name, info] of Object.entries(members)) {
        items.push({
          label: name,
          kind: CompletionItemKind.Function,
          detail: info.brief || info.format,
          insertText: this.schemeSnippet(name, info),
          insertTextFormat: 2,
        });
      }
    };

    const addKeywords = (spec: Record<string, FieldSpec>, kind = CompletionItemKind.Property) => {
      for (const [kw, info] of Object.entries(spec)) {
        items.push({
          label: kw,
          kind,
          detail: info.description || (info.options ? info.options.join(' | ') : ''),
          insertText: this.fieldSnippet(kw, info),
          insertTextFormat: 2,
        });
      }
    };

    const top = ctx.blockPath[0] || '';
    const sub = ctx.blockPath[1] || '';

    if (ctx.fileType === 'fvSchemes') {
      if (!top || top === 'fvSchemes') {
        // Offer sub-dict names
        for (const k of Object.keys(BLOCK_TO_SCHEME)) items.push({ label: k, kind: CompletionItemKind.Module, insertText: `${k}\n{\n    default         $1;\n}\n`, insertTextFormat: 2 });
      } else {
        const cat = BLOCK_TO_SCHEME[top];
        if (cat) {
          addSchemes(cat);
          items.push({ label: 'default', kind: CompletionItemKind.Keyword, insertText: 'default         $1;', insertTextFormat: 2 });
        }
      }
    } else if (ctx.fileType === 'fvSolution') {
      if (top === 'solvers') {
        // Offer solver names
        for (const [name, info] of Object.entries(this.db.linearSolvers || {})) {
          items.push({ label: name, kind: CompletionItemKind.Method, detail: info.brief });
        }
        if (!sub) {
          addKeywords({ solver: {type:'word'}, tolerance: {type:'scalar'}, relTol: {type:'scalar'} });
        }
      } else if (['SIMPLE','PIMPLE','PISO','FLUID'].includes(top)) {
        addKeywords((this.db.algorithms?.[top] as AlgoInfo)?.keywords || {});
      } else {
        for (const k of ['solvers','relaxationFactors','SIMPLE','PIMPLE','PISO','FLUID'])
          items.push({ label: k, kind: CompletionItemKind.Module });
      }
    } else if (ctx.fileType === 'controlDict') {
      addKeywords(this.db.controlDict || {});
    } else if (ctx.fileType === 'turbulenceProperties') {
      if (top === 'RAS') {
        for (const [n, m] of Object.entries(this.db.turbulenceModels?.RAS || {}))
          items.push({ label: n, kind: CompletionItemKind.Class, detail: m.brief });
        addKeywords({ turbulence: {type:'boolean'}, printCoeffs: {type:'boolean'} });
      } else if (top === 'LES') {
        for (const [n, m] of Object.entries(this.db.turbulenceModels?.LES || {}))
          items.push({ label: n, kind: CompletionItemKind.Class, detail: m.brief });
        addKeywords({ turbulence: {type:'boolean'}, delta: {type:'word'} });
      } else {
        items.push({ label: 'simulationType', kind: CompletionItemKind.Property, insertText: 'simulationType  ${1|RAS,LES,laminar|};', insertTextFormat: 2 });
        items.push({ label: 'RAS', kind: CompletionItemKind.Module, insertText: 'RAS\n{\n    RASModel        $1;\n    turbulence      on;\n    printCoeffs     on;\n}\n', insertTextFormat: 2 });
        items.push({ label: 'LES', kind: CompletionItemKind.Module, insertText: 'LES\n{\n    LESModel        $1;\n    turbulence      on;\n    delta           cubeRootVol;\n}\n', insertTextFormat: 2 });
      }
    } else if (ctx.fileType === 'boundaryField') {
      if (ctx.currentKey === 'type' || sub === 'type') {
        for (const [n, bc] of Object.entries(this.db.boundaryConditions || {}))
          items.push({ label: n, kind: CompletionItemKind.Class, detail: bc.brief });
      } else {
        items.push({ label: 'type', kind: CompletionItemKind.Property, insertText: 'type            $1;', insertTextFormat: 2 });
        items.push({ label: 'value', kind: CompletionItemKind.Property, insertText: 'value           ${1|uniform,nonuniform|} $2;', insertTextFormat: 2 });
      }
    } else if (ctx.fileType === 'blockMeshDict') {
      addKeywords(this.db.blockMesh || {});
    } else if (ctx.fileType === 'decomposeParDict') {
      addKeywords(this.db.decomposePar || {});
    } else if (ctx.fileType === 'snappyHexMeshDict') {
      addKeywords(this.db.snappyHexMesh || {});
    } else {
      // General: offer everything
      for (const cat of Object.values(BLOCK_TO_SCHEME)) addSchemes(cat);
      addKeywords(this.db.controlDict || {});
    }

    return items;
  }

  private schemeSnippet(name: string, info: SchemeInfo): string {
    if (!info.arguments?.length) return name;
    let sn = name;
    info.arguments.forEach((a, i) => {
      if (a.type === 'scheme' && a.schemeCategory) {
        const opts = Object.keys(this.db.schemes?.[a.schemeCategory] || {});
        sn += ` \${${i+1}|${opts.join(',')}|}`;
      } else if (a.range) {
        sn += ` \${${i+1}:${a.range[0]}}`;
      } else {
        sn += ` \${${i+1}:${a.name}}`;
      }
    });
    return sn;
  }

  private fieldSnippet(kw: string, spec: FieldSpec): string {
    if (spec.options?.length) return `${kw}        \${1|${spec.options.join(',')}|};`;
    if (spec.type === 'boolean') return `${kw}        \${1|on,off|};`;
    if (spec.type === 'dict')    return `${kw}\n{\n    $1\n}\n`;
    if (spec.default !== undefined) return `${kw}        ${spec.default};`;
    return `${kw}        \${1:${spec.type || 'value'}};`;
  }

  // ── Signature Help ────────────────────────────────────────────────────────
  private onSigHelp(params: TextDocumentPositionParams): SignatureHelp | null {
    const doc = this.docs.get(params.textDocument.uri);
    if (!doc || !this.db) return null;

    const text   = doc.getText();
    const offset = doc.offsetAt(params.position);
    const before = text.slice(0, offset);
    const lineStart = before.lastIndexOf('\n') + 1;
    const line  = before.slice(lineStart);
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 1) return null;

    const schemeName = tokens[0];
    const argIndex   = tokens.length - 1;  // 0 = just typed scheme name, 1 = first arg ...

    for (const members of Object.values(this.db.schemes || {})) {
      if (schemeName in members) {
        const info = members[schemeName];
        const label = info.format;
        const params_: ParameterInformation[] = info.arguments.map(a => ({
          label: a.name,
          documentation: {
            kind: MarkupKind.Markdown,
            value: a.schemeCategory
              ? `Valid ${a.schemeCategory} names: ${Object.keys(this.db.schemes?.[a.schemeCategory] || {}).slice(0,8).join(', ')}, ...`
              : a.range ? `Scalar, range: ${a.range[0]}..${a.range[1]}` : a.description || a.type,
          },
        }));
        return {
          signatures: [{ label, documentation: { kind: MarkupKind.Markdown, value: info.brief || '' }, parameters: params_ }],
          activeSignature: 0,
          activeParameter: Math.max(0, argIndex - 1),
        } as SignatureHelp;
      }
    }
    return null;
  }

  // ── Diagnostics ───────────────────────────────────────────────────────────
  private scheduleDiagnostics(doc: TextDocument) {
    const key = doc.uri;
    if (this.debounce.has(key)) clearTimeout(this.debounce.get(key)!);
    this.debounce.set(key, setTimeout(() => {
      this.debounce.delete(key);
      const diags = this.diagnose(doc);
      this.conn.sendDiagnostics({ uri: doc.uri, diagnostics: diags });
    }, 300));
  }

  private diagnose(doc: TextDocument): Diagnostic[] {
    if (!this.db) return [];
    const diags: Diagnostic[] = [];
    const ft = this.detectFileType(doc);
    const text = doc.getText();

    const addDiag = (line: number, msg: string, sev: DiagnosticSeverity) => {
      const r: Range = { start: { line, character: 0 }, end: { line, character: 1000 } };
      diags.push({ range: r, message: msg, severity: sev, source: 'openfoam' });
    };

    // Generic: unclosed braces
    let depth = 0;
    let lastOpenLine = 0;
    const lines = text.split('\n');
    for (let li = 0; li < lines.length; li++) {
      const ln = stripComments(lines[li]);
      for (const ch of ln) {
        if (ch === '{') { depth++; lastOpenLine = li; }
        if (ch === '}') depth--;
      }
    }
    if (depth > 0) addDiag(lastOpenLine, `Unclosed '{' block (${depth} unclosed)`, DiagnosticSeverity.Error);
    if (depth < 0) addDiag(lines.length - 1, `Extra '}' (${-depth} too many)`, DiagnosticSeverity.Error);

    // FoamFile header check
    if (!text.includes('FoamFile')) {
      addDiag(0, 'Missing FoamFile header block', DiagnosticSeverity.Warning);
    }

    if (ft === 'fvSchemes') this.diagFvSchemes(lines, diags);
    if (ft === 'fvSolution') this.diagFvSolution(lines, diags);
    if (ft === 'controlDict') this.diagControlDict(lines, diags);
    if (ft === 'turbulenceProperties') this.diagTurbulence(text, lines, diags);

    return diags;
  }

  private diagFvSchemes(lines: string[], diags: Diagnostic[]) {
    let currentBlock = '';
    for (let li = 0; li < lines.length; li++) {
      const ln = stripComments(lines[li]).trim();
      const blockM = ln.match(/^(\w+)\s*\{/);
      if (blockM) { currentBlock = blockM[1]; continue; }
      if (ln === '}') { currentBlock = ''; continue; }

      const cat = BLOCK_TO_SCHEME[currentBlock];
      if (!cat) continue;

      const m = ln.match(/^([\w.*()]+)\s+(\w+)(?:\s+(.*))?;/);
      if (!m) continue;
      const schemeName = m[2];
      if (schemeName === 'default' || schemeName === 'none') continue;
      const validSchemes = Object.keys(this.db.schemes?.[cat] || {});
      if (validSchemes.length && !validSchemes.includes(schemeName)) {
        const r: Range = { start: { line: li, character: 0 }, end: { line: li, character: lines[li].length } };
        diags.push({ range: r, severity: DiagnosticSeverity.Error,
          message: `'${schemeName}' is not a valid ${cat}. Valid: ${validSchemes.slice(0,10).join(', ')}...`,
          source: 'openfoam' });
      }
    }
  }

  private diagFvSolution(lines: string[], diags: Diagnostic[]) {
    const ALGO_BLOCKS = new Set(['SIMPLE','PIMPLE','PISO','FLUID']);
    let currentBlock = '';
    let nOuterCorrSeen = false;

    for (let li = 0; li < lines.length; li++) {
      const ln = stripComments(lines[li]).trim();
      const blockM = ln.match(/^(\w+)\s*\{/);
      if (blockM) { currentBlock = blockM[1]; nOuterCorrSeen = false; continue; }
      if (ln === '}') {
        if (currentBlock === 'PIMPLE' && !nOuterCorrSeen) {
          const r: Range = { start: { line: li, character: 0 }, end: { line: li, character: 0 } };
          diags.push({ range: r, severity: DiagnosticSeverity.Error,
            message: 'PIMPLE block requires nOuterCorrectors', source: 'openfoam' });
        }
        currentBlock = ''; continue;
      }
      if (ln.includes('nOuterCorrectors')) nOuterCorrSeen = true;

      if (currentBlock === 'solvers') {
        const solverM = ln.match(/^solver\s+(\w+)\s*;/);
        if (solverM) {
          const sname = solverM[1];
          if (!(sname in (this.db.linearSolvers || {}))) {
            const r: Range = { start: { line: li, character: 0 }, end: { line: li, character: lines[li].length } };
            const valid = Object.keys(this.db.linearSolvers || {});
            diags.push({ range: r, severity: DiagnosticSeverity.Error,
              message: `Unknown solver '${sname}'. Valid: ${valid.join(', ')}`, source: 'openfoam' });
          }
        }
      }
    }
  }

  private diagControlDict(lines: string[], diags: Diagnostic[]) {
    let hasAdjustTimeStep = false;
    let hasMaxCo = false;
    let writeControl = '';
    let hasWriteInterval = false;

    for (let li = 0; li < lines.length; li++) {
      const ln = stripComments(lines[li]).trim();
      if (/^adjustTimeStep\s+(yes|true|on)/i.test(ln)) hasAdjustTimeStep = true;
      if (/^maxCo\b/.test(ln)) hasMaxCo = true;
      const wcm = ln.match(/^writeControl\s+(\w+)/);
      if (wcm) writeControl = wcm[1];
      if (/^writeInterval\b/.test(ln)) hasWriteInterval = true;
    }

    if (hasAdjustTimeStep && !hasMaxCo)
      diags.push({ range: { start:{line:0,character:0}, end:{line:0,character:0} },
        severity: DiagnosticSeverity.Warning,
        message: 'adjustTimeStep is enabled but maxCo is not set', source: 'openfoam' });

    if (writeControl === 'runTime' && !hasWriteInterval)
      diags.push({ range: { start:{line:0,character:0}, end:{line:0,character:0} },
        severity: DiagnosticSeverity.Error,
        message: "writeControl is 'runTime' but writeInterval is missing", source: 'openfoam' });
  }

  private diagTurbulence(text: string, lines: string[], diags: Diagnostic[]) {
    const simTypeM = text.match(/simulationType\s+(\w+)\s*;/);
    if (!simTypeM) return;
    const simType = simTypeM[1];  // RAS, LES, laminar

    if (simType === 'RAS' && !text.includes('RAS\n') && !text.match(/\bRAS\s*\{/)) {
      diags.push({ range: { start:{line:0,character:0}, end:{line:0,character:0} },
        severity: DiagnosticSeverity.Error,
        message: "simulationType is RAS but no RAS { } block found", source: 'openfoam' });
    }

    const modelM = text.match(/RASModel\s+(\w+)\s*;/);
    if (modelM) {
      const name = modelM[1];
      if (!(name in (this.db.turbulenceModels?.RAS || {}))) {
        const valid = Object.keys(this.db.turbulenceModels?.RAS || {});
        for (let li = 0; li < lines.length; li++) {
          if (lines[li].includes('RASModel') && lines[li].includes(name)) {
            diags.push({ range: { start:{line:li,character:0}, end:{line:li,character:lines[li].length} },
              severity: DiagnosticSeverity.Error,
              message: `Unknown RASModel '${name}'. Valid: ${valid.join(', ')}`, source: 'openfoam' });
          }
        }
      }
    }
  }

  // ── Utilities ─────────────────────────────────────────────────────────────
  private wordAt(doc: TextDocument, pos: Position): string | null {
    const text = doc.getText();
    const off  = doc.offsetAt(pos);
    let s = off; while (s > 0 && /\w/.test(text[s-1])) s--;
    let e = off; while (e < text.length && /\w/.test(text[e])) e++;
    return s === e ? null : text.slice(s, e);
  }
}

// ── File-type lookup table ────────────────────────────────────────────────────
const FT_MAP: Record<string, OpenFOAMFileType> = {
  fvSchemes: "fvSchemes", fvSolution: "fvSolution", controlDict: "controlDict",
  blockMeshDict: "blockMeshDict", snappyHexMeshDict: "snappyHexMeshDict",
  decomposeParDict: "decomposeParDict", turbulenceProperties: "turbulenceProperties",
  transportProperties: "transportProperties",
  thermophysicalProperties: "thermophysicalProperties",
  momentumTransport: "turbulenceProperties",
  U: "boundaryField", p: "boundaryField", k: "boundaryField",
  epsilon: "boundaryField", omega: "boundaryField", nut: "boundaryField",
  nuTilda: "boundaryField", T: "boundaryField", alpha: "boundaryField",
  "alpha.water": "boundaryField", "p_rgh": "boundaryField",
};

function stripComments(line: string): string {
  const i = line.indexOf('//');
  return i >= 0 ? line.slice(0, i) : line;
}

// ── Start ──────────────────────────────────────────────────────────────────
const server = new OpenFOAMLanguageServer();
server.listen();
