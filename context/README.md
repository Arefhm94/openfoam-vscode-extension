# OpenFOAM Dictionary Support

VS Code extension for OpenFOAM and Helyx-OS dictionary files. Syntax highlighting, IntelliSense, and a case structure visualizer.

![Case Workflow Panel](image.png)

---

## Features

- **Syntax highlighting** — keywords, numbers, vectors, comments, strings
- **Hover documentation** — hover any keyword to see its description, typed parameters, and an example snippet
- **Auto-completion** — 300+ keywords with parameter snippets; context-aware sorting
- **Signature help** — shows parameter types while you type
- **Outline view** — navigable tree of every dict block and key-value pair (Explorer → Outline)
- **Auto-detection** — files without extensions inside `system/`, `constant/`, `0/` get the OpenFOAM language automatically
- **Case workflow panel** — visual overview of your case structure with inline parameter editing
- **Helyx-OS support** — recognizes `helyxHexMeshDict`, `caseSetupDict`, `materialProperties`, and Helyx boundary condition files

---

## Installation

### From Marketplace

Search for **OpenFOAM Dictionary Support** in the VS Code Extensions sidebar.

### From VSIX

```bash
npx @vscode/vsce package
code --install-extension openfoam-language-support-*.vsix
```

---

## Usage

### Syntax Highlighting

Open any OpenFOAM file. Files with recognized names (`controlDict`, `fvSchemes`, etc.) are detected automatically. For unnamed files, run:

```
⌘⇧P → OpenFOAM: Set Language Mode
```

### Case Workflow Panel

```
⌘⇧P → OpenFOAM: Open Case Workflow
```

Click **Scan** to analyze your workspace. The panel shows three columns: System / Constant / Boundary (0/). Parameters are editable inline — tab out of a field to save.

### Refresh Keyword Database

To extract keywords from your local OpenFOAM installation:

```
⌘⇧P → OpenFOAM: Refresh Keyword Database
```

Enter the path to `$WM_PROJECT_DIR`. The extractor walks `.H` and `.C` source files and merges findings with the shipped database. Reload the window when done.

---

## Commands

| Command | Description |
|---------|-------------|
| `OpenFOAM: Set Language Mode` | Manually assign OpenFOAM syntax to the active file |
| `OpenFOAM: Open Case Workflow` | Open the case structure visualizer |
| `OpenFOAM: Refresh Keyword Database` | Re-extract keywords from your local OpenFOAM source |

---

## Recognized File Types

All standard OpenFOAM dict filenames are recognized, plus:

- **Helyx-OS:** `helyxHexMeshDict`, `caseSetupDict`, `materialProperties`, `surfaceIntersectionDict`
- **Field files:** `U`, `p`, `p_rgh`, `k`, `epsilon`, `omega`, `nut`, `alpha.*`, `T`, `rho`
- **Extensions:** `.foam`, `.dict`
- **Auto-detect:** any file without an extension inside `system/`, `constant/`, or a numeric time directory

---

## Development

### Requirements

- Node.js ≥ 18
- VS Code ≥ 1.75

### Setup

```bash
git clone https://github.com/Arefhm94/openfoam-vscode-extension.git
cd openfoam-vscode-extension
npm install
npm run compile
```

Press **F5** in VS Code to open an Extension Development Host.

### Project Structure

```
src/
├── extension.ts                     # Activation entry point
├── utils/fileDetection.ts           # File auto-detection logic
├── extractor/extractKeywords.ts     # Keyword DB builder
├── extractor/solverScraper.ts       # Solver list from cpp.openfoam.org
├── language-server/server.ts        # LSP server (hover, completion)
├── providers/OpenFOAMDocumentSymbolProvider.ts  # Outline view
└── workflow/WorkflowPanel.ts        # Case visualizer webview
data/
├── openfoam-keywords.json           # Pre-built keyword database
└── openfoam-solvers.json            # Pre-built solver list
syntaxes/openfoam.tmLanguage.json    # TextMate grammar
```

### Updating the Keyword Database

```bash
npm run scrape-solvers          # Fetch solver list from cpp.openfoam.org
npm run extract-keywords        # Build keyword JSON (uses fallbacks if no source)
npm run update-database         # Both in sequence
```

### Packaging

```bash
npm run compile
npx @vscode/vsce package
```

---

## Contributing

- Bug reports and PRs welcome.
- For new keyword entries, edit `src/extractor/extractKeywords.ts` → `addEssentialKeywords()`. Each entry takes a `KeywordInfo` object with `name`, `description`, `category`, optional `parameters[]`, and `examples[]`.
- For grammar changes, edit `syntaxes/openfoam.tmLanguage.json`. Use the [TextMate grammar reference](https://macromates.com/manual/en/language_grammars).

---

## License

GPL-3.0. See [LICENSE](LICENSE).
