# Changelog

All notable changes to the OpenFOAM Dictionary Support extension are
documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/).

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
