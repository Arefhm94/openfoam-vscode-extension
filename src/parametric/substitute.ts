import type { Tree } from "../treeSitter/parser";
import type { SimpleRange } from "../treeSitter/queries";
import { buildOutline, OutlineNode } from "../treeSitter/queries";

const INDENT = "    ";

/** Walks `blockPath` down the outline and returns the `entry` node named
 *  `key` inside it (or at the top level, for an empty `blockPath`). */
export function findEntry(tree: Tree, blockPath: string[], key: string): OutlineNode | null {
  let nodes = buildOutline(tree);
  for (const name of blockPath) {
    const found = nodes.find(n => n.kind === "block" && n.name === name);
    if (!found) return null;
    nodes = found.children;
  }
  return nodes.find(n => n.kind === "entry" && n.name === key) ?? null;
}

export interface RangeReplacement {
  range: SimpleRange;
  text: string;
}

/**
 * The `{range, text}` edit that rewrites an *existing* entry's value —
 * unlike `scaffold/blockLocator.ts`'s `locateInsertion` (which finds
 * where to *add* new content), this finds and replaces a value already
 * in the file, which is what a parametric sweep needs (`deltaT`,
 * `nCorrectors`, a boundary condition's `value`, …). `entry.range` starts
 * right at the key (tree-sitter node ranges exclude leading whitespace),
 * so the entry's own indentation is preserved automatically — nothing to
 * reconstruct here. Returns `null` if `key` isn't found there.
 */
export function substituteEntryValue(
  tree: Tree,
  blockPath: string[],
  key: string,
  newValue: string,
): RangeReplacement | null {
  const entry = findEntry(tree, blockPath, key);
  if (!entry) return null;
  return { range: entry.range, text: `${key}${INDENT}${newValue};` };
}

/** Replaces a `SimpleRange` span of `text` with `replacement` — pure text
 *  surgery (no open document / WorkspaceEdit involved), for editing a
 *  case-clone's files on disk directly. */
export function replaceRange(text: string, range: SimpleRange, replacement: string): string {
  const lines = text.split("\n");
  const startLine = lines[range.start.line] ?? "";
  const endLine = lines[range.end.line] ?? "";
  const merged = startLine.slice(0, range.start.character) + replacement + endLine.slice(range.end.character);
  return [...lines.slice(0, range.start.line), merged, ...lines.slice(range.end.line + 1)].join("\n");
}
