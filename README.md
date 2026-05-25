# OpenFOAM Language Support for VS Code

<img src="logo.png" alt="OpenFOAM Language Support" width="100">

VS Code support for OpenFOAM case files: syntax highlighting, hover docs, completions, an inspector, and quick geometry preview.

---

## Features

### Syntax Highlighting

Understands the main OpenFOAM dictionary patterns and highlights them clearly:

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

Hover a keyword to see what it does, common values, and a short usage hint. Coverage includes:

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

Completion suggestions are based on where you are in the file:

- Inside `ddtSchemes { }` → offers `Euler`, `backward`, `CrankNicolson`, …
- Inside `gradSchemes { }` → offers `Gauss linear`, `leastSquares`, `cellLimited`, …
- Inside `divSchemes { }` → offers `Gauss <scheme>` variants
- Inside `solvers { }` → offers solver names and required keywords
- Inside `SIMPLE { }` / `PIMPLE { }` → offers algorithm-specific keywords
- Inside `RAS { }` → lists all RANS model names
- Inside `boundaryField { }` → lists boundary condition types
- Inside `controlDict` → all control keywords with defaults

### Outline View

Shows the document structure in the Explorer and outline view so it is easier to move through large dictionaries.

### Inspector Panel

A visual view of the current dictionary with blocks, parameters, inline edits, and boolean toggles.

Open with: `Ctrl+Shift+P` → **OpenFOAM: Open Inspector**  
Or click the `$(file-code) OpenFOAM` status bar item.

The inspector tracks the active editor and highlights the block around your cursor.

### Geometry Preview

If a geometry reference points to an STL, OBJ, or VTK file, the inspector can show a 3D preview.

- Opens in the inspector panel, which is intended to stay as a horizontal panel at the bottom
- Inline thumbnails for geometry references
- Full viewer with rotate, pan, and zoom

Viewer controls:

- Left drag: rotate
- Right drag or `Shift` + drag: pan
- Mouse wheel: zoom

### Auto-Detection

Files in `system/`, `constant/`, and time directories such as `0/` or `1/` are detected automatically even when they have no extension.

---

## Commands

| Command | Description |
|---------|-------------|
| `OpenFOAM: Open Inspector` | Open the visual inspector panel |
| `OpenFOAM: Preview Geometry (3D)` | Open a geometry file in the inspector viewer |
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
# Install dependencies and build from source
git clone https://github.com/arefhm94/openfoam-vscode-extension.git
cd openfoam-vscode-extension
npm install
npm run compile

# Package and install the extension locally
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

## Notes

- The inspector is built as a webview panel, so final placement still depends on the current VS Code layout.
- Geometry preview currently focuses on STL-based workflows and common case-relative geometry paths.

---

## License

GPL-3.0 — same as OpenFOAM.
