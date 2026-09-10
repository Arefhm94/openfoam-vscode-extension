import type { Tree } from "../treeSitter/parser";
import { buildOutline, OutlineNode } from "../treeSitter/queries";

const INDENT = "    ";

export interface Insertion {
  /** 0-based line/character to insert at. */
  position: { line: number; character: number };
  /** Wraps the entry body in whatever `blockPath` segments don't exist yet,
   *  indented for its position in the file. */
  render: (body: string) => string;
}

function indentBlock(text: string, spaces: string): string {
  return text
    .split("\n")
    .map(l => (l.length ? spaces + l : l))
    .join("\n");
}

/** Nests `body` inside `names` (outermost first): `a { b { <body> } }`,
 *  with each level indented one step deeper than `startDepth`. */
function wrapInBlocks(body: string, names: string[], startDepth: number): string {
  let inner = indentBlock(body, INDENT.repeat(startDepth + names.length));
  for (let i = names.length - 1; i >= 0; i--) {
    const pad = INDENT.repeat(startDepth + i);
    inner = `${pad}${names[i]}\n${pad}{\n${inner}\n${pad}}`;
  }
  return inner;
}

/** Insert before a trailing `// **** //` footer if present, else at EOF. */
function endOfContent(docText: string): { line: number; character: number } {
  const lines = docText.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (!t) continue;
    if (/^\/\/\s*\*+/.test(t)) return { line: i, character: 0 };
    return { line: i + 1, character: 0 };
  }
  return { line: 0, character: 0 };
}

/**
 * Where to insert a scaffolded entry body for `blockPath` in a parsed
 * document, creating wrapper blocks for any path segment that isn't
 * present yet. `blockPath: []` ⇒ append at the top level.
 */
export function locateInsertion(tree: Tree, docText: string, blockPath: string[]): Insertion {
  let nodes: OutlineNode[] = buildOutline(tree);
  let container: OutlineNode | null = null;
  let matched = 0;
  for (const name of blockPath) {
    const found = nodes.find(n => n.kind === "block" && n.name === name);
    if (!found) break;
    container = found;
    nodes = found.children;
    matched++;
  }
  const missing = blockPath.slice(matched);

  if (!container) {
    // Nothing matched — append at the top level, synthesizing the full path.
    return {
      position: endOfContent(docText),
      render: body => "\n" + wrapInBlocks(body, missing, 0) + "\n",
    };
  }

  // Insert inside `container`, just before its closing brace.
  const oneLiner = container.range.start.line === container.range.end.line;
  const position = oneLiner
    ? { line: container.range.end.line, character: Math.max(0, container.range.end.character - 1) }
    : { line: container.range.end.line, character: 0 };
  const innerDepth = matched; // depth of entries directly inside `container`

  if (missing.length === 0) {
    return {
      position,
      render: body => indentBlock(body, INDENT.repeat(innerDepth)) + "\n",
    };
  }
  return {
    position,
    render: body => wrapInBlocks(body, missing, innerDepth) + "\n",
  };
}
