# Geometry-Aware Case Completions — Feature Plan

## What This Feature Is Called

In VS Code / LSP terminology this is called **"dynamic file-system-backed completions"** or
**"workspace-aware context completions"**. The core idea: instead of returning only a static
keyword database, the server also scans the live case directory and injects **geometry entities
discovered from the filesystem** into the completion list.

In the OpenFOAM-specific context we call it **"Geometry-Aware Case Completions"**.

---

## Problem Statement

When a user fills in `snappyHexMeshDict`, `helyxHexMeshDict`, `caseSetupDict`, or boundary
condition files, they must manually look up:

- Which surface files exist in `constant/triSurface/` (e.g. `building.stl`, `road.obj`)
- Which feature-edge mesh files exist (e.g. `building.eMesh`)
- Which named regions exist inside multi-solid STL files (e.g. `solid inlet`, `solid wall`)
- Which patch names are defined in `constant/polyMesh/boundary`

Mistyping any of these causes silent mesh failures or incorrect boundary conditions. There is no
feedback until the user runs `snappyHexMesh` and reads the log.

---

## What the Extension Will Do

Read the case's `constant/` folder at completion time and surface those names as IntelliSense
suggestions — with warnings if a referenced entity does not exist.

### Sources to Scan

| Folder / File | What is extracted | Used in |
|---|---|---|
| `constant/triSurface/*.{stl,obj,vtk,nas}` | Surface file names (without extension AND with extension) | snappyHexMesh `geometry` block, `refinementSurfaces`, `refinementRegions` |
| `constant/triSurface/*.eMesh` or `constant/extendedFeatureEdgeMesh/*.eMesh` | Feature edge mesh file names | snappyHexMesh `castellatedMeshControls.features[].file` |
| `constant/polyMesh/boundary` | Patch names (the keys in that file) | Boundary conditions (`0/` files), snappyHexMesh `addLayersControls.layers`, function objects `patches` |
| Multi-solid STL header (`solid <name>`) | Named solid regions inside a surface | snappyHexMesh `geometry.<surface>.regions` |

### Where Completions Fire

#### `snappyHexMeshDict` / `helyxHexMeshDict`

| Block path | Trigger | Suggestions |
|---|---|---|
| `geometry` (block key) | user types a new key | tri-surface file names |
| `geometry.<name>.regions` (block key) | user types a new key | solid names from that STL |
| `castellatedMeshControls.features[].file` | value position | `.eMesh` file names (quoted) |
| `castellatedMeshControls.refinementSurfaces` (block key) | new key | surface names defined in `geometry` block |
| `castellatedMeshControls.refinementRegions` (block key) | new key | surface names defined in `geometry` block |
| `addLayersControls.layers` (block key) | new key | patch names from `polyMesh/boundary` |

#### Boundary Condition Files (`0/<field>`)

| Block path | Suggestions |
|---|---|
| `boundaryField` (block key) | patch names from `polyMesh/boundary` |

(Diagnostics for this already partially exist — completions fill the gap.)

#### `controlDict` / `caseSetupDict`

| Key | Suggestions |
|---|---|
| `functions.*.patches` (list value) | patch names |

---

## New Diagnostics (Mismatch Warnings)

| File | Issue | Severity |
|---|---|---|
| snappyHexMeshDict | A name in `refinementSurfaces` or `refinementRegions` is not defined in the `geometry` block | Warning |
| snappyHexMeshDict | `features[].file` does not exist in `constant/triSurface/` or `constant/extendedFeatureEdgeMesh/` | Error |
| snappyHexMeshDict | A name in `geometry` block does not have a matching file in `constant/triSurface/` | Warning |
| snappyHexMeshDict | `addLayersControls.layers` key is not a known patch in `polyMesh/boundary` | Warning |
| `0/<field>` | A key in `boundaryField` is not a known patch in `polyMesh/boundary` | Warning (already exists as a stub — make it reliable) |

---

## Implementation Plan

### Phase 1 — Scanner Module

**New file:** `src/language-server/caseGeometryScanner.ts`

```
CaseGeometryScanner
  scanTriSurfaces(caseRoot)     → string[]   // surface names (no ext) + full filenames
  scanFeatureEdgeMeshes(caseRoot) → string[] // .eMesh filenames
  scanBoundaryPatches(caseRoot)   → string[] // patch names from polyMesh/boundary
  extractSTLRegions(filePath)     → string[] // "solid <name>" lines (sync, first 500 lines only)
```

- Results are cached per `caseRoot` with an `mtime` check so repeated keystrokes don't hit disk.
- All methods are synchronous (`fs.readdirSync` / `fs.readFileSync`) — the language server is
  already synchronous in its handlers.
- If any directory does not exist, return `[]` gracefully.

### Phase 2 — Wire Into Completions (`server.ts`)

1. After `detectFileType` + `getBlockPath`, resolve `caseRoot` via `findCaseRoot(doc.uri)`.
2. For the relevant block paths described in the table above, call the scanner and prepend the
   filesystem-sourced items to the completion list with `sortText = "!!"` (sorts before keywords).
3. Filesystem items get `kind = CompletionItemKind.File` (surfaces/eMesh) or
   `CompletionItemKind.Variable` (patch names).
4. Add detail text: `"from constant/triSurface"` or `"from polyMesh/boundary"`.

### Phase 3 — Wire Into Diagnostics (`server.ts`)

Extend the `diagnose()` method's snappyHexMesh branch:
1. Parse the `geometry` block to collect declared surface names.
2. Compare against `scanTriSurfaces(caseRoot)` — warn on missing files.
3. Parse `refinementSurfaces` / `refinementRegions` keys — warn if not in declared geometry.
4. Parse `features[].file` values — warn if not in `scanFeatureEdgeMeshes(caseRoot)`.
5. Parse `addLayersControls.layers` keys — warn if not in `scanBoundaryPatches(caseRoot)`.

Improve the existing `boundaryField` diagnostic (currently fragile — it stops on parse errors)
to use the scanner instead of an ad-hoc regex.

### Phase 4 — STL Region Completions (stretch goal)

For the `geometry.<name>.regions` block, when the user just typed a key:
1. Look up the parent surface name (one level up in block path).
2. Resolve its full path in `constant/triSurface/<name>.stl`.
3. Call `extractSTLRegions()` — read the first 500 lines, collect `solid <name>` entries.
4. Return those names as completions.

This is a stretch goal because it requires one extra level of block-path resolution and STL
parsing.

---

## Files Changed / Created

| File | Change |
|---|---|
| `src/language-server/caseGeometryScanner.ts` | **New** — filesystem scanner with cache |
| `src/language-server/server.ts` | Add scanner calls in `onCompletion()` and `diagnose()` |
| `src/language-server/caseContext.ts` | Expose `findCaseRoot` reliably (it already exists — confirm it is imported in server) |
| `context/geometry-aware-completions-plan.md` | This file |

No new JSON data files. No changes to `package.json` or `extension.ts`.

---

## Non-Goals

- Parsing the full STL binary format (only ASCII STL region names are extracted).
- Watching for file-system changes in real time (cache invalidation on next keystroke is enough).
- Supporting remote (SSH/Docker) cases where `fs` calls would fail — fail silently and return `[]`.
- Auto-creating missing surface files or patches.

---

## Testing Approach (manual, since there are no unit tests)

Use the Helyx urban case in `examples/Helyx/` which already has:
- `constant/triSurface/` with real STL files
- `constant/polyMesh/boundary` (if present, else create a stub)
- A real `helyxHexMeshDict`

Steps:
1. Open `helyxHexMeshDict` in the examples case.
2. Inside the `geometry` block, trigger completions — expect STL file names.
3. Inside `addLayersControls.layers`, trigger completions — expect patch names.
4. Inside `features[].file`, trigger completions — expect `.eMesh` names.
5. Type a surface name that has no matching STL — expect a warning squiggle.

---

## Open Questions

1. **Helyx `caseSetupDict` geometry block structure** — need to check if it uses the same
   `geometry { <name>.stl { type triSurfaceMesh; } }` pattern as snappyHexMesh, or a different
   schema.
2. **`refinementSurfaces` keys** — in snappyHexMesh the key is the surface *name* (as declared
   in the `geometry` block), not the filename. We should complete from the geometry block first,
   falling back to triSurface filenames if the geometry block is empty.
3. **Binary STL files** — `solid <name>` does not appear in binary STLs. We should detect
   binary format (first 5 bytes are not `solid`) and skip region extraction gracefully.
