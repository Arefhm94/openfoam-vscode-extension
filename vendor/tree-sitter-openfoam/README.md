# tree-sitter-openfoam

A [tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammar for
OpenFOAM and Helyx dictionary files (`controlDict`, `fvSchemes`,
`fvSolution`, `snappyHexMeshDict`, boundary field files, `blockMeshDict`,
`constant/polyMesh/boundary`, and the rest of the dictionary-format family).

This is a standalone, runtime-agnostic parser package. It exists so the
same correctness guarantee on the OpenFOAM dictionary format can be shared
between the [openfoam-vscode-extension](https://github.com/Arefhm94/openfoam-vscode-extension)
(via `web-tree-sitter` + the compiled WASM grammar) and any other consumer
(e.g. a Python-based tool via `py-tree-sitter`), rather than being
reimplemented per-consumer.

## Grammar coverage

- Blocks (`name { ... }`), including anonymous blocks used as list
  elements and quoted block-name patterns (`"(inlet|outlet)"`).
- Entries (`key value+ ;`), including zero-value keyword entries
  (`cuttingPatches();`) and a block closed with a redundant trailing `;`.
- Composite/call-style scheme keys, including arbitrarily nested
  arithmetic expressions (`div(((rho*nuEff)*dev2(T(grad(U)))))`) and
  member-call chains (`grad(U).T()`).
- Values: numbers, quoted strings, `$references`, dimension sets
  (`[0 1 -1 0 0 0 0]`), and parenthesized lists (recursively, including
  multi-line `nonuniform List<vector> N (...)` values and lists of
  blocks as in `constant/polyMesh/boundary`).
- Directives as first-class nodes: `#include`/`#includeIfPresent`/etc,
  `#inputMode`, `#if`/`#ifeq`/`#elif`/`#else`/`#endif`, `#codeStream`,
  and a generic fallback for anything else (`#remove`, ...).
- Line and block comments as extras — never affecting brace/paren
  nesting, and correctly absorbed inside quoted strings.

See `test/corpus/error-recovery.txt` for tree-sitter's built-in error
recovery behavior on malformed input, including one documented known
limitation (a missing `;` silently merges into the next entry with no
`ERROR` node, since the grammar cannot distinguish that case from a
legitimately multi-value entry without whitespace-sensitive tokenization).

## Development

```sh
npm install
npm run generate   # regenerate src/parser.c from grammar.js
npm test           # run test/corpus/*.txt via `tree-sitter test`
npm run build-wasm # produce tree-sitter-openfoam.wasm
```

## Distribution

`tree-sitter-openfoam.wasm` is committed to this repo (co-development
convenience) and consumed by `openfoam-vscode-extension` via
`web-tree-sitter`. A native Node.js addon binding was deliberately not
added — the CLI's own native compilation already covers local dev/test
iteration (`npm test`/`tree-sitter parse`), and the actual distribution
target is the WASM build.
