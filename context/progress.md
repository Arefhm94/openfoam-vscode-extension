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
