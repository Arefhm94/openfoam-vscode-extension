# Geometry-Aware Feature — Improvement Suggestions

This document captures ideas for extending the geometry-aware completions and hover preview
feature beyond what was implemented in v1.

---

## 1. Hover Preview for Geometry Surfaces

### What the user asked about
When hovering over a surface name (e.g. `building.stl`) referenced in `helyxHexMeshDict` or
`snappyHexMeshDict`, show a small visual preview of that geometry in the hover popup.

### Technical options

#### Option A — SVG 2D Projection in Hover Card *(recommended for v2)*

VS Code hover cards render full Markdown, including `![](data:image/svg+xml;base64,...)` image
tags. This means we can embed an SVG thumbnail directly in the hover popup — no external panel
needed.

**How it would work:**
1. `onHover` in `server.ts` detects a surface name (e.g. `building.stl`) in the geometry block.
2. Resolve the full path: `<caseRoot>/constant/triSurface/building.stl`.
3. Parse the ASCII STL on the fly — read triangles (vertex triples).
4. Project all vertices with a simple isometric or front-orthographic projection onto a 200×200
   pixel canvas.
5. Render the projected edges as SVG `<polygon>` or `<line>` elements (outline only — no shading
   needed for a diagnostic thumbnail).
6. Base64-encode the SVG and embed in the hover Markdown:
   ```markdown
   **building.stl** — 4,832 triangles | bbox: 50×30×20 m

   ![](data:image/svg+xml;base64,PHN2ZyB3aWR0...)
   ```

**Limitations:**
- ASCII STL only (binary STLs would need a small binary parser — trivial but needs special-casing).
- No 3D interaction (static image).
- Large meshes (> 100k triangles) need downsampling or only outline rendering to stay fast.
- STL files with no solid regions just show the full mesh cloud.

**Implementation effort:** Medium — ~200 lines in a new `stlPreviewRenderer.ts` module.

#### Option B — Interactive 3D in Inspector Panel *(bigger effort, best UX)*

When the user hovers or Ctrl+clicks a surface name, the Inspector panel opens and renders the
STL in a Three.js / WebGL viewport with orbit controls.

**How it would work:**
1. Language server sends a `previewGeometry` message to the extension host.
2. Extension host forwards it to `InspectorPanel`.
3. Inspector panel loads the STL file using `THREE.STLLoader` and renders it in a side panel.

**Limitations:**
- Requires bundling Three.js (~600 KB) — conflicts with the current no-bundler philosophy.
- Inspector panel would need a "geometry preview" mode separate from the dict graph view.

**Implementation effort:** Large — 2–3 days.

#### Option C — Statistics-only Hover *(easiest, ship now)*

Without any rendering, the hover card can still show useful geometry info:

```
building.stl  (ASCII STL)
  Triangles : 4,832
  Solids    : wall, inlet, outlet
  Bounding box:
    x  -5.2 → 45.8 m  (Δ 51.0)
    y   0.0 → 30.1 m  (Δ 30.1)
    z   0.0 → 22.5 m  (Δ 22.5)
  File size : 834 KB
```

This is cheap to implement (parse only the first ~500 lines for solid names, then `stat` the
file for size; computing bbox requires reading the whole file but can be done lazily).

**Implementation effort:** Small — extend `caseGeometryScanner.ts` with a `getSTLStats()`
function and update the `onHover` handler in `server.ts`.

---

## 2. Completion Enhancements

### 2a. `locationInMesh` Coordinate Suggestion

`castellatedMeshControls.locationInMesh` requires a point guaranteed to be inside the mesh.
When the user is in the value position of this key, compute the centroid of all geometry bounding
boxes and suggest it:

```
locationInMesh  (12.5 15.0 5.2);   // centroid of bounding boxes
```

Requires parsing STL vertex data — same code path as Option C above.

### 2b. Code Action — "Generate geometry block from triSurface files"

A VS Code Code Action (lightbulb) fires when the cursor is inside an empty `geometry {}` block.
Clicking it auto-populates the block with one entry per file in `constant/triSurface/`:

```
geometry
{
    building.stl { type triSurfaceMesh; name building; }
    ground.stl   { type triSurfaceMesh; name ground; }
}
```

### 2c. Code Action — "Generate addLayersControls.layers from boundary"

Similar to 2b — fires when cursor is inside an empty `layers {}` block and offers to populate
it from `constant/polyMesh/boundary` patch names.

### 2d. `surfaceFeatureExtractDict` Completions

The dict that controls feature edge extraction (`constant/triSurface/*.eMesh` generation) also
references surfaces from `constant/triSurface/`. Add it to the file type map and wire geometry
completions into it.

### 2e. `#include` Path Completions

When the user types `#include "` inside any OpenFOAM dict, trigger completions listing files in:
- The same directory
- `<caseRoot>/system/`

This is independent of geometry but highly useful.

### 2f. Hover for Patch Names

When hovering a patch name anywhere (in `boundaryField`, `layers`, etc.), the hover card shows
the patch's type and face count as read from `constant/polyMesh/boundary`:

```
wall_building  (patch)
  Type       : wall
  nFaces     : 1,204
  startFace  : 78,204
```

---

## 3. Diagnostic Enhancements

### 3a. Missing `locationInMesh`

`locationInMesh` is required for `castellatedMeshControls`. If the key is absent, emit an error.

### 3b. Unreferenced Geometry Entries

If a surface is declared in the `geometry` block but never referenced in
`refinementSurfaces`, `refinementRegions`, or `features`, emit a hint suggesting the entry
may be unused.

### 3c. Duplicate Surface Names

Warn if the same name (case-insensitive) appears twice in the `geometry` block.

### 3d. `locationInMesh` Outside Geometry

If we can parse the STL bounding boxes, check that `locationInMesh` falls inside the combined
bounding box of all declared surfaces. If it's clearly outside, emit a warning.

### 3e. Layer Count Sanity Check

In `addLayersControls`, if `nSurfaceLayers` is 0 for all patches but `addLayers true` is set,
emit a warning.

---

## 4. Cross-file Consistency Checks

### 4a. `surfaceFeatureExtractDict` ↔ snappyHexMesh Features

If `surfaceFeatureExtractDict` lists a surface that is NOT referenced in
`snappyHexMeshDict.castellatedMeshControls.features`, emit a hint.

### 4b. Boundary ↔ `0/` consistency

Already partially implemented (boundary patch names vs. boundaryField keys). Make it bi-directional:
also warn if a patch in `polyMesh/boundary` has no corresponding entry in the `0/<field>` file.

---

## 5. Performance

- **Lazy STL parsing:** Parse STL files only on first hover request, cache the result.
  The current `mtime`-based cache in `caseGeometryScanner.ts` already handles invalidation.
- **Async parsing for large files:** For STLs > 50 MB, run the parser in a worker thread or
  skip the bounding-box parse and show only the solid names (from the first 500 lines).
- **File watcher:** Consider using `fs.watch` to invalidate the geometry cache immediately when
  a file in `constant/triSurface/` changes, rather than waiting for the next keystroke.

---

## Priority Order (suggested)

| # | Feature | Effort | Value |
|---|---------|--------|-------|
| 1 | Option C hover (statistics) | Small | High |
| 2 | `#include` path completions | Small | High |
| 3 | Patch hover with type+count | Small | Medium |
| 4 | Missing `locationInMesh` diagnostic | Small | High |
| 5 | Code action: generate geometry block | Medium | High |
| 6 | Option A hover (SVG projection) | Medium | Very High |
| 7 | `locationInMesh` coordinate suggestion | Medium | Medium |
| 8 | Cross-file consistency checks | Medium | Medium |
| 9 | Option B (Three.js interactive viewer) | Large | Very High |
