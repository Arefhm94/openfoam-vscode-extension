# Implementation Prompt: Node-Based UI for OpenFOAM Workflows

## What You Are Building

A drag-and-drop visual node graph editor embedded inside a VS Code webview panel. Each node represents one stage of an OpenFOAM simulation pipeline. Edges between nodes represent data flow and dependency. The graph serializes to JSON, persists across sessions, and drives actual command execution from the extension host.

This is not a mockup. Every node must be able to generate real OpenFOAM dict files and execute real commands. The UI is the configuration surface; the extension host is the execution engine.

---

## Frontend Stack

Use **React + React Flow + esbuild**. This is the right choice for a VS Code webview for these specific reasons:

- React Flow handles node/edge rendering, port connections, zoom/pan, minimap, and selection out of the box — roughly 6 weeks of canvas work you don't have to write.
- esbuild produces a single bundled JS file that satisfies VS Code's strict Content Security Policy (no dynamic imports, no CDN scripts).
- TypeScript throughout — shared types between the webview and the extension host via a `shared/types.ts` file imported by both.

Do not use Vite (overkill for a single-page webview). Do not use the CDN-loaded React from `cdnjs` — it breaks under VS Code's CSP.

**Build setup:**
```
src/
  webview/                # React app — compiled separately from the extension
    nodes/                # One .tsx file per node type
    ports/                # Port type definitions and renderers
    stores/               # Zustand state (graph, execution, validation)
    hooks/                # useVSCode, useValidation, useExecution
    utils/                # Serialization, layout helpers
    App.tsx
    main.tsx
  shared/
    types.ts              # Shared between webview and extension host
  extension.ts
  workflow/WorkflowPanel.ts

out/webview/bundle.js     # Output: single file, no external deps
out/webview/bundle.css
```

**esbuild config (`build-webview.js`):**
```javascript
const esbuild = require("esbuild");
esbuild.build({
  entryPoints: ["src/webview/main.tsx"],
  bundle: true,
  outfile: "out/webview/bundle.js",
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: process.env.NODE_ENV === "production",
  sourcemap: process.env.NODE_ENV !== "production",
  define: { "process.env.NODE_ENV": `"${process.env.NODE_ENV || "development"}"` },
  external: [],            // Bundle everything — no external scripts in webview
}).catch(() => process.exit(1));
```

Add to `package.json` scripts:
```json
"build:webview": "node build-webview.js",
"watch:webview": "NODE_ENV=development node build-webview.js --watch",
"compile": "tsc -b && npm run build:webview"
```

---

## Shared Type System

Put this in `src/shared/types.ts`. Both the webview and the extension host import from here. The TypeScript compiler handles the split — esbuild picks up the webview side, tsc picks up the extension side.

```typescript
// src/shared/types.ts

export type NodeState = "idle" | "queued" | "running" | "done" | "error" | "skipped";

export type PortDataType =
  | "mesh"        // polyMesh directory
  | "field"       // 0/U, 0/p etc.
  | "config"      // a dict file (fvSchemes, fvSolution, etc.)
  | "surface"     // STL or triSurface file
  | "edgeMesh"    // .eMesh feature edge file
  | "scalar"      // a plain number propagated between nodes
  | "log";        // stdout/stderr stream reference

export interface PortDefinition {
  id: string;
  label: string;
  dataType: PortDataType;
  required: boolean;
  multiple: boolean;        // true if multiple edges can connect (e.g., surfaces)
}

export interface ParameterSpec {
  key: string;
  label: string;
  type: "scalar" | "integer" | "boolean" | "string" | "vector" | "enum" | "path";
  defaultValue: unknown;
  options?: string[];       // for enum type
  unit?: string;            // display only, e.g. "m/s", "Pa"
  min?: number;
  max?: number;
  required: boolean;
  description: string;
}

export interface ParameterValue {
  value: unknown;
  source: "manual" | "connected";   // connected = driven by incoming edge
  connectedFrom?: string;            // edgeId if source === "connected"
}

export interface ValidationError {
  field: string;            // parameter key or "connection"
  message: string;
  severity: "error" | "warning";
}

export interface WorkflowNode {
  id: string;
  type: string;             // matches NodeDefinition.type
  label: string;
  position: { x: number; y: number };
  parameters: Record<string, ParameterValue>;
  state: NodeState;
  errorMessage?: string;    // set when state === "error"
}

export interface WorkflowEdge {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
  dataType: PortDataType;
}

export interface WorkflowGraph {
  version: "1.0";
  savedAt: string;
  caseRoot: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

// Messages: webview → extension host
export type WebviewMessage =
  | { command: "ready" }
  | { command: "scanCase" }
  | { command: "saveGraph"; graph: WorkflowGraph }
  | { command: "runNode"; nodeId: string }
  | { command: "runAll" }
  | { command: "stopNode"; nodeId: string }
  | { command: "openFile"; path: string }
  | { command: "validateGraph"; graph: WorkflowGraph }
  | { command: "generateFiles"; nodeId: string };

// Messages: extension host → webview
export type ExtensionMessage =
  | { command: "graphLoaded"; graph: WorkflowGraph }
  | { command: "caseScanned"; caseRoot: string; existingFiles: string[] }
  | { command: "nodeStateChanged"; nodeId: string; state: NodeState; errorMessage?: string }
  | { command: "logLine"; nodeId: string; line: string; stream: "stdout" | "stderr" }
  | { command: "validationResult"; nodeId: string; errors: ValidationError[] }
  | { command: "filesGenerated"; nodeId: string; files: string[] };
```

---

## Node Definition Registry

Every node type is a `NodeDefinition` object. They live in `src/webview/nodes/`. The registry is a plain `Map` populated at startup. This is how you add new node types without touching any framework code.

```typescript
// src/webview/nodes/registry.ts

export interface NodeDefinition {
  type: string;
  label: string;
  category: "mesh" | "solver" | "boundary" | "postprocess" | "utility";
  description: string;
  icon: string;                          // VS Code codicon name, e.g. "symbol-method"
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  parameters: ParameterSpec[];
  defaultLabel: string;                  // Pre-filled label on new node creation

  // Runs in webview — returns errors/warnings shown as badges on the node.
  // Called on every parameter change, debounced 200ms.
  validate(node: WorkflowNode, graph: WorkflowGraph): ValidationError[];

  // Runs in extension host — generates the dict file(s) for this node.
  // Called when user clicks "Generate Files" or "Run".
  // Returns relative paths of files written (e.g., ["system/fvSolution"]).
  generateFiles(node: WorkflowNode, caseRoot: string): Promise<string[]>;

  // Runs in extension host — returns the shell command to execute.
  // Returns null if this node type has no executable (e.g., a config-only node).
  getExecuteCommand(node: WorkflowNode, caseRoot: string): string | null;
}

export const nodeRegistry = new Map<string, NodeDefinition>();

export function registerNode(def: NodeDefinition): void {
  if (nodeRegistry.has(def.type)) {
    console.warn(`Node type "${def.type}" already registered — overwriting`);
  }
  nodeRegistry.set(def.type, def);
}

export function getNodeDef(type: string): NodeDefinition {
  const def = nodeRegistry.get(type);
  if (!def) { throw new Error(`Unknown node type: "${type}"`); }
  return def;
}
```

**Example node definition — `FvSolution`:**

```typescript
// src/webview/nodes/FvSolutionNode.ts
import { registerNode } from "./registry";

registerNode({
  type: "FvSolution",
  label: "fvSolution",
  category: "solver",
  description: "Linear solver settings and SIMPLE/PIMPLE/PISO algorithm control",
  icon: "settings-gear",
  defaultLabel: "Solver Settings",
  inputs: [],
  outputs: [
    { id: "config", label: "fvSolution config", dataType: "config", required: false, multiple: false }
  ],
  parameters: [
    {
      key: "algorithm",
      label: "Algorithm",
      type: "enum",
      options: ["SIMPLE", "PIMPLE", "PISO"],
      defaultValue: "SIMPLE",
      required: true,
      description: "Pressure-velocity coupling algorithm"
    },
    {
      key: "nOuterCorrectors",
      label: "Outer Correctors",
      type: "integer",
      defaultValue: 1,
      min: 1,
      max: 100,
      required: true,
      description: "PIMPLE outer iterations (1 = PISO mode)"
    },
    {
      key: "nCorrectors",
      label: "P-V Correctors",
      type: "integer",
      defaultValue: 2,
      min: 1,
      max: 10,
      required: true,
      description: "Inner pressure-velocity corrector loops"
    },
    {
      key: "nNonOrthogonalCorrectors",
      label: "Non-Ortho Correctors",
      type: "integer",
      defaultValue: 0,
      min: 0,
      max: 5,
      required: true,
      description: "Non-orthogonal mesh corrections (0 for orthogonal meshes)"
    },
    {
      key: "relaxP",
      label: "Pressure Relaxation",
      type: "scalar",
      defaultValue: 0.3,
      min: 0.01,
      max: 1.0,
      required: false,
      description: "Under-relaxation factor for pressure (SIMPLE only)"
    },
    {
      key: "relaxU",
      label: "Velocity Relaxation",
      type: "scalar",
      defaultValue: 0.7,
      min: 0.01,
      max: 1.0,
      required: false,
      description: "Under-relaxation factor for velocity equations (SIMPLE only)"
    },
  ],

  validate(node, _graph) {
    const errors: ValidationError[] = [];
    const algo = node.parameters.algorithm?.value as string;
    const nOuter = node.parameters.nOuterCorrectors?.value as number;
    if (algo === "PIMPLE" && nOuter === 1) {
      errors.push({
        field: "nOuterCorrectors",
        message: "nOuterCorrectors=1 makes PIMPLE behave identically to PISO. Use PISO directly or increase nOuterCorrectors.",
        severity: "warning"
      });
    }
    if (algo === "SIMPLE") {
      const relaxP = node.parameters.relaxP?.value as number;
      const relaxU = node.parameters.relaxU?.value as number;
      if (relaxP >= 0.5) {
        errors.push({ field: "relaxP", message: "Pressure relaxation ≥ 0.5 often causes divergence in SIMPLE", severity: "warning" });
      }
      if (relaxU >= 0.9) {
        errors.push({ field: "relaxU", message: "Velocity relaxation ≥ 0.9 may be unstable for SIMPLE", severity: "warning" });
      }
    }
    return errors;
  },

  async generateFiles(node, caseRoot) {
    const algo = node.parameters.algorithm?.value as string;
    const nOuter = node.parameters.nOuterCorrectors?.value ?? 1;
    const nCorr = node.parameters.nCorrectors?.value ?? 2;
    const nNonOrtho = node.parameters.nNonOrthogonalCorrectors?.value ?? 0;
    const relaxP = node.parameters.relaxP?.value ?? 0.3;
    const relaxU = node.parameters.relaxU?.value ?? 0.7;

    const algoBlock = algo === "SIMPLE"
      ? `SIMPLE\n{\n    nNonOrthogonalCorrectors ${nNonOrtho};\n    consistent      yes;\n}`
      : `PIMPLE\n{\n    nOuterCorrectors ${nOuter};\n    nCorrectors     ${nCorr};\n    nNonOrthogonalCorrectors ${nNonOrtho};\n}`;

    const relaxBlock = algo === "SIMPLE"
      ? `relaxationFactors\n{\n    fields { p ${relaxP}; }\n    equations { U ${relaxU}; }\n}`
      : "";

    const content = buildFoamFileHeader("dictionary", "fvSolution") +
      `\nsolvers\n{\n    p { solver GAMG; smoother GaussSeidel; tolerance 1e-6; relTol 0.1; }\n    U { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-8; relTol 0.1; }\n}\n\n` +
      algoBlock + "\n\n" + relaxBlock + "\n\n// ************************************************************************* //\n";

    const filePath = path.join(caseRoot, "system", "fvSolution");
    await fs.promises.writeFile(filePath, content, "utf-8");
    return ["system/fvSolution"];
  },

  getExecuteCommand(_node, _caseRoot) {
    return null;  // Config-only node, nothing to execute
  }
});
```

---

## Node Types — Complete Catalog

Register one file per node type in `src/webview/nodes/`. Each file calls `registerNode` at module load time.

### Mesh Nodes

**`BlockMesh`**
- Inputs: none
- Outputs: `mesh` (polyMesh)
- Parameters: xMin/xMax/yMin/yMax/zMin/zMax (scalars, meters), nx/ny/nz (integers), gradingX/Y/Z (scalars, default 1.0), `convertToMeters` (scalar, default 1.0)
- Validation: check that nx/ny/nz are positive; warn if any dimension is zero; warn if grading > 10 (extreme stretching).
- `getExecuteCommand`: `"blockMesh"`
- `generateFiles`: writes `system/blockMeshDict` using the parameter values. The dict structure is a simple hex block covering the domain bounding box.

**`SnappyHexMesh`**
- Inputs: `backgroundMesh` (mesh, required), `surfaces` (surface, required, multiple: true), `featureEdges` (edgeMesh, multiple: true)
- Outputs: `mesh` (mesh)
- Parameters: `castellatedMesh` (bool), `snap` (bool), `addLayers` (bool), `maxRefinementLevel` (integer, 1-8), `nSurfaceLayers` (integer), `expansionRatio` (scalar), `finalLayerThickness` (scalar), `locationInMesh` (vector)
- Validation: require at least one surface input; warn if `maxRefinementLevel > 6` (very large mesh); warn if `addLayers` is true but `nSurfaceLayers < 1`; error if `locationInMesh` is the zero vector (almost certainly wrong).
- `getExecuteCommand`: `"snappyHexMesh"`
- `generateFiles`: writes `system/snappyHexMeshDict`. The connected surface inputs provide the STL file names; feature edge inputs provide `.eMesh` file names. The generated dict includes `geometry {}`, `castellatedMeshControls {}`, `snapControls {}`, `addLayersControls {}`, `meshQualityControls {}` blocks filled from parameters.

**`SurfaceFeatureExtract`**
- Inputs: `surfaces` (surface, multiple: true)
- Outputs: `featureEdges` (edgeMesh)
- Parameters: `includedAngle` (scalar, default 150, range 0-180), `writeObj` (bool, default false)
- Validation: require at least one surface; warn if `includedAngle < 100` (too few features extracted) or `> 170` (too many, noise).
- `getExecuteCommand`: `"surfaceFeatureExtract"`
- `generateFiles`: writes `system/surfaceFeatureExtractDict` with one entry per connected surface.

**`CheckMesh`**
- Inputs: `mesh` (mesh, required)
- Outputs: `log` (log)
- Parameters: `writeAllTopology` (bool, default false), `noTopology` (bool, default false)
- No file generation.
- `getExecuteCommand`: `"checkMesh"`

**`DecomposePar`**
- Inputs: `mesh` (mesh, required)
- Outputs: `decomposedMesh` (mesh)
- Parameters: `method` (enum: scotch/simple/hierarchical/manual), `numberOfSubdomains` (integer, 1-1024), `simpleCoeffs_nx/ny/nz` (integers, visible only when method=simple), `hierarchicalCoeffs_n` (vector, visible only when method=hierarchical)
- Validation: `numberOfSubdomains` must be > 0; for `simple`, nx*ny*nz must equal numberOfSubdomains.
- `getExecuteCommand`: `"decomposePar"`
- `generateFiles`: writes `system/decomposeParDict`.

### Solver Nodes

**`Solver`**
- Inputs: `mesh` (mesh, required), `fvSchemes` (config), `fvSolution` (config), `initialConditions` (field, multiple: true)
- Outputs: `results` (field)
- Parameters: `solverName` (enum of all known solvers, e.g. simpleFoam/pimpleFoam/interFoam/...), `parallel` (bool), `nProcs` (integer, visible when parallel=true), `endTime` (scalar), `deltaT` (scalar), `writeInterval` (scalar), `writeControl` (enum: timeStep/runTime), `runTimeModifiable` (bool)
- Validation: require mesh input; if parallel=true, require that a DecomposePar node is upstream; warn if endTime < deltaT; error if endTime = 0.
- `getExecuteCommand`: returns `"simpleFoam"` or `"mpirun -np N pimpleFoam -parallel"` based on parameters.
- `generateFiles`: writes `system/controlDict` from the time control parameters.

**`FvSchemes`**
- Inputs: none
- Outputs: `config` (config)
- Parameters: `ddtScheme` (enum: Euler/backward/CrankNicolson/steadyState/localEuler), `gradScheme` (enum: Gauss linear/leastSquares/cellLimited Gauss linear 1), `divSchemeU` (enum: Gauss linearUpwind/Gauss linear/Gauss upwind/Gauss limitedLinear), `laplacianScheme` (enum: Gauss linear corrected/Gauss linear limited), `snGradScheme` (enum: corrected/limited corrected 0.5/uncorrected)
- Validation: warn if `ddtScheme=steadyState` but the connected solver is `pimpleFoam` or `interFoam` (those need a time scheme); warn if `ddtScheme=Euler` but solver is `simpleFoam` (steady-state doesn't use ddt).
- `getExecuteCommand`: null
- `generateFiles`: writes `system/fvSchemes`.

**`FvSolution`** — detailed example shown above.

### Boundary Condition Nodes

A `BoundaryCondition` node is parameterized by the field it configures. One node = one field on one patch. Multiple BC nodes feed into the same `Solver` node via the `initialConditions` port.

**`BoundaryCondition`**
- Inputs: none
- Outputs: `field` (field)
- Parameters:
  - `fieldName` (enum: U/p/p_rgh/k/epsilon/omega/nut/T/alpha.water/...)
  - `patchName` (string) — the boundary patch this BC applies to
  - `bcType` (enum — changes based on fieldName, see below)
  - Additional parameters that appear dynamically based on `bcType` selection:
    - `fixedValue`: shows a `value` parameter (vector for U, scalar for p, etc.)
    - `inletOutlet`: shows `inletValue` (same type as field)
    - `flowRateInletVelocity`: shows `volumetricFlowRate` (scalar, m³/s)
    - `turbulentIntensityKineticEnergyInlet`: shows `intensity` (scalar, fraction, e.g. 0.05)
    - `turbulentMixingLengthDissipationRateInlet`: shows `mixingLength` (scalar, meters)
    - `nutkWallFunction`, `kqRWallFunction`, `epsilonWallFunction`, `omegaWallFunction`: no extra parameters needed
- Validation: field/patchName combination must be unique across the graph (two BC nodes shouldn't configure the same field+patch). If fieldName is `k` and bcType is `fixedValue` with value ≤ 0, that's an error (k must be positive). If fieldName is `U` and bcType is `noSlip`, no value needed — show no value field.
- `getExecuteCommand`: null (BCs are written into field files, not executed separately)
- `generateFiles`: writes to `0/<fieldName>`. If multiple BC nodes target the same field, they each contribute their patch entry. The extension host must collect all BC nodes for a given field and write the complete file in one pass. This requires special handling — the `Solver` node's `generateFiles` collects all upstream BC nodes and assembles the `0/` directory.

**Implementation note on field file assembly:** The `Solver` node's `generateFiles` implementation must:
1. Traverse all upstream `BoundaryCondition` nodes by following edges backward from its `initialConditions` input.
2. Group them by `fieldName`.
3. For each field, collect all patch entries and write the complete `0/<field>` file with proper `internalField`, `dimensions`, and `boundaryField {}` block.
4. The `internalField` value comes from a separate `InitialConditions` node (see below) or defaults.

**`InitialConditions`**
- Inputs: none
- Outputs: `field` (field, multiple: false per output — one output port per field)
- Parameters: `fieldName`, `internalFieldType` (uniform/nonuniform), `internalValue` (scalar or vector depending on field)
- This node sets `internalField uniform X;` in the field file.

### Post-Processing Nodes

**`PostProcess`**
- Inputs: `results` (field, required)
- Outputs: none
- Parameters: `functionObjects` (multi-select enum: forces/wallShearStress/yPlus/fieldAverage/probes/...), `writeInterval` (scalar), `probeLocations` (list of vectors, visible if probes selected)
- `generateFiles`: appends or creates a `functions {}` block in `system/controlDict`.
- `getExecuteCommand`: null (function objects run inside the solver)

**`CheckMesh`** — see mesh nodes above.

**`ReconstructPar`**
- Inputs: `decomposedResults` (field, required)
- Outputs: `results` (field)
- Parameters: `latestTime` (bool, default true), `time` (scalar, visible when latestTime=false)
- `getExecuteCommand`: `"reconstructPar"` or `"reconstructPar -latestTime"`

---

## Graph State Management

Use Zustand. One store, three slices.

```typescript
// src/webview/stores/graphStore.ts
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

interface GraphState {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedNodeIds: Set<string>;
  history: WorkflowGraph[];       // for undo — last 50 states
  historyIndex: number;

  // Actions
  addNode: (type: string, position: { x: number; y: number }) => void;
  removeNode: (id: string) => void;
  updateNodeParameter: (nodeId: string, key: string, value: unknown) => void;
  addEdge: (edge: WorkflowEdge) => void;
  removeEdge: (id: string) => void;
  loadGraph: (graph: WorkflowGraph) => void;
  setNodeState: (nodeId: string, state: NodeState, errorMessage?: string) => void;
  undo: () => void;
  redo: () => void;
}
```

**Parameter propagation logic** lives in a `useEffect` that reacts to edge changes:

```typescript
// When an edge is added connecting sourcePort → targetPort:
// 1. Get the source node's current parameter value for sourcePortId
// 2. Set the target node's parameter[targetPortId].source = "connected"
// 3. Set the target node's parameter[targetPortId].connectedFrom = edgeId
// 4. Mirror the value: target.parameters[targetPortId].value = source.parameters[sourcePortId].value
// 5. When source changes, propagate downstream recursively (BFS traversal)

function propagateValues(
  changedNodeId: string,
  changedPortId: string,
  newValue: unknown,
  edges: WorkflowEdge[],
  updateFn: (nodeId: string, key: string, value: unknown) => void
): void {
  const outgoingEdges = edges.filter(
    e => e.sourceNodeId === changedNodeId && e.sourcePortId === changedPortId
  );
  for (const edge of outgoingEdges) {
    updateFn(edge.targetNodeId, edge.targetPortId, newValue);
    // Recurse — a propagated value can itself trigger further propagation
    propagateValues(edge.targetNodeId, edge.targetPortId, newValue, edges, updateFn);
  }
}
```

---

## Validation System

Validation runs on every parameter change. Debounce it at 200ms so it doesn't fire on every keystroke.

```typescript
// src/webview/hooks/useValidation.ts
import { useEffect, useRef } from "react";
import { useGraphStore } from "../stores/graphStore";

export function useValidation(nodeId: string) {
  const node = useGraphStore(s => s.nodes.find(n => n.id === nodeId));
  const graph = useGraphStore(s => ({ nodes: s.nodes, edges: s.edges }));
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!node) { return; }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const def = getNodeDef(node.type);
      const result = def.validate(node, graph as WorkflowGraph);
      setErrors(result);
      // Also send to extension host for cross-file validation
      vscode.postMessage({ command: "validateGraph", graph: graph as WorkflowGraph });
    }, 200);
    return () => clearTimeout(timerRef.current);
  }, [node, graph]);

  return errors;
}
```

**Validation badge rendering:** Each `NodeCard` component shows a badge in the top-right corner:
- No errors → no badge
- Warnings only → yellow triangle with count
- Any errors → red circle with count
- Tooltip on hover lists all messages

---

## Execution Engine (Extension Host)

The execution logic lives entirely in `WorkflowPanel.ts` (extension host), not in the webview. The webview only sends commands and receives state updates.

```typescript
// src/workflow/executionEngine.ts

export class ExecutionEngine {
  private runningProcesses = new Map<string, ChildProcess>();

  async runNode(
    nodeId: string,
    graph: WorkflowGraph,
    caseRoot: string,
    panel: vscode.WebviewPanel
  ): Promise<void> {
    const node = graph.nodes.find(n => n.id === nodeId);
    if (!node) { return; }
    const def = getNodeDef(node.type);

    // 1. Generate files first
    this.sendState(panel, nodeId, "running");
    try {
      const files = await def.generateFiles(node, caseRoot);
      this.sendMessage(panel, { command: "filesGenerated", nodeId, files });
    } catch (err) {
      this.sendState(panel, nodeId, "error", String(err));
      return;
    }

    // 2. Execute command if there is one
    const cmd = def.getExecuteCommand(node, caseRoot);
    if (!cmd) {
      this.sendState(panel, nodeId, "done");
      return;
    }

    // 3. Spawn process
    const [executable, ...args] = cmd.split(" ");
    const proc = spawn(executable, args, {
      cwd: caseRoot,
      env: { ...process.env },
    });

    this.runningProcesses.set(nodeId, proc);

    proc.stdout.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        this.sendMessage(panel, { command: "logLine", nodeId, line, stream: "stdout" });
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        this.sendMessage(panel, { command: "logLine", nodeId, line, stream: "stderr" });
      }
    });

    await new Promise<void>((resolve) => {
      proc.on("close", (code) => {
        this.runningProcesses.delete(nodeId);
        if (code === 0) {
          this.sendState(panel, nodeId, "done");
        } else {
          this.sendState(panel, nodeId, "error", `Process exited with code ${code}`);
        }
        resolve();
      });
    });
  }

  stopNode(nodeId: string): void {
    this.runningProcesses.get(nodeId)?.kill("SIGTERM");
    this.runningProcesses.delete(nodeId);
  }

  // Topological sort of the graph, then run each node in order
  async runAll(graph: WorkflowGraph, caseRoot: string, panel: vscode.WebviewPanel): Promise<void> {
    const order = topologicalSort(graph);
    for (const nodeId of order) {
      await this.runNode(nodeId, graph, caseRoot, panel);
      const node = graph.nodes.find(n => n.id === nodeId);
      if (node?.state === "error") {
        break;   // Stop the pipeline on first failure
      }
    }
  }

  private sendState(panel: vscode.WebviewPanel, nodeId: string, state: NodeState, errorMessage?: string): void {
    this.sendMessage(panel, { command: "nodeStateChanged", nodeId, state, errorMessage });
  }

  private sendMessage(panel: vscode.WebviewPanel, msg: ExtensionMessage): void {
    panel.webview.postMessage(msg);
  }
}

// Kahn's algorithm for topological sort
function topologicalSort(graph: WorkflowGraph): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }
  for (const edge of graph.edges) {
    inDegree.set(edge.targetNodeId, (inDegree.get(edge.targetNodeId) ?? 0) + 1);
    adjacency.get(edge.sourceNodeId)!.push(edge.targetNodeId);
  }

  const queue = graph.nodes.filter(n => inDegree.get(n.id) === 0).map(n => n.id);
  const result: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) { queue.push(neighbor); }
    }
  }

  if (result.length !== graph.nodes.length) {
    throw new Error("Graph contains a cycle — cannot execute");
  }
  return result;
}
```

---

## Canvas Component

The main `App.tsx` wraps React Flow and adds the toolbar, log panel, and node palette.

```typescript
// src/webview/App.tsx — structure only, fill in styling and details

import ReactFlow, {
  Background, Controls, MiniMap,
  useNodesState, useEdgesState,
  addEdge, Connection, Edge, Node
} from "reactflow";
import "reactflow/dist/style.css";
import { NodePalette } from "./components/NodePalette";
import { LogPanel } from "./components/LogPanel";
import { NodeCard } from "./components/NodeCard";
import { useVSCode } from "./hooks/useVSCode";

// Map node types to custom React components
const nodeTypes = Object.fromEntries(
  Array.from(nodeRegistry.values()).map(def => [def.type, NodeCard])
);

export function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const { postMessage, lastMessage } = useVSCode();

  // Handle messages from extension host
  useEffect(() => {
    if (!lastMessage) { return; }
    switch (lastMessage.command) {
      case "graphLoaded":
        setNodes(lastMessage.graph.nodes.map(toRFNode));
        setEdges(lastMessage.graph.edges.map(toRFEdge));
        break;
      case "nodeStateChanged":
        setNodes(prev => prev.map(n =>
          n.id === lastMessage.nodeId
            ? { ...n, data: { ...n.data, state: lastMessage.state, errorMessage: lastMessage.errorMessage } }
            : n
        ));
        break;
    }
  }, [lastMessage]);

  // Validate connections before allowing them
  function isValidConnection(connection: Connection): boolean {
    const sourceDef = nodeRegistry.get(getNodeType(connection.source));
    const targetDef = nodeRegistry.get(getNodeType(connection.target));
    if (!sourceDef || !targetDef) { return false; }
    const sourcePort = sourceDef.outputs.find(p => p.id === connection.sourceHandle);
    const targetPort = targetDef.inputs.find(p => p.id === connection.targetHandle);
    if (!sourcePort || !targetPort) { return false; }
    return sourcePort.dataType === targetPort.dataType;  // Type must match
  }

  function onConnect(params: Connection) {
    if (!isValidConnection(params)) { return; }
    setEdges(prev => addEdge({ ...params, type: "smoothstep", animated: false }, prev));
    // Trigger parameter propagation
    propagateOnConnect(params, nodes);
    // Auto-save
    postMessage({ command: "saveGraph", graph: buildGraph(nodes, edges) });
  }

  return (
    <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
      <Toolbar onRunAll={() => postMessage({ command: "runAll" })} />
      <div style={{ flex: 1, display: "flex" }}>
        <NodePalette />
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          isValidConnection={isValidConnection}
          fitView
          snapToGrid
          snapGrid={[20, 20]}
        >
          <Background variant="dots" gap={20} size={1} />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
      <LogPanel />
    </div>
  );
}
```

---

## Drag-and-Drop Node Creation

**Node Palette (`NodePalette.tsx`):**
- Renders a vertical sidebar on the left.
- Groups node types by category (Mesh / Solver / Boundary / PostProcess).
- Each item is a draggable `<div>` with `draggable={true}` and `onDragStart` that sets `event.dataTransfer.setData("application/nodeType", def.type)`.
- The React Flow canvas has `onDrop` and `onDragOver` handlers:

```typescript
function onDrop(event: React.DragEvent) {
  event.preventDefault();
  const nodeType = event.dataTransfer.getData("application/nodeType");
  if (!nodeType) { return; }
  const position = reactFlowInstance.screenToFlowPosition({
    x: event.clientX,
    y: event.clientY,
  });
  const def = getNodeDef(nodeType);
  const newNode: WorkflowNode = {
    id: `${nodeType}_${Date.now()}`,
    type: nodeType,
    label: def.defaultLabel,
    position,
    parameters: Object.fromEntries(
      def.parameters.map(p => [p.key, { value: p.defaultValue, source: "manual" }])
    ),
    state: "idle",
  };
  setNodes(prev => [...prev, toRFNode(newNode)]);
  postMessage({ command: "saveGraph", graph: buildGraph([...nodes, newNode], edges) });
}
```

**Right-click context menu** (add via `onContextMenu` on the pane):
- "Add Node" → opens a `<dialog>` with a fuzzy-search input over all registered node types.
- Implemented with a simple filtered list, no external library needed.

---

## Serialization

Serialization is straightforward because `WorkflowGraph` is pure data. The graph is saved automatically on every change (debounced 1s to avoid hammering disk).

```typescript
// Save: webview → extension host
function autoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    postMessage({ command: "saveGraph", graph: buildGraph(nodes, edges) });
  }, 1000);
}

// Extension host receives it and writes to disk:
case "saveGraph":
  const graphPath = path.join(caseRoot, ".vscode", "openfoam-workflow.json");
  await fs.promises.mkdir(path.dirname(graphPath), { recursive: true });
  await fs.promises.writeFile(graphPath, JSON.stringify(message.graph, null, 2));
  break;
```

**Load on panel open:** `WorkflowPanel.ts` reads `.vscode/openfoam-workflow.json` and sends `{ command: "graphLoaded", graph }` to the webview. If the file doesn't exist, send an empty graph.

**Import from existing case:** When `scanCase` is received and there's no workflow JSON, infer a starter graph from what files exist on disk:
- `system/blockMeshDict` found → create a `BlockMesh` node
- `system/snappyHexMeshDict` found → create a `SnappyHexMesh` node, wire it after BlockMesh
- `system/controlDict` found → read `application` field, create a `Solver` node with that solver name
- `0/` directory found → create `BoundaryCondition` nodes for each file found, but leave `patchName` blank (user must fill in)
- Connect nodes in the inferred order. Mark all as `state: "done"` since files already exist.

---

## UX Details

**Node card layout (NodeCard.tsx):**
- Header bar: node type icon + label (editable on double-click) + state ring (animated border on "running")
- Body: parameter fields rendered based on `ParameterSpec.type`. Enum → `<select>`. Scalar/integer → `<input type="number">`. Boolean → `<input type="checkbox">`. Vector → three `<input>` side by side labeled x/y/z. Path → `<input>` + browse button.
- Parameters with `source: "connected"` are grayed out and show a link icon.
- Validation badge: top-right corner, click to expand error list.
- Footer: "Generate Files" button + "Run" button (if node has an execute command).

**Edge styling:**
- Color-coded by `dataType`: mesh = blue, field = green, config = gray, surface = orange, edgeMesh = purple.
- Animated (dashed, moving) when source node is in "running" state.
- Shows a type label on hover.

**Log panel:**
- Fixed-height panel at the bottom, collapsible.
- Tabs per node (only nodes that have been run). Each tab shows streaming stdout/stderr.
- Errors in red, warnings in yellow (detected by parsing OpenFOAM's `FOAM FATAL ERROR` and `FOAM Warning` patterns).
- "Copy" button copies the full log.
- "Clear" button clears that node's log.

**Keyboard shortcuts:**
- `Ctrl+Z` / `Ctrl+Shift+Z`: undo/redo (managed by history slice in the store).
- `Delete`: remove selected nodes/edges.
- `Ctrl+A`: select all.
- `Ctrl+D`: duplicate selected nodes (new IDs, offset position by +20px).
- `Ctrl+S`: force save (normally auto-saved).

**Undo/redo:** Before any mutation, push the current graph state to `history[]`. Cap at 50 entries. Undo pops the stack and restores. This is the simplest correct implementation — no need for command pattern.

---

## Security

The webview Content Security Policy must be:
```
default-src 'none';
style-src ${webview.cspSource} 'unsafe-inline';
script-src 'nonce-${nonce}';
img-src ${webview.cspSource} data:;
font-src ${webview.cspSource};
```

- No external URLs.
- All scripts loaded via the bundled JS file with nonce.
- The bundle is loaded via `webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "out", "webview", "bundle.js"))`.

**Path validation before writing files (extension host):**
```typescript
function safeWrite(filePath: string, caseRoot: string, content: string): void {
  const resolved = path.resolve(filePath);
  const root = path.resolve(caseRoot);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error(`Refusing write outside case root: ${filePath}`);
  }
  fs.writeFileSync(resolved, content, "utf-8");
}
```

---

## What to Build First (Order of Implementation)

1. **Scaffold** — esbuild config, shared types, VSCode message hook, empty React Flow canvas that loads/saves graph JSON. Nothing works yet but the plumbing is connected.
2. **BlockMesh node** — simplest node with no inputs, no validation complexity. Get the full cycle working: create node → fill parameters → generate file → run command → see state change.
3. **Node registry + palette** — drag from palette, drop on canvas, auto-save. After this, adding new node types is just writing a new `registerNode` call.
4. **FvSchemes + FvSolution nodes** — config-only nodes with rich parameters. Tests the parameter UI without execution complexity.
5. **Solver node + execution engine** — the `spawn` + log streaming loop. After this, a full simple case works end to end.
6. **BoundaryCondition nodes + field file assembly** — the most complex part because multiple nodes write into one file.
7. **SnappyHexMesh + SurfaceFeatureExtract** — file-generating nodes that depend on external geometry files.
8. **Validation** — add `validate()` implementations once the node types are stable.
9. **Undo/redo, keyboard shortcuts, edge color coding** — polish.
10. **Import from existing case** — useful for existing users who don't start from scratch.
