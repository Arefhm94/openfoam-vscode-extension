# OpenFOAM Language Support for VS Code

<img src="logo.png" alt="OpenFOAM Language Support" width="100">

VS Code support for OpenFOAM case files: syntax highlighting, hover docs, completions, diagnostics, a case explorer, and quick geometry preview.

---

## What's New in 0.7.0

This release replaces the extension's parsing engine with
[tree-sitter](https://tree-sitter.github.io/tree-sitter/), a real parser
built specifically for OpenFOAM/Helyx dictionary syntax. That change
unlocked several new features and fixed a number of longstanding bugs:

**New features**

- **Smarter diagnostics**: the extension now catches more real mistakes —
  unknown keywords, missing required keywords, and invalid values (e.g. an
  unrecognized `startFrom` option) — for `controlDict`, `blockMeshDict`,
  `decomposeParDict`, `snappyHexMeshDict`, `helyxHexMeshDict`,
  `fvSchemes`, `fvSolution`, `turbulenceProperties`, `boundaryField`,
  `regionProperties`, `phaseProperties`, and `mapFieldsDict`.
- **Precise syntax-error locations**: a missing semicolon or unbalanced
  brace is now reported at its exact location in every file type, instead
  of only a generic whole-file warning.
- **Smarter boundary-condition completions**: typing a `type` inside a
  boundary condition now only suggests conditions that are actually valid
  for that field — editing `U` no longer suggests pressure-only types,
  and editing `p` no longer suggests velocity-only types.
- **Helyx `helyxHexMeshDict` keyword support**: Helyx-specific
  `snappyHexMeshDict` extensions (feature refinement, gap closure,
  layer/mesh-quality controls, and more) are now recognized instead of
  being flagged as unknown or missing entirely from completions.

**Bugs fixed**

- Signature help (parameter hints while typing a scheme like
  `Gauss linearUpwind grad(U)`) previously never actually triggered for
  the standard single-line entry format — it does now.
- Hover and completion for several `controlDict`/`blockMeshDict`/
  `snappyHexMeshDict` keywords were silently broken due to a data-lookup
  bug; fixed.
- Dotted and composite identifiers (`alpha.water`, `div(phi,U)`) now
  resolve correctly everywhere (hover, rename, go-to-definition) instead
  of being cut off at the first special character.
- Quoted strings, comments, and multi-line list values are now parsed
  correctly in every case, including edge cases (braces inside comments
  or strings) that could previously corrupt parsing of the rest of the
  file.
- The packaged extension is roughly 17x smaller than before (no longer
  accidentally bundling large example case files).

See [CHANGELOG.md](CHANGELOG.md) for the full technical write-up.

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

### Case Explorer

A dedicated OpenFOAM view in the Activity Bar that shows your case directory tree, with quick actions (copy relative path, reveal in Finder, duplicate file, find file in case) available from each item's context menu.

### Geometry Preview

Right-click an `.stl`, `.obj`, or `.vtk` file (in the Case Explorer or a `geometry { }`/`triSurface` reference) and choose **OpenFOAM: Preview Geometry (3D)** to open an interactive 3D viewer.

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
| `OpenFOAM: Preview Geometry (3D)` | Open a geometry file (STL/OBJ/VTK) in the 3D viewer |
| `OpenFOAM: Set Language Mode` | Manually apply OpenFOAM language to the active file |
| `OpenFOAM: Rebuild Keyword Database` | Re-run extraction scripts against an OpenFOAM source tree |
| `OpenFOAM: Show Scheme Documentation` | Browse scheme docs via quick-pick |
| `OpenFOAM: Insert Turbulence Block` | Insert a RAS or LES snippet at the cursor |
| `OpenFOAM: Refresh Keyword Database` | Reload the keyword database from a compiled extractor |
| `OpenFOAM: Refresh Case Explorer` | Reload the Case Explorer tree |
| `OpenFOAM: Switch Case Root` | Change which case directory the Case Explorer shows |
| `OpenFOAM: Find File in Case` | Quick-pick search across the current case |
| `OpenFOAM: Copy Relative Path` | Copy a case file's path relative to the case root |
| `OpenFOAM: Reveal in Finder` | Reveal the selected file in Finder/Explorer |
| `OpenFOAM: Duplicate File` | Duplicate the selected case file |

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
  treeSitter/                        # tree-sitter parsing, schema-driven diagnostics
  workflow/GeometryPreviewPanel.ts   # Standalone 3D geometry preview
  providers/
    OpenFOAMDocumentSymbolProvider.ts  # Outline view
    OpenFOAMCodeLensProvider.ts        # Inlay hints / boolean toggles
    OpenFOAMCaseTreeProvider.ts        # Case Explorer
syntaxes/openfoam.tmLanguage.json    # TextMate grammar (editor syntax highlighting)
data/keyword-db.json                 # Keyword database
scripts/                             # Python extraction scripts (01–13)
examples/                            # Example OpenFOAM cases (dev/test only, not packaged)
```

Parsing itself lives in a separate [tree-sitter](https://tree-sitter.github.io/tree-sitter/)
grammar package, `tree-sitter-openfoam`, consumed via `web-tree-sitter`.

---

## Notes

- The geometry viewer is built as a webview panel, so final placement still depends on the current VS Code layout.
- Geometry preview currently focuses on STL-based workflows and common case-relative geometry paths.
- Deep keyword-level diagnostics currently cover the file types listed under "What's New" above; other file types still get syntax highlighting, hover, outline, and parse-error diagnostics, just not unknown-keyword/missing-required-keyword checks yet.

---

## License

GPL-3.0 — same as OpenFOAM.
