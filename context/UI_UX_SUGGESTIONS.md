# UI/UX Improvement Suggestions

Based on analysis of `src/workflow/InspectorPanel.ts`, `src/webview/geoViewer.ts`, `src/providers/OpenFOAMCaseTreeProvider.ts`, `src/providers/OpenFOAMCodeLensProvider.ts`, and `src/extension.ts`.

---

## 1. Inspector Panel (Webview)

### 1.1 Extract Webview HTML/CSS/JS into a standalone SPA
The entire inspector UI is embedded as a raw HTML string in `InspectorPanel.ts:275-759`. This makes CSS changes, JS debugging, and feature iteration painful. Build a separate SPA (Svelte/React/Lit) compiled with esbuild and loaded as a static file in the webview.

### 1.2 Search / Filter bar
Add a search input above the tree to filter blocks and parameters by name. For large dictionaries (e.g., `fvSolution` with many solvers), this is essential. Highlight matching text in filtered results.

### 1.3 Virtualized tree rendering
The current tree renders every block card as an absolutely-positioned DOM element. For a case with 50+ blocks, this creates hundreds of elements and SVG connectors. Use a virtual list to render only visible nodes, with lazy connector drawing.

### 1.4 Keyboard navigation in the tree
Blocks are clickable, but there is no keyboard navigation (arrow keys, Enter to expand/select, Escape to clear). Implement full keyboard traversal so users never need to reach for the mouse.

### 1.5 Collapse/expand individual blocks
The `▾` arrow has no click handler for collapsing. All blocks are always expanded. Allow collapsing sub-blocks to reduce visual noise.

### 1.6 Inline editing feedback
When a user edits a parameter via the inspector:
- Show a brief _"Saved"_ toast or a subtle green flash on the row
- No feedback currently exists — the change is silently written
- Show a pending state (spinner/dimmer) while the save round-trips

### 1.7 Undo/redo for inspector edits
Edits made via the inspector go directly to the file with no undo stack. Track a local undo history in the webview (or use VS Code's built-in undo by executing edits through the editor API properly).

### 1.8 Highlight the active block on cursor position
Already implemented, but the `scrollIntoView` call (`InspectorPanel.ts:735`) uses `behavior:'smooth'` which is janky on large trees. Use `behavior:'instant'` or a smooth-but-fast alternative.

### 1.9 File path display
File chips (`InspectorPanel.ts:500`) only show the filename, not the path. Add the full relative path as a tooltip or secondary label, especially useful when multiple files share the same name across directories.

### 1.10 Nav tab drag-to-reorder
`dir-tabs` are rendered in the order of discovery. Let users drag tabs to reorder frequently accessed directories.

### 1.11 Persistent panel state
Inspector panel state (active dir, active file, scroll position, geo panel open/closed, split size) is lost when the panel is closed or the window reloads. Persist it in `context.workspaceState`.

### 1.12 Loading indicator
When loading a large dictionary file, there is no visual feedback between the `postMessage` and the render. Show a spinner while parsing.

---

## 2. 3D Geometry Viewer

### 2.1 Proper OBJ/VTK support
The viewer (`geoViewer.ts`) only parses STL. The `previewGeometry` command and thumbnails claim OBJ/VTK support, but the parser always calls `parseSTL()`. Add Three.js loaders for OBJ (`OBJLoader`) and VTK (`VTKLoader`).

### 2.2 Obj viewer controls toolbar
Add buttons for:
- Reset camera to initial position
- Toggle wireframe overlay
- Toggle auto-rotate
- Toggle between solid / wireframe / both
- Fullscreen mode

### 2.3 Measurement tool
A ruler tool that lets users click two points on the geometry surface and see the distance. Very useful for CFD geometry inspection.

### 2.4 Face/edge color by region
STL files can have multiple solids. Color each solid region differently instead of a single uniform blue (`0x4db8ff`). Show a legend.

### 2.5 Geometry info panel
Show metadata: triangle count, bounding box dimensions, surface area, file size, number of solid regions. The triangle count is already computed (`geoViewer.ts:270`) but could be displayed in a sidebar panel rather than the header label.

### 2.6 Viewer panel resize persistence
The 300px default height and drag-resize are reset on every open. Persist the height in `context.workspaceState` keyed by file path.

### 2.7 Ambient occlusion shading
The current lighting uses two directional lights. Add an ambient occlusion pass or use `MeshStandardMaterial` with `envMap` for more realistic previews.

### 2.8 Thumbnail caching
Thumbnails are re-rendered every time the tree rebuilds. Cache the generated `data:` URI keyed by file mod time in a Map to avoid re-rendering unchanged geometry.

---

## 3. Case Explorer Sidebar

### 3.1 Search/filter input
Add a filter text field at the top of the Case Explorer tree. As the user types, filter visible files and directories. This is critical for large cases with many time directories.

### 3.2 Rich context menu
Current context menu only has VS Code defaults. Add:
- _"Copy Relative Path"_
- _"Reveal in Finder/Explorer"_
- _"Open in Inspector Panel"_
- _"Preview Geometry"_ (for STL/OBJ/VTK)
- _"Duplicate File"_ (common in CFD — copying `0/U` to `0.orig/U`)

### 3.3 File decorations
Show file state decorations:
- Modified (vs. disk) — yellow dot
- Read-only — lock icon
- Symlink — shortcut icon

### 3.4 Geometry file preview thumbnails inline
For geometry files in the tree, show a small 40x40 thumbnail next to the filename. Generate these from the offscreen renderer already used for inspector thumbnails.

### 3.5 Drag-and-drop
Allow dragging files from the Case Explorer into the text editor or inspector panel. Also support dragging geometry files onto the 3D viewer to preview.

### 3.6 Auto-refresh on file system changes
The tree only refreshes on active editor change or manual `refreshCaseTree` command. Use `vscode.workspace.createFileSystemWatcher` to auto-refresh when files are added/removed in the case directory.

### 3.7 Collapse all / Expand all buttons
Already has `showCollapseAll: true`, but could benefit from a dedicated _"Expand All Directories"_ button for quick overview.

### 3.8 Time directory grouping
Time directories (0, 0.1, 0.2, ..., 100) can be dozens of entries. Group them into collapsible ranges (0-1, 1-10, 10-100) or show only the last N with a _"Show All"_ link.

---

## 4. Editor & Language Server UX

### 4.1 Boolean toggle UX improvement
The current CodeLens approach (`OpenFOAMCodeLensProvider.ts`) places `⬤` / `○` in the editor margin. This is subtle and users may not discover it. Add an alternative: a lightbulb code action or a hover button. Also consider a command palette entry _"Toggle Boolean at Cursor"_.

### 4.2 Activation notification
`vscode.window.showInformationMessage("OpenFOAM Language Support activated")` fires on every startup. This is intrusive. Remove it or gate it behind a setting.

### 4.3 Welcome view
When no OpenFOAM case is open, show a custom welcome view in the Case Explorer with:
- _"Open an OpenFOAM case folder to get started"_
- Quick links: _"Open Folder"_, _"OpenFOAM: Set Language Mode"_, _"Open Inspector"_
- A link to OpenFOAM documentation

### 4.4 Format on save feedback
When `formatOnSave` is enabled, there is no visual indication that formatting ran. Show a subtle status bar message or a decoration.

### 4.5 Auto-detection edge cases
The auto-detection regex (`/\/\d+(\.\d+)?\//.test(filePath)`) could match non-OF paths (e.g., a file in `/Users/projects/0.5/report.txt`). Add additional checks: verify that the directory also contains `system/` or `constant/` siblings.

### 4.6 Setting discoverability
Several powerful settings are not surfaced:
- `openfoam.formatOnSave` — could have a status bar toggle
- `openfoam.diagnosticsLevel` — could have a quick-pick command
- `openfoam.caseRoot` — could show the current value in status bar

Add a command palette entry: _"OpenFOAM: Show All Settings"_.

### 4.7 Context-sensitive status bar
The status bar currently shows `$(file-code) OpenFOAM` when an OF file is active. Extend it to show:
- Current case root path (truncated)
- Whether validation is on/off
- Number of diagnostics in current file

### 4.8 Diff view for parameters
When comparing two case setups (e.g., before/after a change), users often diff files manually. Add a command _"OpenFOAM: Compare with..."_ that opens the VS Code diff editor between two selected dictionary files.

---

## 5. General

### 5.1 Tutorial / walkthrough
Add a VS Code walkthrough (via `contributes.walkthroughs` in `package.json`) that guides new users through:
1. Opening an OpenFOAM case folder
2. Using the Case Explorer
3. Previewing geometry
4. Using the Inspector Panel
5. Triggering completions and hover docs

### 5.2 Telemetry-free usage analytics
Consider adding optional, privacy-preserving usage telemetry (opt-in, no PII) to understand which features are used most and prioritise improvements.

### 5.3 Color theme integration
Create a companion VS Code color theme optimized for OpenFOAM dictionary files. Use distinct semantic colors for boundaries, solvers, schemes, and field files.

### 5.4 Responsive inspector layout
The inspector panel has a fixed minimum card width of 140px and a single-row layout. When the panel is narrow (<400px), switch to a single-column vertical stack layout for better readability.

### 5.5 Error state UX
When the language server crashes or fails to start, show a notification with a _"Restart Language Server"_ action button, not just a silent log message.

### 5.6 Multi-root workspace support
The Case Explorer and Inspector only use the first workspace folder. Add explicit support for multi-root workspaces with a dropdown to select which case root to explore.
