# OpenFOAM VS Code Extension — Technical Context

## Overview

This extension adds OpenFOAM dictionary file support to VS Code: syntax highlighting, IntelliSense (hover, completion, signatures), an outline view, and a workflow panel that visualizes the case directory structure. It is implemented entirely in TypeScript, using the VS Code Extension API and the Language Server Protocol (LSP).

---

## Folder and File Structure

```
openfoam-vscode-extension/
├── src/
│   ├── extension.ts                  # Activation entry point
│   ├── utils/
│   │   └── fileDetection.ts          # Heuristics for auto-detecting OF files
│   ├── extractor/
│   │   ├── extractKeywords.ts        # Keyword DB builder (runs as Node script)
│   │   └── solverScraper.ts          # Scrapes cpp.openfoam.org for solver list
│   ├── language-server/
│   │   └── server.ts                 # LSP server (hover, completion, signatures)
│   ├── providers/
│   │   └── OpenFOAMDocumentSymbolProvider.ts  # Outline view
│   └── workflow/
│       └── WorkflowPanel.ts          # Webview panel (case visualizer)
├── data/
│   ├── openfoam-keywords.json        # Pre-built keyword database (shipped)
│   └── openfoam-solvers.json         # Pre-built solver list (shipped)
├── syntaxes/
│   └── openfoam.tmLanguage.json      # TextMate grammar for syntax highlighting
├── language-configuration.json       # Bracket matching, comment tokens
├── package.json                      # Manifest: commands, languages, grammars
└── tsconfig.json
```

---

## Main Extension Lifecycle and Activation Flow

1. VS Code loads the extension when any file matching the `openfoam` language ID or any of the `filenames` list in `package.json` is opened.
2. `activate()` in `extension.ts` runs:
   - Starts the LSP child process (`startLanguageServer`).
   - Registers three commands: `refreshKeywordDB`, `setLanguageMode`, `openWorkflow`.
   - Registers `OpenFOAMDocumentSymbolProvider` for the outline view.
   - Attaches `onDidOpenTextDocument` to auto-detect files without extensions that live inside `system/`, `constant/`, or numeric time directories.
3. `deactivate()` calls `client.stop()`, which terminates the child LSP process gracefully.

The LSP process is started as a separate Node process communicating via IPC. This isolation means a crash in the language server doesn't crash the extension host.

---

## How Syntax Highlighting Works

Syntax highlighting is entirely declarative — no TypeScript runs for it.

`syntaxes/openfoam.tmLanguage.json` contains a TextMate grammar with scopes like:
- `comment.line.double-slash.openfoam` — `//` line comments
- `keyword.control.openfoam` — words like `FoamFile`, `controlDict`
- `constant.numeric.openfoam` — numbers and scientific notation
- `string.quoted.double.openfoam` — double-quoted strings
- `punctuation.definition.block.openfoam` — `{` and `}`

`language-configuration.json` adds bracket matching (`{}`), auto-closing pairs, and comment toggling (`//`).

The grammar is registered in `package.json` under `contributes.grammars` and associated with language ID `openfoam`.

---

## How IntelliSense and Keyword Extraction Work

### Keyword Database

`src/extractor/extractKeywords.ts` builds `data/openfoam-keywords.json`. It runs in two modes:

1. **Offline (shipped):** The JSON is pre-built and bundled with the extension. This is what end-users get.
2. **User-triggered:** The `openfoam.refreshKeywordDB` command lets users point to their local OpenFOAM source tree. The extractor then:
   - Walks `.H` and `.C` C++ files, extracting strings from `dict.lookup<T>("keyword")` patterns.
   - Walks known dict files (`controlDict`, `fvSchemes`, etc.), extracting top-level keyword names.
   - Merges results with the large set of hardcoded, well-documented keywords.

`src/extractor/solverScraper.ts` fetches the `cpp.openfoam.org` documentation site and extracts solver names and descriptions. On network failure, it falls back to a hardcoded list of ~40 solvers.

### Language Server

`src/language-server/server.ts` implements an LSP server as a standalone Node process:
- **Hover:** Looks up the word under the cursor in `keywordMap` (Map keyed by lowercased keyword name). Returns a Markdown card with description, typed parameters, and an example snippet.
- **Completion:** Returns all keywords as `CompletionItem[]`, with context-aware sort ordering (keywords matching the current dict section bubble to the top). Insert text uses VS Code snippet syntax (`${1:placeholder}`).
- **Signature Help:** For keywords with declared `parameters[]`, shows parameter names and types in the signature popup.

The server loads `openfoam-keywords.json` once at startup using two path candidates (handling both dev and installed layouts).

---

## How the Workflow Panel Functions

`WorkflowPanel.ts` creates a VS Code `WebviewPanel` — an embedded browser frame inside the editor.

**Data flow:**
1. User clicks "Scan" → webview sends `{ command: "scanCase" }` via `postMessage`.
2. Extension receives it → `_scanCase()` finds the workspace root, calls `_discoverCaseStructure()`.
3. Discovery reads `system/`, `constant/`, and time directories from disk. Each known dict file is read and parsed with `_parseOpenFOAMDictionary()`.
4. Extension sends `{ command: "caseData", data: {...} }` back to webview.
5. Webview JavaScript renders three vertical columns (System / Constant / Boundary), one node per file with inline-editable parameter fields.
6. When a user edits a parameter inline and tabs out, webview sends `{ command: "saveParameter", ... }`.
7. Extension receives it → finds the matching line in the file, updates it in-place, writes back.

**Security:** The webview uses a `nonce` in the Content-Security-Policy to restrict scripts.

---

## Communication Between VS Code APIs, Providers, and UI

```
┌───────────────────────────────────────────────────────────────┐
│  VS Code Extension Host (Node process)                        │
│                                                               │
│  extension.ts  ──────────────────────────────────────────── ─┤
│    │  registers commands, providers, event listeners          │
│    │                                                          │
│    ├─ OpenFOAMDocumentSymbolProvider  (sync, same process)    │
│    │    └─ vscode.languages.registerDocumentSymbolProvider    │
│    │                                                          │
│    ├─ WorkflowPanel  (Webview, same process)                  │
│    │    └─ panel.webview.postMessage / onDidReceiveMessage    │
│    │                                                          │
│    └─ LanguageClient  ──── IPC ──→  server.ts (child process) │
│         (vscode-languageclient)      (vscode-languageserver)  │
│                                       └─ keywordMap (in RAM)  │
└───────────────────────────────────────────────────────────────┘
```

The document symbol provider runs synchronously in the extension host — no IPC. The language server runs in a child process and communicates only via the LSP wire protocol over IPC.

---

## Build System and Packaging Flow

| Step | Command | What happens |
|------|---------|--------------|
| Install | `npm install` | Fetches TS compiler, vscode types, languageclient/server packages |
| Compile | `npm run compile` → `tsc -b` | Transpiles `src/**/*.ts` → `out/**/*.js` with source maps |
| Watch | `npm run watch` → `tsc -b -w` | Incremental watch mode for development |
| Keyword DB | `npm run update-database` | Runs scraper then extractor to refresh JSON data files |
| Package | `npx @vscode/vsce package` | Bundles `out/`, `data/`, `syntaxes/`, `language-configuration.json`, `package.json`, `README.md` into a `.vsix` |

The `.vscodeignore` excludes source files, test directories, and map files from the VSIX.

**Known packaging issue:** The `examples/` directory (27 MB of Helyx case files) and `node_modules/` are included in the VSIX. This inflates the package to ~9 MB unnecessarily. See the performance doc for mitigation.

---

## Current Strengths

- **Zero-configuration syntax highlighting** — works immediately via filename matching, no user setup required.
- **Rich keyword database** — 300+ keywords with typed parameters, descriptions, and examples from both the User Guide and API docs.
- **Auto-detection** — files without extensions in `system/`/`constant/`/`0/` are automatically assigned the OpenFOAM language.
- **Helyx-OS support** — `helyxHexMeshDict`, `caseSetupDict`, `materialProperties`, and Helyx-specific boundary condition files are recognized.
- **Offline first** — the keyword database is shipped with the extension; no network access is required for basic IntelliSense.
- **Document outline** — the symbol provider gives a navigable tree of every dict block and key-value pair.

---

## Current Limitations

- **Regex-based parsing everywhere** — the dict parser in `WorkflowPanel.ts` and the C++ extractor in `extractKeywords.ts` both use line-by-line regex. They break on multi-line values, `#include` directives, `${}` variable references, and macros.
- **No diagnostics** — the language server does not report errors (missing required fields, wrong value types, etc.).
- **No go-to-definition / find-references** — there is no cross-file symbol resolution.
- **All completions returned always** — the server returns the full keyword list on every completion request; VS Code filters client-side, but it means no context-sensitive suggestions.
- **Webview inline editing is fragile** — saving a parameter rewrites the matched line; it does not preserve alignment, comments, or surrounding structure.
- **No bundler** — `node_modules` is included in the VSIX, and 374 files are packaged instead of one bundled JS file.
- **No tests** — there are no unit or integration tests.
- **Language server path fragility** — the server resolves the keyword DB path with two hardcoded candidates; a third install layout would silently fail.
- **Duplicate keyword definitions** — several keywords (e.g., `cacheAgglomeration`, `noSlip`, `cellCoBlended`) are defined twice in `extractKeywords.ts`. The `addKeyword()` guard prevents duplicate entries in the map, so behaviour is correct, but the dead code reduces readability.

---

## Important Dependencies

| Package | Why |
|---------|-----|
| `vscode-languageclient` | Manages the lifecycle of the child LSP process from the extension host side |
| `vscode-languageserver` | Implements the LSP server (protocol connection, request routing) |
| `vscode-languageserver-textdocument` | Efficient document representation inside the server (line/offset mapping) |
| `typescript` | Dev-only: compiles the source |
| `@types/vscode` | Dev-only: VS Code API type definitions |

---

## How Helyx/OpenFOAM Support Is Implemented

Helyx-OS is a commercial CFD platform built on top of OpenFOAM. The extension supports it at two levels:

1. **File recognition** — `package.json` lists Helyx-specific filenames: `helyxHexMeshDict`, `caseSetupDict`, `materialProperties`, `boundaryConditions/*`. These are matched by the `filenames` array and get the `openfoam` language ID automatically.
2. **Examples** — `examples/Helyx/` contains a real Helyx urban CFD case (wind flow over city buildings) with a full `system/` and `constant/` directory including STL surfaces, feature edge meshes, `helyxHexMeshDict.coarse/fine` variants, tracer transport include-dicts, and multi-region turbulence properties. This serves as both a reference and implicit regression test for file recognition.
3. **Keyword coverage** — The keyword database includes Helyx-specific solver settings and boundary conditions that overlap with OpenFOAM but may have different defaults.

---

## Areas Likely to Become Difficult to Scale

1. **Monolithic `addEssentialKeywords()`** — the method is ~1,500 lines of inline data. Adding more keywords makes it longer; there is no category separation or modularity. Should be split into separate JSON files per category loaded at runtime.
2. **The WebView panel as a node-based UI** — the current panel renders plain divs. Building a real node graph (ComfyUI-style) inside an HTML string embedded in TypeScript is a maintenance nightmare. This should become a proper Svelte/React SPA compiled separately.
3. **Regex-based OpenFOAM parser** — a real multi-file workspace (50+ dicts, `#include` chains, `$variables`) will break the current parser. An AST-based parser (hand-written LL(1) or using `ohm-js`) is needed for go-to-definition, diagnostics, and reliable completions.
4. **No caching** — every `scanCase` call reads and parses all files synchronously. A 100-file case will feel sluggish. An in-memory cache with file-system watcher invalidation is needed.
5. **Single keyword DB file** — the shipped `openfoam-keywords.json` is 140 KB and grows linearly. For OpenFOAM v12+ with thousands of keywords from the source tree, this will be too large for efficient loading. A SQLite file or binary search index would scale better.
