# UI/UX Implementation Plan

**Phased approach:** Phase 1 (quick wins, low risk), Phase 2 (medium effort), Phase 3 (major features). Each item lists files to change and how to verify.

---

## Phase 1 — Quick Wins (1-2 hours each)

### P1.1 Fix `scrollIntoView` jank (Suggestion 1.8)

**Problem:** `InspectorPanel.ts:735` uses `behavior:'smooth'`, causing janky scrolling on large trees.

**Implementation:**
- `src/workflow/InspectorPanel.ts:735` — change `{behavior:'smooth', block:'nearest', inline:'nearest'}` → `{behavior:'instant', block:'nearest', inline:'nearest'}`

**Test:** Open a large dict (e.g. `fvSolution`), click around in the editor, verify highlight scroll is instant.

---

### P1.2 Remove intrusive activation notification (Suggestion 4.2)

**Problem:** `extension.ts:26` shows `showInformationMessage` on every startup.

**Implementation:**
- `src/extension.ts:26` — delete or comment out the `showInformationMessage` line.

**Test:** Reload window, verify no popup appears, extension still activates (status bar shows, commands work).

---

### P1.3 Add filename tooltips to file chips (Suggestion 1.9)

**Problem:** `InspectorPanel.ts:500` — file chips only show the basename.

**Implementation:**
- `src/workflow/InspectorPanel.ts:501` — after `b.textContent=f.name`, add `b.title = f.path;`

**Test:** Open inspector, hover over a file chip, verify full path appears in tooltip.

---

### P1.4 Improve auto-detection safety (Suggestion 4.5)

**Problem:** The regex `/\/\d+(\.\d+)?\//` at `extension.ts:249` can match non-OF paths.

**Implementation:**
- `src/extension.ts:246-252` — replace the simple `filePath.includes(...)` checks with a function that also verifies the directory contains `system/` or `constant/` siblings. Walk up at most 3 levels to find a `system/` directory.

**Test:** Open a file in `~/projects/0.5/report.txt` (not an OF case), verify language is NOT auto-set to openfoam. Open a file in a real OF case at `case/0/U`, verify it IS auto-set.

---

### P1.5 Save/restore geo panel height (Suggestion 2.6)

**Problem:** `geoViewer.ts` geo panel resets to 300px every time.

**Implementation:**
- `src/workflow/InspectorPanel.ts` — in `_handleMessage`, add a `saveGeoHeight` command handler. On panel creation, restore from `context.workspaceState.get('inspector.geoHeight', 300)`.
- In geo panel resize handler (`InspectorPanel.ts:743-749`), post a message to save the height on mouseup.

**Test:** Resize geo panel, close & re-open inspector, verify height persists.

---

### P1.6 Add loading indicator (Suggestion 1.12)

**Problem:** No visual feedback when parsing large files.

**Implementation:**
- `src/workflow/InspectorPanel.ts` — in the HTML, add a hidden spinner div (`<div id="spinner" style="display:none">...</div>`).
- In the webview JS, add a handler for `command: 'loading'` that shows the spinner.
- In `InspectorPanel._loadFile()`, send `{command:'loading', loading:true}` before parsing and `{command:'loading', loading:false}` after.

**Test:** Open a large dict file, verify spinner appears briefly during parse.

---

## Phase 2 — Medium Effort (2-4 hours each)

### P2.1 Collapse/expand blocks in inspector (Suggestion 1.5)

**Problem:** All blocks always expanded, `▾` arrow has no click handler.

**Implementation:**
- `src/workflow/InspectorPanel.ts` webview JS:
  - Add a state set `collapsed: Set<string>`.
  - Add click handler on `.arr` elements to toggle visibility of children.
  - When collapsed, hide child blocks and params; change arrow to `▸`.
  - Update `renderTree()` to check collapsed state.

**Test:** Open inspector with a nested dict (e.g. `fvSolution/solvers/p`), click arrow to collapse, verify children hidden. Click again to expand, verify they reappear.

---

### P2.2 Search/filter bar in inspector (Suggestion 1.2)

**Problem:** No way to filter blocks/params in large dictionaries.

**Implementation:**
- `src/workflow/InspectorPanel.ts` webview JS:
  - Add `<input id="filter" type="text" placeholder="Filter blocks..." />` above the canvas.
  - On input, filter `all` array to only nodes whose name or param names include the query.
  - Re-render tree with filtered nodes (re-run `renderTree()` logic).
  - Highlight matching text in node labels.

**Test:** Open `fvSolution` with many solvers, type "GAMG" in filter, verify only matching blocks shown.

---

### P2.3 Inline editing feedback (Suggestion 1.6)

**Problem:** No feedback when saving a param edit via inspector.

**Implementation:**
- `src/workflow/InspectorPanel.ts` — add a toast/notification system in the webview JS:
  - Create a `<div id="toast">` absolutely positioned, initially hidden.
  - After `vscode.postMessage({command:'saveParam',...})`, show toast with "Saving...".
  - In the message handler for `command:'paramSaved'`, update toast to "Saved ✓" then fade out after 1.5s.
- In `InspectorPanel._saveParam()`, after successful edit, post `{command:'paramSaved'}` back to webview.

**Test:** Edit a param value in the inspector, verify "Saving..." then "Saved ✓" feedback appears.

---

### P2.4 Rich context menu for Case Explorer (Suggestion 3.2)

**Problem:** Case Explorer tree only has VS Code default context menus.

**Implementation:**
- `package.json:contributes.menus` — add a `view/item/context` section for `view == openfoam.caseExplorer`:
  ```json
  {
    "view/item/context": [
      {
        "command": "openfoam.copyRelativePath",
        "when": "view == openfoam.caseExplorer && viewItem != folder",
        "group": "inline"
      },
      {
        "command": "openfoam.revealInFinder",
        "when": "view == openfoam.caseExplorer"
      }
    ]
  }
  ```
- Register new commands in `extension.ts`:
  - `openfoam.copyRelativePath` — copies path relative to workspace root to clipboard.
  - `openfoam.revealInFinder` — runs `revealFileInOS`.
  - `openfoam.duplicateFile` — prompts for new filename, copies file.
- `OpenFOAMCaseTreeProvider.ts` — add `contextValue` to `CaseItem` so `when` clauses can distinguish files from folders.

**Test:** Right-click a file in Case Explorer, verify "Copy Relative Path" and "Reveal in Finder" appear. Click them, verify correct behavior.

---

### P2.5 Auto-refresh Case Explorer on file changes (Suggestion 3.6)

**Problem:** Tree only refreshes on editor change or manual refresh.

**Implementation:**
- `src/extension.ts` — after creating the tree view, create a `FileSystemWatcher`:
  ```typescript
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  watcher.onDidCreate(() => caseTreeProvider.refresh());
  watcher.onDidDelete(() => caseTreeProvider.refresh());
  watcher.onDidChange(() => caseTreeProvider.refresh());
  context.subscriptions.push(watcher);
  ```

**Test:** Add a new file to a case directory via terminal, verify Case Explorer updates immediately. Delete a file, verify it disappears.

---

### P2.6 Keyboard navigation in inspector tree (Suggestion 1.4)

**Problem:** No keyboard navigation in the webview tree.

**Implementation:**
- `src/workflow/InspectorPanel.ts` webview JS:
  - Track `focusedNodeId` in state.
  - Add `keydown` listener to the canvas:
    - `ArrowDown` — move to next sibling or into children.
    - `ArrowUp` — move to previous sibling or parent.
    - `Enter` — jump to line / toggle collapse.
    - `Escape` — clear focus.
  - Add `tabindex="0"` to block headers to make them focusable.
  - Visually highlight the focused node with a focus ring.

**Test:** Open inspector, press Tab to focus the tree, use arrow keys to navigate, verify focus moves and editor jumps on Enter.

---

### P2.7 Boolean toggle hover button (Suggestion 4.1)

**Problem:** Boolean CodeLens is hard to discover.

**Implementation:**
- `src/language-server/server.ts` — add a `CodeAction` handler for boolean values:
  - When cursor is on a boolean keyword (`true/false/yes/no/on/off`), return a code action: _"Toggle Boolean"_.
  - Action executes `openfoam.toggleBoolean` command.
- Update `extension.ts` — register the command already exists, just ensure it's discoverable in the command palette with a human-readable title.

**Test:** Hover over `true` in a dict file, click lightbulb, verify action appears. Run _"OpenFOAM: Toggle Boolean at Cursor"_ from command palette, verify value toggles.

---

### P2.8 Status bar improvements (Suggestion 4.7)

**Problem:** Status bar only shows static `$(file-code) OpenFOAM`.

**Implementation:**
- `src/extension.ts` — extend `updateStatusBar`:
  - Show current case root (truncated to 30 chars) when available.
  - Show validation status from settings.
  - Show diagnostic count (requires LSP client query).

**Test:** Open an OF file in a case with a known root, verify status bar shows truncated path. Toggle `validateBoundaryPatches`, verify indicator changes.

---

## Phase 3 — Major Features (4-8+ hours each)

### P3.1 Proper OBJ/VTK support in 3D viewer (Suggestion 2.1)

**Problem:** Geo viewer only parses STL; OBJ/VTK support is claimed but broken.

**Implementation:**
- `src/webview/geoViewer.ts`:
  - Import `OBJLoader` from Three.js (or inline a simple OBJ parser).
  - Import `VTKLoader` or write a basic VTK parser.
  - In the `previewGeometry` message handler, detect format from `msg.fileName` extension:
    - `.stl` → `parseSTL()` (existing)
    - `.obj` → new `parseOBJ()` or use `OBJLoader`
    - `.vtk` → new `parseVTK()` or use `VTKLoader`
  - `src/language-server/caseGeometryScanner.ts` — ensure .obj and .vtk are in the scanned extensions (already listed).
- Update `src/workflow/InspectorPanel.ts` — add `.obj` and `.vtk` to `GEO_RE` regex in the webview.

**Test:** Open `.stl`, `.obj`, and `.vtk` geometry files via Case Explorer → Preview Geometry. Verify all three render correctly in the 3D viewer.

---

### P3.2 Geometry thumbnail caching (Suggestion 2.8)

**Problem:** Thumbnails re-render on every tree rebuild.

**Implementation:**
- `src/workflow/InspectorPanel.ts` — in the extension host side:
  - Maintain a `Map<string, {dataUri: string, mtime: number}>` cache.
  - Before requesting geo data, check cache; if cached and mtime matches, send the data URI directly.
  - Add a `command: 'cachedGeoData'` message to send cached URIs.
- `src/webview/geoViewer.ts`:
  - Handle `cachedGeoData` command — set `img.src` directly without re-rendering.
- Invalidate cache when file mtime changes.

**Test:** Open a dict with geometry references, verify thumbnails appear. Save the STL file externally, re-open inspector, verify thumbnails update.

---

### P3.3 Case Explorer search/filter (Suggestion 3.1)

**Problem:** No search in Case Explorer sidebar for large cases with many time directories.

**Implementation:**
- `src/providers/OpenFOAMCaseTreeProvider.ts`:
  - Add a `_filterQuery: string` property.
  - In `getChildren()`, filter entries by the query (case-insensitive match on filename).
  - Add a `setFilter(query: string)` method that re-fires `_onDidChangeTreeData`.
- `src/extension.ts`:
  - Register a `TreeView` title action with a search icon.
  - Or use `vscode.window.createInputBox()` to prompt for filter text.
- Alternative: Add a quick-pick command `OpenFOAM: Find File in Case` that shows all files in a quick-pick list with `showQuickPick`.

**Test:** Open a case with 10+ time directories, run _"OpenFOAM: Find File in Case"_, type "U", verify only U files appear.

---

### P3.4 Welcome view (Suggestion 4.3)

**Problem:** Case Explorer is empty when no OF case is open.

**Implementation:**
- `OpenFOAMCaseTreeProvider.ts`:
  - Add a `_message: string | undefined` property.
  - When `getChildren()` returns empty and no case root is found, return a single `CaseItem` with `label` set to the message and `collapsibleState: None`. Set `contextValue = 'message'` so it's unclickable.
- The message can include quick actions:
  - _"Open an OpenFOAM case folder"_
  - Use `treeView.message` API instead (VS Code 1.75+ has `TreeView.message`).

**Test:** Open VS Code with no OF folder, verify Case Explorer shows welcome message. Open an OF folder, verify tree appears.

---

### P3.5 Time directory grouping (Suggestion 3.8)

**Problem:** Dozens of time directories clutter the Case Explorer.

**Implementation:**
- `OpenFOAMCaseTreeProvider.ts`:
  - In `getRootChildren()`, after collecting time dirs, group them:
    - Show the first 5 individually.
    - Show remaining as a collapsible _"... and N more"_ group.
    - Or group by ranges: `"1-10 (10 dirs)"`, `"10-100 (90 dirs)"`, etc.
  - Use a special `CaseItem` with a label like `"0.1–1.0 (12 items)"` and collapsible state.

**Test:** Open a case with 50 time directories. Verify the tree shows them grouped, with the ability to expand groups.

---

### P3.6 Inspector responsive layout (Suggestion 5.4)

**Problem:** Fixed card width causes poor readability in narrow panels.

**Implementation:**
- `src/workflow/InspectorPanel.ts` webview JS:
  - Use a `ResizeObserver` on the `#wrap` element.
  - If width < 400px, switch to vertical stack layout:
    - Cards stack vertically (full width).
    - SVG connectors hidden.
    - Params shown as a vertical list below the block name.
  - If width >= 400px, use the current horizontal flow layout.
- Adjust `estimateW()` to return `wrap.clientWidth - 20` in narrow mode.

**Test:** Open inspector in a narrow view (side panel). Verify blocks stack vertically and are readable. Drag to widen, verify it switches to horizontal layout.

---

### P3.7 Multi-root workspace support (Suggestion 5.6)

**Problem:** Case Explorer and Inspector only use the first workspace folder.

**Implementation:**
- `OpenFOAMCaseTreeProvider.ts`:
  - Accept an optional `workspaceRoot` parameter.
  - Add a dropdown/quickpick at the top to switch between workspace folders.
  - `getRootChildren()` walks the selected root instead of always `workspaceFolders[0]`.
- `InspectorPanel.ts`:
  - `_discoverWorkspace()` — let user pick which workspace root to use via a quickpick.
- `extension.ts`:
  - Register command `openfoam.switchCaseRoot` — shows a quickpick of workspace folders.

**Test:** Open a multi-root workspace with two OF cases. Switch between roots in Case Explorer and Inspector. Verify they show the correct case structure.

---

## Testing Strategy

Each phase must pass these checks before moving to the next:

### Build verification
```bash
npm run compile
```
Must complete with zero TypeScript errors.

### Lint verification
```bash
npm run lint
```
Must complete with zero errors (warnings are acceptable).

### esbuild verification
```bash
npx esbuild src/webview/geoViewer.ts --bundle --format=iife --outfile=media/geo-viewer.js
```
Must complete without errors.

### Manual smoke tests (run after each phase)
1. Open VS Code to this project, press F5 (Launch Extension).
2. Open an OpenFOAM dictionary file (e.g. `examples/OpenFOAM/...`).
3. Verify:
   - Syntax highlighting works
   - Hover documentation appears
   - Auto-completions trigger
   - Case Explorer shows case structure
   - Inspector panel opens and renders
   - 3D preview works on STL files
   - Boolean toggle CodeLens appears
   - Status bar shows OpenFOAM
4. Run each feature implemented in that phase and confirm correct behavior.

### Regression checklist before merge
| Check | Command / Action |
|---|---|
| TypeScript compiles | `npm run compile` |
| Linter passes | `npm run lint` |
| esbuild bundles geo viewer | `npx esbuild src/webview/geoViewer.ts --bundle --format=iife --outfile=media/geo-viewer.js` |
| Extension activates | F5 → check output panel for "Activating OpenFOAM Language Support extension..." |
| Syntax highlighting | Open any `.foam` file, verify colored tokens |
| Language server starts | Check `OpenFOAM Language Server` output channel |
| Auto-detection | Open `system/controlDict` from file manager, verify language is set |
| Inspector opens | Click status bar or run command |
| Case Explorer shows tree | Switch to OpenFOAM view in activity bar |
| 3D preview works | Right-click `.stl` in Case Explorer → Preview Geometry |
| Boolean toggle | Click CodeLens hint next to `true`/`false` |
| Format on save | Enable setting, save a file, verify formatting |
