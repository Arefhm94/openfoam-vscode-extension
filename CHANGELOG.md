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
- **View controls panel** (both viewers). A compact corner overlay with
  stepped rotate/pan compasses, zoom in/out, Fit (refit distance only)
  and Reset (also restores a sane default direction), plus a wireframe
  toggle (geometry viewer) or an orthographic/perspective toggle (field
  viewer), and a screenshot button that saves the current view as a PNG
  via a native save dialog.
- **Interactive clip plane** (both viewers). Slice along X/Y/Z (or
  flipped) with a position slider to look inside a case's geometry or a
  sample surface instead of only seeing its outside — the field viewer
  uses vtk.js's native `addClippingPlane`, the geometry viewer uses
  three.js's per-material clipping planes shared across every layer.
  Not capped (the cut shows the open shell, not a filled cross-section)
  — a solid cap is a possible follow-up.
- **`.vtk`/`.vtp` now open directly, no matter how you click them.**
  Registered as a default custom editor: double-clicking any `.vtk`/
  `.vtp` file — in VS Code's own Explorer, not just this extension's
  Case Explorer — now opens it straight into the right viewer, same
  auto-detection as before (field viewer for `.vtp` or a `.vtk` with
  real POINT_DATA/CELL_DATA, plain 3D preview otherwise). ("Reopen
  Editor With…" still offers the plain text editor.) This also fixed a
  real detection bug: the field-data sniff only checked the first 8 KB
  of the file, but in a legacy-VTK file POINT_DATA/CELL_DATA always
  comes *after* the POINTS/POLYGONS section it describes — for any
  real mesh (more than a few dozen points) that section starts well
  past 8 KB, so every real field-data `.vtk` was silently misrouted to
  the geometry viewer. The sniff now scans in bounded 1 MB chunks (up
  to 16 MB) instead.
- **Fixed the three real, separate reasons field-data `.vtk` files
  rendered blank.** Chased with an actual headless-Chrome + WebGL render
  this round (not just source-reading), which uncovered three
  independent, previously-undiscovered bugs stacked on top of each
  other — every earlier lighting/normals fix was correct but addressed
  none of these:
  1. **Binary VTK support.** Real HELYX/OpenFOAM `sampleSurface`/
     `postProcessing/**/VTK` output defaults to the legacy **BINARY**
     format, not ASCII. `src/webview/vtkParse.ts` previously only
     understood ASCII (built and tested against synthetic fixtures
     only), so every real field-data file silently failed to parse.
     Added a binary-aware parser alongside the existing ASCII one
     (big-endian, as the legacy format always is).
  2. **A flexbox circular-sizing bug.** The field/geometry viewers'
     `flex:1` containers had no `min-height:0`, so a canvas whose
     `width`/`height` *attributes* get set programmatically (both
     three.js and vtk.js do this) could force its own ancestor chain to
     grow to match it — the container ends up sized by its child
     instead of the other way around, breaking layout in a way that
     doesn't show up until real content is loaded.
  3. **A bad default camera direction for near-planar datasets.**
     `renderer.resetCamera()` only fits *distance* to the bounds — it
     preserves whatever direction the camera already had. A sample
     surface is flat in one axis; if the default direction happened to
     look straight down that axis, the whole plane projected to a
     sliver with ~zero screen-space area. The new default view now
     looks predominantly *along* the dataset's thinnest axis instead
     (`src/webview/cameraOrient.ts`, unit-tested), which is what
     actually shows a thin slice face-on.
  Verified end-to-end against a real 126k-point/257k-cell example file,
  confirmed by a real rendered screenshot showing the correctly
  colored field, not just passing metadata checks.
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
- **Viewer controls overhauled per direct feedback.** Both viewers:
  left-drag now rotates around whichever point you clicked (not a fixed
  scene center), right-drag pans, and the scroll-wheel zoom is
  significantly gentler than before. The nav panel's separate zoom
  in/out buttons were removed (reported as not useful — scroll or the
  Fit/Reset buttons cover it). The field viewer's legend is now a
  compact **vertical** color bar (bottom-right, a reasonable fixed
  height, not the old full-width horizontal strip) with a **colormap
  picker** — Cool→Warm (the previous fixed default), Jet, Viridis,
  Plasma, and Grayscale.
- **Language server self-heals from a tree-sitter WASM crash.** A rare
  `RuntimeError: memory access out of bounds` in the bundled
  `web-tree-sitter` parser (root cause not reproduced against any
  synthetic input tried) previously left the server permanently unable
  to parse anything — every document, not just the one that triggered
  it — because `web-tree-sitter` runs on one process-wide WebAssembly
  module shared by every `Parser` instance; once its linear memory
  traps, it stays corrupted for the rest of that process's life no
  matter how many new `Parser` objects get created. The server now
  detects this and exits cleanly, which `vscode-languageclient`'s
  default (unmodified) error handler treats as a normal crash and
  restarts from — a genuinely fresh process, and therefore a genuinely
  fresh WASM instance — instead of leaving hover/completion/
  diagnostics broken for the rest of the session.
- **`.stl`/`.obj` now open directly too**, the same default-custom-editor
  treatment `.vtk`/`.vtp` already got — double-clicking one anywhere in
  VS Code (not just the Case Explorer) opens the 3D geometry viewer
  straight away instead of raw text. ("Reopen Editor With…" still
  offers the plain text editor.)
- **Multi-select "Open with OpenFOAM 3D Geometry"**: select several
  `.stl`/`.obj`/`.vtk` files in VS Code's own Explorer, right-click, and
  every selected file loads as its own layer in one go — not just the
  one you clicked. (The right-click menu itself, on any Explorer file —
  not just the Case Explorer — was also missing before this; both
  `openfoam.previewGeometry` and `openfoam.previewField` are now on it.)
- **Consolidated the clip-plane panel into the view-controls panel** on
  both viewers, removing a separate floating overlay that sat right next
  to the geometry viewer's axis gizmo and looked like a redundant second
  "X/Y/Z" control living right beside it.
- **"OpenFOAM Preview" is now one feature**, not two. A single command
  (`openfoam.preview`, on the Explorer right-click menu and used
  internally everywhere) auto-detects field-vs-geometry per file and
  opens the right one of the two viewers — you no longer need to know
  which viewer a file belongs in, or pick between two separate
  "Preview Geometry" / "Preview Field Data" menu entries. Drag-and-drop
  onto either viewer, and the "Open file…" flow's drops, now route the
  same way, so dropping a field-data file onto the geometry viewer (or
  a plain mesh onto the field viewer) opens it correctly instead of
  failing silently. (The two underlying viewers are still separate
  three.js/vtk.js engines internally — see the roadmap note below.)
- **Field viewer legend moved to the top-left** (was bottom-right,
  crowding the view-controls panel there).
- **A real loading state** for both viewers: a spinner + "Loading
  &lt;file&gt;…" overlay now shows from the moment a file is chosen
  until it's actually parsed and rendered, replacing the previous
  behavior of the "Add geometry layer…" / "Open a file…" empty-state
  staying on screen the whole time — which, for a larger file, looked
  like nothing had happened rather than that it was working.
- **`∇` case menu.** A nabla icon appears in the editor title bar
  whenever the current workspace looks like an OpenFOAM case (a folder
  with `constant`/`system`) — click it for **Load Geometries…**
  (multi-select STL/OBJ/VTK) or **Postprocessing…** (multi-select
  VTK/VTP, defaulting to the case's `postProcessing/` folder when one
  exists), both routed through the unified `openfoam.preview` command.

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
