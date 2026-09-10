# OpenFOAM Language Support — VS Code Extension

**Version:** 0.6.1 | **License:** GPL-3.0 | **Identifier:** `openfoam-language-support`

A VS Code extension providing rich language support for OpenFOAM dictionary files — the configuration files used by the OpenFOAM CFD toolbox.

---

## Features

- **Syntax Highlighting** — TextMate grammar for `.openfoam` files and all standard OpenFOAM filenames (controlDict, fvSchemes, U, p, k, etc.)
- **IntelliSense** — Hover docs (~300 entries), auto-completions, signature help, and diagnostics via LSP
- **3D Geometry Preview** — Standalone webview panel for previewing STL/OBJ/VTK geometry files with orbit controls and zoom
- **Case Explorer Sidebar** — Tree view of case directories (system/, constant/, time dirs) with geometry preview actions
- **Auto-Detection** — Automatically assigns the `openfoam` language mode to un-typed files in OpenFOAM case directories
- **Keyword Database** — Ships with ~300+ keywords; can be rebuilt from a local OpenFOAM-13 source tree via 13 Python extraction scripts
- **Boolean Toggle CodeLens** — Clickable inlay hints for on/off/yes/no/true/false values
- **#include & $variable Resolution** — Navigate included files and resolve variable references within a case
- **Format on Save** — Basic dictionary formatting
- **Helyx-OS Support** — Recognizes Helyx-specific filenames and includes an urban CFD example case

---

## Tech Stack

| Technology | Purpose |
|---|---|
| **TypeScript** | All extension and LSP server code |
| **Node.js** | Extension host & LSP runtime |
| **VS Code Extension API** | Commands, providers, webviews, tree views, status bar |
| **LSP** (vscode-languageclient + vscode-languageserver) | Hover, completion, signature help, diagnostics |
| **Three.js** | 3D geometry rendering in webview |
| **esbuild** | Bundles Three.js + geoViewer into webview script |
| **TextMate Grammars** | Syntax highlighting |
| **Python 3** | Keyword database extraction scripts |
| **npm / vsce** | Build & packaging |

---

## Project Structure

```
src/
├── extension.ts                     # Activation entry point
├── parsers/OpenFOAMParser.ts        # RFC-based dictionary parser
├── language-server/
│   ├── server.ts                    # LSP server (hover, completion, diagnostics)
│   ├── caseContext.ts               # Case root detection, #include/$variable resolution
│   └── caseGeometryScanner.ts       # STL/OBJ/VTK geometry scanning
├── providers/
│   ├── OpenFOAMDocumentSymbolProvider.ts  # Outline / document symbols
│   ├── OpenFOAMCodeLensProvider.ts        # Boolean toggle inlay hints
│   └── OpenFOAMCaseTreeProvider.ts        # Case Explorer sidebar tree
├── workflow/GeometryPreviewPanel.ts # Standalone 3D geometry preview webview panel
├── webview/geoViewer.ts             # Three.js 3D viewer for webview
└── extractor/
    ├── extractKeywords.ts           # Keyword DB builder from OF source
    └── solverScraper.ts             # Web scraper for solver list

syntaxes/openfoam.tmLanguage.json    # TextMate grammar
snippets/openfoam.code-snippets      # 10 VS Code snippets
data/                                # Shipped keyword databases
scripts/                             # 13 Python extraction scripts
media/                               # Webview assets (bundled JS, icons)
examples/                            # Example OpenFOAM cases
```

---

## Build Pipeline

1. `tsc -b` — Compiles TS to JS in `out/`
2. `esbuild src/webview/geoViewer.ts --bundle --format=iife --outfile=media/geo-viewer.js` — Bundles Three.js viewer
3. `vsce package` — Packages extension as `.vsix`

---

## Current Limitations

- Regex-based parsing (breaks on multi-line values, macros)
- No go-to-definition or find-references
- No bundler for the main extension (node_modules shipped in VSIX)
- No unit or integration tests
- Keyword database is relatively small
- Webview HTML/CSS/JS embedded directly in TypeScript strings

---

## Links

- **Repository:** https://github.com/Arefhm94/openfoam-vscode-extension
- **OpenFOAM:** https://openfoam.org/
