# Performance & Extension Improvement Plan

---

## 1. Replace the Regex Parser with tree-sitter-foam

This is the single highest-impact change available. Everything else in this document is incremental; this one is architectural.

**Current situation:** `WorkflowPanel.ts` and the symbol provider both use line-by-line regex parsing. This breaks on multi-line values, `#include` directives, `${}` variable references, `#codeStream` blocks, and macros. It is also not reusable — the same parsing logic is duplicated in multiple places.

**What exists already:** There is a complete, community-maintained tree-sitter grammar for OpenFOAM called `tree-sitter-foam` (https://github.com/FoamScience/tree-sitter-foam). It has been tested against all OpenFOAM 8 and Foam-Extend 4 tutorial dictionaries, handles `#include`, nested dicts, lists, vectors, and C++ embedded code blocks, and includes a test suite. There is also a companion LSP (`foam-language-server`) built on top of it, which is worth studying as a reference even if you don't adopt it directly.

**What to do:**

Use the WASM build of tree-sitter (`web-tree-sitter`) so it works in both the extension host and the language server without native bindings:

```bash
npm install web-tree-sitter
# Build tree-sitter-foam to WASM:
# git clone https://github.com/FoamScience/tree-sitter-foam
# cd tree-sitter-foam && npm install && npx tree-sitter build-wasm
# Copy tree-sitter-foam.wasm to your out/ directory
```

```typescript
// src/parser/foamParser.ts
import Parser from "web-tree-sitter";

let parser: Parser | null = null;

export async function initParser(wasmPath: string): Promise<void> {
  await Parser.init({ locateFile: () => wasmPath });
  const lang = await Parser.Language.load(wasmPath.replace("tree-sitter.wasm", "tree-sitter-foam.wasm"));
  parser = new Parser();
  parser.setLanguage(lang);
}

export interface ParseResult {
  tree: Parser.Tree;
  hasErrors: boolean;
}

export function parseDocument(content: string): ParseResult {
  if (!parser) { throw new Error("Parser not initialized"); }
  const tree = parser.parse(content);
  return { tree, hasErrors: tree.rootNode.hasError() };
}

// Incremental re-parse on edit (tree-sitter's killer feature)
export function reparseDocument(
  content: string,
  oldTree: Parser.Tree,
  edit: Parser.Edit
): ParseResult {
  if (!parser) { throw new Error("Parser not initialized"); }
  oldTree.edit(edit);
  const tree = parser.parse(content, oldTree);
  return { tree, hasErrors: tree.rootNode.hasError() };
}
```

The AST from tree-sitter gives you exact source ranges for every node — required for diagnostics, go-to-definition, and semantic tokens. Incremental re-parsing means edits are processed in microseconds, not milliseconds.

---

## 2. Runtime Selection Table Extraction — Cover All Macro Variants

**Current situation:** `extractKeywords.ts` scans for `addToRunTimeSelectionTable` with a basic regex. This misses a large fraction of registered types.

**The full macro family** (from `cpp.openfoam.org/v13/globals_defs.html`):
```
addToRunTimeSelectionTable
addNamedToRunTimeSelectionTable
addTemplatedToRunTimeSelectionTable
addNamedTemplatedToRunTimeSelectionTable
addRemovableToRunTimeSelectionTable
addBackwardCompatibleToRunTimeSelectionTable
addToPatchFieldRunTimeSelection
addToNullConstructablePatchFieldRunTimeSelection
addToFvsPatchFieldRunTimeSelection
addToPointPatchFieldRunTimeSelection
addToFieldSourceRunTimeSelection
addToRadiationRunTimeSelectionTables
makePatchTypeField                    ← boundary conditions (Foundation fork)
makeRASModel                          ← RAS turbulence models
makeLESModel                          ← LES turbulence models
```

**Updated extractor pattern:**

```typescript
// src/extractor/runtimeRegistrations.ts

const REGISTRATION_PATTERNS: RegExp[] = [
  /addToRunTimeSelectionTable\s*\(\s*(\w+)\s*,\s*(\w+)/g,
  /addNamedToRunTimeSelectionTable\s*\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)/g,
  /addToPatchFieldRunTimeSelection\s*\(\s*(\w+)/g,
  /makePatchTypeField\s*\(\s*(\w+)/g,
  /makeRASModel\s*\(\s*(\w+)/g,
  /makeLESModel\s*\(\s*(\w+)/g,
];

export interface RuntimeRegistration {
  baseClass: string;     // e.g. "fvPatchField"
  typeName: string;      // e.g. "fixedValue"
  sourceFile: string;    // relative path in OF source tree
  macro: string;         // which macro was used
}

export async function extractRegistrations(
  sourceRoot: string
): Promise<RuntimeRegistration[]> {
  const results: RuntimeRegistration[] = [];
  // Walk src/ and applications/ in parallel
  const files = await globAsync("**/*.{C,H}", { cwd: sourceRoot, ignore: ["**/lnInclude/**"] });
  await Promise.all(
    files.map(async (file) => {
      const content = await fs.promises.readFile(path.join(sourceRoot, file), "utf-8");
      for (const pattern of REGISTRATION_PATTERNS) {
        let match: RegExpExecArray | null;
        pattern.lastIndex = 0;
        while ((match = pattern.exec(content)) !== null) {
          results.push({
            baseClass: match[1],
            typeName: match[2] ?? match[1],
            sourceFile: file,
            macro: pattern.source.split("\\s")[0],
          });
        }
      }
    })
  );
  return results;
}
```

This produces the complete list of all registered solvers, BCs, turbulence models, functionObjects, and thermophysical models — extracted directly from the source, not from documentation.

---

## 3. Use Annotated Dicts as the Canonical Schema Source

**Current situation:** All keyword descriptions and parameter specs are hand-coded in `addEssentialKeywords()` — a 1,500-line method that diverges from the actual OpenFOAM source over time.

**What OpenFOAM ships:** Every installation includes `$FOAM_ETC/caseDicts/annotated/` — a directory of fully annotated template dicts for every major utility. These are maintained by the OpenFOAM developers and update with each release. For example, `snappyHexMeshDict` in this directory contains every parameter with inline comment documentation.

**What to do:** Parse the annotated dicts during the metadata build step to extract key names, default values, and comment text:

```typescript
// src/extractor/annotatedDictParser.ts

export interface AnnotatedEntry {
  key: string;
  defaultValue: string | null;
  comment: string;           // inline comment text, trimmed
  required: boolean;         // true if no default value given
}

export function parseAnnotatedDict(content: string): AnnotatedEntry[] {
  // Use tree-sitter-foam to get the AST, then walk it:
  // For each key-value pair, collect the leading // comment if present
  // For each key, check if a default value is shown
  const entries: AnnotatedEntry[] = [];
  const tree = parseDocument(content);
  // Walk tree.rootNode, extract keyValue nodes and their preceding comment siblings
  // ... (implementation using tree-sitter node traversal)
  return entries;
}
```

The annotated dict for `decomposeParDict` documents every field. The one for `snappyHexMeshDict` covers every refinement parameter. Parsing these automatically gives you better coverage than any hand-coded database and stays in sync with installed versions.

**Storage:** Replace `data/keywords/` JSON files with one JSON per annotated dict, generated at build time:
```
data/schemas/
  snappyHexMeshDict.json
  decomposeParDict.json
  blockMeshDict.json
  controlDict.json
  fvSchemes.json
  fvSolution.json
  ...
```

---

## 4. Tutorial Mining for Autocomplete Ranking and Snippet Generation

The `tutorials/` directory in the OpenFOAM source is the single best source of working, validated parameter combinations. Mining it gives you frequency data that improves autocomplete ranking and real examples that are more representative than documentation.

**What to extract:**

```typescript
// src/extractor/tutorialMiner.ts

export interface TutorialInsight {
  file: string;                         // e.g. "system/fvSolution"
  solverName: string;                   // from controlDict.application
  turbulenceModel: string | null;       // from constant/turbulenceProperties
  keyFrequencies: Record<string, number>;  // how often each key appears
  valueSamples: Record<string, string[]>;  // sample values seen for each key
  parameterCombinations: Record<string, Record<string, string>>;  // co-occurrence
}

export async function mineTutorials(tutorialsRoot: string): Promise<TutorialInsight[]> {
  const caseDirs = await findCaseDirs(tutorialsRoot);  // dirs with system/controlDict
  return Promise.all(caseDirs.map(dir => mineCaseDir(dir)));
}
```

**How to use the results:**

- **Autocomplete ranking:** A keyword that appears in 80 tutorials ranks higher than one that appears in 2. Store frequency as `popularityScore` in the keyword DB.
- **Value suggestions:** If `deltaT` is set to `0.001` in 40 tutorials using `pimpleFoam`, suggest that as a starting point when the user selects `pimpleFoam`.
- **Incompatibility detection:** If `simpleFoam` never appears with `ddt(U)` in any tutorial, flag it as a likely error when the user sets `ddtScheme` to `Euler` in a `simpleFoam` case.
- **Snippet generation:** Each tutorial case is a potential snippet template. The most popular configurations become built-in snippets.

---

## 5. Semantic Tokens — Context-Aware Coloring Beyond TextMate

**Current situation:** Syntax highlighting is purely TextMate grammar-based. It cannot distinguish a known boundary condition type from an unknown one, a valid solver name from a typo, or a parameter key from a value.

**Semantic tokens** (LSP `textDocument/semanticTokens/full`) are colored by the language server after it has analyzed the document. They override or extend TextMate tokens.

**Token types to define:**

```typescript
// In the LSP server initialization:
const semanticTokensLegend = {
  tokenTypes: [
    "openfoam_known_keyword",      // key with a known schema entry
    "openfoam_unknown_keyword",    // key not in any schema (warning color)
    "openfoam_bc_type",            // value that is a registered BC type
    "openfoam_solver_name",        // value matching a registered solver
    "openfoam_turbulence_model",   // value matching a registered turbulence model
    "openfoam_dimension_set",      // [kg m s ...] dimensional tokens
    "openfoam_include_path",       // #include "file" — the path part
    "openfoam_variable_ref",       // $varName — variable reference
  ],
  tokenModifiers: ["deprecated", "readonly", "defaultValue"],
};
```

**How to emit them:** Walk the tree-sitter AST and for each node, look up its text in the appropriate registry:

```typescript
function buildSemanticTokens(tree: Parser.Tree, db: KnowledgeDatabase): SemanticTokensBuilder {
  const builder = new SemanticTokensBuilder();
  // Walk all keyValue nodes — look up key in schema for current dict type
  // Walk all word values in known positions — check against BC/solver registry
  // Walk all #include paths — mark as include_path token type
  // Walk all $variable references — mark as variable_ref
  return builder;
}
```

**Result:** The editor colors unknown keys in amber, known keys normally, solver names distinctly, and BC types in a third color — without the user configuring anything.

---

## 6. Diagnostics — What to Check and How

No diagnostics exist at all today. These are the ones worth implementing, in priority order:

### Tier 1 — Syntactic (use tree-sitter error nodes)

These cost almost nothing because tree-sitter gives you error recovery for free. Any `ERROR` or `MISSING` node in the AST is a diagnostic:

```typescript
function collectSyntaxErrors(tree: Parser.Tree): Diagnostic[] {
  const errors: Diagnostic[] = [];
  const cursor = tree.walk();
  function walk() {
    if (cursor.nodeType === "ERROR" || cursor.nodeType === "MISSING") {
      errors.push({
        range: nodeToRange(cursor.currentNode()),
        message: `Syntax error: unexpected token`,
        severity: DiagnosticSeverity.Error,
        source: "openfoam",
      });
    }
    if (cursor.gotoFirstChild()) { walk(); cursor.gotoParent(); }
    if (cursor.gotoNextSibling()) { walk(); }
  }
  walk();
  return errors;
}
```

### Tier 2 — Schema validation (use annotated dict schemas)

For each recognized file type, check that required keys are present and no unknown keys are used:

```typescript
// controlDict must have: application, startFrom, stopAt, deltaT, writeControl, writeInterval
// fvSolution must have at least one solver block
// 0/U must have: dimensions, internalField, boundaryField

const REQUIRED_KEYS: Record<string, string[]> = {
  controlDict: ["application", "startFrom", "stopAt", "deltaT", "writeControl", "writeInterval"],
  fvSchemes: ["ddtSchemes", "gradSchemes", "divSchemes", "laplacianSchemes", "interpolationSchemes", "snGradSchemes"],
};
```

### Tier 3 — Cross-file semantic checks (requires project index)

These need the full project graph and are implemented after the indexer:

- `controlDict.application` value must match a registered solver name
- Fields in `0/` must declare boundary entries for every patch defined in `constant/polyMesh/boundary`
- If `turbulenceModel` is `kEpsilon`, then `0/k` and `0/epsilon` must both exist
- `decomposeParDict.numberOfSubdomains` must be consistent with the mpi launch count (if readable from a `Allrun` script)
- `#include "filename"` — file must exist relative to the case root

---

## 7. Go-To-Definition for `#include` Chains

OpenFOAM cases make heavy use of `#include`. A field file might look like:
```
#include "initialConditions"
```
where `initialConditions` lives in `0/include/initialConditions`. Currently, clicking on the include path does nothing.

**Implementation:**

```typescript
// LSP: textDocument/definition
function onDefinition(params: DefinitionParams): Location | null {
  const doc = documents.get(params.textDocument.uri);
  const tree = parseDocument(doc.getText());
  // Walk AST to find #include node at cursor position
  const includeNode = findIncludeAtPosition(tree, params.position);
  if (!includeNode) { return null; }
  const includePath = includeNode.text.replace(/^["<]|[">]$/g, "");
  // Resolve relative to case root, then to $FOAM_ETC/caseDicts
  const candidates = [
    path.join(caseRoot, path.dirname(params.textDocument.uri), includePath),
    path.join(caseRoot, "0", "include", includePath),
    path.join(caseRoot, "system", "include", includePath),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { uri: URI.file(candidate).toString(), range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } };
    }
  }
  return null;
}
```

---

## 8. Project Indexer — Cross-File Symbol Resolution

The language server currently treats each file in isolation. A project indexer builds a complete in-memory model of the case, which is required for cross-file diagnostics and go-to-definition on non-include references.

**Index structure:**

```typescript
interface CaseIndex {
  caseRoot: string;
  solverName: string | null;       // from controlDict.application
  turbulenceModel: string | null;  // from constant/turbulenceProperties
  patches: PatchInfo[];            // from constant/polyMesh/boundary
  fields: FieldInfo[];             // all files in 0/ and time directories
  includes: IncludeGraph;          // which files include which
  lastIndexed: number;             // timestamp, for cache invalidation
}

interface PatchInfo {
  name: string;
  type: string;                    // wall / patch / symmetry / empty / ...
}

interface FieldInfo {
  name: string;                    // "U", "p", "k", etc.
  filePath: string;
  dimensions: string;
  internalField: string;
  patches: string[];               // patch names with entries in boundaryField
  missingPatches: string[];        // patches from polyMesh/boundary with no BC entry
}
```

**Build trigger:** Index on workspace open, then watch for file changes via `vscode.workspace.createFileSystemWatcher` and incrementally update only the changed file's contribution.

---

## 9. Knowledge Database Schema — Versioned, Fork-Aware

The current `openfoam-keywords.json` is a flat list. Replace it with a structured, versioned schema:

```typescript
interface KnowledgeDatabase {
  version: string;                  // DB schema version, e.g. "2.0"
  openfoamVersions: string[];       // ["v13", "v2412"] — which OF versions this covers
  generatedAt: string;              // ISO timestamp
  registrations: {
    solvers: RegisteredType[];
    boundaryConditions: RegisteredType[];
    turbulenceModels: RegisteredType[];
    functionObjects: RegisteredType[];
    fvOptions: RegisteredType[];
    thermophysicalModels: RegisteredType[];
  };
  schemas: {                        // One entry per recognized dict file type
    [dictName: string]: DictSchema;
  };
  tutorialInsights: TutorialInsight[];
}

interface RegisteredType {
  name: string;                     // "simpleFoam", "fixedValue", "kEpsilon"
  baseClass: string;                // "solver", "fvPatchField", "RASModel"
  sourceFile: string;               // relative path in OpenFOAM source
  supportedFieldTypes?: string[];   // for BCs: ["volScalarField", "volVectorField"]
  openfoamVersions: string[];       // which versions this type exists in
  description: string;
}

interface DictSchema {
  dictName: string;                 // "controlDict", "fvSchemes", etc.
  requiredKeys: SchemaEntry[];
  optionalKeys: SchemaEntry[];
  openfoamVersions: string[];
}

interface SchemaEntry {
  key: string;
  type: "word" | "scalar" | "integer" | "boolean" | "vector" | "list" | "dict" | "dimensionedScalar";
  defaultValue?: unknown;
  allowedValues?: string[];         // for enum-like entries
  description: string;             // from annotated dict comment
  popularityScore: number;         // from tutorial mining, 0-1
}
```

This schema supports: version filtering (don't suggest v13-only features to a v2412 user), fork-awareness (Foundation vs ESI), and plugin extensions (user adds their custom library entries).

---

## 10. Code Performance Optimizations

### Language Server Startup

Load the knowledge database asynchronously. Don't block the `onInitialized` handler:

```typescript
private async loadDatabase(): Promise<void> {
  try {
    const raw = await fs.promises.readFile(dbPath, "utf-8");
    this.db = JSON.parse(raw) as KnowledgeDatabase;
  } catch (err) {
    this.connection.console.error(`Failed to load keyword DB: ${err}`);
    // Server continues without completions rather than crashing
  }
}
```

### Completion — Lazy Resolve

Return lightweight stubs from `onCompletion`, compute documentation only in `onCompletionResolve`:

```typescript
// onCompletion: fast, called on every keypress
private onCompletion(_params: TextDocumentPositionParams): CompletionItem[] {
  return Array.from(this.db.schemas[currentDictType]?.optionalKeys ?? []).map(entry => ({
    label: entry.key,
    kind: CompletionItemKind.Field,
    data: entry.key,
    sortText: String(1 - entry.popularityScore).padStart(6, "0"),  // frequency-ranked
  }));
}

// onCompletionResolve: called only for the item the user hovers
private onCompletionResolve(item: CompletionItem): CompletionItem {
  const entry = this.lookupEntry(item.data as string);
  if (entry) {
    item.detail = entry.type;
    item.documentation = { kind: MarkupKind.Markdown, value: formatEntry(entry) };
    item.insertText = generateSnippet(entry);
    item.insertTextFormat = InsertTextFormat.Snippet;
  }
  return item;
}
```

### WorkflowPanel File Parsing

Cache parsed file content keyed by `(filePath, mtimeMs)`:

```typescript
private parseCache = new Map<string, { mtime: number; ast: ParseResult }>();

private async parseCached(filePath: string): Promise<ParseResult> {
  const stat = await fs.promises.stat(filePath);
  const cached = this.parseCache.get(filePath);
  if (cached?.mtime === stat.mtimeMs) { return cached.ast; }
  const content = await fs.promises.readFile(filePath, "utf-8");
  const ast = parseDocument(content);
  this.parseCache.set(filePath, { mtime: stat.mtimeMs, ast });
  return ast;
}
```

---

## 11. Recommended Testing Strategy

### Unit Tests — `@vscode/test-electron` + Mocha

Priority targets:

| Module | What to Test |
|--------|-------------|
| `foamParser.ts` | Parse all files in `examples/` — zero errors expected |
| `runtimeRegistrations.ts` | Against a real OF source tree snippet |
| `annotatedDictParser.ts` | Extract known keys from a fixed annotated dict file |
| `diagnostics.ts` | Known-bad controlDict → expected error list |
| `DocumentSymbolProvider` | Symbol count matches expected for each example file |
| Language server | Hover on `GAMG` returns markdown with description |

### Grammar Tests — tree-sitter test framework

```
# test/corpus/controlDict.txt
==================
controlDict basic
==================
application     simpleFoam;
startFrom       startTime;
startTime       0;
endTime         500;
deltaT          1;

---
(dict
  (entry (key) (value))
  (entry (key) (value))
  (entry (key) (value))
  (entry (key) (value))
  (entry (key) (value)))
```

### Tutorial Regression Tests

The `testOFFiles.sh` script pattern from `tree-sitter-foam` can be adapted:
```bash
#!/bin/bash
# Run parser over all tutorial files, report any that produce ERROR nodes
find "$FOAM_TUTORIALS" -name "controlDict" -o -name "fvSchemes" -o -name "fvSolution" | \
  xargs -P8 -I{} node out/tools/parseCheck.js {}
```

---

## 12. Extension Bundle Size

**Current VSIX: 8.9 MB** (27 MB Helyx examples + node_modules included)

**After fixes:**

1. Move `examples/` to a separate GitHub release asset. Link to them from README. VSIX stops shipping 27 MB of STL files.
2. Bundle with esbuild — replaces `node_modules/` (235 files) with one ~300 KB JS file.
3. Ship `tree-sitter-foam.wasm` (~800 KB) instead of building at runtime.

```json
// .vscodeignore additions
examples/**
node_modules/**
src/**
*.map
tsconfig*.json
build-webview.js
```

**Expected VSIX size after: ~1.5 MB** (bundle + wasm + data files)

---

## 13. Security

**Webview file write path validation** — before any `saveParameter` or `generateFiles` write:
```typescript
function assertInsideWorkspace(filePath: string, caseRoot: string): void {
  const resolved = path.resolve(filePath);
  const root = path.resolve(caseRoot);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error(`Security: refusing write outside case root: ${filePath}`);
  }
}
```

**Content Security Policy** — current CSP is correct (`script-src 'nonce-X'`, no `unsafe-eval`). Do not change it when adding the React webview — ensure esbuild output does not use dynamic `eval` or `new Function`.

**`child_process.spawn` for execution** — never use `shell: true`. Always pass arguments as an array:
```typescript
// Wrong:
spawn("sh", ["-c", `blockMesh -case ${caseRoot}`]);  // shell injection risk

// Right:
spawn("blockMesh", ["-case", caseRoot], { cwd: caseRoot });
```

**RTST scraping** — the `solverScraper.ts` makes an outbound HTTP request to `cpp.openfoam.org`. This should only run during the offline metadata build step, never at extension activation or in response to user actions. Document this clearly.
