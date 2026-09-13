# Changelog

All notable changes to the OpenFOAM Dictionary Support extension are
documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

## [0.8.0] — 2026-09-13

Implements `context/UPDATE.md`'s Parts E–H: essential UI/UX + backend
fixes, a VTK field-data viewer, a live residual dashboard, and a native
parametric-study engine (with an optional Dakota export).

### Added

- **Field-data viewer (`.vtk`/`.vtp`).** A new viewer, alongside the
  existing plain-geometry preview, for datasets that carry point/cell
  field data (`foamToVTK` / `postProcessing/**/VTK/*.vtk` output):
  color-by-array with a legend, and solid/wireframe/points toggles.
  Built on `@kitware/vtk.js` (dev-time only — bundled into
  `media/field-viewer.js`, ~1.2 MB, no runtime dependency added).
  Clicking a `.vtp` file, or a `.vtk` file that actually contains
  `POINT_DATA`/`CELL_DATA`, in the Case Explorer now opens this viewer
  instead of the plain geometry preview (`openfoam.previewField`); a
  bare geometry `.vtk` still gets the original 3D preview. Both this
  viewer and the plain geometry preview have their own **"Open file…"**
  button (and an empty-state placeholder before anything's loaded), so
  either can be opened from the Command Palette with no file at all and
  used to pick one. The array dropdown now lists every **channel**, not
  just each array's magnitude — a vector/tensor field expands into its
  magnitude *and* each individual component (`U — X`, `U — Y`, `U — Z`,
  …), point and cell data both included. Also fixed a real bug that
  could leave the viewer showing nothing at all: geometry now always
  renders with a visible flat-shaded color, independent of whether any
  field data/coloring is present.
- **Geometry viewer: multi-layer, multi-select, drag & drop.** Opening
  more than one STL/OBJ/VTK file no longer replaces the previous one —
  each becomes its own toggleable, removable layer (own color, click to
  show/hide, `×` to remove, "Clear All" to reset), kept in its true
  relative scale and position rather than each being independently
  re-centered, with the camera auto-fitting to whatever's currently
  visible. "Add geometry layer…" now supports picking several files at
  once, and files can be dragged straight in from the Explorer or the
  Case Explorer (which can now act as a drag source, same as VS Code's
  own Explorer). Also fixed the viewer opening "too zoomed in": the
  camera's zoom range and near/far clipping planes are now computed from
  each geometry's actual size instead of a fixed range tuned for the old
  single-file normalized view, so real-world-scale meshes (tiny or huge)
  frame and zoom correctly.
- **Field viewer: drag & drop.** `.vtk`/`.vtp` files can now be dropped
  in from the Explorer or Case Explorer the same way as the geometry
  viewer, in addition to "Open file…".
- **Live residual & run dashboard** (`OpenFOAM: Open Run Dashboard`, also
  in the Case Explorer's title bar). Tails the case's solver log
  incrementally (no re-reading multi-MB files on every tick), charts
  every field's residual on a log scale as the run progresses, and shows
  a per-field converging/diverging/stalled badge from a trailing-window
  regression on the residual trend — plus an info strip (time step,
  Courant number, `ExecutionTime`/wall-clock). The log format and the
  "moving average / trend" vocabulary are grounded in a real HELYX
  solver log and its own bespoke convergence monitor
  (`examples/Helyx/complex/log/`). Works immediately on an
  **already-finished** run too (reads the whole existing log on open,
  not just new growth), and picks the actual solver log even when other
  `.out` files (mesh generation, a convergence monitor, …) sit alongside
  it in the same folder. The chart now has a Plotly-Dash-style toolbar:
  a **Box Zoom**/**Pan** mode toggle (drag a rectangle to zoom into both
  axes at once in Box Zoom mode, or drag to pan in Pan mode), explicit
  **zoom in/out** and **Autoscale** buttons, plus the existing
  scroll-to-zoom, hover for exact values, and click-a-legend-entry to
  show/hide a field. A run's status area now also shows a summary table
  (final residual + trend per field) and aggregate stats (time span
  covered, fields tracked, average wall-clock cost per iteration) instead
  of just "Run finished.", so there's something to read once a run
  completes, not only while it's live — plus its own **Open Log File…**
  button to point it at a different log.
- **Parametric study** (`OpenFOAM: Start Parametric Study`). Define one
  or more parameters (a target dictionary key + a list of values to
  sweep); the full grid of combinations is materialized as sibling case
  directories with the values already substituted in — the same
  "black-box" idea Dakota itself uses, done directly via this
  extension's tree-sitter infrastructure, no external tool required.
  For users who already have **Dakota** installed
  (`OpenFOAM: Export Parametric Study to Dakota`, shown only when a
  `dakota` binary is detected on `PATH`), the same parameter definitions
  export a starting `dakota.in` plus an analysis-driver script, for its
  actual DOE/optimization/UQ algorithms instead of a plain grid.
- **"Did you mean" quick-fix.** An `Unknown key 'walldis'`-style
  diagnostic now offers a one-click fix to the nearest real key in that
  file's schema (plain edit-distance, no ML).

### Changed

- Consolidated the three independent copies of the case-root-detection
  walk (`extension.ts`, `language-server/caseContext.ts`,
  `scaffold/context.ts`) into one shared `src/shared/caseRoot.ts`.
- `openfoam.toggleBoolean` (previously an undeclared, palette-invisible
  command) is now declared and explicitly hidden from the palette,
  documenting that it's deliberately CodeAction-only.

### Not in this release

Deferred from `context/UPDATE.md`'s roadmap: the field viewer's slicing/
iso-surface/glyph tiers (v2/v3), a Case Explorer run-status decoration
tied to the dashboard's live state, the parametric-study dashboard
(plotting a result against each swept parameter as variants finish — the
sweep engine and the residual dashboard both exist, just not wired
together yet), the extractor pipeline's regex→real-parsing rewrite, a
multi-OpenFOAM-version schema setting, and expanded direct LSP-layer
test coverage.

## [0.7.3] — 2026-09-10

### Added

- **Search & Configure — `@` inline trigger.** Type `@` (optionally with
  a query, e.g. `@pimple`, `@fixed`) where a dictionary key or block name
  would go and the completion popup fills with scaffoldable features
  ranked for the current file — boundary conditions in a `0/` field
  file, SIMPLE/PIMPLE/PISO in `fvSolution`, RAS/LES models in a
  turbulence-properties file, and so on. Accepting one replaces the `@`
  with the block right there, as a snippet, so the parameters are
  tab-stops you fill in place (a boundary condition typed inside
  `boundaryField` expands to a whole `patch { … }` entry). No dialog.
  - This release covers boundary conditions and fvSolution algorithms
    with a full field draft, plus turbulence models and schemes as a
    searchable starting-point insert. Function objects and fvOptions are
    pending richer schema data.
- **`?` — OpenFOAM C++ API help.** Type `?name` where a value would go
  (e.g. `?kOmegaSST`, `?fixedValue`) and the completion popup lists
  matching classes from cpp.openfoam.org. As you move through the list
  the detail pane beside the cursor shows that class's brief and — with
  `openfoam.docs.onlineHelp` enabled — its full *Detailed Description*,
  fetched from the class page and rendered inline. **Pressing Enter**
  opens the class documentation in a persistent panel beside the editor
  (`openfoam.docs.onAccept`, default `panel`; also `browser` — the page
  in VS Code's Simple Browser — `comment` — a `//` note with the brief
  and URL — or `none`). Separately, **hover any identifier** that names
  an OpenFOAM class for the same brief + full description + link. A class
  index is bundled with the extension so the briefs and links work
  offline; `openfoam.docs.onlineHelp` (default `false`) opts into all
  cpp.openfoam.org traffic — the index refresh and the on-demand page
  fetches, both cached ~7 days — and `openfoam.docs.apiVersion` (default
  `v14`) picks the docs version.
- **Staging tab** (opt-in via `openfoam.scaffold.insertMode: "stagingTab"`,
  or the `OpenFOAM: Search & Configure` command / `Ctrl+Alt+O` ·
  `Cmd+Alt+O`). Instead of dropping the block at the cursor, opens it in
  a real, editable OpenFOAM buffer with full highlighting, completion and
  diagnostics, and three buttons at the top of the tab — **Write →
  `<target>`** (suggested destination file + block nesting), **Change
  target** (autocompleting picker over the case's dictionary files;
  append `> block > block` to change the nesting), **Discard**. Nothing
  touches disk until Write, which creates the enclosing block — and the
  file, with a standard header — if needed.

## [0.7.2] — 2026-09-10

### Added

- **Semantic highlighting for resolvable references.** Values that point
  at something real in the case now get a distinct colour, by category:
  a geometry file (`.stl`/`.obj`/…) present in `constant/triSurface/`, a
  `.eMesh` feature-edge file, a `$variable` that resolves to a definition
  in the case, a boundary-patch name that exists in
  `constant/polyMesh/boundary`, and an `#include` path that resolves to
  an existing file. Anything that resolves to nothing gets no colour and
  stays at the editor default — so a typo in a geometry name or a stale
  `$ref` now visibly stands out from a correct one. Colours follow the
  active theme (mapped to its type / variable / tag / string / function
  colours); requires semantic highlighting enabled in the theme (on by
  default in most).
- The `$variable` TextMate rule was removed so unresolved `$refs` are no
  longer coloured unconditionally — the semantic layer is now the single
  source of truth for `$ref` colouring.

## [0.7.1] — 2026-09-10

### Fixed

- `#include` paths using OpenFOAM/HELYX environment variables — most
  commonly `#include "$FOAM_CASE/system/includeDicts/..."` — were
  incorrectly flagged as *"cannot find"* even when the target file
  existed. The include resolver now expands `$FOAM_CASE` (and
  `${FOAM_CASE}`, `$FOAM_CASENAME`, `$WM_PROJECT_DIR`, `$FOAM_ETC`, and a
  few other standard OpenFOAM variables) before checking the filesystem.
  Absolute include paths are now also honored. Unknown variables are left
  untouched, so resolution just fails cleanly as before rather than
  matching the wrong thing.

## [0.7.0] — 2026-09-10 — tree-sitter overhaul

A ground-up rework of how the extension parses and understands OpenFOAM/
Helyx dictionary files, executed in phases per
`context/openfoam-extension-treesitter-instruction.md` (see
`context/progress.md` for the full step-by-step log).

### Architectural change: tree-sitter parsing

- The extension's parsing logic previously lived as **three independent,
  duplicated hand-rolled text scanners**: `server.ts`'s
  `getBlockPath()`/`getCursorContext()`/per-file-type `diagXxx()` regex
  functions, `OpenFOAMDocumentSymbolProvider.ts`'s own regex-based outline
  parser, and an unused `OpenFOAMParser.ts`. None shared a parse tree,
  which was a concrete source of bugs (e.g. quoted strings or comments
  containing braces could corrupt nesting).
- Replaced with **`tree-sitter-openfoam`**, a new standalone,
  runtime-agnostic [tree-sitter](https://tree-sitter.github.io/tree-sitter/)
  grammar package (separate local repository so far, not yet published
  or pushed anywhere; MIT licensed), built specifically so the same
  correctness guarantee can eventually be shared with a non-VSCode
  consumer (e.g. a Python-based tool via `py-tree-sitter`) without a
  third independent parser ever being written.
- **New external dependency**: `tree-sitter-openfoam` (currently
  consumed as a local package during co-development; will move to a
  published npm version once the grammar repository is published) and
  `web-tree-sitter` (`^0.27.0`), which loads the grammar's compiled WASM
  artifact and parses documents in the language server process.
- `getBlockPath()`, the old `getCursorContext()` heuristic, `wordAt()`'s
  `\w`-only regex, and `OpenFOAMParser.ts` are gone, replaced by real
  tree queries (`src/treeSitter/queries.ts`) shared by the language
  server and the outline provider.
- Verified a **6.9x incremental-reparse speedup** (`tree.edit()` +
  reparse vs. full reparse) on the largest available fixture — see
  `scripts/benchmark-treesitter.js`.

### Diagnostics

- **New**: schema-driven diagnostics (`src/treeSitter/schema.ts`) —
  unknown-key, missing-required-key, and enum-value checks against the
  `FieldSpec` schemas already in `data/keyword-db.json`, for
  `controlDict`, `blockMeshDict`, `decomposeParDict`, `snappyHexMeshDict`,
  `helyxHexMeshDict` (Helyx-extended — see below), `fvSchemes`/
  `fvSolution`/`turbulenceProperties` (top-level block names),
  `boundaryField` (per-patch boundary-condition keyword validation, e.g.
  a `fixedValue` patch missing its required `value`), and the newly
  wired `regionProperties`/`phaseProperties`/`mapFieldsDict`.
- **New**: raw parse errors (unbalanced braces, unterminated strings,
  etc.) now surface as real diagnostics with precise locations, for
  *every* file type — previously only a whole-file brace-count heuristic
  existed, with no localized error reporting at all.
- Along the way, found and fixed several real gaps in the existing
  keyword schema data (`solver`/`maxAlphaCo`/`graphFormat` missing from
  `controlDict`; `convertToMeters`/`patches` missing from `blockMeshDict`;
  `psi`/`gamma`/`gradient` missing from two boundary-condition types) —
  all confirmed against real files in `examples/`, not guessed.
- Fixed a pre-existing bug where `controlDict`/`blockMeshDict` hover and
  the `snappyHexMeshDict` completion fallback read the wrong nesting
  level of `data/keyword-db.json`, silently breaking those lookups.

### Completion

- Boundary-condition completion (the `type` field inside a
  `boundaryField` patch) is now filtered by the field's value type —
  editing `U` no longer suggests scalar-only boundary conditions like
  `totalPressure`, and editing `p` no longer suggests vector-only ones
  like `noSlip`.
- Required keys now surface first in completion lists, with a
  `(required)` marker.
- The unknown-file-type completion fallback no longer suggests
  `SIMPLE`/`PIMPLE`/`ddtSchemes`/etc. for files it has no real context
  for (it previously did this unconditionally) — it now only offers the
  generically-applicable `FoamFile` header snippet.
- Fixed a signature-help bug that likely meant it never worked for the
  standard single-line scheme form (e.g. `div(phi,U) Gauss linearUpwind
  grad(U);`): it read the current line's first token as "the scheme
  name", which for that shape is the entry's *key*, never a valid scheme.
  Now resolves the actual value tokens via the parse tree.

### Helyx support

- `helyxHexMeshDict` previously shared `snappyHexMeshDict`'s
  OpenFOAM-only schema wholesale — applying it produced 60+
  false-positive "unknown key" warnings on real Helyx files
  (`locationsInMesh`, `wrapper`, `crackDetection`, `meshMode`, and more).
  Resolved by extending the schema with the real Helyx-specific keyword
  names found across every `helyxHexMeshDict*` file in `examples/`
  (`src/treeSitter/knownSchemas.ts`), applied to both diagnostics and
  completion. `caseSetupDict` — a much larger, deeply dynamic
  Helyx-only meta-configuration format with no OpenFOAM equivalent to
  extend — was deliberately left without a bespoke schema (still gets
  tree-sitter parsing, hover, outline, and the new universal
  parse-error diagnostics; just not deep keyword validation).

### Packaging

- `.vscodeignore` now excludes `examples/**`, `context/**`,
  `data/01_*.json`–`data/12_*.json` and the legacy
  `openfoam-keywords.json`/`openfoam-solvers.json` (confirmed only
  `data/keyword-db.json` is loaded at runtime), `scripts/**`, `test/**`,
  `.github/**`, `LINKEDIN_POST.md`, `_logo.png`, `package-lock.json`,
  and `tsconfig.tsbuildinfo`.
- Packaged `.vsix` size: **35.75 MB → 2.03 MB**.
- Found and fixed a real packaging blocker in the process: the local
  `file:../tree-sitter-openfoam` dependency installed as a symlink by
  default, which `vsce package` cannot include (a VSIX can't contain a
  path outside its own root). Added `.npmrc` (`install-links=true`) so
  `npm install` produces a real, self-contained copy instead.

## [0.6.1] and earlier

Pre-dates this changelog; see git history. Notable prior milestones:
geometry-aware case completions and a 3D geometry preview panel
(Three.js-based STL/OBJ/VTK viewer), case explorer, OpenFOAM snippets.
