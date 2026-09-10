import { Parser, Language, Tree } from "web-tree-sitter";

let languagePromise: Promise<Language> | null = null;

/**
 * Loads the tree-sitter-openfoam WASM grammar exactly once per process
 * (the language server and the extension host each load their own copy,
 * since they're separate Node processes).
 */
function loadLanguage(): Promise<Language> {
  if (!languagePromise) {
    languagePromise = (async () => {
      await Parser.init();
      const wasmPath = require.resolve("tree-sitter-openfoam/tree-sitter-openfoam.wasm");
      return Language.load(wasmPath);
    })();
  }
  return languagePromise;
}

/** A ready-to-use parser for the OpenFOAM grammar. Cheap to call repeatedly. */
export async function getParser(): Promise<Parser> {
  const language = await loadLanguage();
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

export function parseText(parser: Parser, text: string, oldTree?: Tree): Tree {
  return parser.parse(text, oldTree) as Tree;
}

export type { Parser, Tree, Node as SyntaxNode } from "web-tree-sitter";
