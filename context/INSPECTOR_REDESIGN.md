# Inspector Panel Redesign

## Core Problem

The current horizontal card layout has three fundamental UX issues:

1. **Wide rows break scanning** — blocks are laid out left-to-right in absolute-positioned cards. With 15+ blocks, the row can exceed 3000px. Users scan top-to-bottom, not left-to-right, so blocks at the far right are effectively hidden.
2. **Editing is cramped** — parameter inputs are tiny inline fields squeezed into cards of 140–280px width. Numeric vectors, file paths, and long values get truncated. No room for validation feedback or description text.
3. **Navigation + editing compete for the same space** — the tree and the form are the same thing. You cannot browse the structure while editing a parameter.

---

## Recommended Approach: Tree + Detail Split (Phase 1)

Replace the single-pane card layout with a two-panel vertical split:

```
┌─────────────────────────────────────┐
│  [Filter input]                      │
├────────────┬────────────────────────┤
│            │  Block: myBlockName     │
│  ▸ topo    │  ───────────────────    │
│  ▸ solvers │  key1     42           │
│    ▸ PISO  │  key2     (0 0 1)      │
│    ▸ SIMPLE│  key3     file.stl  ►  │
│  ▸ schemes │  ───────────────────    │
│  ▸ divSchemes                      │
│            │                        │
│            │                        │
│  [tree]    │  [detail form]         │
│            │                        │
└────────────┴────────────────────────┘
```

### Left panel: Tree Outline
- Compact, single-line-per-block tree with standard expand/collapse arrows
- Each line shows: expand arrow, block name, and param count badge
- Click selects a block → right panel updates
- Filter input filters the tree in real time (match block or param names)
- Keyboard: ArrowUp/Down to navigate, ArrowRight/Left to expand/collapse, Enter to select
- Very similar to VS Code's built-in Outline view

### Right panel: Detail Form
- Shows the selected block's header (name, type) with a clickable link to jump to source line
- Below: a vertical list of parameter rows, each with:
  - **Label** (param name, clickable to jump to line)
  - **Input** (text/number/toggle/vector — same as current but full width)
  - **Context** (description or units if available from comments)
- Below the params: sub-block tabs or a mini-tree for nested blocks
- The form is scrollable independent of the tree

### Benefits
- **Navigation never loses context** — tree stays visible while editing
- **Wider inputs** — no 140px limit, vectors and paths have room
- **Natural vertical scrolling** — matches human reading direction
- **Clear focus** — you always know which block you're editing
- **Familiar pattern** — mimics VS Code settings editor, property inspectors in every IDE

---

## Alternative: Tab-per-Block (Phase 2, optional complement)

For dictionary files with many independent top-level blocks (e.g. `fvSchemes`, `fvSolution`):

```
┌─────────────────────────────────────┐
│  [Filter]                            │
├─────────────────────────────────────┤
│  [ fvSchemes ] [ fvSolution ] [+]   │
├─────────────────────────────────────┤
│                                     │
│  ddtSchemes    Euler                │
│  gradSchemes   Gauss linear         │
│  divSchemes    Gauss upwind         │
│  ...                                │
│                                     │
│  ▸ sub-block 1                     │
│    ─────────────────────            │
│    param1     value                 │
│    param2     value                 │
│                                     │
└─────────────────────────────────────┘
```

- Each top-level block is a tab (horizontal tab bar)
- Content area shows the selected block's params and sub-blocks
- Sub-blocks can be shown as collapsible sections within the tab content
- Nested blocks beyond depth 2 switch to the Tree + Detail split inside the content area

### When it works best
- Files like `fvSchemes` with ~5 major sections + many nested entries
- Users who frequently switch between block groups
- Combined with the tree outline as a sidebar toggle

### When it falls short
- Files with deeply nested block hierarchies
- Dynamic blocks where the tab list changes frequently

---

## Alternative: Property Grid (VS Code Settings style)

A single unified, searchable list of ALL parameters across ALL blocks:

```
┌─────────────────────────────────────┐
│  [Search parameters...]             │
├─────────────────────────────────────┤
│                                     │
│  ── fvSchemes ──                    │
│                                     │
│  ddtSchemes        Euler       [✎]  │
│  gradSchemes       Gauss linear [✎] │
│                                     │
│  ── fvSolution ──                   │
│                                     │
│  ──── PISO ────                     │
│  nCorrectors      3            [✎]  │
│  nNonOrthogonalCorrectors  0   [✎]  │
│                                     │
│  ──── SIMPLE ────                   │
│  nNonOrthogonalCorrectors  2   [✎]  │
│                                     │
└─────────────────────────────────────┘
```

### Strengths
- **Best for finding** — one search box finds any param anywhere
- **Most compact** — no card borders, no whitespace waste
- **Batch editing** — change multiple params without switching context

### Weaknesses
- Loses the block hierarchy visualization
- Cannot show sub-block nesting naturally
- Feels generic, loses the "OpenFOAM case structure" character

---

## Recommendation Priority

1. **Tree + Detail Split** — Replace the card layout. Biggest UX improvement for daily use.
2. **Property Grid as filter mode** — When user types in the filter, switch to a flat property grid view showing matching params across all blocks (best of both worlds).
3. **Tab-per-Block** — Optional enhancement for files with many top-level blocks. Could be an alternative layout toggle.

---

## Key Constraints (not-to-do)

- **Keep inline edit round-trip** (edit → postMessage → save → toast feedback) — works well
- **Keep filter with highlight** — essential, just move it to the tree
- **Keep the 3D viewer** — bottom split is fine, no change needed
- **Keep file nav tabs and chips** — they solve a different problem and work well
- **Do NOT extract to SPA/framework** — the current inline template approach, while ugly, works reliably. Extracting to a separate framework adds build complexity without solving the layout problem. The layout change can be done entirely within the existing `_buildHtml()` template.

---

## Open Questions

- Should the tree+detail split be resizable by the user? (Pro: customization. Con: complexity.)
- Should selecting a block in the tree also jump the cursor in the text editor? (Current behavior: yes. Pro: keeps them in sync. Con: user may not want cursor jumping.)
- For nested blocks, should the detail form inline-render sub-blocks or offer a breadcrumb to navigate down? (Breadcrumb keeps the form clean.)
