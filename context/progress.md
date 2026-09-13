# Progress log

Tracks execution of `context/openfoam-extension-treesitter-instruction.md`,
phase by phase. See `/Users/arefmoalemi/.claude/plans/please-familiarize-yourself-with-abundant-spark.md`
for the full execution plan and discrepancies noted against the instruction
doc.

## 2026-09-09 — Phase 0: Safety net

**Status: done.**

1. **ESLint**: `.eslintrc.json` already existed (legacy format,
   `eslint:recommended` + `@typescript-eslint/recommended`) — contrary to
   the instruction doc's assumption that no config existed. Verified
   `npm run lint` runs clean with zero errors/warnings; no changes made.
2. **Test runner**: added `vitest` (`^5.0.0`) as a devDependency. Had to
   bump `@types/node` from `^18.0.0` → `^22.0.0` to satisfy vitest 5's
   peer dependency on `vite@^6||^7||^8` (which requires `@types/node`
   `^20.19||>=22.12`); safe since this only affects dev tooling types,
   not the bundled runtime (local Node is v22.23.2). Added
   `"test": "vitest run"` to `package.json` scripts, keeping `pretest`
   (compile) as-is so `npm test` still compiles first.
3. **CI**: added `.github/workflows/ci.yml` running
   `npm ci && npm run compile && npm run lint && npm test` on every push
   to `main` and every PR.
4. **Fixtures**: created `test/fixtures/`:
   - `openfoam/{fvSchemes,fvSolution,controlDict,U}` — copied verbatim
     from `examples/OpenFOAM/damBreak3D` (real OpenFOAM-13 case).
   - `helyx/{helyxHexMeshDict,boundary}` — copied verbatim from
     `examples/Helyx/simple` (`helyxHexMeshDict`, and
     `constant/polyMesh/boundary` as a real nested-block-list example).
   - `edge-cases/block-comment-with-braces.foam` and
     `edge-cases/multiline-list-value.foam` — **hand-authored**, since no
     file in `examples/` actually contains a block comment with embedded
     braces or an ASCII multi-line `nonuniform List<vector>` value (the
     only real multi-line list data on disk, `constant/polyMesh/points`,
     is binary-format and unusable as a text fixture). The multiline-list
     fixture also doubles as a quoted-block-name case
     (`"(inlet|outlet)"`) for later grammar corpus tests.
   - Added `test/fixtures.test.ts` (vitest) asserting each fixture exists/
     is non-empty plus a few content sanity checks (unbalanced brace
     inside block comment, `nonuniform List<vector>` present with >10
     list-item lines, `$internalField` reference in `U`).

**Verification**: `npm run compile`, `npm run lint`, `npm test` all pass
locally (11/11 tests), matching the exact command sequence CI runs.

**Deviations from the doc**: see discrepancy #1 (ESLint) and #2 (Helyx
examples restructured into `simple/`+`complex/`, only `simple/` used) in
the plan file referenced above.

**Next**: Phase 1 — scaffold `../tree-sitter-openfoam` as a new sibling
repo and port these fixtures into its `test/corpus/*.txt` format.

## 2026-09-09 — Phase 1: `tree-sitter-openfoam` standalone grammar

**Status: done.** Repo at `/Users/arefmoalemi/Documents/Github/tree-sitter-openfoam`
(sibling to this repo, git-initialized, not yet committed — left for the
user to commit when ready, per "never commit without being asked").

**Scaffold**: `tree-sitter init` requires an interactive TTY and hung
non-interactively (`IO error: not a terminal`), so the standard layout
(`grammar.js`, `tree-sitter.json`, `src/`, `queries/`, `test/corpus/`)
was hand-built instead of via the CLI wizard — functionally identical
output, confirmed by a clean `tree-sitter generate`.

**Grammar design** (`grammar.js`): blocks, entries (`key value* ;`),
`$reference` values, quoted strings/block-names, dimension sets
(`[0 1 -1 0 0 0 0]`), directives as first-class nodes
(`#include`/`#inputMode`/`#if`-`#else`-`#endif`/`#codeStream`/generic
fallback, each with a *fixed* arity to avoid the inherent ambiguity of
an open-ended "swallow following tokens" directive rule). Comments are
extras via plain regexes (no external scanner needed — block comments
correctly span multiple lines and absorb embedded braces via ordinary
regex, no special-casing required).

**Real bugs found and fixed by testing against every real file in
`examples/`** (not just the Phase 0 fixtures) — each is a concrete
instance of the "quoted strings / nesting" bug class the instruction
doc called out:
1. `[0 1 -1 0 0 0 0]` dimension-set brackets weren't a grammar
   construct at all — added `dimension_set`.
2. `$p_rghFinal;` (a bare merge-reference entry, no separate key) —
   added `merge_entry`.
3. `6\n(\n  patchName { ... }\n  ...\n)` — whole-file sized lists as
   used by `constant/polyMesh/boundary` — added `sized_list`.
4. `features ( { file "x"; ... } ... )` — anonymous (unnamed) blocks as
   list elements — made block names optional, which introduced a real
   LR ambiguity (`identifier '{'` between "named block" and "bare
   identifier value + separate anonymous block"), resolved via
   `prec.dynamic` + an explicit `conflicts` entry favoring the
   named-block reading.
5. **The identifier token originally included `(` `)` `,` as
   continuation characters** (to support `div(phi,U)`-style composite
   keys as a single regex token) — this silently swallowed genuine
   list-closing parens, e.g. `phases (water air);` mis-tokenized as
   `identifier("phases"` `identifier("water"` `identifier("air)"` with
   the list never closing, corrupting everything after it in the file.
   Fixed by splitting into a plain bareword token plus a real recursive
   `call_key` grammar rule (bareword + balanced parens), so arbitrary
   nesting balances correctly instead of relying on a flat regex —
   this is what let `div(((rho*nuEff)*dev2(T(grad(U)))))` (a genuine
   scheme key from `examples/OpenFOAM/damBreak3D/system/fvSchemes`)
   parse correctly, including a `.T()` member-call-chain variant and
   `thermo:mu|rho`-style colon/pipe characters found in Helyx fvSchemes.
6. `call_key`'s opening `(` had to be marked `token.immediate` —
   without it, `phases          (water air);` (key, whitespace, then an
   unrelated list value) wrongly merged into one call-key with no
   value, since whitespace is an extra and invisible to the grammar
   otherwise.
7. `cuttingPatches();` (Helyx `mapFieldsDict`) — a valid zero-data
   keyword entry. OpenFOAM's real `word` tokenizer treats `(`/`)`/`,`
   as ordinary word characters, so this is genuinely one atomic keyword
   with no value, not a syntax error. Relaxed `entry` from `value+` to
   `value*`.
8. `};` — a block closed with a redundant trailing semicolon (real
   Helyx `caseSetupDict`). Added `optional(";")` after a block's `}`.
9. `-60.` (trailing decimal point, no digits after) in Helyx
   `_snappyHexMeshDict` — the number regex required at least one digit
   after `.`; relaxed to zero-or-more.

**Verification**: after each fix, re-ran `tree-sitter parse` across
*every* real dict file in `examples/OpenFOAM/damBreak3D/**` and
`examples/Helyx/{simple,complex}/**` (excluding binary formats:
`.stl`/`.eMesh`/`.vtk`/`polyMesh/{points,faces,owner,neighbour}`), not
just the Phase 0 fixture set — ended at **zero `ERROR` nodes across the
entire corpus**, including the gitignored `examples/Helyx/complex/`
case. `test/corpus/` (28 tests across `basics.txt`, `lists.txt`,
`composite-keys.txt`, `comments.txt`, `directives.txt`,
`error-recovery.txt`) all pass via `tree-sitter test` / `npm test`.

**Error recovery** (`test/corpus/error-recovery.txt`): confirmed
against deliberately-broken input —
- unbalanced brace → localized `MISSING "}"` at EOF, everything before
  it still parses correctly;
- unterminated string → `ERROR` confined to after the last good entry;
- unterminated block comment → localized `ERROR` around the comment
  start, entries after it still recover and parse.
- **Documented known limitation**: a missing `;` produces *no* `ERROR`
  node at all — the following tokens silently merge into the same
  entry's value list, since the grammar has no way (without
  whitespace-sensitive tokenization) to tell "one more value" from
  "start of the next entry." Left as-is rather than over-fitting the
  grammar to one failure mode; flagged here for whoever next touches
  diagnostics (Phase 3) since schema validation may need its own
  guard against suspiciously long value lists.

**WASM build**: `npm run build-wasm` (`tree-sitter build --wasm`)
succeeds, produces `tree-sitter-openfoam.wasm` (16.6 KB), verified via
a clean-slate rebuild (`rm src/parser.c src/node-types.json
tree-sitter-openfoam.wasm && npm run generate && npm test && npm run
build-wasm`).

**Deviation — no native Node.js addon binding**: attempted a hand-written
N-API `bindings/node/binding.cc` per the doc's "produce both a native
binding ... and a WASM build" instruction. It compiled cleanly via
`node-gyp rebuild`, but the exported language object failed the
`tree-sitter` npm package's internal validation (`TypeError: Invalid
language object` from `Parser.setLanguage`) — getting this fully
correct requires boilerplate normally scaffolded by `tree-sitter init`
(which needs an interactive TTY, unavailable here). Rather than ship
broken/misleading native-binding code, it was removed. This isn't a
functional gap for this project: the CLI's own native compilation
already provides fast local dev/test iteration (`npm test`, confirmed
running all 28 corpus tests natively), and the actual consumer path for
Phase 2 is WASM + `web-tree-sitter`, which is built and verified. Noted
in the grammar repo's own README.

**CI**: `.github/workflows/ci.yml` added to the grammar repo running
`npm ci && npm run generate && npm test && npm run build-wasm`.

**Next**: Phase 2 — integrate `tree-sitter-openfoam` into this
extension via `web-tree-sitter`, replacing `getBlockPath()`/
`getCursorContext()` with tree queries and deleting the dead
`OpenFOAMParser.ts`.

## 2026-09-09 — Phase 2: integrate the grammar into the extension

**Status: done**, with one deliberately scoped-down item (live incremental
LSP sync — see below) and one form of verification substituted for
another (unit tests against the query layer instead of a live VSCode
Extension Development Host — see Verification).

1. **Dependencies**: added `web-tree-sitter` (`^0.27.0`) and
   `tree-sitter-openfoam` (`file:../tree-sitter-openfoam`, the sibling
   repo from Phase 1) as real `dependencies` (not dev-only — they need
   to ship in the packaged `.vsix`, relevant when Phase 5 revisits
   `.vscodeignore`). Smoke-tested WASM loading via `web-tree-sitter`
   from a plain Node script before writing any TypeScript, to isolate
   grammar-loading issues from compile/type issues.
2. **New shared module** `src/treeSitter/`:
   - `parser.ts` — `getParser()` loads the WASM grammar once per
     process (memoized) and returns a ready `Parser` instance;
     `parseText()` wraps `parser.parse()`.
   - `queries.ts` — pure functions operating on a `Tree`/position, used
     by both the language server and the outline provider (this is
     the "same tree, via tree-sitter queries, not a second parser"
     requirement): `nodeAtPosition`, `getBlockPath`, `getCursorContext`
     (block path + key-vs-value, replacing the old backward-scan
     heuristic), `wordAt` (smallest word-shaped node — identifier,
     string, number, `$reference` — replacing the `\w`-only regex),
     `dollarReferenceAt` (resolves a `$reference` node to its bare
     variable name), `isInsideComment`, and `buildOutline` (walks the
     tree into a block/entry symbol tree, transparently flattening
     `list`/`sized_list` wrappers so blocks nested inside a list, e.g.
     `constant/polyMesh/boundary`, still surface as outline entries).
3. **`server.ts`**: added a per-document `Map<uri, Tree>` cache,
   populated on `onDidOpen`/`onDidChangeContent` and cleared on
   `onDidClose`; `getCursorContext()`, `wordAt()`, and
   `isInsideComment()` are now thin wrappers delegating to
   `treeSitter/queries.ts` against the cached tree, with their original
   signatures/return shapes kept unchanged so every call site (hover,
   completion, definition, rename, signature help) needed no further
   changes. `getBlockPath()` is gone entirely (inlined into
   `getCursorContext`). `onHover`/`onDefinition` had a duplicated
   "rescan backwards for a preceding `$`" block each — both replaced by
   the new `dollarReferenceAt()` helper, which needed no duplication
   since `$reference` is already one atomic grammar token.
   `getFileType()` no longer round-trips through `getCursorContext()`
   just to read one field — it calls `detectFileType()` directly.
   `detectFileType()`/`diagXxx()` functions are untouched (Phase 3
   scope — they don't call any of the replaced functions).
4. **Deleted** `src/parsers/OpenFOAMParser.ts` (confirmed still zero
   importers) and its now-empty `src/parsers/` directory.
5. **`src/providers/OpenFOAMDocumentSymbolProvider.ts`** rewritten from
   its ~200-line independent regex/line-scanning parser to
   `buildOutline()` + a small `OutlineNode → vscode.DocumentSymbol`
   mapper. `getSymbolKind()`'s icon-selection heuristics were kept
   verbatim (they're a reasonable, independent piece of UX logic, not
   parsing logic) — `buildOutline()` now supplies the `detail` (value
   text) they inspect instead of the regex parser reconstructing it.
6. **Incremental vs. full reparse latency** (`scripts/benchmark-treesitter.js`,
   kept as a reusable script): on `examples/Helyx/complex/system/helyxHexMeshDict`
   (378 lines, 16 KB — the largest `*HexMeshDict` fixture available),
   simulating a single-character edit, averaged over 200 runs:
   **full reparse 1.46 ms/parse vs. incremental (`tree.edit()` +
   `parser.parse(text, editedTree)`) 0.21 ms/parse — a 6.9x speedup**.

**Deviation — live LSP sync stays full-reparse, not `tree.edit()`-based**:
`server.ts` re-parses the whole document text on every
`onDidChangeContent`, rather than wiring true incremental edits into
the live server. The LSP client already negotiates
`TextDocumentSyncKind.Incremental` and sends range-based deltas, but
the `vscode-languageserver` `TextDocuments` wrapper consumes
`connection.onDidChangeTextDocument` internally to reconstruct full
text and only exposes the *result* via `onDidChangeContent` — registering
a second handler on that same connection notification to intercept the
raw `contentChanges` ranges would replace (not augment) the wrapper's
own handler, since LSP JSON-RPC connections dispatch one handler per
notification type, breaking document sync entirely. Full reparse is
correct and safe, and — per the benchmark above — still sub-2ms even on
the largest available fixture, so this isn't a user-facing regression;
it's flagged here because the doc's Phase 2.7 wording ("confirm the
incremental-parsing benefit is actually being used") implies wiring it
into the live path, and this doesn't. Revisiting it would mean either a
custom `TextDocuments`-like wrapper that exposes raw edits, or
computing a diff between old/new full text (as the benchmark script
does) on every change — both deferred as unnecessary complexity given
current latency is already well within interactive budget.

**Verification**:
- `npx tsc -b` and `npm run lint` both clean.
- New `test/treeSitter.test.ts` (31 tests total across both vitest
  files) exercises the actual query functions `server.ts` and the
  outline provider now call, against real fixtures: zero-`ERROR`
  parsing, `getBlockPath`/`getCursorContext` correctness on a real
  nested one-liner (`boundaryField { atmosphere { type ...; } }`),
  `wordAt` resolving `alpha.water` and `div(phi,U)` as single tokens
  (the concrete defects Phase 1 fixed, now proven end-to-end through
  the same code path the server uses), `dollarReferenceAt` on a real
  `$internalField` reference, `isInsideComment` against the
  block-comment-with-braces fixture, and `buildOutline` producing a
  correct nested block/entry tree plus flattening
  `constant/polyMesh/boundary`'s sized-list-of-blocks into outline
  entries.
- **Not done**: driving a live VSCode Extension Development Host to
  manually exercise hover/completion/outline in the editor UI — this
  environment has no way to launch/interact with a GUI VSCode window.
  Substituted with the unit tests above, which hit the identical
  underlying functions; this is a real verification gap for
  UI-level regressions (e.g. LSP message wiring, completion trigger
  characters) that only manual or `@vscode/test-electron`-based testing
  would catch. Recommend the user do a manual smoke pass in the
  Extension Development Host before relying on this in daily use.
- `npm run compile && npm run lint && npm test` all pass together
  (the exact CI sequence).

**Next**: Phase 3 — schema-driven diagnostics: generic
`validate(tree, schema): Diagnostic[]` reusing `FieldSpec` from
`data/keyword-db.json`, replacing the 8 hand-written `diagXxx()`
functions, plus raw parse-`ERROR` surfacing (new capability) and schema
coverage for the currently-unschemed file types.

## 2026-09-09 — Phase 3: schema-driven diagnostics

**Status: done**, with a deliberately conservative scope decision on
which of the ~14 currently-unschemed file types actually got new
coverage — see the table and rationale below.

**Deviation from the doc's framing**: the doc says "Replace the 8
hand-written `diagXxx()` functions with calls into this generic
validator." In practice, inspecting all 8 showed none of them actually
overlap with the generic unknown-key/missing-required/enum shape — they're
all genuinely bespoke cross-field or cross-file checks (`adjustTimeStep`
requires `maxCo`, `PIMPLE` requires `nOuterCorrectors`, vertex indices
must be in range, scheme/solver names must exist in the registry, ...).
So the generic validator is **additive**, not a replacement: `diagSchema()`
runs alongside the untouched `diagXxx()` functions in `diagnose()`, and
is a wholly new diagnostic capability (these 8 file types had zero
unknown-key/missing-required-key/enum checking before this).

**New module** `src/treeSitter/schema.ts`: `DictSchema`/`FieldSpec`
(matching `data/keyword-db.json`'s existing shape), `validate()`
(top-level), `validateBlock()` (one named nested block, e.g.
`castellatedMeshControls`), `validateSyntaxNode()` (arbitrary node —
used for per-patch boundary-condition validation), `validateBoundaryConditions()`
(walks every patch in `boundaryField { ... }`, looks up its `type`
against `db.boundaryConditions`, validates the patch's keys against that
BC's `keywords`), and `collectParseErrors()` (walks the tree for
`ERROR`/`isMissing` nodes — the new raw-parse-error-as-diagnostic
capability, wired unconditionally for **every** file type in `diagnose()`,
not just the schema-covered ones). New `src/treeSitter/knownSchemas.ts`
holds hand-authored coarse top-level schemas for file types whose real
content is mostly dynamic (scheme/solver names looked up elsewhere) —
kept separate from `keyword-db.json` since they're not extracted from
source.

**Two real bugs found and fixed while building this**:
1. `entry.childrenForFieldName('value')` returns the grammar's `value`
   *wrapper* node (type `"value"`), not the actual `identifier`/
   `dollar_reference`/etc. node inside it — my first type-check pass
   compared against the wrapper and so never actually detected
   `$reference` values, silently flagging them against `options` enums.
   Fixed with an `unwrapValue()` helper.
2. **Pre-existing bug, unrelated to Phase 3 itself**: `KeywordDb`'s
   TypeScript interface declared `controlDict`/`blockMesh`/`snappyHexMesh`
   as flat `Record<string, FieldSpec>`, but `data/keyword-db.json`
   actually nests them one level deeper (`controlDict.keywords`,
   `blockMesh.keywords`, and `snappyHexMesh.{castellatedMeshControls,
   snapControls,addLayersControls,meshQualityControls}`). This silently
   broke `controlDict`/`blockMeshDict` hover and completion, and made the
   `snappyHexMeshDict` completion fallback offer the 4 category *names*
   (`castellatedMeshControls`, ...) as if they were real keywords instead
   of the ~50 actual keywords inside them. Found because the new
   schema validator needed correct access paths; fixed the interface and
   all 4 call sites (`server.ts:1050`, `1403`, `1517`, and the
   `snappyHexMesh` fallback, which now merges all 4 categories).

**Verification discipline**: after wiring each schema, ran a throwaway
broad-scan script (`test/schema-broad-scan.test.ts`, kept as
`describe.skip` — a manual diagnostic aid, not part of the enforced
suite) against **every real file of that type across the entire
`examples/` tree** (OpenFOAM + Helyx `simple` + Helyx `complex`), the
same discipline used for the Phase 1 grammar work. This caught real
findings before they became false positives in the shipped tool:
- `solver` (OpenFOAM 9+'s modular-solver alternative to `application`)
  and `maxAlphaCo`/`graphFormat` missing from `data/12_controlDict.json`;
  `writeCompression` too strictly typed as boolean-only (real OpenFOAM
  also accepts `compressed`/`uncompressed`).
- `convertToMeters` (older alias for `scale`) and `patches` (alternate
  name for `boundary`) missing from `data/10_blockMesh.json`; `boundary`
  was wrongly `required: true` (Helyx's example uses `patches` instead).
- `psi`/`gamma` missing from `prghTotalPressure`, `gradient` missing from
  `fixedFluxPressure` in `data/04_boundary_conditions.json`.
- `cache`/`blockSolver` missing from the hand-authored fvSolution
  top-level schema.
- A recurring real-world quirk: `roots();` and `cuttingPatches();`
  (no space before empty parens) tokenize as **one** atomic keyword
  (`"roots()"`, `"cuttingPatches()"`) per the grammar's faithful
  reproduction of OpenFOAM's own whitespace-sensitive word tokenizer
  (same mechanism as the `div(phi,U)` composite-key handling from
  Phase 1) — added as explicit alternate schema keys rather than
  special-cased in the validator.
- **The real, substantial Helyx-vs-OpenFOAM keyword gap**: applying the
  OpenFOAM-only `snappyHexMesh` schema to real `helyxHexMeshDict` files
  produced 60+ false-positive "unknown key" warnings (`locationsInMesh`,
  `wrapper`, `crackDetection`, `meshMode`, `featureAngleMerge`, and many
  more genuine Helyx extensions). This is the exact gap the instruction
  doc's own Phase 5 step 3 flags as unresolved ("helyxHexMeshDict ...
  zero Helyx-specific data anywhere") — rather than silently shipping
  those false positives, `diagSchema()` explicitly excludes
  `helyxHexMeshDict` from the generic snappy-family schema checks (the
  bespoke `diagSnappyHexMesh()` geometry cross-checks still run for both,
  since those aren't schema-shaped and don't have this problem). All
  fixes above were re-verified against the full `examples/` corpus after
  each change — the broad scan ended at a **single remaining, documented,
  non-issue** (the `roots()` tokenization quirk, before it too was fixed).

**Coverage table** (per the doc's Phase 3 exit-criteria ask):

| File type | Schema-backed? | Notes |
|---|---|---|
| controlDict | **Yes** (real `data/` extraction) | unknown key, missing required, enum |
| blockMeshDict | **Yes** (real `data/` extraction) | |
| decomposeParDict | **Yes** (real `data/` extraction) | |
| snappyHexMeshDict | **Yes** (top-level + 4 sub-dicts) | |
| helyxHexMeshDict | No — deliberately excluded | real Helyx keywords not modeled; bespoke geometry checks (`diagSnappyHexMesh`) still apply |
| fvSchemes | Partial (top-level block names) | per-scheme dynamic entries not deep-validated (looked up via `db.schemes` in the existing `diagFvSchemes` instead) |
| fvSolution | Partial (top-level block names) | ditto (`diagFvSolution` covers solver-name validity) |
| turbulenceProperties | Partial (`simulationType`/`RAS`/`LES` presence + enum) | per-model coefficients not validated (`diagTurbulence` covers `RASModel` validity) |
| boundaryField | **Yes — new**: per-patch BC keyword validation via `validateBoundaryConditions()` | plus the existing patch-name-vs-`polyMesh/boundary` cross-check (`diagBoundaryField`) |
| regionProperties | **Yes — new** | |
| phaseProperties | **Yes — new** | |
| mapFieldsDict | **Yes — new** | |
| transportProperties | No | dynamic per-phase structure, no extracted schema data exists |
| thermophysicalProperties | No | `db.thermophysical` data exists (model-chain shape) but wiring the dynamic `thermoType`→model-coefficient recursion was out of scope for this pass |
| dynamicMeshDict | No | top-level is highly version/model-dependent (`topoChanger`/`dynamicFvMesh`/`motionSolver` variants) |
| RASProperties | No | top-level always includes a dynamic `<Model>Coeffs` block whose name can't be predicted — would false-positive on every real file |
| topoSetDict, fvOptions, sampleDict | No | dynamic per-action/per-option/per-sample-type structure |
| setFieldsDict | No | this repo's only example file has no real field-setting content to ground a schema against |
| createPatchDict, refineMeshDict, surfaceFeatureExtractDict, materialProperties | No | no real example file in this repo to ground a schema against (or, for surfaceFeatureExtractDict, not attempted this pass) |
| caseSetupDict | No | Helyx-only, same gap as `helyxHexMeshDict` (doc's Phase 5) |
| `g`, `rho`, `mu`, `nu`, and other bare field files not matching `boundaryField`'s detection | No dedicated schema | generic checks only (brace balance, FoamFile header, now also raw parse errors) |

**Raw parse-`ERROR` surfacing**: confirmed universal — wired
unconditionally in `diagnose()` whenever a tree is available, regardless
of file type, so even the "No" rows above now get real parser-backed
error detection they never had before (e.g. an unbalanced brace now
reports a precise `MISSING "}"` location instead of only the old
generic whole-file brace-count check).

**Verification**: `test/phase3-diagnostics.test.ts` — one valid-fixture
(zero diagnostics) + one deliberately-broken test per newly-schema-backed
type (11 types × ~2 tests = 24 tests). `test/schema.test.ts` (9 tests)
covers the validator engine itself against the real `controlDict`
schema plus `validateBlock`/`collectParseErrors`. `npx tsc -b`,
`npm run lint`, and `npm test` all pass (64 tests total across 4 files,
1 diagnostic-aid file intentionally skipped in the enforced run).

**Next**: Phase 4 — context-aware completion: filter boundary-condition
completions by `bc.appliesTo` matching the current field's value type
(currently lists all BCs unconditionally), surface `FieldSpec.required`
entries first via `sortText`, and fix the unknown-file-type completion
fallback that currently suggests irrelevant scheme/controlDict keywords
for `transportProperties`/`thermophysicalProperties`/truly-unknown files.

## 2026-09-10 — Phase 4: context-aware completion

**Status: done.** All 5 checklist items implemented and tested.

1. **Boundary-condition completion filtered by field type**
   (`server.ts`'s `type` value branch inside `boundaryField`/patch
   completion): added `detectFieldValueType(doc)` — reads the FoamFile
   `class` field (`volVectorField`→vector, `volScalarField`→scalar, etc.,
   authoritative when present) with a filename-convention fallback (`U`→
   vector; `p`/`k`/`epsilon`/.../`alpha*`→scalar). The actual filtering
   is a new pure function, `boundaryConditionsForFieldType()` in
   `treeSitter/schema.ts` (kept separate from the LSP class so it's
   directly testable against the real `data/keyword-db.json`), used by
   both `server.ts` and — importantly — proven correct with real data:
   `noSlip`/`pressureInletOutletVelocity` (vector-only) no longer appear
   while editing `p`, and `totalPressure`/`fixedFluxPressure`
   (scalar-only) no longer appear while editing `U`; BCs with no
   `appliesTo` restriction (`fixedValue`, `zeroGradient`, ...) still
   appear for both, and an undetectable field type falls back to
   offering everything rather than silently hiding options.
2. **Required keys surface first**: `addKeywords()` (the shared helper
   used by `controlDict`/`blockMeshDict`/`decomposeParDict` completion)
   and the `snappyHexMeshDict` fallback's merged-keyword loop now sort
   required entries before optional ones, and prefix the detail text
   with `(required)`. Note on mechanism: `filterAndSortCompletions()`
   re-ranks every item by fuzzy match score against the typed prefix and
   *overwrites* `sortText` in the process, so a plain `sortText` value
   set here would just get discarded — since `Array.sort` is stable,
   inserting required items into the array first is what actually
   surfaces them ahead of equally-relevant optional ones (the doc's "via
   sortText **or equivalent**" — this is the equivalent).
3. **Fixed the unknown-file-type completion fallback**: it was
   unconditionally suggesting `solvers`/`SIMPLE`/`PIMPLE`/`ddtSchemes`/
   `gradSchemes`/`divSchemes`/`laplacianSchemes`/`boundaryField`/
   `dimensions`/`internalField` for *any* file type without a specific
   completion branch — including the Phase 3 additions
   (`regionProperties`, `phaseProperties`, `mapFieldsDict`) and
   `transportProperties`/`thermophysicalProperties`, where suggesting
   `SIMPLE`/`ddtSchemes` is simply wrong. Now offers only the `FoamFile`
   header snippet, which is genuinely generic to every dict file.
4. **Multi-line/nested-one-liner completion contexts**: added fixture
   tests exercising `getCursorContext()` (the Phase 2 tree-query
   replacement for the old backward-scan) inside a real multi-line
   `nonuniform List<vector>` value and a nested one-liner
   `boundaryField { inlet { type ...; value ...; } }` — both correctly
   resolve `blockPath`/`cursorIn`/`currentKey`, confirming the context
   `onCompletion` dispatches on on is trustworthy for these shapes.
5. **Signature help rewritten to use tree structure** — and this
   surfaced a real, likely-always-broken bug: the old `onSigHelp` took
   `line.trim().split(/\s+/)[0]` (the current line's first
   whitespace-separated token) as "the scheme name". For the extremely
   common single-line form `div(phi,U)   Gauss linearUpwind grad(U);`,
   that first token is `div(phi,U)` — the entry's **key**, never a valid
   scheme name — so `schemeName in members` could never match and
   signature help could never actually fire for this shape. New
   `signatureHelpContext()` in `treeSitter/queries.ts` instead finds the
   enclosing `entry` node and reads its actual first **value** token
   (`"Gauss"`), with `activeParameter` computed from how many value
   nodes have started at/before the cursor position. Verified against a
   composite scheme (`Gauss linearUpwind grad(U)`): resolves `schemeName
   = "Gauss"` regardless of cursor position within the value, with
   `activeParameter` advancing from 0 to 1 as the cursor moves past the
   first argument — and against a real line from the `fvSchemes` fixture
   (`div(phi,alpha) Gauss vanLeer;`).

**Verification**: `test/phase4-completion.test.ts` (11 tests) — 4 on
`boundaryConditionsForFieldType()` against the real `db.boundaryConditions`
(the "U vs p yields different BCs" demonstration the doc's Phase 4 exit
criteria ask for), 5 on `signatureHelpContext()` including the composite-
scheme and real-fixture cases, 2 on cursor context inside multi-line/
nested-one-liner shapes. `npx tsc -b`, `npm run lint`, and `npm test` all
pass (75 tests total across 5 files, 1 diagnostic-aid file skipped).
Same caveat as Phase 2: no live VSCode Extension Development Host
available in this environment to manually confirm the completion popup
UI itself — verified via unit tests against the exact functions
`onCompletion`/`onSigHelp` now delegate to, not the LSP message round-trip.

**Next**: Phase 5 — packaging and scope honesty: trim `.vscodeignore`
(currently doesn't exclude `examples/**`, so the `.vsix` ships large STL
files today), report `vsce package` size before/after, and resolve the
`helyxHexMeshDict`/`caseSetupDict` Helyx-schema gap this phase's own
work ran into directly (extract real Helyx keyword data, or explicitly
drop them from the supported-filenames list — state and justify the
choice).

## 2026-09-10 — Phase 5: packaging and scope honesty

**Status: done.**

1. **Helyx schema gap — resolved via option (a)** (extract real Helyx
   keyword data), not option (b) (remove from package.json). Wrote a
   small Node script that diffed every real key actually used across
   every `helyxHexMeshDict*` file in `examples/` (top-level + all 4
   `snappyHexMesh` sub-dicts) against the existing OpenFOAM-only schema,
   producing exact lists of genuine Helyx-specific extension keywords
   (`src/treeSitter/knownSchemas.ts`: `HELYX_SNAPPY_EXTRA_TOP_LEVEL_KEYS`,
   `HELYX_CASTELLATED_EXTRA_KEYS`, `HELYX_SNAP_EXTRA_KEYS`,
   `HELYX_ADD_LAYERS_EXTRA_KEYS`, `HELYX_MESH_QUALITY_EXTRA_KEYS` — ~90
   keys total, e.g. `locationsInMesh`, `wrapper`, `crackDetection`,
   `meshMode`, `nOuterIter`, `dualConcaveCollapse`). These extend (not
   replace) the real OpenFOAM `data/keyword-db.json` schema at runtime
   via a new `withExtraKeys()` helper, marked `required: false` since
   only the key *names* are grounded in real usage, not their deeper
   semantics. Also relaxed `castellatedMeshControls.locationInMesh` from
   required to optional, since Helyx substitutes the plural
   `locationsInMesh` instead (`helyxCastellatedSchema()`). Wired into
   both `diagSchema()` (diagnostics) and `addSnappyCompletions()`
   (completion) for `helyxHexMeshDict`, previously excluded from both.
   Re-verified against the full `examples/` corpus: zero false
   positives, including on the large `Helyx/complex` case.
   - **`caseSetupDict` — deliberately left uncovered**, and this is a
     materially different situation from `helyxHexMeshDict`: inspecting
     the real examples (395 and 755 lines) shows a deeply nested,
     dynamic meta-configuration format (`global.system.controlDict.*`,
     `global.system.fvSchemes.*`, dynamic `functions.<name>` blocks, …)
     with **no OpenFOAM baseline to extend** — unlike the snappy family,
     where ~90 flat keyword names could be layered onto a real existing
     schema, `caseSetupDict` would need an entirely hand-built schema
     from scratch, well beyond what two example files can responsibly
     ground. Left in the same bucket as Phase 3's other uncovered types
     (fvOptions, topoSetDict, RASProperties, ...): not removed from
     `package.json` — it still gets genuine tree-sitter-backed parsing,
     hover, outline, rename, and the universal parse-error/brace/
     FoamFile-header diagnostics, which is real functionality even
     without a bespoke deep schema.
2. **`.vscodeignore`**: added exclusions for `examples/**` (chose to
   exclude rather than ship for an "insert example" feature — no such
   feature exists), `context/**`, `data/01_*.json`–`data/12_*.json` +
   the legacy `openfoam-keywords.json`/`openfoam-solvers.json` (confirmed
   via `loadDb()` that only `data/keyword-db.json` is read at runtime),
   `scripts/**` and `test/**` (dev-only), `.github/**`, `LINKEDIN_POST.md`,
   `_logo.png`, `package-lock.json`, `tsconfig.tsbuildinfo`. Explicit
   negated patterns confirm `node_modules/tree-sitter-openfoam/**` and
   `node_modules/web-tree-sitter/**` (both needed at runtime) aren't
   accidentally caught by anything broader added later.
3. **Real packaging blocker found and fixed**: `vsce package` failed
   outright (`invalid relative path:
   extension/../tree-sitter-openfoam/node_modules/tree-sitter-cli/...`).
   `npm install` had installed the local `file:../tree-sitter-openfoam`
   dependency as a **symlink** (default npm behavior for local `file:`
   deps) rather than a copy — fine for co-development (edits to the
   grammar repo are immediately visible), fatal for packaging (a VSIX
   can't contain a path outside its own root, and vsce followed the
   symlink to the full grammar repo including its own `node_modules`).
   Fixed by adding `.npmrc` (`install-links=true`), which makes
   `npm install` produce a real, self-contained copy — confirmed it
   still respects `tree-sitter-openfoam/package.json`'s `files` field
   (196 KB copied: `grammar.js`, `src/`, `queries/`, the `.wasm`, no
   `node_modules`), so no scope creep. This is the correct long-term
   behavior for this repo; whenever `tree-sitter-openfoam` is eventually
   published to npm, the dependency should switch from `file:` to a real
   semver range, at which point `.npmrc`'s `install-links` no longer
   matters for it.
4. **`vsce package` size**: **35.75 MB → 2.03 MB** (before/after
   isolated to just the `.vscodeignore` change, both measured with the
   symlink fix already applied so the comparison is apples-to-apples).
   Before running the real "before" measurement, a first attempt with
   the *broken* symlink dependency didn't even produce a package at all
   — worth noting since it means packaging was silently non-functional
   the moment the tree-sitter dependency was added in Phase 2, until
   this fix.
5. **End-to-end packaged-runtime smoke test**: extracted the packaged
   `.vsix` to a scratch directory and ran a script using the exact same
   `require("web-tree-sitter")` / `require.resolve("tree-sitter-openfoam/
   tree-sitter-openfoam.wasm")` bare-specifier calls `treeSitter/parser.ts`
   uses (not an absolute-path require, which behaves differently against
   `web-tree-sitter`'s conditional `exports` map and would give a
   false failure) — confirmed the grammar loads and parses correctly
   from within the actual packaged file layout, not just from the dev
   `node_modules`.
6. **`CHANGELOG.md`**: added, with a detailed `[Unreleased]` section
   covering the full tree-sitter architectural change (new external
   `tree-sitter-openfoam`/`web-tree-sitter` dependencies), diagnostics,
   completion, Helyx support, and packaging changes from Phases 1–5;
   terse note on pre-existing versions (no changelog existed before).

**Verification**: `npm run compile && npm run lint && npm test` all pass
(79 tests, 1 diagnostic-aid file skipped). New Helyx fixture tests
(`test/phase3-diagnostics.test.ts`) confirm the real `helyxHexMeshDict`
fixture now validates clean, a genuine typo is still caught, and
`locationInMesh` is correctly non-required. Packaging verified two ways:
`vsce package` file-tree listing, and the extracted-package smoke test
above.

**Deviation from the doc's literal Phase 5 checklist**: item 3's
"extract a real Helyx keyword schema using the same `scripts/01`–`13`
pattern" wasn't literally followed — those scripts parse actual OpenFOAM
*source code*, which isn't available in this environment (only Helyx's
compiled *output*, i.e. example dict files, is). Used the example files
as the grounding source instead, exactly as the doc's own fallback
wording allows ("using the Helyx examples in the repo as reference for
actual dict shape"). This means the ~90 Helyx-specific keys are
confirmed-real names but not confirmed `required`/`type`/`options`
semantics (all marked `required: false`, undocumented type) — a
deliberate, disclosed precision trade-off, not an oversight.

**Next**: Phase 6 — ongoing hardening (continuous, no fixed end state):
every future bug gets a reproducing corpus/fixture test before the fix;
`tree-sitter-openfoam` should be versioned and pinned deliberately once
published rather than auto-bumped; the future Python-based agentic CFD
platform should consume the published `tree-sitter-openfoam` package
rather than writing a third parser; and `onDocumentFormatting` should be
revisited to confirm it also moves off text-scanning once diagnostics
have had more real-world mileage.

## 2026-09-10 — Audit pass: verify Phases 0–5, remove dead code

Requested review before moving to Phase 6: re-verify every phase's
checklist against actual code state, and remove anything genuinely
unused/redundant. Findings:

1. **Real regression caught and fixed**: `test/schema-broad-scan.test.ts`
   (the manual Helyx-verification diagnostic aid from Phase 5) had lost
   its Helyx-specific scan additions — traced to the `sed -i.bak` +
   `mv *.bak` pattern used to toggle `describe.skip` on/off for manual
   runs during Phase 5; at some point a `.bak` restore clobbered a
   newer edit. Re-added the Helyx scan lines using the Edit tool instead
   (not sed/mv) and re-verified: zero false positives across the full
   `examples/` corpus, Helyx included. Note this was a regression in a
   `describe.skip`'d convenience script only, never part of the enforced
   suite — the actual correctness claim (Helyx schema validation works)
   was independently and correctly verified the whole time by
   `test/phase3-diagnostics.test.ts`'s permanent Helyx tests, which never
   regressed. Lesson: prefer the Edit tool over `sed -i.bak`/`mv` for
   temporary toggles on files with uncommitted edits — the backup/restore
   dance is a real footgun when edits happen between the backup and the
   restore.
2. **Dead code removed**: `validateSyntaxNode`, `directBlocks`,
   `directEntry`, `entryValueText` (`treeSitter/schema.ts`) and
   `nodeAtPosition` (`treeSitter/queries.ts`) were `export`ed but never
   used outside their own file (only internally, by
   `validateBoundaryConditions()`/the module's other functions
   respectively) — un-exported them to tighten the modules' actual
   public surface.
3. **Duplicate type definition removed**: `server.ts` had its own local
   `interface FieldSpec` that was structurally identical to the one
   `treeSitter/schema.ts` now defines. Removed the duplicate and import
   `FieldSpec` from `treeSitter/schema.ts` instead — confirmed via a
   clean `tsc -b` that the two really were identical (no type errors
   from the switch).
4. **Redundant diagnostic removed**: `diagnose()`'s old hand-written
   brace-counting check (`Unclosed '{' block` / `Extra '}'`) and the new
   `collectParseErrors()` (Phase 2/3) now both fire for the same
   unbalanced-brace input — confirmed by parsing a deliberately-broken
   fixture and inspecting the tree (`(MISSING "}")`), which
   `collectParseErrors()` already reports with a precise location.
   Removed the old counter: it was not just redundant but strictly
   worse (a per-line character counter with no concept of quoted
   strings — `pattern "{not a brace}";` would have miscounted; the real
   parser handles this correctly, which was rather the entire point of
   Phase 1).
5. **Fixed a fabricated URL** in `CHANGELOG.md`: had written
   `[tree-sitter-openfoam](https://github.com/Arefhm94/tree-sitter-openfoam)`
   as if the grammar repo were already published there — it's a local,
   uncommitted repository only. Corrected to plain text with an explicit
   "not yet published or pushed anywhere" note.
6. **Verified NOT broken/missing**: re-ran the full checklist for
   Phases 0–5 against actual code (grammar repo's `npm test` — 28/28;
   extension's `tsc -b`/`lint`/`vitest run` — 79/79 plus 1 intentionally
   skipped; `src/parsers/` confirmed fully removed, no empty dirs;
   `package-lock.json` confirmed in sync via idempotent `npm install`;
   all edited `data/*.json` files confirmed valid JSON).
7. **Found, not fixed — pre-existing, out of this instruction's scope**:
   - `README.md` documents an "Inspector Panel" feature and an
     "OpenFOAM: Open Inspector" command (lines ~68–101) that no longer
     exist anywhere in the code — `InspectorPanel.ts` was deleted and
     replaced by `GeometryPreviewPanel.ts` in a commit that predates
     this entire tree-sitter effort (visible in the repo's git history
     from before Phase 0 started). Flagging rather than rewriting,
     since it's unrelated to the tree-sitter migration and a README
     rewrite of that scope should be a deliberate, separate decision.
   - `npm audit` shows 2 high-severity ReDoS advisories
     (`brace-expansion`, `minimatch`) in transitive dependencies of
     `vscode-languageclient` (a pre-existing dependency, untouched by
     this work). Not fixed here — `npm audit fix` could change
     `vscode-languageclient`'s resolved version, which is the kind of
     dependency change that should be a deliberate, asked-for action,
     not a side effect of an unrelated cleanup pass.

**Verification**: `tsc -b`, `npm run lint` (both `src` and `test`),
`npm test` (extension: 79 passed/1 skipped) and `npm test` (grammar
repo: 28/28) all pass after every change above.

## 2026-09-10 — Release: 0.7.0, and a real CI-breaking bug found in production

Bumped to `0.7.0`, updated `CHANGELOG.md`, added a plain-language
"What's New" section to `README.md` (and fixed several stale README
sections describing the removed Inspector Panel command, which predates
this work). Built and locally verified the `.vsix` package.

**Real bug found the hard way**: the user pushed and ran CI, which
failed in ~13s, and separately hit Marketplace publish timeouts. The CI
failure was real and mine to have caught earlier: `package.json`'s
`tree-sitter-openfoam` dependency was `file:../tree-sitter-openfoam` —
a path to a **sibling directory that only exists on the local dev
machine** (the grammar repo from Phase 1, never pushed anywhere).
`npm ci` in GitHub Actions checks out only this repo, so that path
never resolves and `npm ci` fails immediately — matching the fast
13-second failure. This was flagged in the Phase 5 log as a known
future concern ("switch to a real semver range once published to npm")
but its severity was understated: it didn't just affect eventual
publishing, it broke CI on every single push from the moment the
dependency was added in Phase 2, and would have broken `npm install`
for anyone else who ever cloned this repo.

**Fix**: vendored the grammar package's built output (`grammar.js`,
`src/`, `queries/`, `tree-sitter.json`, the compiled `.wasm` — exactly
what `tree-sitter-openfoam/package.json`'s `files` field already
scoped it to) into `vendor/tree-sitter-openfoam/` inside this repo, and
changed the dependency to `file:vendor/tree-sitter-openfoam` — a path
*inside* the checked-out repo, so `npm ci` can resolve it anywhere,
including a fresh CI runner. Added `vendor/**` to `.vscodeignore` (only
needed for `npm install` to resolve from; the real installed copy in
`node_modules/tree-sitter-openfoam` is what actually ships). Verified
by simulating CI exactly: `rm -rf node_modules && npm ci && npm run
compile && npm run lint && npm test` — all pass from a clean state.
Rebuilt `.vsix`: unchanged size (2.03 MB), confirming `vendor/` was
correctly excluded from the shipped package.

This is a stopgap, not the long-term fix — once `tree-sitter-openfoam`
is published to npm (or at minimum pushed to its own GitHub repo), the
dependency should switch to a real semver range or a git URL, and
`vendor/tree-sitter-openfoam/` should be deleted. Vendoring makes the
repo self-contained and CI-safe *today* without requiring an external
publish decision to be made under pressure while mid-release.

The Marketplace `Request timeout: /_apis/gallery` errors are unrelated
— a separate, transient network issue between `vsce` and the Marketplace
gallery API, not a problem with the package or this fix.

**Correction to the above**: the first pass at this fix was verified
insufficiently and was actually still broken. After changing
`package.json` and running a plain `npm install`, `rm -rf node_modules
&& npm ci && npm test` appeared to pass — but that was misleading:
`package-lock.json`'s `node_modules/tree-sitter-openfoam` entry still
had `"resolved": "file:../tree-sitter-openfoam"` (the *old* sibling
path) even after the `package.json` change and a plain `npm install`;
npm doesn't always re-resolve an already-satisfied lockfile entry just
because the declared dependency string changed. The `npm ci` "pass" was
silently reading from the still-present sibling directory, not the
vendored copy — so the fix was cosmetic, not real, and would have
failed in actual CI exactly as before. Caught by actually testing the
claim properly: temporarily renamed the sibling directory out of the
way and re-ran `rm -rf node_modules && npm ci` — this reproduced the
exact `ENOENT ... tree-sitter-openfoam/package.json` failure, proving
the first fix hadn't worked. Resolved by `npm uninstall
tree-sitter-openfoam && npm install tree-sitter-openfoam@file:vendor/tree-sitter-openfoam`,
which forced npm to genuinely re-resolve and rewrite
`package-lock.json`'s `resolved` field to `file:vendor/tree-sitter-openfoam`.
Re-ran the same sibling-hidden test again: `npm ci` and the full
`compile`/`lint`/`test` pipeline now pass with the sibling directory
genuinely absent. Restored the sibling directory afterward (it's still
needed for local grammar-repo co-development) and rebuilt the `.vsix`
one final time — unchanged, 2.03 MB. Lesson: when a fix's claim is "this
works without X", the only real verification is testing with X actually
absent, not just re-running the same command in an environment where X
still happens to be present.

## 2026-09-10 — 0.7.1: `#include` `$FOAM_CASE` expansion (Part A of the post-0.7.0 plan)

User reported a false-positive diagnostic after 0.7.0 shipped:
`#include "$FOAM_CASE/system/includeDicts/BCs_tracers_zeroGradient"` in
`examples/Helyx/complex/system/caseSetupDict` flagged "cannot find"
despite the file existing. Root cause: `resolveInclude()` in
`caseContext.ts` did zero variable expansion — `$FOAM_CASE` went into
`path.join` as a literal segment.

Fix: new `expandOpenFoamVars(raw, caseRoot)` in `caseContext.ts` maps
`$FOAM_CASE`/`${FOAM_CASE}` → the case root that `findCaseRoot()` already
computes, plus `$FOAM_CASENAME`, `$WM_PROJECT_DIR`, `$FOAM_ETC`, etc. from
`process.env`; unknown `$VAR`s pass through unchanged. `resolveInclude()`
now expands first, and checks an absolute expanded path directly before
the relative candidates. All four call sites (diagnostics, hover,
go-to-definition, document links) route through this one function, so all
benefit. New `test/caseContext.test.ts` (11 tests) against the real
`examples/Helyx/complex` fixture — regression + no-false-match coverage.
Bumped to 0.7.1, CHANGELOG entry added. `npm run compile/lint/test` clean
(90 passed / 1 skipped). `.vsix` built.

Part B of the plan (semantic coloring of resolvable references — geometry
files, `$vars`, patches, includes — via an LSP semantic-tokens provider)
is deferred to 0.8.0 per the user's chosen delivery split; see
`/Users/arefmoalemi/.claude/plans/please-familiarize-yourself-with-abundant-spark.md`.

## 2026-09-10 — 0.7.2: semantic coloring of resolvable references (Part B)

User later asked for all three follow-ups to ship as 0.7.x patches
(0.7.2 = coloring, 0.7.3 = scaffold engine).

**Implemented as an LSP semantic-tokens provider.** `onSemanticTokens` in
`server.ts` walks the cached tree, gathers the case's surface / eMesh /
patch / variable name sets **once per request** (reusing
`scanCaseGeometry`'s mtime cache, plus a new `getCaseVariableNames()` in
`caseContext.ts` cached by an XOR of `system/` file mtimes), and emits a
token only where a name resolves. The classification is a pure function,
`computeSemanticTokens(tree, ctx)` in the new
`src/treeSitter/semanticTokens.ts`, so it's unit-testable without a live
connection; `forEachToken(tree, cb)` (new, in `queries.ts`) is the
token walk. Five custom token types: `geometryFile`, `featureEdge`,
`caseVariable`, `boundaryPatch`, `includePath`.

**Theming:** `package.json` `contributes.semanticTokenTypes` +
`contributes.semanticTokenScopes` map each type to a standard TextMate
scope (`entity.name.type` / `entity.name.function` / `variable` /
`entity.name.tag` / `string`), so every theme colours them from its own
palette — no `configurationDefaults` colour overrides needed. Removed the
`#variable-refs` rule from `openfoam.tmLanguage.json` so unresolved
`$refs` are no longer coloured unconditionally (the semantic layer now
owns `$ref` colouring; unresolved ⇒ no token ⇒ default colour). Left the
`string.quoted.double.include.openfoam` rule in place (low stakes).

**Not done:** manual Extension Development Host check of the actual
editor colours (no GUI here) — verified via `test/semanticTokens.test.ts`
(9 tests) exercising `computeSemanticTokens` against hand-built resolver
contexts plus one integration check against the real
`examples/Helyx/complex` geometry block. `npm run compile/lint/test`
clean (99 passed / 1 skipped). Version bumped to 0.7.2, CHANGELOG +
README "What's New" updated.

**Next:** 0.7.3 — Search & Configure scaffold engine (Part C).

## 2026-09-10 — 0.7.3: Search & Configure scaffold engine (Part C)

Data-driven insert engine, all extension-host side under `src/scaffold/`:

- `features.ts` — `InsertableFeature` descriptor, `normalizeFields()`
  (flattens the DB's several FieldSpec shapes), `renderBody()` (assembles
  the `key value;` lines; `type <name>;` first for BCs).
- `providers.ts` — `collectFeatures(db, opts)`. v1 categories:
  **boundary conditions** and **fvSolution algorithms** (SIMPLE/PIMPLE/
  PISO/FLUID) get the full prompt flow (real typed `required` data);
  **turbulence models** (a small hand-authored RAS/LES template set —
  supersedes the old hardcoded `openfoam.insertTurbulenceBlock`) and
  **schemes** (catalog over `db.schemes`, inserts the `usage` example or a
  `<name>;` stub) are catalog-only. Function objects / fvOptions
  deliberately excluded — no usable schema data (function objects have
  zero briefs and untyped `{required:true}` scrape noise; there is no
  `fvOptions` section). They light up automatically when a data PR adds
  real schema — no engine change (the point of the architecture).
- `blockLocator.ts` — `locateInsertion(tree, docText, blockPath)`. Reuses
  `getParser()` + `buildOutline()` (same modules the server uses; loads
  its own WASM copy in the extension-host process — proven to work by the
  vitest suite). Walks `blockPath` down the outline, finds the insert
  point just before the matched block's `}`, and synthesizes wrapper
  blocks (correctly indented) for any missing path segment; `blockPath:
  []` appends at top level before a trailing `// **** //` footer.
  **Deviation from the plan:** no LSP custom request
  (`openfoam/resolveScaffoldContext`) — the plan's justification for it
  ("reused by Part B") evaporated once Part B shipped as a standard
  semantic-tokens capability, and host-side `getParser` is simpler with
  no async server dependency. If a future feature genuinely needs
  server-side tree queries from the host, that's when to add it.
- `engine.ts` — `runSearchInsert(context, arg?)`: the pipeline.
  `createQuickPick` (context-ranked: BC-file → boundary conditions first,
  `fvSolution` → algorithms first, etc., nothing hidden; `{category}`
  arg restricts outright). Per-field `createInputBox` with live
  `validateInput` (integer/scalar/boolean/enum), `default` pre-fill, or a
  `createQuickPick` for enum options. `namedBlock` targets (BCs) prompt
  for a patch name, offering existing patches from
  `constant/polyMesh/boundary`. Modal preview (`showInformationMessage`
  with the rendered block as `detail`) + **Write** / **Change target…**.
  Write only on confirm: `WorkspaceEdit` insert (creating the file from a
  minimal FoamFile header if it doesn't exist), then open + reveal.
  `setStatusBarMessage` confirmation — no modal on success.

- `extension.ts` — `openfoam.searchInsert` command + a `▽ OpenFOAM`
  status-bar item (shown only for `openfoam` documents), `command` bound
  to it. `package.json` — command declaration; **no keybinding** (per the
  spec's own caution about not colliding with defaults — users bind it
  themselves).

**Verification:** `test/scaffold.test.ts` (14 tests) — `normalizeFields`
across shapes; `collectFeatures` (BC `typeKeyword` + required-only
fields + `appliesTo` filter; PIMPLE required fields + target;
turbulence catalog body; category filter); `renderBody`; and
`locateInsertion` (insert into existing block, create missing nested
path, create-whole-path-at-footer, empty-path append). `npm run
compile/lint/test` clean (113 passed / 1 skipped). Version 0.7.3,
CHANGELOG + README updated. `.vsix` built (2.05 MB).

**Not done:** manual Extension Development Host walkthrough of the actual
quick-pick / webview-form UX (no GUI here) — the engine's pure pieces
(`collectFeatures`, `renderBody`, `locateInsertion`) are unit-tested;
the VSCode-API orchestration in `engine.ts` / `formPanel.ts`
(`createQuickPick` wiring, the webview form + live preview message
round-trip, `WorkspaceEdit` application) is not, and should get a manual
smoke pass before relying on it.

### 2026-09-10 — 0.7.3 UX revision: staging tab + title-bar icon

Three rounds of user feedback converged on a **staging tab**:

1. "floating card / temp tab instead of the bar" → a `WebviewPanel` form
   (`formPanel.ts`) — rejected next.
2. "we really don't need a UI, everything in text mode as OpenFOAM/HELYX
   uses by default" → direct snippet insert — rejected next.
3. "when a search item is clicked a new tmp tab opens that the user can
   edit the text/settings directly, then a Write button; the correct
   target suggestion is shown but the user must be able to edit the
   path" → the final design.

Final shape:

- **`src/scaffold/stagingTab.ts`** (new) — `openStagingTab()` opens an
  **untitled `openfoam` document** pre-filled with `renderTemplate(feature)`
  (so it's a real editor: highlighting, completion, diagnostics all
  live). A module-level `Map<uriString, PendingWrite>` holds
  `{ targetFsPath, caseRoot, blockPath, label }` for each open staging
  doc. `ScaffoldCodeLensProvider` renders three CodeLens "buttons" at
  line 0 for those docs only: **Write to `<caseRel › block › block>`**,
  **Change target…** (input box, `system/fvSolution > PIMPLE` syntax,
  parsed back to `{file, blockPath}`), **Discard**. `scaffoldWrite`
  reads the buffer text, creates the target file with a `FoamFile`
  header if missing, `locateInsertion` for the block path,
  `WorkspaceEdit.insert`, saves, closes the staging tab via
  `workbench.action.revertAndCloseActiveEditor` (no save prompt), then
  reveals the write site. `onDidCloseTextDocument` clears the map entry.
  `registerStagingTab(context)` wires the provider + 3 commands.
- **`features.ts`** — `renderSnippetBody` replaced by `renderTemplate(feature)`:
  plain text, one `key value;` line per required field, seeded from
  `default` → first enum option → `<type>` placeholder; catalog body
  verbatim. `renderBody` (used by the diagnostics-free path and tests)
  unchanged.
- **`engine.ts`** — flow is now QuickPick (feature search) → for a
  `namedBlock` target one `pickOrType` QuickPick for the patch name
  (structural, keeps the polyMesh/boundary suggestions) →
  `openStagingTab(...)`. All the disk-write / parser / `locateInsertion`
  logic moved to `stagingTab.ts`; `formPanel.ts` deleted.
- **`extension.ts`** — `registerStagingTab(context)` after the
  `searchInsert` command.
- **`package.json`** — `editor/title` menu entry for `openfoam.searchInsert`
  (`when: resourceLangId == openfoam`) so the `▽` icon shows top-right
  of every OpenFOAM editor (status-bar item kept too); the 3
  `openfoam.scaffold.*` commands declared and hidden from the palette
  (`commandPalette` `when: false`).

**Follow-up tweaks (same day):**

- **Change target now autocompletes.** `scaffoldChangeTarget` swapped
  `showInputBox` for a `QuickPick` whose items are every plausible
  dictionary file in the case (`listCaseDictFiles` — recursive walk,
  skips `polyMesh`/`triSurface`/`postProcessing`/`processor*` and
  binary-ish extensions, capped at 800). `qp.value` seeds with the
  current relative file so typing filters live; picking an item keeps
  the existing `blockPath`, typing `foo > A > B` overrides the nesting.
- **Buttons made prominent.** The three actions are now also
  `editor/title` menu items (`$(check)` / `$(edit)` / `$(trash)`,
  `group: navigation@1..3`), gated by a `openfoam.stagingTab` context
  key that `updateStagingContext()` sets on active-editor change / tab
  open / close — so they sit as always-visible icons at the top-right of
  the staging tab. `openfoam.searchInsert`'s own title-bar icon is
  suppressed there (`when: … && !openfoam.stagingTab`). CodeLens titles
  punched up to `$(check)  WRITE  →  <target>` etc. Command handlers
  take `Uri | undefined` and `resolveStagingUri()` falls back to the
  active editor when the menu passes something else.

**`??` inline trigger + keybinding + insertMode setting:**

- **`src/scaffold/context.ts`** (new) — extracted the shared doc-analysis
  from `engine.ts`: `findCaseRoot`, `detectFieldValueType`,
  `isBoundaryFieldDoc`, `loadKeywordDb` (cached), and
  `collectRankedForDoc(db, doc, category?)` (collect + context-rank, used
  by both the QuickPick engine and the inline completion so they never
  drift). `engine.ts` now imports these; `runSearchInsert` also accepts
  `{ featureId }` to skip the picker when called from a completion item.
- **`features.ts`** — `renderSnippet(feature)` added back alongside
  `renderTemplate`: `${1:…}` / `${n|a,b,c|}` tab-stops, and for a
  `namedBlock` target it wraps the body in `${n:name}\n{\n … \n}` so a BC
  typed inside `boundaryField` becomes a whole patch entry.
- **`src/scaffold/inlineComplete.ts`** (new) — `InlineScaffoldProvider`,
  a `CompletionItemProvider` on trigger char `?`. Fires when the line
  prefix matches `(^|[\s{(])\?\?([\w:]*)$` (and isn't in a `//`
  comment); returns `collectRankedForDoc(...)` as `Snippet`-kind items
  with `filterText: "??"+label`, `range` covering the `??`+query. In
  `insertMode: "inline"` (default) `insertText` is
  `new SnippetString(renderSnippet(f))`; in `"stagingTab"` it clears the
  `??` and runs `openfoam.searchInsert` with `{ featureId }`.
- **`extension.ts`** — `registerInlineScaffold(context)`.
- **`package.json`** — `openfoam.scaffold.insertMode` enum setting
  (`inline` default / `stagingTab`); `keybindings` entry binding
  `openfoam.searchInsert` to `ctrl+alt+o` / `cmd+alt+o` when
  `editorLangId == openfoam`.

**Verification:** `test/scaffold.test.ts` — +3 `renderSnippet` cases
(namedBlock `${n:name}{ }` wrap, entries numbering, enum `${n|…|}`).
`npm run compile / lint / test` clean — **120 passed / 1 skipped**.

### 2026-09-10 — 0.7.3: `?` trigger, dropped the top chrome

User feedback: "maybe just use 1 `?`" and "delete the nabla icon and
search bar feature on top — the `?` option is way nicer and more useful".

- **Single `?`.** `inlineComplete.ts` regex is now
  `/(?:^\s*|[{}]\s*)\?([\w:]*)$/` — a lone `?` at the start of a line
  (after indentation) or right after a brace, plus an optional query.
  Added a guard: bail if the line prefix has an odd number of `"`
  (inside a `#calc "…"` / regex-selector string) or contains `//`.
  `filterText` / replace range / docs updated `??` → `?`.
- **Removed the always-visible entry points.** Deleted the
  `editor/title` `openfoam.searchInsert` menu entry (the `▽` icon) and
  the `▽ OpenFOAM` status-bar item + its `onDidChangeActiveTextEditor`
  wiring in `extension.ts`. The `openfoam.searchInsert` command itself
  stays — reachable from the command palette and `Ctrl+Alt+O` /
  `Cmd+Alt+O`, and used as the `insertMode: "stagingTab"` target — so the
  staging tab (with its Write / Change target / Discard title-bar
  buttons, which are unaffected) is still available, just not pushed in
  the user's face. `?` is now the primary path.

`npm run compile / lint / test` clean — **120 passed / 1 skipped**.
CHANGELOG + README 0.7.3 entries reworked (still unreleased). Not
smoke-tested in an Extension Development Host (no GUI here): the `?`
popup + string/comment guards, the `insertMode` branch, the keybinding,
and the staging-tab round-trip.

### 2026-09-10 — 0.7.3 Part D: `@` scaffold + `?` cpp.openfoam.org help

User: "symbol `@` is for search items, symbol `?` is for search in
cpp.openfoam.org — we don't want any `@?` together." Two independent
single-char triggers. Docs help shows **on hover** over an identifier;
index sourced **both** ways (bundled + opt-in online); picking a `?`
result **does nothing** (lookup, not edit). See plan Part D.

- **`src/scaffold/inlineComplete.ts`** — trigger `?` → `@` (regex,
  `registerCompletionItemProvider(..., "@")`, `filterText`, offsets,
  doc). Nothing else in `scaffold/` changed.
- **`src/docs/parse.ts`** (new, no `vscode` — unit-testable):
  `DocEntry`, `apiRoot`, `decodeEntities`, `parseAnnotated` (class list
  *with* briefs), `parseClassIndex` (full alphabetical list, no briefs),
  `mergeEntries` (dedupe by name, prefer the one with a brief),
  `rankLookup` (exact then prefix then substring, each tier alphabetical).
- **`src/docs/index.ts`** — `DocsIndex`: lazy-loads bundled
  `data/openfoam-classes.json`, overlays a disk cache in
  `context.globalStorageUri/doc-index-<version>.json`, and when
  `openfoam.docs.onlineHelp` is true fires a one-shot background fetch of
  `annotated.html` + `classes.html` from
  `cpp.openfoam.org/<openfoam.docs.apiVersion>` (Node `https`, no global
  `fetch`), 7-day TTL, all failures silent. `lookup()`, `exact()` (case-
  sensitive, for the quiet hover), `fullUrl()`.
- **`src/docs/lookupComplete.ts`** — `?` `CompletionItemProvider`
  (trigger `"?"`). Fires on `/(?:^|[\s{}(=])\?([\w:]+)$/`, not in `//`
  or an odd-quote string. Items: kind `Reference`, `documentation` =
  brief + `[Open in browser ↗](url)`, `filterText = "?"+name`. Accept:
  `insertText = ""` over the whole `?query` range → the query just
  disappears, no edit, no navigation.
- **`src/docs/hover.ts`** — `HoverProvider`; word range
  `/\??[A-Za-z_][\w:]*/`, strip leading `?`, `index.exact(word)` (exact
  case-sensitive match only, so it stays silent on common words and the
  server's own hovers are unaffected — VS Code stacks providers).
- **`src/docs/register.ts`** — `registerDocsHelp(context)` builds one
  shared `DocsIndex`, registers both providers.
- **`src/extension.ts`** — `registerDocsHelp(context)` next to
  `registerInlineScaffold`.
- **`package.json`** — settings `openfoam.docs.onlineHelp` (bool, false),
  `openfoam.docs.apiVersion` (string, `v14`); `insertMode` enum text
  updated `??`/`@`.
- **`scripts/build-doc-index.js`** (new) — release-time generator;
  fetches both Doxygen pages, merges, writes minified
  `data/openfoam-classes.json`. `scripts/**` is `.vscodeignore`'d so the
  script is not packaged; `data/openfoam-classes.json` is a new name not
  in the `data/NN_*.json` exclusion list, so it ships.
- **`data/openfoam-classes.json`** — generated: **3796 classes, 2123
  with a description, 533 KB** (v14). Doxygen's static `annotated.html`
  only exposes ~2.6k with briefs; `classes.html` fills the rest name-
  only. Dictionary keywords map to class *suffixes* (`fixedValue` →
  `fixedValueFvPatchField`), which `rankLookup`'s substring tier covers.
- **`test/docs.test.ts`** (new) — 7 tests: the parsers, `mergeEntries`
  precedence, `rankLookup` tiers/limit, and a sanity check on the
  bundled JSON.

### 2026-09-11 — 0.7.3 Part D follow-up: full class-page text on hover / in the `?` detail pane

User: "when the search item is selected I expected all the content
relevant to it be fetched from the website and shown in hovering."

- **`src/docs/page.ts`** (new, pure) — `extractDetailedDescription(html)`
  (first `<div class="textblock">` up to the next member/section marker),
  `htmlToMarkdown(html, pageUrl)` (tolerant: links resolved relative
  to the page, `<code>`/`<tt>` → backticks, `<pre>`/`.fragment` → fenced,
  `<li>` → dash, entities decoded, capped at ~2800 chars), and
  `pageToMarkdown`.
- **`src/docs/index.ts`** — `DocsIndex.fetchDoc(entry)`: fetches the
  class page, `pageToMarkdown`, caches in memory + on disk
  (`globalStorageUri/pages/<version>/<url>.json`, 7-day TTL). Returns
  `null` unless `openfoam.docs.onlineHelp` is on. `onlineEnabled` is now
  a public getter.
- **`src/docs/hover.ts`** — `provideHover` is async; appends the fetched
  Detailed Description under the brief when available.
- **`src/docs/lookupComplete.ts`** — items carry their `DocEntry`;
  `resolveCompletionItem` (fired when an item is highlighted) fetches the
  page and rewrites `documentation` with the full text. So browsing the
  `?` list shows each class's full docs in the detail pane beside the
  cursor — no accept, no buffer change.
- **`package.json`** — `openfoam.docs.onlineHelp` description broadened:
  it now governs the index refresh *and* the on-demand page fetches.
- **`test/docs.test.ts`** — +3 `page.ts` cases (section extraction stops
  at the next `groupheader`; relative-link + code + fence rendering;
  empty when no textblock).

`npm run compile / lint / test` clean — **130 passed / 1 skipped**.

### 2026-09-11 — 0.7.3 Part D follow-up: `?` accept does something (`openfoam.docs.onAccept`)

User: accepting a `?` item "disappears and nothing happens" — wants the
fetched info shown after Enter. Chosen: a hover box (default), with the
other options kept behind a setting.

- **`src/docs/onAccept.ts`** (new) — registers internal command
  `openfoam.docs._accepted`, invoked by each `?` completion item's
  `item.command` (runs after the edit that clears `?query`). Branches on
  `openfoam.docs.onAccept`:
  - `"hover"` (default) — `fetchDoc(entry)`, stash
    `DocsIndex.pendingAccept = { uri, line, body }`, then
    `setTimeout(30) → editor.action.showHover`.
  - `"browser"` — `simpleBrowser.show` on the class URL, falling back to
    `env.openExternal`.
  - `"comment"` — insert `// <name> — <brief>\n// <url>\n` at the cursor.
  - `"none"` — nothing.
- **`src/docs/index.ts`** — `pendingAccept` field on `DocsIndex`.
- **`src/docs/hover.ts`** — `provideHover` checks `pendingAccept` first
  (same uri + line), returns that Hover once and clears it, so
  `showHover` right after an accept lands on real content even though
  there's no word under the cursor.
- **`src/docs/lookupComplete.ts`** — items now set
  `item.command = { command: ACCEPT_COMMAND, arguments: [entry] }`.
- **`src/docs/register.ts`** — `registerDocsOnAccept` wired in first.
- **`package.json`** — `openfoam.docs.onAccept` enum
  (`hover`/`browser`/`comment`/`none`, default `hover`). The command is
  not declared in `contributes.commands`, so it stays out of the palette.

`npm run compile / lint / test` clean — **130 passed / 1 skipped**.

### 2026-09-11 — 0.7.3 Part D fixes: stale-range bug, doc panel, more detail

User reported: after `?wallDist` + Enter, the popup vanished, `walldist`
was left in the file (→ "Unknown key", "Syntax error"), the hover closed
on mouse-move, and they wanted more detail.

- **Stale replace-range bug (the real one).** Both `?` and `@` providers
  returned a plain `CompletionItem[]`, so VS Code cached the list and
  filtered client-side without re-calling the provider — the items'
  `range` stayed pinned to the `?w` typed at first request while the
  user kept typing, so accepting replaced only that stale prefix and
  left the tail (`alldist`) in the buffer. Fixed: both providers now
  return `new vscode.CompletionList(items, /* isIncomplete */ true)`, so
  VS Code re-queries every keystroke and the range always covers the
  current `?query` / `@query`. (`inlineComplete.ts`, `lookupComplete.ts`.)
- **`onAccept` is now a persistent panel, not a hover.** `hover` mode
  (transient, closed on mouse-move) replaced by **`panel`** (default):
  `src/docs/docPanel.ts` — one reused `WebviewPanel`
  (`ViewColumn.Beside`, `retainContextWhenHidden`, `enableScripts:false`)
  that renders the class page's own HTML (`extractArticle` +
  `absolutizeUrls`, `<script>` stripped, themed with `--vscode-*`, CSP
  `img-src https:`). Stays until the user closes it. Falls back to the
  bundled brief + a hint when `onlineHelp` is off. `pendingAccept` /
  `showHover` plumbing removed from `index.ts` / `hover.ts`.
- **More detail.** `page.ts` `MAX_CHARS` 2800 → 6000 for the
  identifier-hover / list detail pane; the panel shows the whole article
  (all sections, not just the brief).
- **`index.ts`** — `fetchPageHtml(entry)` (raw HTML, disk-cached under
  `pages/<version>/`, gated on `onlineHelp`); `fetchDoc` now derives its
  Markdown from that.
- **`page.ts`** — new `extractArticle`, `absolutizeUrls`.
- **`package.json`** — `openfoam.docs.onAccept` enum `hover` → `panel`
  (default `panel`).
- **`test/docs.test.ts`** — +2 (`extractArticle` header→contents, drops
  script + footer + top nav; `absolutizeUrls` only rewrites relatives).

`npm run compile / lint / test` clean — **132 passed / 1 skipped**.

### 2026-09-11 — doc panel: distinguish "off" from "fetch failed"

User enabled `openfoam.docs.onlineHelp` but the panel still said "Enable
openfoam.docs.onlineHelp…" — because the fallback text was shown for
*both* the setting being off *and* the fetch throwing.

- **`index.ts`** — `fetchPageHtml(entry, force?)` now records
  `lastPageError` and does **not** negative-cache a failure (so Retry
  re-attempts); `force` bypasses mem + disk cache.
- **`docPanel.ts`** — `enableScripts: true` with a nonce'd script;
  `onDidReceiveMessage` handles `enable` / `retry` / `open`. Three
  distinct states: full page; **off** → brief + "Enable online help"
  button (flips the setting) + "Open in browser"; **on but fetch failed**
  → brief + the actual error + "Retry" + "Open in browser".

`npm run compile / lint / test` clean — **132 passed / 1 skipped**.
Still 0.7.3, unreleased, uncommitted.

### 2026-09-11 — docs fetch: tolerate non-conformant HTTP ("Parse Error: JS Exception")

A user behind a proxy got `Parse Error: JS Exception` on class pages
(the origin responds fine directly — an intermediary rewrites the
response into something Node's strict `llhttp` parser rejects). First
tried `insecureHTTPParser: true` on `https.get`; the user still hit it
(VS Code's proxy agent likely bypasses the per-request parser option).
`src/docs/index.ts` `httpGet` is now a two-step: `nodeGet` (Node
`https`, still `insecureHTTPParser: true`) → on *any* failure fall back
to **`curlGet`** (`execFile("curl", ["-sSL","--compressed",…])` — its
own HTTP stack + tolerant parser + honours proxy env). Error message
combines both failures. `scripts/build-doc-index.js` keeps
`insecureHTTPParser: true`. `npm run compile / lint / test` clean —
**132 passed / 1 skipped**.

## 2026-09-13 — 0.8.0: `context/UPDATE.md` Parts E–H

Implemented the full next-round plan the user asked for: "fix essential
UI/UX and backend problems first... then geometry viewer/VTK... then a
dashboard showing residuals... then investigate Dakota... for parametric
study." Version bumped 0.7.3 → **0.8.0** (this is clearly a feature
release, not a patch) — user hasn't confirmed the number, flagged in the
wrap-up.

### Part E — fix-first UI/UX + backend

- **`src/shared/caseRoot.ts`** (new) — `findCaseRootFromPath(filePath)`,
  the one shared implementation of the case-root walk. `extension.ts`'s
  own copy replaced with `const findCaseRoot = findCaseRootFromPath`;
  `language-server/caseContext.ts`'s `findCaseRoot(fileUri)` now
  delegates (`return findCaseRootFromPath(uriToPath(fileUri))`);
  `scaffold/context.ts` re-exports it directly. All three call-site
  shapes preserved exactly (verified: `caseContext.ts`'s version did
  `path.dirname(uriToPath(fileUri))` first, matching the shared
  function's own internal `path.dirname()` — no behavior change).
- **"Did you mean" quick-fix** — `src/shared/levenshtein.ts` (new, pure):
  `levenshtein(a,b)`, `closestMatch(word, candidates, maxDistance?)`
  (threshold scales with word length). `treeSitter/schema.ts`'s
  `SchemaDiagnostic` gained an optional `data: { candidates: string[] }`
  — `validateNode`'s two "Unknown key" push sites now attach
  `Object.keys(schema)` as candidates. `server.ts`'s `pushSchemaDiags`
  copies `.data` onto the LSP `Diagnostic`; `onCodeAction` matches
  `/^Unknown key '(.+)'$/` diagnostics carrying `data.candidates` and
  offers `Change to '<closest>'` as a preferred QuickFix
  (`TextEdit.replace(diag.range, suggestion)` — the range already
  targets just the key/name node).
- **Command Palette hygiene** — `openfoam.toggleBoolean` (previously
  registered but undeclared) added to `contributes.commands` and to
  `commandPalette` with `when: false` — documents the CodeAction-only
  intent instead of leaving it ambiguous.
- Deferred (noted, not built): extractor regex→real-parsing rewrite,
  multi-OpenFOAM-version schema setting, expanded direct LSP-layer test
  coverage, doc-panel history/search, semantic-token category expansion,
  onboarding walkthrough. All still valid backlog items from
  `context/UPDATE.md`.

### Part F — field-data viewer (`@kitware/vtk.js`)

- De-risked before committing to the dependency: installed
  `@kitware/vtk.js` (36.14.2) and read the actual installed source
  (not just docs) to confirm the exact API shape —
  `vtkPoints.newInstance({values})` + `vtkCellArray.newInstance({values})`
  (raw VTK POLYGONS connectivity blob, unchanged) wired via
  `polydata.setPoints()`/`setPolys()` (NOT the `{points, polys}`
  constructor-shortcut idiom seen in many vtk.js examples — traced
  `PolyData.js`'s `extend()` and found `polys` has no `vtk()`-wrapping
  normalization, so a real `vtkCellArray` instance must be constructed
  explicitly or the mapper's `model.polys.getCellSizes()` call breaks).
  `Mapper`'s scalar-coloring setters (`setColorByArrayName`,
  `setScalarModeToUsePointData/UseCellData`, `setColorModeToMapScalars`,
  `setUseLookupTableScalarRange`) confirmed against
  `ScalarColoringHelper.js`'s macro list, not assumed from memory.
- **`src/webview/vtkParse.ts`** (new, pure — no DOM/`three`/`vtk.js`) —
  `parseLegacyVTK(text)`: POINTS, POLYGONS/TRIANGLE_STRIPS (kept as the
  raw VTK connectivity blob, not triangulated — that's exactly vtk.js's
  `polys` format), POINT_DATA/CELL_DATA with SCALARS (optional
  numComponents)/VECTORS/NORMALS/FIELD sub-arrays. Deliberately a new
  module rather than editing `geoViewer.ts`'s existing triangle-soup
  `parseVTK()` (which the plain 3D preview still uses, untouched) — an
  indexed representation is what vtk.js wants, and this avoids any risk
  to the working geometry-preview path.
- **`src/webview/fieldViewer.ts`** (new) — vtk.js v1: builds
  `vtkPolyData` from the parsed points/polys, computes a per-tuple
  magnitude for any vector array (so coloring never depends on an
  uncertain "color by vector" mapper mode — always a plain 1-component
  scalar array), a diverging blue→white→red `vtkColorTransferFunction`,
  an array `<select>`, and solid/wireframe/points buttons
  (`Property/Constants` `Representation` enum). `vtkRenderWindow` +
  `vtkOpenGLRenderWindow.setContainer()` + `vtkRenderWindowInteractor` +
  `vtkInteractorStyleTrackballCamera` — the standard non-fullscreen vtk.js
  embed pattern.
- **`src/workflow/FieldViewerPanel.ts`** (new, mirrors
  `GeometryPreviewPanel.ts`) — singleton panel, base64-posts the file,
  warns (doesn't block) above 25 MB.
- **`OpenFOAMCaseTreeProvider.ts`** — `looksLikeFieldData(fsPath)` sniffs
  the first 8 KB for `POINT_DATA`/`CELL_DATA` (cheap; a false negative on
  a huge file just falls back to the plain viewer, never breaks
  anything). `.vtp` always, `.vtk` when the sniff hits, routes to
  `openfoam.previewField` (new command, `graph-line` icon) instead of
  `openfoam.previewGeometry`.
- **Packaging**: `@kitware/vtk.js` moved to `devDependencies` (matches
  `three` — it's bundled into `media/field-viewer.js` by esbuild, never
  needed as a raw runtime `node_modules` copy; confirmed via
  `vsce ls` that no `node_modules/@kitware/**` files end up packaged).
  esbuild bundle: **1.2 MB** (tree-shaken from the package's 13.25 MB
  unpacked size — the plan's own "open question" about bundle size is
  now answered with a real number, not a guess). Total vsix: 2.05 MB →
  2.42 MB.
- **Deferred**: v2 (slicing plane, iso-surface/contour) and v3 (vector
  glyphs, click-to-probe, multi-block/multi-region) — v1 alone is a real
  upgrade and the tiers were explicitly designed to land independently.
- **Tests**: `test/vtkParse.test.ts` (5 cases) against a small synthetic
  fixture (no real example `.vtk` carries field data — checked; the
  committed ones are bare `featureEdgeMesh` geometry).

### Part G — live residual & run dashboard

- **`src/monitor/residualLog.ts`** (new, pure) — regex parser for the
  generic OpenFOAM/HELYX solver-log shape (`Time = N`,
  `<solver>:  Solving for <field>, Initial residual = …, Final residual
  = …, No Iterations n` with scalar or `( a b c d )` tuple residuals,
  `Region: … Courant Number mean: … max: …`, `ExecutionTime = … s
  ExecutionStepTime = … s ClockTime = … s`, `End`/`Finalising parallel
  run`). `finalResidualMagnitude()` — the largest-magnitude component,
  the natural single number to chart for a coupled/vector field.
- **`test/fixtures/helyxSolve-excerpt.log`** — two full, real `Time =`
  blocks trimmed verbatim from
  `examples/Helyx/complex/log/helyxSolve_gen_10p.out` (not synthesized),
  covering scalar + 4-tuple residuals, Courant, and ExecutionTime lines.
  `test/residualLog.test.ts` (11 cases) asserts exact values against it.
- **`src/monitor/convergence.ts`** (new, pure) — `regressionSlope(xs,ys)`
  (least-squares) + `classifyTrend(history, windowSize=20)`
  (converging/diverging/stalled/unknown from the slope of
  log10(residual) vs. iteration) — the scoped, arithmetic-only version
  of the plan's "physics + ML" idea, modeled on the example case's own
  `check_convergence_gen_*.out` moving-average/delta approach.
  `test/convergence.test.ts` (7 cases).
- **`src/monitor/logTail.ts`** (new) — `LogTail` remembers a byte offset
  and only reads/parses newly-appended bytes per `poll()` (the example
  logs already reach 2.4 MB); `findLikelyLogFile(caseRoot)` — most
  recently modified `log.*`/`*.out`, 2 levels deep, skipping
  `postProcessing`/`processorN`/etc.
- **`src/monitor/dashboardPanel.ts`** (new) — one reusable webview
  (`enableScripts:true`, nonce'd script), `setInterval` polling
  (1000 ms) pushing only new samples via `postMessage`; the webview
  accumulates per-`solver:field` series and redraws a hand-rolled canvas
  log-scale line chart (no charting library) each tick, plus a legend
  with live trend badges and an info strip. `showDashboard(logPath)` /
  `openDashboardForCase(caseRoot)` (auto-detects the log, else prompts).
- **Wiring**: `openfoam.monitor.openDashboard` command (Command Palette
  + Case Explorer title bar, `pulse` icon); `OpenFOAMCaseTreeProvider`
  gained a public `getCaseRoot()` getter for the command to use.
- **Deferred**: the Case Explorer per-case status decoration (idle/
  running/converged/…) — the dashboard itself has all that state, just
  not yet fed back into the tree view; parsing the surface-probe/
  mass-flow data the example's own monitor computes (v2, per the plan).

### Part H — parametric study + Dakota investigation

- **`src/parametric/paramSet.ts`** (new, pure) — `ParamDef` (file +
  blockPath + key + values) → `cartesianVariants()`, the full grid,
  zero-padded `variant_NNN` names. `test/paramSet.test.ts` (4 cases).
- **`src/parametric/substitute.ts`** (new, pure) — `findEntry` (walks
  `buildOutline` by blockPath, reusing the same outline `queries.ts`
  already builds for the symbol view) + `substituteEntryValue`
  (rewrites an *existing* entry's value — deliberately distinct from
  `scaffold/blockLocator.ts`'s `locateInsertion`, which only knows how
  to *add* new content) + `replaceRange` (pure text-range surgery for a
  case-clone's on-disk files, no open document involved). **Found and
  fixed a real bug during testing**: `entry.range` from `buildOutline`
  starts at the key token, not the line's column 0 (tree-sitter node
  ranges exclude leading whitespace) — an early version of
  `substituteEntryValue` re-prepended the line's indentation itself,
  which then doubled once `replaceRange` also preserved the original
  indent via `range.start.character`, producing 8 spaces instead of 4.
  Caught by `test/substitute.test.ts`'s exact-output assertions; fixed
  by dropping the redundant indent reconstruction entirely (the range
  already starts past the whitespace). `test/substitute.test.ts`
  (7 cases, including the regression).
- **`src/parametric/sweepRunner.ts`** (new) — `copyCaseDir` (skips
  `postProcessing`/`processorN`/`dynamicCode`/VCS dirs) +
  `runSweep(caseRoot, variants)`: one cloned `<caseRoot>_<variant>` dir
  per variant, edits grouped by file (parse once per file, not per
  edit), reports `missedEdits` for keys not found rather than throwing.
  `test/sweepRunner.test.ts` (4 cases, real filesystem via
  `fs.mkdtempSync`, including a `postProcessing/` exclusion check and a
  missed-edit case).
- **`src/parametric/runCommand.ts`** (new) — `OpenFOAM: Start Parametric
  Study`: text-prompt loop (file / blockPath / key / comma-separated
  values, repeatable) → modal confirm listing every variant's params →
  `runSweep` → summary + "Reveal first variant".
- **Dakota investigation** (verified via WebFetch against Sandia's own
  site, not from training data alone): real, actively maintained,
  standalone native application (not a library) for optimization/UQ/
  DOE/sensitivity/calibration; integrates via its documented black-box
  interface (writes a parameters file, calls an analysis-driver script,
  reads back a results file). Confirmed too heavy to bundle/require —
  built as an **optional, detected** export instead:
  **`src/parametric/dakotaExport.ts`** (new) — `detectDakota()`
  (`execFile("dakota", ["-version"])`, resolves `false` on any error/
  ENOENT), `buildDakotaInput()` (a `multidim_parameter_study` deck: one
  `discrete_state_set` descriptor per parameter, sanitized to a valid
  Dakota identifier), `buildAnalysisDriverScript()` (a generated Node
  driver embedding the case root + `{file,blockPath,key}` targets,
  `require()`-ing this extension's own compiled `substitute.js` by
  absolute path so it needs no separate install — reads Dakota's
  parameters file, applies the same substitution, shells out to a
  `TODO`-marked solver command, writes a results file).
  `test/dakotaExport.test.ts` (3 cases). `OpenFOAM: Export Parametric
  Study to Dakota` command registered but hidden from the palette unless
  `openfoam.dakotaAvailable` (set via `detectDakota()` at activation).
  **Not investigated in depth**: OpenTURNS, mentioned in the plan as a
  lighter-weight alternative — flagged for a future pass, not built.
- **Deferred**: the parametric-study dashboard (plotting a result
  against each swept parameter as variants finish, sharing Part G's
  chart) — the sweep engine and the residual dashboard both exist
  independently; wiring them together is the natural next step, not
  done this round.

### Verification

`npm run compile && npm run lint && npm test` clean throughout —
**179 passed / 1 skipped** (was 132 before this round: +8 in Part E,
+5 in Part F, +18 in Part G, +18 in Part H — 47 new tests altogether).
`npx vsce package` succeeds; vsix 2.42 MB (up from 2.17 MB, mostly the
vtk.js bundle). Version bumped to 0.8.0. Not committed; the version
number is a judgment call flagged to the user, not a confirmed decision.

**Not smoke-tested in an Extension Development Host** (no GUI here) —
everything above is verified via compile/lint/unit-tests against real
or realistic fixtures, but nobody has yet: opened a real `.vtp`/
field-carrying `.vtk` in the new viewer and confirmed it actually
renders and colors correctly in a live webview; watched the dashboard
against an actually-running solver (only a static-file tail was
exercised); run a real parametric sweep against a full example case
end-to-end; or checked the generated Dakota deck against a real `dakota`
install. All flagged as the natural next manual-verification pass.

## 2026-09-13 — dashboard fix: stuck on "Watching for solver output…" for a finished run

User reported: opening the dashboard on an already-finished simulation
never showed any residuals, just the placeholder text forever. Two real
bugs, found by tracing the actual message flow (not guessed):

1. **Dropped first `postMessage` (the real bug).** `showDashboard()` set
   `panel.webview.html` and then synchronously called `tick()` (via
   `startPolling`) in the same turn. `webview.postMessage` does **not**
   queue — a message posted before the webview's own `<script>` has
   loaded and attached its `message` listener is silently lost. For a
   *live* run this only cost the initial backlog (later ticks, once new
   bytes appear, still land) — but a finished run's log never grows
   again, so that dropped first message was the *only* one ever going to
   have data, leaving the panel stuck on its static placeholder forever.
   Fixed with a ready-handshake: the webview script now
   `acquireVsCodeApi().postMessage({type:'ready'})` right after attaching
   its listener; `dashboardPanel.ts` holds a `pendingStart` closure and
   only calls `startPolling()` once that `'ready'` arrives
   (`panel.onDidReceiveMessage`, registered once at panel creation, not
   per `showDashboard()` call).
2. **Wrong log file could get picked.** `findLikelyLogFile` was "most
   recently modified `log.*`/`*.out`", full stop — but a real case has
   several `.out` files that aren't the solver log (confirmed against
   `examples/Helyx/complex/log/`: `check_convergence_gen_*.out` is a
   bespoke Python monitor's own output, `helyxHexMesh.out`/`topoSet.out`/
   `caseSetup.out` are pipeline steps, and any of these could have a
   later mtime than the actual `helyxSolve_*.out`). Now ranks by tier —
   canonical `log.<solver>` (2) > a `.out` with "solve" in its name (1) >
   anything else matching the log-name pattern (0) — most-recently-
   modified *within* the winning tier. `findLikelyLogFile('examples/
   Helyx/complex')` now correctly returns a `helyxSolve_*.out` path.
   Also fixed a real gap while touching this: `PROCESSOR_DIR_RE`
   (`processorN/`) wasn't actually being skipped by the directory walk
   despite being documented as skipped — `SKIP_DIRS` only ever held the
   literal-name set.
3. Added a `noData` message (posted only if the very first read finds
   nothing at all) so a wrong/empty log file says so explicitly instead
   of leaving "Reading log…" showing forever.

**Tests:** `test/logTail.test.ts` (new, 7 cases) — the tiered
`findLikelyLogFile` ranking (including the exact `examples/Helyx/
complex/log/` ambiguity, reconstructed with `fs.utimesSync` to control
mtimes), `postProcessing`/`processorN` exclusion (this is what caught
the `PROCESSOR_DIR_RE` gap), and `LogTail`'s first-read-vs-incremental
and shrink/reset behavior. `npm run compile / lint / test` clean —
**186 passed / 1 skipped** (+7). `.vsix` repackaged, still 2.42 MB.

### 2026-09-13 — three viewer/UX follow-ups: in-panel file pickers + dashboard interactivity

User feedback after trying the new panels: the field/geometry viewers
had no way to pick a file from inside the panel itself ("i should be
able to select vtk files in it"), the geometry viewer showed nothing at
all with nothing to click, and the dashboard "seems just the last
iteration is shown and is not interactive."

- **Field viewer + geometry viewer: in-panel "Open file…"** —
  `GeometryPreviewPanel.ts` / `FieldViewerPanel.ts` each gained an
  `onDidReceiveMessage` handler for `{command:'openFile'}` →
  `vscode.window.showOpenDialog` (filtered to stl/obj/vtk, or vtk/vtp)
  → `previewGeometry()`/`previewField()`. The webview HTML for both now
  has a header button plus an `#empty-state` overlay (own button + hint
  text) shown until the first file loads — `geoViewer.ts`/
  `fieldViewer.ts` hide it once a `previewGeometry`/`previewField`
  message actually loads something. This is also what fixes "nothing
  shown, nothing can be selected": before this, an empty panel really
  was just a bare dark rectangle — three.js/vtk.js are never initialized
  until the first file arrives, and there was no button or text at all.
  `extension.ts`'s `previewGeometry`/`previewField` commands now always
  open the panel (with its own picker ready) even when invoked bare
  with no resolvable file, instead of silently doing nothing or just
  toasting a message and returning.
- **Dashboard interactivity** (`src/monitor/dashboardPanel.ts`'s
  webview script, substantially extended): an "Open Log File…" button
  (same `showOpenDialog` pattern, re-invokes `showDashboard()` on the
  picked file — the dashboard's own version of the same in-panel-picker
  ask); legend entries are now clickable to show/hide that series
  (`s.hidden`, dimmed + struck-through when off); mouse-wheel zooms the
  time axis around the cursor, drag pans it, double-click or a "Reset
  Zoom" button restores the full-data auto-fit; a hover tooltip shows
  each visible series' nearest value at the cursor's time. `draw()` now
  tracks its own screen↔time mapping in a `layout` object so the
  wheel/drag/tooltip handlers can convert `clientX` → data time without
  re-deriving the axes. (The "just the last iteration" impression was
  most likely the *info strip* — which by design always shows the
  latest sample as a live status readout — being mistaken for the whole
  dashboard; the chart itself already plotted full history. No bug
  found there, but the new zoom/pan/hover make the full history
  actually inspectable instead of only visible as a compressed line.)

**Verification:** `npm run compile / lint / test` clean — 186 passed / 1
skipped (webview `<script>` bodies are template strings, not
independently unit-tested — this is UI-only surface area, verified by
reading the generated HTML/script carefully, same as the rest of this
session's webview work). `.vsix` repackaged, 2.42 MB. Not smoke-tested
in an Extension Development Host (no GUI here) — the zoom/pan/tooltip
math and the open-file dialogs are the natural next manual check.

### 2026-09-13 — geometry viewer: multi-layer support; field viewer: found and fixed the real "shows nothing" bug

User: "3d geometry viewer must support multi geometry and put them in
different layer[s]"; "vtk does not show anything"; "cell and point
[data] and sub features must be selectable."

**Geometry viewer → multi-layer.** `geoViewer.ts` previously held one
`THREE.Mesh` at a time, replaced on every load. Now a `Layer[]` list:
each opened file gets its own mesh, its own color (cycled from an
8-color palette), and is added *without* the existing per-file
`normalizeGeometry()` (re-center + rescale-to-unit-box) — multiple case
parts need to line up in their real relative position/scale, not each
collapse onto the origin independently. `normalizeGeometry` (still used,
unchanged, for the single-file thumbnail renderer where filling the
small preview frame *is* the goal) gained a `normalize` parameter,
default `true`, so the thumbnail path is untouched. `fitCameraToLayers()`
unions the bounding boxes of all *visible* layers and re-centers/re-sizes
the orbit camera to fit — recomputed on add/remove. `GeometryPreviewPanel.ts`
gained a `#layers` chip strip (color swatch, click-to-toggle visibility,
`×` to remove) and a "Clear All" button (pure client-side — no host
round-trip needed); the header button is now "Add geometry layer…", and
`previewGeometry()` — called both by the panel's own button and by
Case Explorer clicks — now **adds** a layer instead of replacing.
Also (found while touching this file): neither the OBJ-without-`vn`
path nor the VTK path ever called `computeVertexNormals()`, so those
shapes had no normals for Phong shading to work with — added.

**Field viewer → the actual "shows nothing" bug, found by tracing the
real vtk.js source** (not guessed): every real `.vtk` file in
`examples/` (the `featureEdgeMesh` triSurface files) has **no**
POINT_DATA/CELL_DATA — bare geometry. On that path, `loadDataset()`
correctly skipped `applyChannel()` (no arrays to color by) via the old
`arrays.length` guard, but the actor was left with vtk.js's *default*
material properties — no explicit color, and critically **no
`computeVertexNormals()`-equivalent for the parsed geometry either**
(the raw points+polys upload carries no normals, same class of gap as
the three.js side). Under vtk.js's default Phong-ish lighting, an
unlit/normal-less surface can render fully black — indistinguishable
from "nothing." Root-caused by reading the actual installed
`ScalarColoringHelper.js`/`Property.js` source rather than trusting the
official examples' happy-path snippets, since I have no browser here to
just look at the result. Fixed by making the actor **always** visible
regardless of field data: `actor.getProperty().setLighting(false)` (flat
unlit color — also arguably the *right* default for a data-viz tool,
since it shows the true mapped color with no shading distortion) plus an
explicit default color. Confirmed this doesn't regress the colored path:
`setScalarVisibility(true)` + `ColorModeToMapScalars` still overrides
the flat color per-vertex when a channel is selected, independent of the
lighting flag.

**"Cell and point data and sub features must be selectable."** Reworked
the array dropdown from one entry per raw array to one entry per
*channel*: a plain scalar array is still one entry, but a vector/tensor
array (e.g. `U`, 3-component) now expands into **magnitude + each
individual component** (`U (magnitude)`, `U — X`, `U — Y`, `U — Z`,
labelled with real axis names for 3- and 6-component arrays, numeric
index otherwise) — `buildChannels()`/`channelValues()` in
`fieldViewer.ts`, replacing the old magnitude-only `arrays`/`applyArray`.
Point vs. cell location was already distinguishable in the label; now
so is which part of a vector/tensor you're looking at.

**Verification:** `npm run compile / lint / test` clean — 186 passed / 1
skipped (unchanged — this round is webview rendering-pipeline logic, not
independently unit-testable without a browser/WebGL context; verified
by reading the installed `@kitware/vtk.js` and `three` source directly
rather than guessing). `.vsix` repackaged, 2.42 MB. **Still not
smoke-tested in an Extension Development Host** — this is the second
round of vtk.js fixes made without ever having seen it render; the
`setLighting(false)` fix is a strong, well-reasoned hypothesis (traced
through the actual scalar-coloring and property source), not a confirmed
fix. If the field viewer is still blank after this, the next thing to
check by hand is whether the WebGL context itself is being created at
all (a `console.error` in the webview's devtools would show it) —
something no amount of source-reading from here can rule out.

### 2026-09-13 — geometry viewer zoom fix, multi-select + drag & drop everywhere, Plotly-style dashboard zoom + richer summary

User: "the 3d geometry viewer does not show the geometries properly it
is too zoomed[,] and still does not allow multi select of geometries and
drag and drop of them to the screen from the explorer / vtk viewer must
also support drag and drop. could pyvista be useful here / can u improve
zoom in and zoom out in dashboard[,] similar to [the] zoom in feature
that plotly dash offers[,] same ui ux style. also provide more useful
information under the plot section which is just showing run is
finished."

**Root cause of "too zoomed."** Removing per-file `normalizeGeometry()`
in the previous round (needed for real relative multi-layer positioning)
left the orbit-zoom clamp (`sph.r` bounds `[0.3, 50]`) and the camera's
`near`/`far` planes (`0.01`/`1000`) as hardcoded constants tuned for the
*old* always-~2-unit-box single mesh. Real-world-scale geometry (mm-scale
parts or building-scale cases) would get far-plane-clipped, or on the
very first wheel-scroll get snapped back to a nonsensical zoom regardless
of the object's actual size, since the clamp bounds never took `maxDim`
into account. Fixed in `geoViewer.ts`'s `fitCameraToLayers()`: `zoomMin`/
`zoomMax` (now module-level `let`s, not constants) and `camera.near`/
`camera.far` are all recomputed proportionally to the fitted `maxDim`
every time layers change, so the zoom range always matches what's
actually on screen.

**Multi-select + drag & drop.** `GeometryPreviewPanel.ts`'s "Add geometry
layer…" now uses `canSelectMany: true` and loops over every picked file.
Both `GeometryPreviewPanel.ts` and `FieldViewerPanel.ts` gained a
`dropFiles` message handler (+ a `uriStringToPath` helper parsing
`vscode.Uri.parse` output) and matching webview-side `dragover`/
`dragleave`/`drop` listeners reading `event.dataTransfer.getData('text/uri-list')`
— this is enough on its own to accept drags from VS Code's built-in
Explorer, no extra wiring needed there. For the **Case Explorer** (a
custom `TreeView`) to be a drag *source* too, it needed VS Code's
`TreeDragAndDropController<T>` API: `OpenFOAMCaseTreeProvider` now
implements it (`dragMimeTypes: ['text/uri-list']`, `dropMimeTypes: []`
since it's source-only, `handleDrag` writing the selected items'
`resourceUri`s), wired into `extension.ts`'s `createTreeView` call via a
new `dragAndDropController` option.

**"Could pyvista be useful here" — answered, not implemented.** PyVista
is a Python library; it cannot run inside a VS Code webview, which is a
browser/Electron JS context with no Python runtime. `@kitware/vtk.js`
(already integrated into `fieldViewer.ts` two rounds ago) is the
JS/WebGL equivalent, wrapping the same underlying VTK library PyVista
itself wraps — so the slicing/iso-surface/glyph features PyVista would
be used for elsewhere are still reachable, just built directly on the
vtk.js foundation already in place (the deferred v2/v3 tiers from
`context/UPDATE.md`'s Part F), not via a second, incompatible library.

**Dashboard: Plotly-Dash-style zoom.** `dashboardPanel.ts`'s chart
previously only supported x-axis scroll-zoom and drag-to-pan, with a
"Reset Zoom" button. Rewrote the toolbar/script to add: a **Box
Zoom**/**Pan** mode toggle (Plotly's own default drag behavior is
box-zoom, not pan) with the canvas cursor changing to reflect the active
mode; in Box Zoom mode, dragging draws a rubber-band rectangle
(`#selbox`) and on mouseup zooms *both* the time axis and the log-scale
value axis to that rectangle (previously only the time axis could be
zoomed at all, and never by a matching drag gesture); in Pan mode,
dragging pans exactly as before; explicit **zoom in**/**zoom out** step
buttons (`zoomAroundCenter()`, symmetric around the current view center,
both axes) and an **Autoscale** button/dbl-click replacing "Reset Zoom"
with the same reset-to-null-view-bounds behavior. Scroll-to-zoom on the
time axis is unchanged. A new `valMin`/`valMax` pair of module vars holds
the (linear-space) y-axis zoom window, mirroring the existing `viewMin`/
`viewMax` for x — `draw()` now uses them when set, falling back to the
previous auto-fit-to-visible-points behavior otherwise.

**Richer post-run information.** The single `#status` line ("Run
finished.") is now paired with a `#summary` block built entirely from
data the webview already holds client-side (no new host→webview
messages needed): a per-field table (last residual value + trend badge,
reusing the same `converging`/`diverging`/`stalled`/`unknown` badge
styling already used in the legend) via `renderSummary()`, plus aggregate
stats (time span covered, number of fields tracked, and — from a new
`execHistory` array accumulating each `executionTime` message — average
wall-clock cost per iteration). Recomputed on every `residuals` and
`executionTime` message, and once more on `finished`, so it's populated
throughout a live run, not just at the end.

**Verification:** `npm run compile / lint / test` clean — 186 passed / 1
skipped (unchanged; this entire round is webview-side rendering/UX logic
with no new pure-function surface to unit test). `npx vsce package`
succeeds, 2.43 MB. Updated `CHANGELOG.md`, `README.md` for this round.
**Still not smoke-tested in an Extension Development Host** — no
browser/GUI available in this environment; the box-zoom drag math and
the zoom-clamp fix are traced by hand against the same coordinate
transforms already used elsewhere in each file, not visually confirmed.

### 2026-09-13 — `.vtk`/`.vtp` open directly on click; found & fixed the real field-data-detection bug

User: "when I click on a vtk file I expect openfoam extension [to]
preview field data vtk directly[,] distinguish it and open[] it."

**Two separate problems, both real.** (1) The Case Explorer already
auto-distinguished field-data `.vtk` from plain geometry on click
(`looksLikeFieldData()`, sniffing for `POINT_DATA`/`CELL_DATA`) — but
that only covers this extension's *own* tree view. Double-clicking a
`.vtk`/`.vtp` in VS Code's **built-in** Explorer (or via `File > Open`,
or the global "recently opened" list) has always just opened it as raw
text, since nothing registered a custom editor for those extensions.
(2) Independently, the sniff itself had a real bug: it only read the
first 8192 bytes. In a legacy-VTK file, `POINT_DATA`/`CELL_DATA` always
comes *after* the `POINTS`/`POLYGONS` block it describes — for any real
mesh with more than a few dozen points, that section starts well past
8 KB. So field-data files weren't being silently *missed only in edge
cases* — every realistically-sized field-data `.vtk` was misdetected as
plain geometry, all the time. Confirmed with a synthetic 5000-point
fixture in the new `test/vtkSniff.test.ts` (asserting the file is
`> 8192` bytes before checking detection, so the test can't pass by
accident).

**Fix 1 — real detection.** Moved the sniff out of
`OpenFOAMCaseTreeProvider.ts` into a new shared `src/shared/vtkSniff.ts`
(so both the tree provider and the new custom editor use one
implementation), and changed it from a single 8 KB read to a bounded
scan in 1 MB chunks up to a 16 MB cap, carrying the last 32 bytes of
each chunk forward so a match split across a chunk boundary isn't
missed. Not a full-file read — a purely additive-sized `.vtk` could
still be large — just enough headroom that the section describing a
case's actual field data is reliably reached.

**Fix 2 — a real default editor.** Added `VtkCustomEditorProvider.ts`
implementing `vscode.CustomReadonlyEditorProvider`, registered in
`package.json`'s new `contributes.customEditors` for `*.vtk`/`*.vtp`
with `"priority": "default"` — VS Code now opens these files straight
into the OpenFOAM viewer (geometry or field, same auto-detection) no
matter which UI they're opened from; "Reopen Editor With…" still offers
plain text if ever needed, since `default` priority doesn't remove the
built-in editor, just stops being the default. To avoid duplicating the
viewer HTML, extracted `GeometryPreviewPanel`'s and `FieldViewerPanel`'s
`_buildHtml()` bodies into standalone `src/workflow/geometryHtml.ts` /
`fieldHtml.ts` functions (`build{Geometry,Field}Html(webview,
extensionUri)`), now shared by all three call sites (the two standalone
panels + the new custom editor). The custom editor's "Open file…"/
drag-drop actions in its header hand off to the existing standalone-panel
commands rather than trying to swap the content of a tab that's bound to
one fixed document.

**Found and fixed a latent message-drop race while wiring this up** (the
same class of bug the dashboard hit earlier this session): both
standalone panels called `panel.previewGeometry()`/`previewField()`
immediately after `createWebviewPanel()`, posting the initial payload
before the webview's *external* `<script src="...">` bundle (geoViewer.js
/fieldViewer.js, ~1.1-1.2 MB) had necessarily finished fetching+executing
and attached its `message` listener — `postMessage()` doesn't queue,
so on a slow enough load the first file could silently fail to render.
This was always a possible bug for the standalone panels, but became
far more likely to actually bite once the custom editor path calls
`sendPayload()` the moment the panel is created, with no user-driven
delay (like a picker dialog) in between. Fixed the same way as the
dashboard: `geoViewer.ts`/`fieldViewer.ts` now post `{command:'ready'}`
as their very last synchronous statement (right after attaching their
own `message` listener), reading the already-`acquireVsCodeApi()`'d
object off `window.vsApi` (set by the inline bootstrap `<script>` in
each HTML builder, since `acquireVsCodeApi()` can only be called once
per webview); the host holds a `_pending` closure queue and only sends
once `ready` arrives, then flushes in order — handles multiple
`previewGeometry()` calls queued before ready (e.g. several dragged
files) correctly, not just one.

**Verification:** `npm run compile / lint / test` clean — 190 passed / 1
skipped (4 new: `test/vtkSniff.test.ts` — finds `POINT_DATA` past 8 KB,
finds `CELL_DATA` past 8 KB, correctly returns false for bare geometry,
and doesn't throw on a nonexistent file). `npx vsce package` succeeds,
2.43 MB, 330 files. Updated `CHANGELOG.md`/`README.md`. **Still not
smoke-tested in an Extension Development Host** — no browser/GUI here;
the ready-handshake fix mirrors the dashboard's own proven fix exactly,
and the custom-editor registration follows VS Code's documented
`CustomReadonlyEditorProvider` API precisely, but neither has been seen
rendering.

### 2026-09-13 — found the *actual* "vtk not shown" bug (binary format), and finally verified it visually

User: "i have also noticed still vtk are not shown when they are
opened." (Also asked to look at two other VS Code CAD/mesh preview
extensions — loumalouomega's `CAD-Preview` and `VSCode-MDPA-Preview` —
for feature ideas; covered at the end of this entry.)

**Every previous "vtk not shown" fix this session (lighting, normals,
zoom clamps) was real but not the actual root cause for field-data
files.** Inspected a real example that was sitting in the repo the
whole time — `examples/Helyx/complex/postProcessing/p_ymid.vtk` — with
a raw byte dump (`head -c` / a small Node script), and its header reads
`BINARY`, not `ASCII`. HELYX/OpenFOAM's `sampleSurface`/`foamToVTK`
output defaults to the legacy **binary** format. `src/webview/
vtkParse.ts`'s `parseLegacyVTK()` — the parser feeding the field
viewer — was a pure `text.split(/\s+/)` whitespace tokenizer, built and
tested only against synthetic ASCII fixtures (checked at the time:
"no real sample with field data exists in examples/" — true when that
comment was written, false by the time `postProcessing/*.vtk` was
added to the repo later in the session, and nobody re-checked). Run
against raw binary bytes, that tokenizer doesn't error — it just
produces garbage tokens and `parseFloat`s them into garbage numbers, so
every real field-data `.vtk` from an actual OpenFOAM/HELYX run has been
silently unreadable this whole time. This is why the lighting/normals
fixes never actually resolved the user's repeated reports: those fixes
were correct for bare/ASCII geometry, but the field-viewer's own
primary use case (real solver output) was hitting a completely
different, earlier failure.

**Fix:** added a binary-aware sibling parser (`parseBinaryLegacyVTK`)
alongside the untouched ASCII one (`parseAsciiLegacyVTK`, renamed but
byte-for-byte identical logic — zero regression risk for existing
ASCII fixtures/tests), dispatched by reading the file's 3rd header line
("ASCII" vs "BINARY") in the exported `parseLegacyVTK()`. Legacy-VTK
binary values are always big-endian ("network order") regardless of
platform — confirmed by decoding a real point coordinate from the
example file both ways and checking which produced a sane, small
number. The parser walks the file byte-by-byte: ASCII keyword lines
(`POINTS N float`, `POLYGONS n size`, `SCALARS name type`, …) alternate
with fixed-length binary data blocks; since each block's exact byte
length is always computable from its own header line, the cursor lands
exactly on the boundary after reading it, so any whitespace bytes found
there are guaranteed real ASCII delimiters, never binary data
coincidentally matching a whitespace byte value. Connectivity
(POLYGONS/TRIANGLE_STRIPS) is always 4-byte int in the legacy binary
format, independent of the file's declared point data type — confirmed
against the real file's actual bytes (decoded a `3, i0, i1, i2` triangle
correctly at the expected offset). An unrecognized keyword (LINES,
CELL_TYPES, a modern METADATA/INFORMATION block, …) stops the scan
rather than guessing a payload size — whatever was already parsed
(points, connectivity, arrays read so far) is still returned, a
partial-but-correct result rather than a corrupted one.

**Actually verified this time — a real headless-Chrome + WebGL render,
not just source-reading.** Every vtk.js/three.js fix earlier this
session was shipped with an explicit caveat that it had never been
seen rendering, since this environment has no GUI. This round, found
that `playwright` installs cleanly here and can drive the *system*
Google Chrome via `channel: 'chrome'` (no Chromium download needed,
which would likely be blocked) — so built a real harness: the compiled
`media/field-viewer.js`/`geo-viewer.js` loaded in an actual headless
Chrome tab, fed the exact real example files, and checked the result
two ways — `gl.readPixels()` on the WebGL canvas (works reliably right
after a render call in the same evaluate(), before any buffer swap) and
an actual `page.screenshot()` (works regardless of timing, since it
reads the compositor's output, not the GL backbuffer directly — the
right tool once >0ms passes before checking). Confirmed: (1) the real
126,390-point/257,202-cell binary `p_ymid.vtk` now parses correctly
(label shows the right counts, one selectable "p" channel) and
**renders real pixels** (100% of the canvas covered in field-colored,
non-background pixels — the sampled plane, correctly framed); (2) a
real STL (`all_chillers.stl`, a very flat/wide rooftop-equipment
layout, bounding box 1524×875×5 units) renders correctly too — a
screenshot showed thin diagonal dashed lines, which is the *correct*
rendering of that specific, extremely flat geometry from an isometric
angle, not a bug; (3) the ASCII bare-geometry path (a `LINES`-only
featureEdgeMesh file) still parses without error post-refactor, i.e.
no regression; (4) the `{command:'ready'}` handshake added earlier this
session actually fires, exactly once, synchronously after the
`message` listener attaches. This is the first time in this whole
multi-round vtk.js saga that a fix has been confirmed by looking at
actual rendered pixels instead of reasoning through library source —
worth remembering as a technique for future webview-rendering bugs in
this project, not just this one.

**Files:** `src/webview/vtkParse.ts` (added `parseBinaryLegacyVTK` +
dispatch; `parseLegacyVTK`'s ASCII behavior is unchanged, just
renamed-and-called-through). `test/vtkParse.test.ts` — 3 new binary
tests: a hand-built binary fixture (points + POLYGONS + a POINT_DATA
SCALARS + a CELL_DATA VECTORS, mirroring the existing ASCII fixture
test exactly so the two are easy to compare), a bare-binary-geometry
case, and — the one that actually matters — an end-to-end read of the
real `examples/Helyx/complex/postProcessing/p_ymid.vtk` file, asserting
the exact real point/cell counts and that a `p` field comes back.

**Verification:** `npm run compile / lint / test` clean — 193 passed /
1 skipped (3 new, all in `test/vtkParse.test.ts`). `npx vsce package`
succeeds, 2.44 MB. Playwright + system Chrome used only as a local,
throw-away verification harness this round (installed into `/tmp`,
never added as a project dependency, deleted afterward) — not part of
the shipped extension or its test suite.

**Feature inspiration from the two linked projects** (per the user's
request — "get inspired... don't use their extension"), **not
implemented yet**, ranked by fit with this extension's existing
three.js/vtk.js stack (no OpenCascade/Gmsh):
- From `loumalouomega/VSCode-MDPA-Preview` (also a pure vtk.js viewer —
  directly comparable architecture, unlike CAD-Preview below): an
  **orientation cube + axis arrows** gizmo where clicking a face snaps
  the camera to that canonical view (upgrade from today's
  display-only axis gizmo); a compact **navigation panel** (stepped
  rotate/pan buttons, zoom +/-, Fit, Center); an **interactive clip
  plane** (X/Y/Z or a free normal, with a live filled cross-section) —
  especially valuable for CFD, to look inside a domain rather than only
  at its surface; **per-layer opacity sliders** (the multi-layer
  geometry viewer built earlier this session already has the layer
  model this would hang off of); a **Persp/Ortho toggle**; an
  editable/lockable color range + log-scale option + a colormap
  dropdown for the field viewer (today's diverging colormap is fixed);
  **Screenshot to PNG**. Their **click-to-inspect** (value at a point)
  and **plot-over-time** features are bigger asks (need picking +, for
  the latter, a time-series of files) but worth keeping in mind if the
  field viewer grows further.
- From `loumalouomega/CAD-Preview` (OpenCascade.js/Gmsh-based — a much
  heavier stack, not a fit to adopt wholesale, but some UI ideas
  transfer): the same orientation-cube/Fit/Ctr view controls; a
  **File ▾ menu** with Open/Save/Export as both menu items and
  commands; **Measurement tools** (distance/angle, pinned as
  annotations) — plausible for the geometry viewer's STL/OBJ meshes
  without needing any B-rep kernel; drag-a-file-onto-the-3D-view (this
  extension already added this earlier in the session, independently).
  Its actual pipeline (OCCT/Gmsh/meshio++, MCP server, parametric
  edits) is out of scope — this extension has no CAD-kernel need, and
  pulling in OpenCascade.js would be a large, unrelated dependency for
  a project whose actual job is dictionary editing + case
  visualization, not CAD modeling.

### 2026-09-13 — view controls panel, and finally getting a real WebGL render to confirm the fixes (three stacked bugs, not one)

User pointed at two more `loumalouomega` VS Code extensions for feature
ideas — `CAD-Preview` ("view fit, pan rotate etc") and
`VSCode-MDPA-Preview` ("add most of its features... be more friendly and
consistent") — and separately reported the field viewer was *still*
blank. Both threads intersect: building the requested view-control panel
required actually driving vtk.js's camera API, which is what finally
forced a real, working headless-render test setup — and that setup then
exposed that the "still blank" report had **three independent, genuine
bugs** behind it, not one, each masking the others.

**View controls panel (`CAD-Preview`-inspired, "view fit, pan rotate
etc").** Added a compact corner overlay to both `geometryHtml.ts` and
`fieldHtml.ts`: two 3×3-grid "compasses" (rotate: tilt/rotate ±15° with
Fit in the center; pan: 4-direction pan with Reset in the center), a
zoom in/out row, and a wireframe toggle (geometry viewer) or
ortho/perspective toggle (field viewer) plus a screenshot button.
Verified via reading the actual installed vtk.js `Camera.js` source (not
guessed) that `azimuth(deg)`/`elevation(deg)`/`zoom(factor)`/
`translate(x,y,z)` all exist with exactly the classic VTK semantics —
`zoom()` in particular scales `parallelScale` or `viewAngle` depending on
projection mode, so one button works correctly in both Ortho and Persp.
Pan has no built-in "by pixels" primitive in vtk.js, so it's built from
`camera.getDirectionOfProjection()` × `getViewUp()` to get a right
vector, scaled by `camera.getDistance()`. Geometry viewer reuses its
existing `sph`/`panCamera`/`fitCameraToLayers` orbit-camera state
directly. Screenshot: `canvas.toDataURL('image/png')` → posted to the
host → `src/workflow/screenshot.ts` (new, shared by both panels and the
custom editor) → a native `showSaveDialog` + `fs.writeFileSync`.

**Building and testing this is what surfaced the real "still blank"
root causes.** Getting the rotate/pan/zoom buttons right meant actually
watching the camera move — which meant finally getting a *working*
headless-Chrome test harness, not just reasoning from source (the
caveat attached to every vtk.js/three.js fix all session). Found that
`playwright` installs cleanly in this environment and can drive the
*system* Google Chrome via `channel: 'chrome'` (no Chromium download,
which would likely be blocked). Three real, previously-undiscovered bugs
came out of actually using it — each one alone was enough to explain
"blank field viewer", which is exactly why earlier fixes (lighting,
normals, the binary-parsing fix from the previous round) never fully
resolved the report:

1. **A real WebGL-context-loss issue in the test harness itself**,
   not the extension — worth recording since it cost real time. The
   legacy `--use-gl=swiftshader` Playwright/Chrome launch flag causes
   `CONTEXT_LOST_WEBGL` specifically when vtk.js is the one driving the
   canvas (confirmed with vtk.js's own trivial built-in `ConeSource`
   example — it lost context too, under identical launch args that
   render three.js scenes just fine). The fix is `--use-angle=swiftshader
   --use-gl=angle --enable-unsafe-swiftshader` (the modern ANGLE-backed
   software-rendering flags) instead of the older `--use-gl=swiftshader`
   alone. Also confirmed `gl.readPixels()` called from a *separate*
   `page.evaluate()` after the fact is unreliable for both three.js and
   vtk.js canvases (their default `preserveDrawingBuffer:false` means the
   backing buffer can already be cleared by the time of an out-of-band
   read) — `page.screenshot()` (reads the compositor's output, not the
   GL backbuffer) is the reliable check; this produced a false "100%
   pixel coverage" positive in the previous round's verification, since
   an untouched/transparent canvas differs from the background color
   just as much as real content would under that check's naive
   thresholding.
2. **A real flexbox circular-sizing bug**, present in the shipped
   `fieldHtml.ts`/`geometryHtml.ts` all along. `#field-panel`/
   `#field-canvas` (and the geometry viewer's `#geo-panel`/`#geo-canvas`)
   are `flex:1` items with no `min-height:0`. vtk.js's own canvas gets
   `style.width:100%` but **no** CSS height at all (confirmed by reading
   `Rendering/OpenGL/RenderWindow.js`) — three.js's canvas has no CSS
   height either (only `width:100%` in this extension's own stylesheet).
   Left alone, the canvas's rendered height falls back to its `height`
   *attribute* (whatever `glWindow.setSize()`/`renderer.setSize()` last
   wrote), which then feeds back into `container.clientHeight` on the
   next resize measurement — with default `min-height:auto`, a flex
   item's automatic minimum size is based on its content's intrinsic
   size, so the container grows to match the canvas instead of the other
   way around, with no upper bound (measured it settling at a genuinely
   wrong 900×900 in one test, actually growing past the whole 700px
   viewport height). Setting the canvas's own CSS `style.height` doesn't
   fix it either — percentage/`100%` heights need a *definite* parent
   height to resolve against, and an auto-sized flex item isn't one, so
   it just resolves back to `auto` → the same intrinsic-attribute
   fallback. The actual fix is `min-height:0` on the `flex:1` containers
   (`#field-panel`, `#field-canvas`, `#geo-panel`, `#geo-canvas`) —
   confirmed by measuring the full layout chain before/after: container
   height stayed a correct, stable value through repeated data loads
   only once this was added at *every* affected level (adding it to just
   the innermost container wasn't sufficient — the ancestor flex item had
   the same unbounded-content problem one level up).
3. **A bad default camera direction for near-planar datasets** — the
   actual, final piece of "why does a real sample surface render as
   nothing." `renderer.resetCamera()` only fits *distance* to the
   current bounds; it explicitly preserves whatever direction the camera
   already has (confirmed by instrumenting a real render and reading the
   camera position back out before/after `resetCamera()` — direction
   was unchanged). A `sampleSurface`/`foamToVTK` slice is close to flat
   in one axis (the real example used throughout this investigation is
   ~0-thickness in X); the camera's default direction happened to look
   straight down a *different* axis than X, but since the object's other
   two dimensions (325 and 8000 units) are wildly asymmetric, the
   default view still projected the plane to a visually-negligible
   sliver. **Made a real, caught-and-fixed reasoning error while fixing
   this**: the first attempt biased the view direction *away* from the
   bounds' thinnest axis (reasoning backwards — "avoid looking down the
   thin axis" was applied as "put the camera far along the wide axes"
   instead of "look mostly along the thin axis"), and a screenshot of
   that attempt still showed a bad, nearly-invisible thin diagonal line —
   caught by actually looking at the render, not by re-reading the code.
   Fixed by inverting it: the camera direction's dominant component is
   now the bounds' thinnest axis (its normal), with a small tilt from the
   other two for a 3/4 look rather than a flat orthogonal one. Extracted
   the pure math into `src/webview/cameraOrient.ts`
   (`computeFaceOnView(bounds)`, no vtk.js/DOM dependency) so it's
   unit-testable — `test/cameraOrient.test.ts` (new) asserts the offset
   along the thinnest axis dominates over the two wide axes, for both an
   X-thin and a Z-thin dataset, which is exactly the assertion that would
   have caught the inverted first attempt.

**Verification.** `npm run compile / lint / test` clean — 199 passed / 1
skipped (6 new, all in `test/cameraOrient.test.ts`). `npx vsce package`
succeeds, 2.44 MB. And, for the first time this session, an actual
rendered screenshot confirming the fix: the real 126,390-point/257,202-
cell `p_ymid.vtk` example now renders as a real, correctly-colored
horizontal band (matching its true 8000×325-unit proportions) with the
legend's `p` field range (0.0002 to 3917) visibly mapped across it —
not reasoned about, not inferred from metadata, actually seen. Also
re-confirmed the geometry viewer (`all_chillers.stl`) still renders
correctly after the shared `min-height:0` CSS fix, and confirmed via
direct `dispatchEvent` testing that the nav-panel buttons correctly
drive the camera (a `page.click()` targeting quirk on the small 22×22px
buttons under Playwright's own actionability check — not a real bug —
initially made two rotate-button clicks appear to do nothing; dispatching
a raw `MouseEvent` instead confirmed the handlers and camera math are
correct). Playwright itself was used only as a local, throw-away
verification harness (installed to `/tmp`, deleted after each round) —
not a project dependency or part of the shipped test suite.

**Feature roadmap for `VSCode-MDPA-Preview`'s bigger ask** ("add most of
its features... more friendly and consistent UI/UX") — not started this
round beyond the view-controls panel above; needs sequencing before a
large implementation push given the scope (contour/quiver/isosurface/
threshold/deformed-shape field-viz modes, mesh quality metrics, find-by-
id, click-to-inspect, a full data table, per-layer opacity, a colormap
picker + log scale + editable range). Recommend tackling in roughly this
order, each a self-contained slice: (1) field viewer color-range/colormap
picker + log scale (small, reuses the existing channel-coloring code
directly), (2) per-layer opacity sliders (small, the multi-layer geometry
model already exists), (3) an interactive clip plane (medium, high value
for CFD — "look inside the domain" — vtk.js ships `vtkPlane`/
`CutterMapper` for exactly this), (4) click-to-inspect a point/cell's
field value (medium), (5) mesh quality metrics + isosurface/threshold/
quiver modes (larger, more novel code each). Not committed to without
the user picking an order, given the size.

### 2026-09-13 — interactive clip plane (user picked this as the next MDPA-Preview-inspired feature)

Given the roadmap above, the user chose the clip plane. Implemented on
both viewers, using each library's real native clipping support (no
hand-rolled geometry cutting):

- **Field viewer** (`fieldViewer.ts`): `mapper.addClippingPlane(plane)`
  with a single `vtkPlane` instance, confirmed via
  `Rendering/Core/AbstractMapper.js` — `addClippingPlane`/
  `removeAllClippingPlanes`/`getClippingPlanes` are real mapper methods.
  `updateClipPlane()` recomputes the plane's origin/normal from the
  current polydata bounds + the slider's 0-100% position along the
  selected axis; re-called on new file loads too (bounds change) so a
  stale plane doesn't end up out of range.
- **Geometry viewer** (`geoViewer.ts`): `renderer.localClippingEnabled =
  true` + a single shared `THREE.Plane`, assigned to every layer's
  `material.clippingPlanes` when enabled (three.js's real per-material
  clipping API, not a shader hack). New layers pick up the current clip
  state in `addLayer()`. Existing `DoubleSide` materials mean the cut
  face shows the mesh's inner surface rather than nothing.
- Both are **hollow** cuts (open shell), not a filled/capped
  cross-section — a solid cap needs a separate cut-and-triangulate pass
  (vtk.js's `vtkCutter`, or manual polygon capping for three.js) and was
  scoped out as a v2 given the size of the ask already covered.
- UI: a `#clip-panel` (X/Y/Z toggle buttons + flip + a slider) added to
  both `fieldHtml.ts` and `geometryHtml.ts`, positioned opposite the nav
  panel — bottom-left for the field viewer, and bottom-left-but-above-
  the-axes-gizmo (`bottom:96px`) for the geometry viewer, since the
  existing 80px axes-canvas already occupies the plain bottom-left
  corner there.

**Verification — a real render again, not just code review.** Used the
same Playwright + system-Chrome-with-ANGLE-swiftshader-flags harness
from the rendering-bug investigation earlier this session. Tested the
geometry viewer against `examples/Helyx/simple/constant/triSurface/
_refSphere.stl` (a real sphere — an unambiguous shape for visually
confirming a flat cut) via direct `dispatchEvent` clicks (Playwright's
own `.click()` had a known hit-testing quirk on these small buttons,
established in the earlier investigation): toggling the clip showed a
sphere with a clean flat cut; flipping direction correctly kept the
opposite (now much smaller) crescent instead; switching the axis to Z
correctly showed a horizontal dome cut. Tested the field viewer against
the same real `p_ymid.vtk` example: enabling a Y-axis clip visibly
shortened the rendered plane from one end, and moving the slider from
50% to 75% shortened it further, proportionally — confirming the
slider-to-position mapping is correct, not just that *some* clipping
happens.

**Verification:** `npm run compile / lint / test` clean — 199 passed / 1
skipped (unchanged; this is webview UI/rendering wiring with no new pure
logic to unit test, same as the nav-panel work). `npx vsce package`
succeeds, 2.44 MB. Playwright used again only as a local, throw-away
verification harness (installed to `/tmp`, deleted after).

### 2026-09-13 — LSP crash resilience + viewer interaction/legend overhaul (direct user feedback)

Two independent reports in one message: a `RuntimeError: memory access
out of bounds` crashing the language server repeatedly, and a detailed
list of 3D-viewer UX complaints (rotation/pan/zoom feel, useless zoom
buttons, the legend's look/placement/size, no colormap choice).

**LSP crash — root-caused the *failure mode*, not the trigger.** Spent
real effort trying to reproduce the actual crash to fix its root cause:
tried a 500K-line real-shaped OpenFOAM field file (5.4 MB), a single
~4 MB line with no newlines, 50,000 levels of nested `{ }`, a
binary-`writeFormat` field file's bytes decoded as UTF-8 garbage (a
real, plausible trigger — HELYX/OpenFOAM `p`/`U`/`T`/etc. field files
can legitimately be written in the same "binary" format as the
`postProcessing` VTK output this session's earlier round dealt with,
under the exact same bare filenames this extension already recognizes),
and a battery of Unicode edge cases (emoji, combining characters, BOM,
lone surrogates, 500K emoji in a comment). **None reproduced it** — so
the exact trigger from the user's environment remains unknown. What
*did* get root-caused, by reading the actual bundled
`web-tree-sitter.cjs` runtime rather than guessing: it's built on ONE
process-wide Emscripten WebAssembly module — `Parser.init()` sets a
module-level `C` binding singleton (`setModule(...)`), and every
`new Parser()` afterward just calls `C._ts_parser_new_wasm()` against
that SAME shared linear memory (confirmed in `Parser.initialize()`).
So once a trap corrupts that memory, **recreating the `Parser` object
does nothing** — every parser in the process shares the same poisoned
backing memory, which is exactly why the crash cascaded into every
subsequent `hover`/`completion`/`semanticTokens` request failing
identically for the rest of the session, as reported. A first attempt
at a fix (catch the exception, discard `this.tsParser`, call
`getParser()` again to build a replacement) was caught as insufficient
*before* shipping, specifically because of this shared-memory fact.
**Actual fix**: `server.ts`'s `parseDoc()` now catches the trap, logs a
clear diagnostic message, and calls `process.exit(1)` (after a short
`setTimeout` to let the log reach the client first) — `extension.ts`
never registered a custom `errorHandler` on the `LanguageClient`, so
`vscode-languageclient`'s *default* one is in effect, which restarts a
closed server process automatically. A fresh process gets a genuinely
fresh WASM module, which is the only real fix for a trapped instance.

**Viewer interactions rebuilt per explicit feedback**, on both the
geometry viewer (three.js) and field viewer (vtk.js):
- **Rotate pivots on the clicked point**, not a fixed scene center.
  Three.js: `THREE.Raycaster` against the visible layer meshes on
  rotate-drag mousedown; if it hits something, `retargetTo(point)`
  recomputes `sph.theta`/`phi`/`r` from `(camera.position - point)` so
  the camera's position doesn't move — only its aim does (a `lookAt`
  snap onto whatever was clicked, not a teleport). vtk.js: no picker was
  in use at all before this round; added one (`vtkPicker`, confirmed via
  its `.d.ts` — `pick([x, y, 0], renderer)` in *display* coordinates,
  which are canvas-relative and bottom-up, unlike the browser's
  top-down `clientY`) and simply `camera.setFocalPoint(...)` to the pick
  result — vtk's camera always looks at its focal point, so this alone
  reproduces the same "snap-then-orbit-from-here" behavior. Both
  engines' built-in "no jump at all" version was investigated and
  rejected as geometrically impossible in general (an off-center click's
  ray isn't the camera's central axis, so *some* re-aim on retarget is
  unavoidable with a look-at camera model) — a small, expected snap onto
  what you clicked, matching common CAD-tool behavior, not a bug.
- **Right-click pans** on both viewers now (previously: geoViewer.ts
  already supported right-drag pan, but fieldViewer.ts had no working
  right-click binding at all — `vtkInteractorStyleTrackballCamera`'s own
  defaults only bind plain-left=rotate/shift+left=pan/ctrl+left=spin,
  confirmed by reading its source, no right or middle-button handler
  exists in that class). Replaced vtk.js's own mouse dispatch entirely
  with direct camera manipulation (reusing the same
  azimuth/elevation/translate/zoom primitives the nav-panel buttons
  already used) rather than fighting its internal state machine to inject
  a pick-and-retarget mid-gesture.
- **Zoom sensitivity reduced** on both: replaced the fixed ~10-20%-per-
  wheel-tick step with an exponential response to the raw `deltaY`
  (`factor = exp(-deltaY * 0.0006)`), smooth across mouse wheels and
  trackpads and noticeably gentler than before.
- **Removed the nav-panel's zoom in/out buttons** on both viewers,
  called out directly as not useful (scroll-zoom and Fit/Reset cover the
  same need).
- **Field viewer legend redesigned**: was a full-panel-width horizontal
  bar in a dedicated footer strip; now a compact **vertical** bar
  (14×130px) in a small corner overlay panel, bottom-right (just left of
  the nav panel), matching the nav/clip panels' own visual style.
- **Colormap picker added** (`src/webview/colormaps.ts`, new, pure/
  testable — a `Colormap[]` of `{id, label, stops}` control points, no
  vtk.js/DOM dependency): Cool→Warm (the previous fixed default, kept
  first/default), Jet (a vivid rainbow map, explicitly requested), and
  Viridis/Plasma/Grayscale as further conventional options. A
  `<select>` in the new legend panel rebuilds the `vtkColorTransferFunction`
  and redraws the CSS gradient (`toCssGradientStops()`, also pure) on
  change, then reapplies the currently-selected channel's color range so
  switching colormaps doesn't require reselecting the field.

**Verification:** `npm run compile / lint / test` clean — 203 passed / 1
skipped (4 new, `test/colormaps.test.ts`: preset shape/range validation,
`findColormap` fallback, gradient-string generation). `npx vsce package`
succeeds, 2.45 MB. Verified interactions and the new legend visually via
the same Playwright + system-Chrome-with-ANGLE-swiftshader-flags harness
from the earlier rendering-bug round, using **real `page.mouse` events**
(not `dispatchEvent`, which was a documented Playwright-hit-testing
workaround needed for the tiny 22×22px nav buttons specifically, not for
full-canvas drags): left-drag rotate visibly changes the view (axis
gizmo reorients) with a sphere test file confirming a clean rotation;
right-drag pan visibly moves the object in the drag direction (grab-feel
confirmed) on both viewers; one wheel-tick now changes size only
slightly, confirmed by comparing before/after screenshots; the colormap
dropdown lists all 5 presets and switching between them (Cool→Warm →
Jet → Viridis) visibly recolors both the rendered plane and the legend
bar correctly on the real 126k-point HELYX example. **Not verified**:
the actual tree-sitter crash fix, since the trigger was never
reproduced — the fix is grounded in reading the real
`web-tree-sitter.cjs` architecture, not in a before/after repro.

### 2026-09-13 — `.stl`/`.obj` also default to the 3D viewer on open

User: "when I open a stl or a CAD file can openfoam 3D geometry be a
default option to open the stl."

Small, mechanical extension of the `.vtk`/`.vtp` default-custom-editor
work from earlier this session: `VtkCustomEditorProvider.ts`'s own
`resolveCustomEditor()` logic already treated anything that isn't `.vtp`
or a field-carrying `.vtk` as plain geometry (routing to
`buildGeometryHtml`/`previewGeometry`, extension-agnostic) — it just
wasn't *registered* for `.stl`/`.obj` files at all. Added both filename
patterns to `package.json`'s existing `contributes.customEditors` entry
(still `priority: "default"`, still "Reopen Editor With…"-overridable);
no code changes needed beyond updating the provider's own doc comment
to reflect the broader scope. "CAD file" in the request is STL/OBJ
specifically — this extension's geometry viewer doesn't parse any
other CAD format (STEP/IGES/etc. are out of scope, per the earlier
`CAD-Preview`/`VSCode-MDPA-Preview` inspiration discussion where that
was flagged as belonging to a much heavier OpenCascade-based stack).

**Verification:** `npm run compile / lint / test` clean — 203 passed / 1
skipped (unchanged; a `contributes.customEditors` selector addition has
no unit-testable logic of its own). `npx vsce package` succeeds,
2.45 MB.

### 2026-09-13 — clip-panel consolidation + multi-select "Open with OpenFOAM 3D Geometry"

User: "there is a panel on the bottom left with x y z and cut etc, is
not it redundant? if i multi select stls in the explorer there must be
an option [with] right click to open with openfoam 3d geometry."

**Redundant panel.** The geometry viewer had TWO things labeled with
X/Y/Z sitting right next to each other in the bottom-left corner: the
passive axis-orientation gizmo (`#axes-canvas`, always there, shows
which way is up) and the interactive clip-plane panel (`#clip-panel`,
added two rounds ago, X/Y/Z axis buttons + a slider). Visually near-
identical labels in the same corner reads as duplicated controls even
though they do different things. Fixed by moving the clip-plane
controls (unchanged element IDs, so `geoViewer.ts`/`fieldViewer.ts`'s
JS needed zero changes) into the existing view-controls (`#nav-panel`)
panel as a final section below a `.nav-divider` — one coherent panel
per viewer instead of two overlapping ones, and the axis gizmo (still
bottom-left, on its own now) no longer looks like it's duplicating
anything.

**Multi-select right-click.** Investigated why this didn't already
work: `package.json` had **no `explorer/context` menu entry at all**
for `openfoam.previewGeometry`/`openfoam.previewField` — they were only
ever reachable via the Command Palette or the Case Explorer's own
`view/item/context` menu, never VS Code's native Explorer right-click
menu. Added both to a new `explorer/context` section, gated by
`resourceExtname` regex (`previewGeometry` for `.stl`/`.obj`/`.vtk`,
`previewField` for `.vtk`/`.vtp` — deliberately overlapping on `.vtk`
since it can be either, letting the user pick explicitly rather than
only ever getting the auto-detected one from double-click). Separately,
`previewGeometryCommand`'s handler only ever read its *first* argument
— but VS Code invokes a context-menu command as
`(clickedUri, allSelectedUris[])` when more than one item is selected,
so even with the menu entry present, a multi-select right-click would
have silently only opened the one file that happened to be right-
clicked. Updated the handler to check for that second array argument
and loop `panel.previewGeometry()` over every selected URI when present
— reusing the exact same "add as layer" method the multi-select file
picker and drag-and-drop already call.

**Verification:** `npm run compile / lint / test` clean — 203 passed /
1 skipped (unchanged; both changes are manifest/command-plumbing with
no new pure logic). `npx vsce package` succeeds, 2.45 MB. Re-verified
the merged panel visually via the same Playwright harness — the clip
toggle button still correctly enables/highlights and clips the test
sphere from within its new location inside `#nav-panel`, confirming the
ID-preserving move didn't break the existing JS wiring.

**Not yet addressed — flagged for a scoped decision, not silently
started:** the user's third point in the same message — merging the
geometry viewer (three.js) and field viewer (vtk.js) into one single
"OpenFOAM Preview" tool that handles both plain CAD geometry and VTK
field data. This is a materially bigger undertaking than the two fixes
above: the two viewers run on genuinely different rendering engines
with no shared scene graph, so a *true* merge means picking one engine
for everything (vtk.js can already render bare geometry with no field
data, as proven by the earlier "vtk not shown" investigation — it's the
more capable candidate) and porting all of three.js-only functionality
(multi-layer STL/OBJ, the click-to-orbit raycasting, wireframe toggle)
onto it, or the reverse. Raised this trade-off directly with the user
rather than guessing at how deep a "merge" they actually want (a single
entry-point/command that still runs two engines under the hood vs. one
true unified engine) before committing to a multi-round rewrite.

### 2026-09-13 (continued) — "OpenFOAM Preview" unified, per the user's chosen scope

Asked the user which depth of merge they wanted (AskUserQuestion): "one
command/UI, same two engines underneath" vs. "one engine for
everything (full rewrite)." They picked the former — implemented it
directly rather than the bigger rewrite.

**New single command: `openfoam.preview`.** Auto-detects field-vs-
geometry per file (reusing `looksLikeFieldData`, same sniff already
used everywhere else this session) and routes to
`GeometryPreviewPanel`/`FieldViewerPanel` accordingly; with no argument
it falls back to `previewGeometry`'s own quickpick-from-triSurface flow
rather than duplicating that logic. Handles the context-menu
multi-select calling convention (`(clickedUri, allSelectedUris[])`) by
partitioning the whole selection into field vs. geometry buckets and
opening each into the right panel — a multi-select of mixed file types
now does the sensible thing instead of only working for one type.
`previewGeometry`/`previewField` stay registered (now hidden from the
Command Palette, `"when": "false"`, matching the existing pattern for
the staging-tab's own internal commands) since `openfoam.preview` just
delegates to them — no duplicated panel-creation logic.

**Every entry point now goes through it, closing real latent bugs, not
just for uniformity:**
- `package.json`'s `explorer/context` menu — one entry
  (`openfoam.preview`, matching all four extensions) instead of two
  separate ones a user would have to pick between.
- `OpenFOAMCaseTreeProvider.ts`'s `CaseItem` — now always sets
  `command: 'openfoam.preview'` instead of computing `isField` itself
  just to choose between two command names (still uses the same sniff
  for the tree's own icon choice, since that's a separate, legitimate
  need — the icon should show what it'll open as).
- `VtkCustomEditorProvider.ts`'s `dropFiles` handler — previously
  forced every dropped file into whatever type the *currently open*
  document was (drop a `.stl` onto an open `.vtp` tab → it would have
  tried to open the STL as field data and failed). Now routes each
  dropped file through `openfoam.preview` individually.
- `GeometryPreviewPanel.ts`'s and `FieldViewerPanel.ts`'s own
  `dropFiles` handlers — same fix, and also now genuinely accept all
  four extensions (the field viewer's drop handler previously silently
  ignored `.stl`/`.obj` entirely, and only ever took the *first*
  matching file even when several were dropped together — now every
  dropped file gets routed and opened, not just one).
- Custom editor `displayName` renamed from "OpenFOAM 3D Preview" to
  plain **"OpenFOAM Preview"**, and a new `openfoam.preview` command
  entry added (title "OpenFOAM: Preview (3D/CAD/VTK)") alongside the
  now-hidden originals — this is the one users actually see and invoke
  from here on.

**Verification:** `npm run compile / lint / test` clean — 203 passed /
1 skipped (unchanged; this round is command/menu routing, no new pure
logic). `npx vsce package` succeeds, 2.45 MB.

### 2026-09-13 (continued) — legend placement, a real loading state, and a `∇` case-menu icon

Three more direct requests: move the field-viewer legend, add a loading
state instead of leaving the empty-state page up while a file loads, and
a `∇` editor-title icon (shown only in an OpenFOAM case) offering "Load
Geometries…" / "Postprocessing…".

**Legend moved.** `#legend-panel` in `fieldHtml.ts`: `bottom:8px;
right:104px` → `top:8px;left:8px`. Purely a CSS position change, no JS
touched.

**Loading state.** Added a `#loading-state` overlay (spinner + "Loading
&lt;file&gt;…" text) to both `geometryHtml.ts`/`fieldHtml.ts`, shown from
a new `loading` message through to the actual `previewGeometry`/
`previewField` payload finishing. Two things had to be gotten right for
this to actually be visible rather than a no-op:
1. **Host-side timing.** `GeometryPreviewPanel.previewGeometry()`/
   `FieldViewerPanel.previewField()`/`VtkCustomEditorProvider`'s
   `sendPayload()` all do a synchronous `fs.readFileSync` + base64
   encode before ever posting anything — for a large file that read
   itself can take real time, during which nothing was shown before
   this change. Now they post `{command:'loading', fileName}`
   *immediately*, before that read — `postMessage` to a webview is
   async IPC, so the webview (a separate process) can paint the
   spinner while the host's read+encode still runs, rather than only
   finding out once the data (and the read time) has already happened.
2. **Webview-side timing.** `loadDataset()`/the STL-OBJ-VTK parse +
   `addLayer()` path are both synchronous, single-threaded JS. Showing
   the loading overlay and then immediately calling that heavy work in
   the same tick would never let the browser actually paint the overlay
   first — same class of issue as anything that blocks the main thread
   right after a DOM update. Deferred the heavy work with a **double
   `requestAnimationFrame`** (`afterPaint()`, new small helper in both
   `geoViewer.ts`/`fieldViewer.ts`) after showing the spinner, which
   reliably lands after the next paint, so the spinner is genuinely on
   screen before the parse/render work blocks the thread.
Verified visually (Playwright + the ANGLE-swiftshader flags from
earlier in this session): posting a `loading` message shows the
spinner + filename immediately; posting the real data afterward clears
it and shows the rendered result, for both viewers.

**`∇` case-menu icon.** New `openfoam.caseMenu` command with a custom
SVG icon (`media/nabla-{light,dark}.svg` — a plain `<text>` glyph for
"∇", U+2207, since VS Code's own codicon set has nothing resembling it;
two variants since editor-title icons need distinct light/dark-theme
colors, unlike CSS icons that can use `currentColor`), added to the
`editor/title` menu gated on a new `openfoam.caseDetected` context key.
That key is set from `caseTreeProvider.getCaseRoot()` (already
maintained by the existing Case Explorer — no new detection logic) on
every tree-data-change event, so it tracks the same case-root state the
sidebar already shows. The command itself is a `showQuickPick` with two
options — "Load Geometries…" (multi-select file dialog defaulting to
`constant/triSurface`) and "Postprocessing…" (multi-select, defaulting
to the case's `postProcessing/` folder if one exists) — both of which
just call the already-unified `openfoam.preview` command with the full
selection, reusing everything built earlier this session rather than
adding a third code path.

**Verification:** `npm run compile / lint / test` clean — 203 passed /
1 skipped (unchanged; all three changes are CSS/webview-timing/command-
plumbing with no new pure logic to unit test). `npx vsce package`
succeeds, 2.45 MB, now including the two new SVG icon files. Loading
state and legend placement re-confirmed visually via the same
Playwright harness pattern used throughout this session's viewer work.
