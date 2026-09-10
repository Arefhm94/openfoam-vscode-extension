# Instruction: Build `tree-sitter-openfoam` and Overhaul the VSCode Extension On Top Of It

## Context and architectural decision

Two separate consumers exist or are planned for "correctly parse, validate,
and generate OpenFOAM/Helyx dictionary files":

1. `openfoam-vscode-extension` (this repo) — IntelliSense in VSCode:
   hover, completion, signature help, diagnostics, outline, inspector
   webview.
2. A separate, non-VSCode agentic CFD platform (different repo, not covered
   by this instruction) that will need to read/validate/generate the same
   file format, most likely from Python.

Because both need the same correctness guarantee on the same file format,
the parser must **not** be built as an internal implementation detail of
the VSCode extension. It must be built as its own standalone,
runtime-agnostic package first, with the VSCode extension as its first
consumer. This avoids two independently-maintained parsers drifting apart
in correctness over time.

**Decision: use tree-sitter**, built as a standalone `tree-sitter-openfoam`
grammar repository, compiled to WASM for portability (consumable via
`web-tree-sitter` from TypeScript and via `py-tree-sitter`/WASM from
Python later). This is a larger upfront investment than a hand-written
parser confined to the extension, justified specifically by the
cross-project reuse requirement above — do not skip straight to a
hand-written parser inside `src/` even though it would be faster to ship
first-order bug fixes.

Note explicitly: VS Code's native editor syntax highlighting is TextMate
grammar based (oniguruma regex), not tree-sitter. `syntaxes/
openfoam.tmLanguage.json` is unaffected by this work and is out of scope
here — tree-sitter powers the LSP-side logic (diagnostics, completion,
hover, outline), not the editor's highlighting layer.

Follow the phases below **in order**. Do not skip Phase 1 or reorder work
ahead of its stated dependencies. Each phase has explicit exit criteria —
do not start the next phase until the current one's exit criteria are met
and you have said so explicitly, with evidence (test output, file diffs,
size/perf comparisons as specified).

Work in small, reviewable commits, one per checklist item or tightly
related group of items. After each phase, produce a short summary of what
changed, what you verified, and any deviations from this instruction (and
why).

If any task turns out to be based on a wrong assumption about the current
code or grammar (a file has moved, a construct doesn't parse the way
assumed, a bug already appears fixed), stop, state the discrepancy
explicitly, and ask before improvising a replacement plan.

---

## Phase 0 — Safety net (VSCode extension repo, before touching feature code)

1. Add an ESLint config (`.eslintrc.json` or `.eslintrc.cjs`) using
   `@typescript-eslint/recommended`. Confirm `npm run lint` runs to
   completion instead of failing with "ESLint couldn't find a
   configuration file."
2. Add a real `test` script to `package.json` (currently only `pretest`
   exists). Use `vitest` or `node --test` with `tsx`/`ts-node`.
3. Add `.github/workflows/ci.yml` running, on every push/PR:
   `npm ci && npm run compile && npm run lint && npm test`.
4. Create `test/fixtures/` and populate it with real case files from
   `examples/OpenFOAM` and `examples/Helyx`, covering at minimum:
   `fvSchemes`, `fvSolution`, `controlDict`, a boundary field file,
   `snappyHexMeshDict`, one file with a block comment containing braces,
   one file with a multi-line list value. These fixtures will be reused
   as the tree-sitter grammar's corpus tests in Phase 1 — keep them in a
   format easy to port (plain `.foam`/dict text files, not
   TS-embedded strings).

**Before proceeding, report:** confirmation `npm run lint` and `npm test`
both execute cleanly and are wired into CI, and the fixture list.

---

## Phase 1 — Build `tree-sitter-openfoam` as a standalone grammar package

Do this in a **new, separate repository/package** (e.g.
`tree-sitter-openfoam`), not inside `openfoam-vscode-extension/src`. The
VSCode extension will depend on it, not contain it.

### 1.1 Scaffold

- Initialize with the standard tree-sitter CLI project layout
  (`grammar.js`, `src/` for generated parser, `test/corpus/` for corpus
  tests, `bindings/` for language bindings).
- Set up the build to produce both a native binding (for fast local dev/
  test iteration) and a WASM build (`tree-sitter build --wasm`) for actual
  distribution to consumers.

### 1.2 Grammar design

Model the grammar around OpenFOAM's actual dictionary structure — this is
a small, regular grammar (comparable in complexity to an nginx-config
grammar), not a general-purpose programming language:

- Top-level: sequence of entries and directives.
- `block`: `identifier '{' entry* '}'` (identifier may be a bare word,
  dotted word like `alpha.water`, or a quoted string pattern).
- `entry`: `key value+ ';'` where `value` can be a scalar, a quoted
  string, a `$reference`, a parenthesized list `( value* )` (recursively,
  for vectors and nested lists), or a nested anonymous block.
- `directive`: `#include`, `#inputMode`, `#if`/`#else`/`#endif`,
  `#codeStream`, etc. as first-class grammar nodes, not comments.
- `line_comment` (`// ...`) and `block_comment` (`/* ... */`, correctly
  spanning multiple lines) as extras/trivia, explicitly excluded from
  affecting brace/paren nesting.
- Ensure quoted strings correctly absorb embedded `//`, `{`, `}`, `(`,
  `)` characters without those affecting tokenization or nesting — this
  was a concrete bug class in the old hand-scanned implementation and
  must not reappear here.

### 1.3 Error recovery

Confirm (via corpus tests, not just manual spot checks) that malformed
input produces `ERROR` nodes localized around the actual problem, while
the rest of the file still parses into a valid tree — this is tree-
sitter's built-in behavior, but it must be validated against real,
deliberately-broken fixtures (missing semicolon, unbalanced brace,
unterminated string, unterminated block comment) before relying on it.

### 1.4 Corpus tests

Port the Phase 0 fixtures into tree-sitter's corpus test format
(`test/corpus/*.txt`) plus additional targeted cases for every specific
defect called out in 1.2. Corpus tests must cover, at minimum:

- Multi-line values (e.g. `nonuniform List<vector> 40 ( ... );` spanning
  many lines) — parse as one entry.
- Nested one-liners (`inlet { type fixedValue; value uniform (0 0 0); }`).
- Quoted block names (`"(inlet|outlet)" { ... }`).
- Comment edge cases from 1.2.
- Each malformed-input case from 1.3, asserting recovery behavior.

Run `tree-sitter test` as part of this package's own CI
(`.github/workflows/ci.yml` in the grammar repo) before it's considered
done.

**Before proceeding to Phase 2, report:** the grammar repo with passing
`tree-sitter test`, a WASM build artifact produced successfully, and
confirmation every defect listed in 1.2/1.3 has a corpus test proving the
fix.

---

## Phase 2 — Integrate the grammar into the VSCode extension

Back in `openfoam-vscode-extension`:

1. Add the `tree-sitter-openfoam` WASM artifact as a dependency (via the
   published package if you've published it, or a local/relative
   dependency during co-development).
2. Add `web-tree-sitter` and load the WASM grammar in the language server
   (`src/language-server/server.ts`) at startup.
3. Replace `getBlockPath()` and `getCursorContext()` with tree queries:
   find the node at the cursor offset, walk parents for the block path,
   determine key-vs-value position from the node's structure.
4. Delete `src/parsers/OpenFOAMParser.ts`'s independent line-based parsing
   logic entirely. Outline view and inspector panel must consume the same
   tree as the language server — via tree-sitter queries, not a second
   parser.
5. Delete now-redundant text-scanning functions, including `wordAt()`'s
   `\w`-only regex — replace with a tree-node-aware lookup so dotted
   identifiers like `alpha.water` resolve as a single token.
6. Re-run the Phase 0 fixtures through hover, completion, and outline.
   Confirm no regression versus current behavior for cases that already
   worked, and confirm the specific defects from Phase 1.2/1.3 are fixed
   end-to-end (not just at the grammar level).
7. Measure and record re-parse latency on the largest available
   `snappyHexMeshDict` fixture using tree-sitter's incremental edit API
   (`tree.edit()` + reparse) versus a full-document reparse, to confirm
   the incremental-parsing benefit is actually being used, not just
   theoretically available.

**Before proceeding to Phase 3, report:** confirmation that hover,
completion, diagnostics, outline, and the inspector all read from the
tree-sitter tree; confirmation `OpenFOAMParser.ts`'s old logic is gone;
and the incremental vs full reparse latency comparison.

---

## Phase 3 — Schema-driven diagnostics

Context: only 8 file types (`fvSchemes`, `fvSolution`, `controlDict`,
`turbulenceProperties`, `boundaryField`, `blockMeshDict`,
`decomposeParDict`, `snappyHexMeshDict`) currently get real diagnostics.
Every other file type declared in `package.json`'s
`contributes.languages[0].filenames` gets only a generic brace-count and
"has FoamFile header" check.

1. Define a generic `DictSchema` type reusing the existing `FieldSpec`
   shape already present in `data/keyword-db.json` (`required`, `type`,
   `options`, `default`).
2. Implement one generic validator, `validate(tree: Tree, schema:
   DictSchema): Diagnostic[]`, operating on the tree-sitter tree via
   queries, that:
   - Flags keys present in the file but absent from the schema for that
     block (unknown key).
   - Flags schema keys marked `required: true` absent from the block
     (missing required key).
   - Flags value type mismatches where `FieldSpec.type` is known.
   - Flags values outside `FieldSpec.options` where an enum is defined.
   - Also surfaces genuine parse `ERROR` nodes from the tree directly as
     diagnostics (this is new — the old implementation had no general
     parse-error reporting at all, only per-file-type pattern checks).
3. Replace the 8 hand-written `diagXxx()` functions with calls into this
   generic validator plus the relevant schema slice. Keep only genuinely
   file-type-specific logic (e.g. cross-checking boundary patches against
   `constant/polyMesh/boundary`) as targeted additions.
4. Extend `data/` extraction (`scripts/01`–`13`) or hand-author schema
   stubs for currently-uncovered file types: `fvOptions`, `topoSetDict`,
   `setFieldsDict`, `refineMeshDict`, `thermophysicalProperties`,
   `phaseProperties`, `RASProperties`, `regionProperties`,
   `dynamicMeshDict`, `createPatchDict`, `mapFieldsDict`, `sampleDict`,
   `surfaceFeatureExtractDict`, `materialProperties`.
5. For every file type now covered, add two fixture tests: one valid file
   (zero diagnostics), one file with a deliberately introduced
   missing-required-key / unknown-key / bad-enum-value (expected
   diagnostics present).

**Before proceeding to Phase 4, report:** a table of every file type
declared in `package.json` against whether it now has schema-backed
required-key and unknown-key checks, with a passing test for each, and
confirmation raw parse errors now surface as diagnostics.

---

## Phase 4 — Context-aware completion

Context: the data model already encodes `BcInfo.appliesTo` (which fields
a boundary condition is valid for) and `FieldSpec.required`, but
completion logic ignores both and only surfaces them in hover text.

1. In boundary-field completion, filter the boundary-condition list by
   `bc.appliesTo` matching the field currently being edited.
2. In every keyword-completion helper, surface `FieldSpec.required`
   entries first (via `sortText` or equivalent) so required keys are
   visually distinguished from optional ones.
3. Fix the "general/unknown file type" completion fallback: it currently
   returns every scheme name plus every `controlDict` keyword regardless
   of context. For file types without a specific schema yet, return
   either nothing or only genuinely generic entries — never misleading,
   out-of-context suggestions.
4. Add fixture tests confirming completion triggers correctly inside
   multi-line and nested one-liner entries, using the tree-sitter-backed
   cursor context from Phase 2.
5. Verify signature help resolves composite scheme names correctly (e.g.
   `Gauss linearUpwind grad(U)`) using tree structure rather than
   first-token-only assumptions. Add fixture tests for real composite
   schemes.

**Before proceeding to Phase 5, report:** a demonstration that editing a
`p` file vs a `U` file yields different, field-appropriate
boundary-condition completions, and that the unknown-file-type fallback
no longer suggests irrelevant keywords.

---

## Phase 5 — Packaging and scope honesty

1. Update `.vscodeignore` to exclude: `examples/Helyx/**`,
   `examples/OpenFOAM/**` (unless deliberately shipping them for an
   "insert example" feature — state your choice explicitly),
   `context/**`, `data/01_*.json` through `data/12_*.json` (confirm via
   the loader that only `data/keyword-db.json` is needed at runtime
   before excluding the rest), `LINKEDIN_POST.md`, `_logo.png`,
   `package-lock.json`, `tsconfig.tsbuildinfo`. Also confirm the
   `tree-sitter-openfoam` WASM artifact is included and not excluded by
   an overly broad ignore pattern.
2. Run `vsce package` before/after and report the `.vsix` size
   difference.
3. Resolve the Helyx support gap. `helyxHexMeshDict` currently routes
   through identical logic to `snappyHexMeshDict` with zero Helyx-specific
   data anywhere in `src/`. Choose and execute one of:
   - **(a)** Extract a real Helyx keyword schema using the same
     `scripts/01`–`13` pattern used for OpenFOAM-13, using the Helyx
     examples in the repo as reference for actual dict shape — note the
     grammar itself (Phase 1) should already parse Helyx files correctly
     since the dict syntax is the same family; this step is about
     semantic schema data, not parsing, or
   - **(b)** Remove `helyxHexMeshDict`/`caseSetupDict` from
     `package.json`'s supported filenames until real schema data exists.
   State which option you took and why.
4. Add or update `CHANGELOG.md` to reflect this overhaul, including the
   architectural change to tree-sitter and the new external grammar
   dependency.

**Before proceeding to Phase 6, report:** the `.vsix` size before/after,
and confirmation every "supported" file type in `package.json`/README now
has real logic behind it (or has been removed from the list).

---

## Phase 6 — Ongoing hardening (continuous, after Phases 0–5 ship)

1. For every future bug found through real usage, add a corpus test (in
   `tree-sitter-openfoam`) or fixture test (in the extension) before
   fixing it — never fix without a reproducing test, in whichever repo
   the bug actually lives.
2. Version `tree-sitter-openfoam` independently and pin the extension to
   a specific version; bump deliberately, not automatically, so grammar
   changes are reviewed before they affect the shipped extension.
3. When work begins on the separate agentic CFD platform's parsing needs,
   consume `tree-sitter-openfoam` there via `py-tree-sitter` or the WASM
   build rather than writing a third parser — this is the entire point of
   having built the grammar as a standalone package. Flag it explicitly
   if that integration turns out to need grammar changes, so fixes land
   in the shared grammar rather than as a workaround in either consumer.
4. Once Phase 3 diagnostics are trustworthy, revisit `onDocumentFormatting`
   in `server.ts` to confirm it also uses the tree-sitter tree rather than
   older text-scanning logic.

---

## Execution order summary

1. Phase 0 — always first, in the extension repo.
2. Phase 1 — new standalone `tree-sitter-openfoam` repo; the core
   investment, and a prerequisite for correctness work in both consumers.
3. Phase 5 step 1 only (packaging trim) may be done in parallel with
   Phase 1 — it is independent.
4. Phase 2 — integrate the grammar into the extension.
5. Phase 3 — schema-driven diagnostics, immediately after Phase 2.
6. Phase 4 — context-aware completion, immediately after Phase 3.
7. Phase 5 steps 2–4 — whenever ready to commit to the Helyx decision.
8. Phase 6 — ongoing, no end state, and the point at which the grammar's
   reuse in the non-VSCode agentic platform becomes relevant.
