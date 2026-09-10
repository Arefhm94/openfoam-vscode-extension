import type { Tree } from "./parser";
import { forEachToken } from "./queries";

/**
 * Custom semantic-token types. Order defines the numeric index used in the
 * LSP legend — keep in sync with `package.json`'s `contributes.semanticTokenTypes`.
 */
export const SEMANTIC_TOKEN_TYPES = [
  "geometryFile",
  "featureEdge",
  "caseVariable",
  "boundaryPatch",
  "includePath",
] as const;

export type SemanticTokenTypeName = (typeof SEMANTIC_TOKEN_TYPES)[number];

export const TOK: Record<SemanticTokenTypeName, number> = Object.fromEntries(
  SEMANTIC_TOKEN_TYPES.map((t, i) => [t, i]),
) as Record<SemanticTokenTypeName, number>;

const GEOMETRY_EXT_RE = /\.(stl|obj|vtk|nas|brep|igs|step|eMesh)$/i;

export interface RawToken {
  line: number;
  char: number;
  length: number;
  tokenType: number;
}

/**
 * What the caller has already resolved for the whole document, once —
 * name sets from the case scan plus an include-path resolver. Anything not
 * matched here produces no token (and so keeps its default/TextMate colour).
 */
export interface SemanticResolverContext {
  surfaceNames: ReadonlySet<string>;
  surfaceFilenames: ReadonlySet<string>;
  eMeshNames: ReadonlySet<string>;
  patchNames: ReadonlySet<string>;
  varNames: ReadonlySet<string>;
  /** true iff the raw (still-quoted) `#include` operand resolves to a file. */
  includeResolves: (rawQuotedPath: string) => boolean;
}

/**
 * Classifies every token-shaped node in `tree` against `ctx`, returning the
 * tokens that resolve to something real, sorted by (line, char) as the LSP
 * `SemanticTokensBuilder` requires. Multi-line nodes are skipped (semantic
 * tokens are single-line).
 */
export function computeSemanticTokens(tree: Tree, ctx: SemanticResolverContext): RawToken[] {
  const out: RawToken[] = [];

  forEachToken(tree, node => {
    if (node.type === "include_directive") {
      const pathNode = node.childForFieldName("path");
      if (pathNode && ctx.includeResolves(pathNode.text)) emit(pathNode, TOK.includePath);
      return;
    }
    if (node.type === "dollar_reference") {
      const name = node.text.replace(/^\$\{?/, "").replace(/\}$/, "");
      if (ctx.varNames.has(name)) emit(node, TOK.caseVariable);
      return;
    }
    // identifier or string
    const raw = node.text.replace(/^"(.*)"$/, "$1");
    const noExt = raw.replace(GEOMETRY_EXT_RE, "");
    if (ctx.surfaceFilenames.has(raw) || ctx.surfaceNames.has(raw) || ctx.surfaceNames.has(noExt)) {
      emit(node, TOK.geometryFile);
    } else if (ctx.eMeshNames.has(raw)) {
      emit(node, TOK.featureEdge);
    } else if (ctx.patchNames.has(raw)) {
      emit(node, TOK.boundaryPatch);
    }
  });

  out.sort((a, b) => a.line - b.line || a.char - b.char);
  return out;

  function emit(node: import("./parser").SyntaxNode, tokenType: number) {
    if (node.startPosition.row !== node.endPosition.row) return;
    out.push({
      line: node.startPosition.row,
      char: node.startPosition.column,
      length: node.endPosition.column - node.startPosition.column,
      tokenType,
    });
  }
}
