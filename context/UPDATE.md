# Next-round plan: fix-first UI/UX + backend, geometry/VTK viewer, live residual dashboard, parametric study

Status: **planned, not yet implemented.** Everything through 0.7.3 (the
tree-sitter overhaul, semantic coloring, the `@` scaffold engine, the
`?` cpp.openfoam.org docs help, and their follow-up fixes — the stale
completion-range bug, the doc panel, `insecureHTTPParser` + the `curl`
fallback) is already implemented, tested, and packaged; see
`CHANGELOG.md` and `context/progress.md` for that history. This document
is the plan for what comes next, per the user's explicit direction:
fix essential UI/UX and backend problems first, then the geometry/VTK
viewer, then a live residual dashboard grounded in the real logs in
`examples/Helyx/complex/log/`, then a Dakota investigation for
parametric studies.

---

# Part E — Fix first: essential UI/UX + backend items

## Context

A codebase survey covering everything not already touched in the prior
round — the geometry viewer, Case Explorer, the extractor pipeline, the
Python data-build scripts, and `package.json` wiring — found the
extension's static-analysis side (parsing, diagnostics, completion,
hover, scaffold, docs) is solid, but a handful of concrete gaps and a
few small pieces of repeated code are worth clearing before building
the three bigger features in Parts F–H, since two of those (F, G) will
add their own webview/parser modules that should follow cleaned-up
patterns rather than copy today's duplication forward.

**Biggest structural finding:** the extension is purely *static* — it
never knows a solver has run. No log watching, no residual data, no
task/terminal integration exist anywhere in `src/`. Part G below closes
that gap directly.

## UI/UX

- **Case Explorer run-status** (`src/providers/OpenFOAMCaseTreeProvider.ts`)
  — currently just lists `0/`/`system/`/`constant/`/time dirs (case-root
  walk at lines ~57–83, time-dir bucketing ~133–152) with zero awareness
  of whether/how a run went. Add decorators once a `log.*` exists:
  running / converged / diverged / stalled, last residual, iteration
  count. Pairs directly with the log-watching idea below.
- **Geometry viewer** (`src/webview/geoViewer.ts`,
  `src/workflow/GeometryPreviewPanel.ts`) — solid hand-rolled STL/OBJ/
  legacy-VTK viewer (three.js, orbit camera, mini-axis gizmo, tree
  thumbnails) but single-file only, no measurement (distance/bbox/point
  picking), no wireframe toggle, no per-patch coloring (would let you
  sanity-check a `boundaryField` against the mesh visually), no binary
  VTK/VTP/PVD, and it doesn't auto-refresh when `snappyHexMesh`/
  `surfaceFeatureExtract` regenerates the file.
- **Doc panel follow-ups** (`src/docs/docPanel.ts`, now scriptable) — a
  back/forward history between looked-up classes, a search box inside
  the panel, and preserving the Doxygen page's own "Inherits from" /
  "Inherited by" links (currently just absolutized, not specially
  surfaced) so you can browse a class hierarchy without re-typing `?`.
- **Semantic-token categories** (0.7.2's deferred item) — extend beyond
  the 5 current categories to turbulence-model / scheme names so those
  get resolved-vs-typo coloring too.
- **Diagnostics quick-fixes** — `Unknown key 'walldis'`-style errors
  (schema-driven, `src/treeSitter/schema.ts`) currently just flag; a
  `CodeAction` offering the nearest real key (edit-distance against the
  schema's known keys — plain string algorithm, no ML) would turn every
  typo into a one-click fix. Cheap, high-value, good first "smart
  suggestion" feature.
- **Onboarding** — a `contributes.walkthroughs` entry (case detection,
  the `@`/`?` triggers, the Case Explorer) since the extension has grown
  a lot of non-obvious surface area recently.
- **Command Palette hygiene** — `toggleBooleanCommand`
  (`extension.ts:200`) is registered but not declared in
  `contributes.commands`, so it's invisible in the palette (only reachable
  via its CodeAction). Confirm that's intentional or add the declaration.

## Backend / architecture

- **Consolidate `findCaseRoot`.** At least three independent copies now
  exist (`extension.ts`, `language-server/caseContext.ts`,
  `scaffold/context.ts`). One shared module, imported by all three,
  removes a recurring source-of-truth risk.
- **`src/extractor/` regex → real parsing.** `extractKeywords.ts` has
  its own explicit TODOs (lines ~12–13, ~2143–2144) to replace
  regex-based C++ scraping with real parsing; `solverScraper.ts` scrapes
  cpp.openfoam.org HTML similarly to what `src/docs/` now does more
  robustly (Doxygen-aware extraction) — worth back-porting those
  techniques into the extractor pipeline for the next `keyword-db.json`
  regeneration.
- **`data/keyword-db.json` is underused.** The merge script produces
  rich, structured sections (snappyHexMesh, blockMesh, decomposePar,
  thermophysical, function objects) beyond what any current feature
  reads — natural raw material for richer scaffold templates
  (`src/scaffold/providers.ts`) once that data is curated.
- **Multi-OpenFOAM-version schema.** `keyword-db.json` is implicitly
  pinned to one upstream version; an `openfoam.version` setting
  selecting between schema variants (mirroring how HELYX already gets
  its own extended schema in `knownSchemas.ts`) would prevent
  false-positive diagnostics for users on older/newer OpenFOAM.
- **Direct LSP-layer test coverage.** Current tests are strong for the
  newer pure modules (`scaffold/`, `docs/`, `treeSitter/schema.ts`) but
  `language-server/server.ts` itself (2800+ lines: hover, diagnostics,
  completion) has comparatively little direct unit coverage — worth
  extracting more of its logic into pure, tested functions the way
  `docs/parse.ts` and `scaffold/context.ts` did.
- **Bundle size.** `media/geo-viewer.js` triggers esbuild's 1.1 MB
  warning on every build (three.js bundled whole); worth a pass on
  tree-shaking / dynamic import if the packaged size becomes a concern
  (currently ~2.17 MB total, still small, but worth knowing the biggest
  contributor).

## Files (Part E)

Each bullet above is independent and small; no shared new module except
a `src/shared/caseRoot.ts` (or similar) for the `findCaseRoot`
consolidation, imported by `extension.ts`, `caseContext.ts`, and
`scaffold/context.ts` in place of their own copies. The diagnostics
quick-fix is a `CodeActionProvider` addition next to the existing
boolean-toggle one in `providers/OpenFOAMCodeLensProvider.ts`, reusing
the schema key lists already built for `treeSitter/schema.ts`'s
unknown-key diagnostic.

## Verification (Part E)

- `npm run compile && npm run lint && npm test` clean after the
  `findCaseRoot` consolidation (all three call sites now import one
  function; existing `caseContext.test.ts` / `scaffold.test.ts` keep
  passing unchanged).
- New quick-fix: a small vitest fixture with `Unknown key 'walldis'`
  style typos against a known schema, asserting the top edit-distance
  match is offered.
- Manual: `toggleBooleanCommand` now shows in the Command Palette (or a
  comment confirms it's deliberately hidden).

---

# Part F — Geometry & field-data viewer: pyvista/paraview-style features

## Context

`src/webview/geoViewer.ts` (382 lines) is a working, hand-rolled
three.js viewer: its own ASCII/binary STL parser, OBJ parser, and a
legacy-VTK **POLYDATA** parser (POLYGONS/TRIANGLE_STRIP only — no
POINT_DATA/CELL_DATA is read), a Z-up orbit camera, an axis gizmo, and
offscreen thumbnails for the Case Explorer tree. `three` is a real npm
dependency (`package.json`), bundled via esbuild into
`media/geo-viewer.js` (~1.1 MB, esbuild's size warning fires on every
build). `GeometryPreviewPanel.ts` just base64-encodes one file and posts
it to the webview — single file, geometry only, no field values.

"pyvista/paraview-style features" — color-by-field, slicing, iso-surface
contours, glyphs — all need **field data** (point/cell scalar or vector
arrays), which pure STL/OBJ surfaces never carry. HELYX/OpenFOAM's own
`foamToVTK` output (and the case's `postProcessing/**/VTK/*.vtk`) does
carry it. So this is a second, separate viewer alongside the existing
one, not a rewrite of it — the STL/OBJ preview stays as-is (fast, no
new dependency) for pure geometry.

## Approach: `@kitware/vtk.js`, not more hand-rolled parsing

Verified (Kitware's own docs): `vtk.js` is a real npm package
(`@kitware/vtk.js`), pure client-side/WebGL (works inside a sandboxed
webview, no server), and ships the actual filters this feature needs
out of the box — `CutterMapper`/`ImageResliceMapper` (slicing),
contour/iso-surface extraction, `Glyph3DMapper`, and
`ScalarsToColors`/`ColorTransferFunction` (color-by-array). It reads
modern XML VTK (`.vtp`/`.vti`) natively; **legacy `.vtk`
(ASCII/binary) — what `foamToVTK` produces by default and what
`geoViewer.ts` already parses for POLYDATA — is not its strongest
format.** Recommended path: keep and extend the existing legacy-VTK
parser to also capture `POINT_DATA`/`CELL_DATA` arrays (it already
tokenizes the file; this is additive), then hand the parsed
points/polys/arrays to vtk.js as an in-memory `vtkPolyData` /
`vtkImageData` via `newInstance({points, polys})` +
`getPointData().addArray(...)` — reusing proven parsing code instead of
depending on vtk.js's own legacy reader. This also means both viewers
can keep sharing one input parser long-term.

Feature tiers (build in order — v1 alone is already a real upgrade):

- **v1**: load a `.vtk`/`.vtp` with field data, color by a chosen
  point/cell array with a legend, solid/wireframe/points toggle.
- **v2**: a slicing plane (drag to move, like ParaView's "Slice"
  filter) and a scalar iso-surface/contour control.
- **v3**: vector glyphs (arrows sized/colored by `U`), a click-to-probe
  tool reporting the field value at a point (mirrors what the example
  HELYX convergence script already does for surface probes — see Part G
  — so the vocabulary is consistent across features), multi-block
  support for multi-region cases.

## Files (Part F)

- `src/webview/fieldViewer.ts` (new) — the vtk.js render loop, filters,
  legend, toggles; bundled by the existing esbuild step (new entry
  point, same pattern as `geoViewer.ts`).
- `src/webview/geoViewer.ts` — extend the legacy-VTK parser to also
  return `pointData`/`cellData` arrays (currently discarded); the STL/
  OBJ paths are untouched.
- `src/workflow/FieldViewerPanel.ts` (new, mirrors
  `GeometryPreviewPanel.ts`) — resolves a `.vtk`/`.vtp` file, posts it
  (and, for large files, a note about size) to the new webview.
- `src/providers/OpenFOAMCaseTreeProvider.ts` — a second eye-icon
  affordance (or a distinct icon) for files under `postProcessing/**/VTK/`
  or any `.vtp`, opening the field viewer instead of the geometry one.
- `package.json` — no new `dependencies` beyond `@kitware/vtk.js`; note
  its bundle size in the same place the three.js warning already lives,
  since this is a second sizeable addition to `media/`.

## Open questions to settle during implementation

- Exact `@kitware/vtk.js` bundle-size impact once tree-shaken by esbuild
  (their docs didn't state a number) — worth a throwaway build to check
  before committing to it over a lighter alternative.
- Whether `foamToVTK`/HELYX can be asked to emit `.vtp` directly
  (sidestepping the legacy-format gap entirely for new output) — worth
  a one-line note in the extension's docs either way.

## Verification (Part F)

- Unit: the extended legacy-VTK parser against a small fixture VTK file
  (trim one from `examples/`) asserting `pointData`/`cellData` arrays
  come back correctly alongside the existing geometry.
- Manual (EDH): open a real `postProcessing/**/VTK/*.vtk` from
  `examples/Helyx/complex` (or a `foamToVTK` run if none exists yet),
  confirm color-by-field + legend render, then the v2 slice/contour
  once built.

---

# Part G — Live residual & run dashboard

## Context

Grounded directly in `examples/Helyx/complex/log/` (real HELYX solver
output, not a synthetic example):

- **`helyxSolve_gen_10p.out`** etc. (up to 2.4 MB) — standard OpenFOAM/
  HELYX solver log: `Time = N` blocks, each containing lines like
  `AMG:  Solving for Up, Initial residual = ( 60.7 58.9 35.2 10.6 ), Final residual = ( 0.61 0.69 0.52 0.51 ), No Iterations 2`
  (vector fields as 4-tuples) and
  `smoothSolver:  Solving for k, Initial residual = 1, Final residual = 0.00084, No Iterations 15`
  (scalar fields), plus per-timestep
  `Region: region0 Courant Number mean: 1.71 max: 2298.1` and
  `ExecutionTime = 205.02 s  ExecutionStepTime = 11.35 s  ClockTime = 304 s`,
  ending in `End` / `Finalising parallel run`. This format is generic
  across OpenFOAM/HELYX solvers, not gen_10p-specific.
- **`check_convergence_gen_*.out`** — a bespoke Python monitor already
  part of this HELYX workflow, doing real convergence analysis: a
  mass-flow-delta check (`avg |Δ[i]-Δ[i-1]| ≤ 0.025 kg/s`, a 50-iteration
  moving-average window) and per-surface-probe scoring (raw/MA/std-dev
  thresholds per field, e.g. `Tmean`/`pStatmean`), reporting a
  percentage converged and writing PNG plots
  (`convergence_gen_*/mass_flow_delta_convergence.png`,
  `surface_probes/<field>/surface_convergence_<patch>_<field>.png`).
  This is strong prior art for what "important information" means here
  — the dashboard should speak this vocabulary (moving average, delta
  threshold, % converged) rather than invent new metrics.

## Design

- **`src/monitor/residualLog.ts`** (new, pure — no `vscode`, unit
  tested like `docs/parse.ts`): a streaming-friendly regex parser for
  the format above → `{ time, solver, field, initialResidual,
  finalResidual, iterations }[]` (vector residuals kept as a tuple, not
  collapsed — let the chart decide how to show them, e.g. max
  component) plus `{ time, courantMean, courantMax }` and
  `{ time, executionTime, stepTime, clockTime }` samples.
- **`src/monitor/logTail.ts`** (new) — incremental tail of the active
  log file: remembers the last byte offset read, only parses newly
  appended bytes on each poll/`fs.watch` event (the example logs already
  reach multi-MB; re-parsing whole files on every tick would not scale
  to a live run). Auto-detects the likely log file as the
  most-recently-modified `log.*`/`*.out` under the case root, with a
  manual override command.
- **`src/monitor/dashboardPanel.ts`** (new, same reusable-singleton
  pattern as `docs/docPanel.ts`: `enableScripts: true`, nonce'd script,
  themed with `--vscode-*`) — a live line chart (log-scale y-axis, one
  line per residual field) plus an info strip (current time step,
  Courant mean/max, `ExecutionTime`, iterations/sec); `logTail` pushes
  new points to the already-open panel via `postMessage`, no full
  re-render.
- **Convergence heuristic** — a trailing-window linear regression on
  `log(residual)` vs. iteration per field, mirroring
  `check_convergence_*.out`'s own moving-average/delta approach: flags
  a positive slope (diverging) or a near-zero slope well above the
  target tolerance (stalled) in the info strip. Plain arithmetic, no
  library, no bundled model — directly modeled on the bespoke script
  that's already part of this exact workflow.
- **Case Explorer integration** — a status decoration per case (idle /
  running / converged / diverged / stalled) derived from "the log file
  is still growing" + the regression above, and a command
  `OpenFOAM: Open Run Dashboard` from the case's context menu or next to
  the log file in the tree.
- **Explicitly deferred to a v2**: parsing the surface-probe / mass-flow
  data the example's own monitor already computes
  (`postProcessing/**/surfaceReport.dat`, per the glob patterns printed
  in `check_convergence_gen_10p.out`'s own settings dump) — the file
  patterns are already known, so this is a scoped follow-up, not a
  research gap, once the core residual dashboard exists.

## Files (Part G)

- `src/monitor/{logTail,residualLog,dashboardPanel}.ts` (new).
- `test/residualLog.test.ts` (new) — fixtures built from a **small,
  trimmed excerpt** of `examples/Helyx/complex/log/helyxSolve_gen_10p.out`
  committed to `test/fixtures/` (a few `Time =` blocks, not the full
  2.4 MB file), covering scalar + vector residual lines, the Courant
  line, and the `ExecutionTime` line.
- `src/providers/OpenFOAMCaseTreeProvider.ts` — status decorations +
  the dashboard command entry.
- `package.json` — `openfoam.monitor.openDashboard` command,
  `contributes.menus` entry on the Case Explorer / log files.

## Verification (Part G)

- `test/residualLog.test.ts` green against the trimmed real-log
  fixture — exact field names/values asserted, not approximate.
- Manual (EDH): point the dashboard at
  `examples/Helyx/complex/log/helyxSolve_gen_10p.out` directly (no live
  run needed for a first pass — tailing a static file that doesn't grow
  still exercises the full parse→chart path) and confirm the chart
  matches what `grep -E "Solving for|Courant"` shows in the raw file.
  A true live-tail check needs an actual running case, noted as a
  follow-up manual test once available.

---

# Part H — Parametric study: Dakota investigation + recommendation

## Context

Investigated Dakota "or any better tools" for parametric studies, with
a dashboard tied directly to the case setup. Verified (Sandia's own
site, fetched directly, not from training data alone):

- **Dakota** (Sandia National Labs) is real and actively maintained
  (current release cited as 6.24 on their site), for optimization,
  uncertainty quantification, calibration, sensitivity analysis, and
  design-of-experiments. It is a **standalone installed application**
  (C++/Fortran), not a library — distributed as its own
  download/installer, with native Linux/macOS support and Windows
  typically via WSL. It integrates with an external code like OpenFOAM
  through its documented **black-box interface**: each iteration, Dakota
  writes a parameters file, calls a user-supplied *analysis driver*
  script that (1) substitutes those parameters into the case's
  dictionaries — Dakota ships `dprepro`/`pyprepro` templating for
  exactly this — (2) runs the solver, (3) extracts a scalar/vector
  response, and (4) writes back Dakota's expected results-file format;
  Dakota then aggregates and decides the next iteration (grid, LHS,
  gradient-based optimization, UQ sampling, …).
- This is real, powerful, and **too heavy to bundle or require**: a
  separately-installed native application with weak native Windows
  support is a bad fit as a hard dependency for a VS Code extension.
  Right fit: an **optional, detected backend** for users who already
  have it — never a requirement.

## Recommendation: build the native sweep first, treat Dakota as an export target

**Tier 1 — native parametric sweep, zero external tools (build this
first).** Reuses infrastructure already built rather than inventing new
machinery:

- Reuse `src/scaffold/blockLocator.ts`'s safe dictionary-editing
  (`locateInsertion`, tree-sitter-based) to substitute a chosen key's
  value across a parameter grid or a simple Latin-Hypercube sample —
  this *is* Dakota's own "black-box" idea, just implemented directly in
  TypeScript instead of via an external driver script.
- Each combination becomes a cloned case directory
  (`<case>_variant_001/`, …) with the substituted values already
  written in place — no templating language needed, since the extension
  already has a real parser to find and replace the right dictionary
  entry.
- A dashboard webview — **sharing the chart component from Part G**
  rather than a new one — plots a chosen scalar result (final residual,
  a `postProcessing` function-object value, or a value the user points
  at) against each varied parameter, updating as each variant's run
  (tailed the same way as Part G) finishes.

**Tier 2 — optional Dakota export**, gated on detecting a `dakota`
binary on `PATH`: given the same parameter definitions from Tier 1,
generate a starting `dakota.in` (variables / interface / responses
blocks) plus an analysis-driver script wired to the same substitution
logic — so a user who wants Dakota's actual DOE/optimization/UQ
algorithms gets a working starting deck instead of hand-writing one
from scratch, while everyone else still gets a fully working dashboard
with no extra installs.

**Worth a mention, not a commitment:** **OpenTURNS** (a pure Python
uncertainty-quantification/sensitivity-analysis library, much lighter
to install than Dakota) as a secondary optional-export target later, if
proper sensitivity analysis is wanted without Dakota's native-app
weight. Not investigated in depth this round — flagged for a future
pass if Tier 1/2 aren't enough.

## Files (Part H)

- `src/parametric/{paramSet,sweepRunner,dakotaExport}.ts` (new);
  `dashboardPanel.ts` reused/extended from Part G rather than
  duplicated.
- `package.json` — `openfoam.parametricStudy.start` command; Tier 2's
  "Export as Dakota study" action only registered/shown once a `dakota`
  binary is detected on `PATH`.

## Verification (Part H)

- Unit: `paramSet`/`sweepRunner` against a small fixture dictionary,
  asserting N variant directories are created with the right
  substituted values and nothing else changed (mirrors the existing
  `blockLocator.test` style of exact before/after text assertions).
- Manual (EDH): run a 2-parameter × 3-value grid sweep against a small
  example case, confirm 9 variant directories, then confirm the
  dashboard updates as each variant's (fake, for the test) log file is
  tailed.
- Dakota export: with a real Dakota install available, confirm the
  generated `dakota.in` at least parses (`dakota -input dakota.in -check`)
  — deferred until Tier 1 is built and an environment with Dakota is
  available to test against.

