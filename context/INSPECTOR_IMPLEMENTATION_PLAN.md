# Inspector Redesign — Implementation Plan

**File**: `src/workflow/InspectorPanel.ts` (only file to change — no SPA extraction, no new files)

**Strategy**: Replace the horizontal card layout CSS/JS in `_buildHtml()` with a vertical tree + detail split. Host-side code (`_loadFile`, `_handleMessage`, etc.) stays largely unchanged. Changes are scoped to the HTML template, CSS, and inline JS inside `_buildHtml()`.

---

## Phase 1 — Tree Outline (Left Panel)

### Step 1.1 — Add tree HTML container
Replace the current `#canvas` div (inside `#wrap`) with a two-panel split:
```html
<div id="inspector-split">
  <div id="tree-panel">
    <div id="tree"></div>
  </div>
  <div id="split-handle-v"></div>
  <div id="detail-panel">
    <div id="detail"></div>
  </div>
</div>
```
Keep `#wrap` as the scrollable outer container.

### Step 1.2 — Replace CSS (remove card layout, add tree layout)
Remove all card-related CSS classes: `.fcard`, `.fhead`, `.pill`, `.arr`, `.cnt`, `.card`, `.card-grid`, `.ck`, `.cs`, `.cv`, `.vnum`, `.vstr`, `.vref`, `.vvec`, `.tog`, `.tog-t`, `.edge`, `.narrow` rules.

Add:
- `#inspector-split` — flex row, `height:100%`
- `#tree-panel` — `width:200px`, `flex-shrink:0`, overflow-y auto, border-right
- `#split-handle-v` — `width:4px`, cursor `col-resize`, hover highlight
- `#detail-panel` — `flex:1`, overflow-y auto
- `.tree-node` — single-line row: `display:flex`, `align-items:center`, padding, font-size 11px
- `.tree-arrow` — inline toggle arrow, 12px width
- `.tree-name` — block name, flex:1, truncate with ellipsis
- `.tree-badge` — param count pill (small rounded rect)
- `.tree-node.selected` — highlight background
- `.tree-node:hover` — hover background
- `.tree-indent` — 14px per level (adds left padding for nested children)

### Step 1.3 — Write `renderTree()` (tree version)
Replace current `renderTree()` with:

```javascript
function renderTree(){
  const el=document.getElementById('tree');
  el.innerHTML='';
  if(!S.tree||!S.tree.children||!S.tree.children.length){
    el.innerHTML='<div class="tree-empty">no structure found</div>';
    return;
  }
  for(const c of bkids(S.tree)) renderNode(el, c, 0);
}
```

### Step 1.4 — Write `renderNode(parentEl, node, depth)`
Recursively builds a `.tree-node` row for each block:

```javascript
function renderNode(parentEl, node, depth){
  const row = mk('div','tree-node');
  row.style.paddingLeft = (12 + depth*14) + 'px';
  row.dataset.id = node.id;
  
  const arrow = mk('span','tree-arrow');
  const hasChildren = bkids(node).length > 0;
  if(hasChildren){
    arrow.textContent = collapsed.has(node.id) ? '▸' : '▾';
    arrow.onclick = (e) => {
      e.stopPropagation();
      if(collapsed.has(node.id)) collapsed.delete(node.id);
      else collapsed.add(node.id);
      renderTree();
    };
  } else {
    arrow.textContent = ''; 
  }
  row.appendChild(arrow);
  
  const name = mk('span','tree-name');
  name.textContent = node.name;
  row.appendChild(name);
  
  const kids = pkids(node);
  if(kids.length){
    const badge = mk('span','tree-badge');
    badge.textContent = kids.length;
    row.appendChild(badge);
  }
  
  row.onclick = () => selectNode(node.id);
  parentEl.appendChild(row);
  
  if(!collapsed.has(node.id)){
    for(const c of bkids(node)) renderNode(parentEl, c, depth+1);
  }
}
```

### Step 1.5 — Add selection state and `selectNode(id)`
Add to `S`: `selectedNodeId: null`.

```javascript
function selectNode(id){
  S.selectedNodeId = id;
  // Remove old selection highlight
  document.querySelectorAll('.tree-node.selected').forEach(el => el.classList.remove('selected'));
  // Highlight new selection
  const row = document.querySelector(`.tree-node[data-id="${CSS.escape(id)}"]`);
  if(row) row.classList.add('selected');
  // Render detail panel
  renderDetail(id);
}
```

Render detail panel immediately on selection. If a geo thumbnail is visible, lazily request geo data.

### Step 1.6 — Filter the tree
The existing filter input already calls `renderTree()`. Update the tree version so `renderTree()` hides non-matching nodes:

```javascript
function matchesFilter(node){
  if(!filterQuery) return true;
  if(node.name.toLowerCase().includes(filterQuery)) return true;
  for(const p of pkids(node)) if(p.name.toLowerCase().includes(filterQuery)) return true;
  for(const c of bkids(node)) if(matchesFilter(c)) return true; // ancestor of match
  return false;
}
```

Build the tree from filtered blocks. If filter is active but no match, show: `no matches for "..."`.

---

## Phase 2 — Detail Form (Right Panel)

### Step 2.1 — Write `renderDetail(nodeId)`
```javascript
function renderDetail(nodeId){
  const el=document.getElementById('detail');
  el.innerHTML='';
  const node = findNode(nodeId);
  if(!node){
    el.innerHTML='<div class="detail-empty">Select a block to inspect</div>';
    return;
  }
  
  // ── Header ──
  const hdr = mk('div','detail-header');
  hdr.innerHTML = `<span class="detail-name">${hf(node.name)}</span>
    <span class="detail-line" data-line="${node.line}">line ${node.line+1}</span>`;
  hdr.querySelector('.detail-line').onclick = () =>
    vscode.postMessage({command:'jumpToLine',line:node.line});
  el.appendChild(hdr);
  
  // ── Params ──
  const params = pkids(node);
  if(params.length){
    const grid = mk('div','detail-grid');
    for(const p of params) renderParam(grid, p, node.line);
    el.appendChild(grid);
  }
  
  // ── Sub-blocks ──
  const subs = bkids(node);
  if(subs.length){
    const sec = mk('div','detail-subs');
    const stitle = mk('div','detail-subtitle');
    stitle.textContent = 'Sub-blocks';
    sec.appendChild(stitle);
    // Show sub-blocks as a mini tree (depth-1, clickable → select that node)
    for(const c of subs) renderSubBlock(sec, c);
    el.appendChild(sec);
  }
}
```

### Step 2.2 — Write `renderParam(parentEl, param, parentLine)`
Each param is a two-column row: label | input.

```javascript
function renderParam(parentEl, param, parentLine){
  const row = mk('div','param-row');
  
  // Label column
  const label = mk('span','param-label');
  label.textContent = param.name;
  label.dataset.line = param.line;
  label.onclick = () => vscode.postMessage({command:'jumpToLine',line:param.line});
  row.appendChild(label);
  
  // Value column
  const val = mk('div','param-value');
  const raw = (param.rawValue || '').trim();
  
  // Detect type (same heuristics as current code)
  const lo = raw.toLowerCase();
  const isBool = lo === 'yes' || lo === 'no' || lo === 'true' || lo === 'false' || lo === 'on' || lo === 'off';
  const isNum = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(raw);
  const isVec = /^\(.*\)$/.test(raw);
  const isGeo = /\.(stl|obj|vtk)$/i.test(raw);
  
  if(isBool){
    // Toggle switch (same as current .tog)
    val.innerHTML = buildToggle(raw, param.line);
  } else if(isNum){
    const inp = mk('input','param-input-num');
    inp.type = 'text'; inp.value = raw;
    inp.onchange = () => saveParam(param.filePath||S.activeFile, param.line, inp.value);
    val.appendChild(inp);
  } else if(isVec){
    const inp = mk('input','param-input-vec');
    inp.type = 'text'; inp.value = raw;
    inp.onchange = () => saveParam(param.filePath||S.activeFile, param.line, inp.value);
    val.appendChild(inp);
  } else if(isGeo){
    // Geo thumbnail + label (same as current geo-ref pattern)
    val.innerHTML = buildGeoThumb(raw, param.name);
  } else {
    const inp = mk('input','param-input-str');
    inp.type = 'text'; inp.value = raw;
    inp.onchange = () => saveParam(param.filePath||S.activeFile, param.line, inp.value);
    val.appendChild(inp);
  }
  
  row.appendChild(val);
  parentEl.appendChild(row);
}
```

### Step 2.3 — Write `renderSubBlock(parentEl, node)`
A single clickable row with expand arrow, name, badge — but simpler than tree nodes:
```javascript
function renderSubBlock(parentEl, node){
  const row = mk('div','sub-block-row');
  row.textContent = node.name;
  const cnt = pkids(node).length;
  if(cnt) row.innerHTML += ` <span class="tree-badge">${cnt}</span>`;
  row.onclick = () => selectNode(node.id);
  parentEl.appendChild(row);
}
```

---

## Phase 3 — Integration

### Step 3.1 — Adaptive auto-select on tree load
When `treeData` arrives and `S.selectedNodeId` is `null`, auto-select the first block:
```javascript
if(treeData received){
  S.tree = m.tree; ...
  if(!S.selectedNodeId){
    const first = allBlocks(S.tree)[0];
    if(first) selectNode(first.id);
  }
  renderTree();
  // renderDetail is called by selectNode
}
```

### Step 3.2 — Filter + selection interaction
When filter clears (back to empty), re-select previously selected node if it's still visible. Store `lastSelectedNodeId`:

```javascript
if(!filterQuery && lastSelectedNodeId){
  selectNode(lastSelectedNodeId);
} else if(filterQuery){
  lastSelectedNodeId = S.selectedNodeId;
  S.selectedNodeId = null;
  document.getElementById('detail').innerHTML = '<div class="detail-empty">Filter active — select a block</div>';
}
```

### Step 3.3 — Keyboard navigation rework
Replace current keydown handler (ArrowUp/Down on flat list) with tree-aware navigation:

```javascript
document.addEventListener('keydown', e => {
  if(!e.key.startsWith('Arrow') && e.key !== 'Enter') return;
  const tree = document.getElementById('tree');
  if(!tree) return;
  const items = [...tree.querySelectorAll('.tree-node')];
  const idx = items.findIndex(el => el.dataset.id === S.selectedNodeId);
  if(e.key === 'ArrowDown' && idx < items.length-1){
    selectNode(items[idx+1].dataset.id);
    items[idx+1].scrollIntoView({block:'nearest'});
    e.preventDefault();
  } else if(e.key === 'ArrowUp' && idx > 0){
    selectNode(items[idx-1].dataset.id);
    items[idx-1].scrollIntoView({block:'nearest'});
    e.preventDefault();
  } else if(e.key === 'ArrowRight' && idx >= 0){
    const id = items[idx].dataset.id;
    if(collapsed.has(id)){ collapsed.delete(id); renderTree(); }
    e.preventDefault();
  } else if(e.key === 'ArrowLeft' && idx >= 0){
    const id = items[idx].dataset.id;
    if(!collapsed.has(id)){ collapsed.add(id); renderTree(); }
    e.preventDefault();
  } else if(e.key === 'Enter' && idx >= 0){
    vscode.postMessage({command:'jumpToLine',line:+items[idx].dataset.line});
    e.preventDefault();
  }
});
```

Store `node.line` in `dataset.line` on `.tree-node` rows.

### Step 3.4 — Remove old rendering code
Delete from the JS section:
- `collectBlocks()` 
- `estimateW()`
- `cardH()`
- `xpos`, `cw`, `xLeft`, `xMid` variables
- Connection/SVG drawing logic (everything with `conns`, `svg`, `polyline`, `edge`)
- All card positioning code (for loops setting `el.style.left`, `el.style.top`)
- `hl()` function (highlight specific card) — replaced by tree node highlight
- `renderTree` filter mode that shows "no matches for" (now done in tree)

Keep:
- `bkids()`, `pkids()` — still needed
- `GEO_RE`, `isGeoVal()` — still needed for geo thumbnails
- `hf()` — still needed for filter highlight in tree names
- `mk()`, `sid()` — still useful

### Step 3.5 — Update `saveParam` wiring
`saveParam` is called from param input `onchange` events. The current implementation sends `{command:'saveParam', filePath, line, value}`. Keep this identical — the host-side `_handleMessage` doesn't change.

The current `showSaving` / toast is unchanged. Keep `#toast` element and `paramSaved` message handler.

---

## Phase 4 — Polish & Edge Cases

### Step 4.1 — Auto-focus tree on load
After `renderTree()` completes, if a node is selected, scroll it into view:
```javascript
function renderTree(){
  // ... build tree ...
  if(S.selectedNodeId){
    const el = document.querySelector(`.tree-node[data-id="${CSS.escape(S.selectedNodeId)}"]`);
    if(el) el.scrollIntoView({block:'nearest'});
  }
}
```

### Step 4.2 — Responsive: tree collapses on narrow panels
When the inspector panel is very narrow (<350px), hide the tree panel and show a breadcrumb-style selector at the top of the detail panel:

```css
@media (max-width: 350px) {
  #inspector-split { flex-direction: column; }
  #tree-panel { width: 100%; max-height: 150px; border-right: none; border-bottom: 1px solid ...; }
}
```

Or use the existing `ResizeObserver` pattern.

### Step 4.3 — Re-sizable split handle
The vertical split handle (`#split-handle-v`) supports drag to resize:

```javascript
let dragging=false;
splitHandle.addEventListener('mousedown', e => { dragging=true; e.preventDefault(); });
document.addEventListener('mousemove', e => {
  if(!dragging) return;
  const w = Math.max(120, Math.min(400, e.clientX - treePanel.getBoundingClientRect().left));
  treePanel.style.width = w + 'px';
});
document.addEventListener('mouseup', () => { dragging=false; });
```

### Step 4.4 — Highlight active node from editor cursor
The host sends `highlightNode` on cursor change. Update the handler to select the tree node instead of highlighting a card:

```javascript
if(m.command==='highlightNode'){
  selectNode(m.nodeId);
}
```

This keeps the tree and editor cursor in sync automatically.

---

## Summary of Changes

| Area | Lines Affected | Change |
|------|----------------|--------|
| HTML template | ~30 lines | Swap `#canvas` → `#inspector-split` with `#tree-panel` + `#detail-panel` |
| CSS | ~200 lines | Remove all card/edge/pill/narrow CSS. Add tree-node, param-row, detail-header CSS |
| JS: `renderTree()` | rewrite 80→30 lines | Replace card+SVG rendering with tree node recursion |
| JS: new `renderDetail()` | ~80 lines | New function to render parameter form |
| JS: new `renderParam()` | ~50 lines | New function for each parameter row |
| JS: new `selectNode()` | ~15 lines | New selection state management |
| JS: `renderNode()` | ~35 lines | New recursive tree node builder |
| JS: keyboard nav | rewrite 20→40 lines | Replace flat-list nav with tree-aware |
| JS: filter handling | update 10 lines | Filter hides tree nodes instead of cards |
| JS: `hl()` → removed | −15 lines | No card highlighting needed |
| JS: SVG/connector code | −60 lines | Removed entirely |
| JS: card math (estimateW, cardH, etc.) | −40 lines | Removed entirely |
| Host-side (`_loadFile`, `_handleMessage`) | 0 lines | No changes needed |
| Total: ~500 lines changed in one file | | |

---

## Build & Verify

1. `npm run compile` — must produce 0 errors
2. `npm run lint` — must produce 0 new warnings
3. Manual test in F5 debug:
   - Open OF dictionary → tree appears in left panel, first block selected, params shown in right panel
   - Click tree nodes → detail switches
   - Type in filter → tree narrows, "no matches" shown when empty
   - ArrowUp/Down in tree → selection moves
   - ArrowRight/Left → expand/collapse tree nodes
   - Edit param → save + toast works
   - Resize split handle → tree width adjusts
   - Narrow panel → tree collapses or stacks
