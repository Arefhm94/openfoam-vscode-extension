# OpenFOAM Language Support for VS Code

<img src="logo.png" alt="OpenFOAM Language Support" width="100">

Syntax highlighting, hover documentation, auto-completion, and an interactive inspector panel for OpenFOAM case files.

---

## Features

### Syntax Highlighting

Token-aware coloring for the full OpenFOAM dictionary format:

- `FoamFile` header fields
- Keywords: `ddtSchemes`, `SIMPLE`, `PIMPLE`, `solvers`, `relaxationFactors`, …
- Scheme names: `Gauss`, `linearUpwind`, `vanLeer`, `CrankNicolson`, …
- Turbulence models: `kOmegaSST`, `SpalartAllmaras`, `Smagorinsky`, `WALE`, …
- Boundary conditions: `fixedValue`, `zeroGradient`, `kqRWallFunction`, `nutkWallFunction`, …
- Linear solvers and preconditioners: `GAMG`, `PCG`, `PBiCGStab`, `DIC`, `DILU`, …
- Decomposition methods: `scotch`, `simple`, `hierarchical`, …
- Dimension sets `[kg m s K mol A cd]`, vectors `(x y z)`, numbers, booleans
- `$variable` references and `#include` directives

### Hover Documentation

Hover over any keyword to get a description, valid values, and usage examples. Covered topics include:

| Category | Examples |
|----------|---------|
| Time schemes | `Euler`, `backward`, `CrankNicolson`, `steadyState`, `localEuler` |
| Gradient schemes | `Gauss linear`, `leastSquares`, `cellLimited` |
| Divergence schemes | `Gauss linearUpwind`, `Gauss vanLeer`, `Gauss LUST` |
| Laplacian / snGrad | `corrected`, `limited corrected 0.333`, `uncorrected` |
| fvSolution algorithms | `SIMPLE`, `PIMPLE`, `PISO`, `FLUID` |
| Linear solvers | `GAMG`, `PCG`, `PBiCGStab`, `smoothSolver`, `diagonal` |
| Preconditioners | `DIC`, `DILU`, `FDIC` |
| Smoothers | `GaussSeidel`, `symGaussSeidel`, `DICGaussSeidel` |
| RANS models | `kOmegaSST`, `kEpsilon`, `SpalartAllmaras`, `realizableKE`, `v2f` |
| LES models | `Smagorinsky`, `WALE`, `dynamicKEqn`, `DDES`, `DES` |
| Boundary conditions | `fixedValue`, `inletOutlet`, `totalPressure`, `fixedFluxPressure`, all wall functions |
| Patch types | `wall`, `cyclic`, `cyclicAMI`, `symmetry`, `empty`, `wedge`, `processor` |
| Decomposition | `scotch`, `simple`, `hierarchical`, `manual` |
| snappyHexMesh | All sub-dicts: `castellatedMeshControls`, `snapControls`, `addLayersControls`, … |
| blockMesh | `hex`, `simpleGrading`, `arc`, `spline`, `mergePatchPairs` |
| Transport / thermo | `Newtonian`, `powerLaw`, `perfectGas`, `janaf`, `sensibleEnthalpy` |
| Fields | `U`, `p`, `k`, `epsilon`, `omega`, `nut`, `T`, `alpha1`, … |
| Function objects | `forces`, `forceCoeffs`, `probes`, `yPlus`, `wallShearStress`, `fieldAverage`, … |
| controlDict | Every control keyword with valid options and defaults |

### Auto-Completion

Context-aware completions with snippet templates:

- Inside `ddtSchemes { }` → offers `Euler`, `backward`, `CrankNicolson`, …
- Inside `gradSchemes { }` → offers `Gauss linear`, `leastSquares`, `cellLimited`, …
- Inside `divSchemes { }` → offers `Gauss <scheme>` variants
- Inside `solvers { }` → offers solver names and required keywords
- Inside `SIMPLE { }` / `PIMPLE { }` → offers algorithm-specific keywords
- Inside `RAS { }` → lists all RANS model names
- Inside `boundaryField { }` → lists boundary condition types
- Inside `controlDict` → all control keywords with defaults

### Outline View

Hierarchical document structure in the Explorer sidebar (`Ctrl+Shift+O`). Colored icons indicate block type (scheme, solver, boundary, mesh, …).

### Inspector Panel

A visual horizontal tree of any open OpenFOAM dictionary — blocks as collapsible pills, parameters as cards with inline editable values and boolean toggles.

Open with: `Ctrl+Shift+P` → **OpenFOAM: Open Inspector**  
Or click the `$(file-code) OpenFOAM` status bar item.

The panel follows the editor cursor: the node for the block you are currently editing is highlighted automatically.

### Auto-Detection

Files in `system/`, `constant/`, and time directories (`0/`, `1/`, etc.) without an extension are automatically set to the `openfoam` language mode.

---

## Commands

| Command | Description |
|---------|-------------|
| `OpenFOAM: Open Inspector` | Open the visual inspector panel |
| `OpenFOAM: Set Language Mode` | Manually apply OpenFOAM language to the active file |
| `OpenFOAM: Rebuild Keyword Database` | Re-run extraction scripts against an OpenFOAM source tree |
| `OpenFOAM: Show Scheme Documentation` | Browse scheme docs via quick-pick |
| `OpenFOAM: Insert Turbulence Block` | Insert a RAS or LES snippet at the cursor |
| `OpenFOAM: Refresh Keyword Database` | Reload the keyword database from a compiled extractor |

---

## Supported Files

### system/

`controlDict`, `fvSchemes`, `fvSolution`, `blockMeshDict`, `snappyHexMeshDict`, `decomposeParDict`, `fvOptions`, `topoSetDict`, `setFieldsDict`, `refineMeshDict`

### constant/

`transportProperties`, `turbulenceProperties`, `momentumTransport`, `thermophysicalProperties`, `thermophysicalProperties.gas`, `phaseProperties`, `g`, `RASProperties`

### 0/ (boundary conditions)

`U`, `p`, `p_rgh`, `k`, `epsilon`, `omega`, `nut`, `nuTilda`, `T`, `rho`, `alpha.*`, `G`, `Ii`, and any other field file

---

## Installation

```bash
# From a .vsix release
code --install-extension openfoam-language-support-0.4.4.vsix

# From source
git clone https://github.com/arefhm94/openfoam-vscode-extension.git
cd openfoam-vscode-extension
npm install
npm run compile
vsce package
code --install-extension openfoam-language-support-*.vsix
```

---

## Rebuilding the Keyword Database

The extension ships with a pre-built `data/keyword-db.json`. To regenerate it from a local OpenFOAM 13 source tree:

1. Run `Ctrl+Shift+P` → **OpenFOAM: Rebuild Keyword Database**
2. Enter the path to your OpenFOAM 13 source root (e.g. `/path/to/OpenFOAM-13`)
3. The terminal runs 13 extraction scripts and merges the results
4. Reload VS Code when complete

---

## Project Structure

```
src/
  extension.ts                       # Extension entry point
  language-server/server.ts          # LSP server (hover, completion, diagnostics)
  workflow/InspectorPanel.ts         # Visual inspector webview
  providers/
    OpenFOAMDocumentSymbolProvider.ts  # Outline view
    OpenFOAMCodeLensProvider.ts        # Inlay hints / boolean toggles
  parsers/OpenFOAMParser.ts          # Dictionary parser
syntaxes/openfoam.tmLanguage.json    # TextMate grammar
data/keyword-db.json                 # Keyword database
scripts/                             # Python extraction scripts (01–13)
examples/                            # Example OpenFOAM cases
```

---

## License

GPL-3.0 — same as OpenFOAM.
