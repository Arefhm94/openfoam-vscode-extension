import type { Tree, SyntaxNode } from "./parser";

export interface Point {
  line: number;
  character: number;
}

export interface SimpleRange {
  start: Point;
  end: Point;
}

function toTSPoint(pos: Point) {
  return { row: pos.line, column: pos.character };
}

function nodeRange(node: SyntaxNode): SimpleRange {
  return {
    start: { line: node.startPosition.row, character: node.startPosition.column },
    end: { line: node.endPosition.row, character: node.endPosition.column },
  };
}

/** -1 if a is before b, 0 if equal, 1 if a is after b (row-major). */
function comparePoints(a: Point, b: Point): number {
  if (a.line !== b.line) return a.line < b.line ? -1 : 1;
  if (a.character !== b.character) return a.character < b.character ? -1 : 1;
  return 0;
}

function unwrapValue(node: SyntaxNode): SyntaxNode {
  return node.type === "value" ? node.namedChild(0) ?? node : node;
}

function pointWithinNode(pos: Point, node: SyntaxNode): boolean {
  const p = toTSPoint(pos);
  const s = node.startPosition;
  const e = node.endPosition;
  if (p.row < s.row || (p.row === s.row && p.column < s.column)) return false;
  if (p.row > e.row || (p.row === e.row && p.column > e.column)) return false;
  return true;
}

/** The smallest tree node whose range contains `pos`. Internal — every
 * other function in this module is built on it, but nothing outside
 * needs the raw node directly. */
function nodeAtPosition(tree: Tree, pos: Point): SyntaxNode | null {
  return tree.rootNode.descendantForPosition(toTSPoint(pos)) ?? null;
}

/**
 * The chain of enclosing `block` names, innermost last (e.g.
 * `["gradSchemes", "default"]`), replacing the old character-scanning
 * `getBlockPath()`.
 */
export function getBlockPath(tree: Tree, pos: Point): string[] {
  const path: string[] = [];
  let n: SyntaxNode | null = nodeAtPosition(tree, pos);
  while (n) {
    if (n.type === "block") {
      const name = n.childForFieldName("name");
      if (name) path.unshift(name.text);
    }
    n = n.parent;
  }
  return path;
}

export interface CursorContext {
  blockPath: string[];
  cursorIn: "key" | "value";
  currentKey: string;
}

/**
 * Determines the enclosing block path and whether the cursor sits in an
 * entry's key or value position, from the parse tree's actual structure
 * rather than a backward character scan. Replaces the old
 * `getCursorContext()`'s key/value heuristic.
 */
export function getCursorContext(tree: Tree, pos: Point): CursorContext {
  let n: SyntaxNode | null = nodeAtPosition(tree, pos);
  let entryNode: SyntaxNode | null = null;
  while (n) {
    if (n.type === "entry") {
      entryNode = n;
      break;
    }
    if (n.type === "block" || n.type === "source_file") break;
    n = n.parent;
  }

  let cursorIn: "key" | "value" = "key";
  let currentKey = "";

  if (entryNode) {
    const keyNode = entryNode.childForFieldName("key");
    if (keyNode && pointWithinNode(pos, keyNode)) {
      cursorIn = "key";
    } else {
      cursorIn = "value";
      currentKey = keyNode ? keyNode.text : "";
    }
  }

  return { blockPath: getBlockPath(tree, pos), cursorIn, currentKey };
}

const WORD_NODE_TYPES = new Set(["identifier", "string", "number", "dollar_reference"]);

export interface WordInfo {
  text: string;
  range: SimpleRange;
  node: SyntaxNode;
}

/**
 * The smallest "word-shaped" node at `pos` — an identifier (including
 * dotted words like `alpha.water` and call-style keys like `div(phi,U)`,
 * which are single tokens in the grammar), string, number, or
 * `$reference`. Replaces `wordAt()`'s old `\w`-only regex, which split
 * dotted identifiers apart.
 */
export function wordAt(tree: Tree, pos: Point): WordInfo | null {
  const leaf = nodeAtPosition(tree, pos);
  if (!leaf) return null;
  let n: SyntaxNode | null = leaf;
  while (n && !WORD_NODE_TYPES.has(n.type)) n = n.parent;
  const target = n ?? leaf;
  if (!target.text) return null;
  return { text: target.text, range: nodeRange(target), node: target };
}

/**
 * If `pos` is on a `$reference` value, returns the variable name
 * (without the leading `$` / surrounding `${}`). Replaces the
 * duplicated "rescan backwards for a `$`" logic in hover/definition.
 */
export function dollarReferenceAt(tree: Tree, pos: Point): string | null {
  const w = wordAt(tree, pos);
  if (!w || w.node.type !== "dollar_reference") return null;
  return w.text.replace(/^\$\{?/, "").replace(/\}$/, "");
}

/** Whether `pos` falls inside a line or block comment node. */
export function isInsideComment(tree: Tree, pos: Point): boolean {
  let n: SyntaxNode | null = nodeAtPosition(tree, pos);
  while (n) {
    if (n.type === "line_comment" || n.type === "block_comment") return true;
    n = n.parent;
  }
  return false;
}

export interface OutlineNode {
  name: string;
  kind: "block" | "entry";
  /** For entries: the value text (e.g. `"true"`, `"uniform (0 0 0)"`). Empty for blocks. */
  detail: string;
  range: SimpleRange;
  selectionRange: SimpleRange;
  children: OutlineNode[];
}

/**
 * Builds a symbol outline directly from the parse tree — replacing the
 * document symbol provider's independent line-by-line regex parser.
 * `list`/`sized_list` wrapper nodes (as in `constant/polyMesh/boundary`,
 * or `features (...)`) are transparently flattened so blocks nested
 * inside a list still show up in the outline.
 */
export function buildOutline(tree: Tree): OutlineNode[] {
  function visitChildren(node: SyntaxNode): OutlineNode[] {
    const result: OutlineNode[] = [];
    for (const child of node.namedChildren) {
      if (!child) continue;
      switch (child.type) {
        case "block": {
          const nameNode = child.childForFieldName("name");
          result.push({
            name: nameNode ? nameNode.text : "(anonymous)",
            kind: "block",
            detail: "",
            range: nodeRange(child),
            selectionRange: nameNode ? nodeRange(nameNode) : nodeRange(child),
            children: visitChildren(child),
          });
          break;
        }
        case "entry": {
          const keyNode = child.childForFieldName("key");
          const keyText = keyNode ? keyNode.text : "";
          const detail = child.text.slice(keyText.length).replace(/;\s*$/, "").trim();
          result.push({
            name: keyNode ? keyNode.text : "(entry)",
            kind: "entry",
            detail,
            range: nodeRange(child),
            selectionRange: keyNode ? nodeRange(keyNode) : nodeRange(child),
            children: [],
          });
          break;
        }
        case "list":
        case "sized_list":
          result.push(...visitChildren(child));
          break;
        default:
          break;
      }
    }
    return result;
  }
  return visitChildren(tree.rootNode);
}

export interface SignatureHelpContext {
  /** The entry's first value token — the scheme/solver name itself, e.g.
   * "Gauss" in `div(phi,U) Gauss linearUpwind grad(U);`. */
  schemeName: string;
  /** Index into that scheme's `arguments` array the cursor is currently
   * in (0-based, clamped to >= 0). */
  activeParameter: number;
}

/**
 * Resolves signature-help context from the entry's actual value nodes
 * rather than naively splitting the current line on whitespace — the old
 * approach took the line's first whitespace-separated token as the
 * "scheme name", which is actually the entry's *key* on a normal
 * single-line entry like `div(phi,U) Gauss linearUpwind grad(U);`
 * (tokens[0] = "div(phi,U)"), so it could never resolve a real composite
 * scheme signature for that common case.
 */
export function signatureHelpContext(tree: Tree, pos: Point): SignatureHelpContext | null {
  let n: SyntaxNode | null = nodeAtPosition(tree, pos);
  let entryNode: SyntaxNode | null = null;
  while (n) {
    if (n.type === "entry") {
      entryNode = n;
      break;
    }
    if (n.type === "block" || n.type === "source_file") break;
    n = n.parent;
  }
  if (!entryNode) return null;

  const values = entryNode
    .childrenForFieldName("value")
    .filter((v): v is SyntaxNode => v != null)
    .map(unwrapValue);
  if (!values.length) return null;

  const schemeName = values[0].text;

  // The index of the last value token that has started at or before the
  // cursor — i.e. how many tokens (including the scheme name) are "in
  // play" by the time the cursor got here.
  let lastStarted = 0;
  for (let i = 0; i < values.length; i++) {
    const start = { line: values[i].startPosition.row, character: values[i].startPosition.column };
    if (comparePoints(start, pos) <= 0) lastStarted = i;
    else break;
  }

  return { schemeName, activeParameter: Math.max(0, lastStarted - 1) };
}

/**
 * Visits every "token-shaped" node in the tree — `identifier` (whole span,
 * including a `call_key` like `div(phi,U)`), `string`, `dollar_reference`,
 * plus `include_directive` (so the caller can classify the include path via
 * its `path` field). Does not descend into a visited node. Used by the
 * semantic-tokens provider. Visit order is not guaranteed to be document
 * order — callers that need ordering (the LSP `SemanticTokensBuilder`
 * does) must sort.
 */
export function forEachToken(tree: Tree, visit: (node: SyntaxNode) => void): void {
  const stack: SyntaxNode[] = [tree.rootNode];
  while (stack.length) {
    const node = stack.pop()!;
    if (
      node.type === "identifier" ||
      node.type === "string" ||
      node.type === "dollar_reference" ||
      node.type === "include_directive"
    ) {
      visit(node);
      continue;
    }
    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      const c = node.namedChild(i);
      if (c) stack.push(c);
    }
  }
}
