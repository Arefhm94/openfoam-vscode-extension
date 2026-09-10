// One-off benchmark: incremental (tree.edit() + reparse) vs full reparse
// latency, per Phase 2 of context/openfoam-extension-treesitter-instruction.md.
// Run with: node scripts/benchmark-treesitter.js [path-to-fixture]
const fs = require("fs");
const path = require("path");
const { Parser, Language } = require("web-tree-sitter");

const DEFAULT_FIXTURE = path.join(
  __dirname, "..", "examples", "Helyx", "complex", "system", "helyxHexMeshDict",
);

function computeEdit(oldText, newText) {
  let start = 0;
  while (start < oldText.length && start < newText.length && oldText[start] === newText[start]) start++;
  let oldEnd = oldText.length;
  let newEnd = newText.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    oldText[oldEnd - 1] === newText[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  const posAt = (text, index) => {
    let row = 0, col = 0;
    for (let i = 0; i < index; i++) {
      if (text[i] === "\n") { row++; col = 0; } else { col++; }
    }
    return { row, column: col };
  };
  return {
    startIndex: start,
    oldEndIndex: oldEnd,
    newEndIndex: newEnd,
    startPosition: posAt(oldText, start),
    oldEndPosition: posAt(oldText, oldEnd),
    newEndPosition: posAt(newText, newEnd),
  };
}

async function main() {
  const fixturePath = process.argv[2] || DEFAULT_FIXTURE;
  const original = fs.readFileSync(fixturePath, "utf8");
  console.log(`Fixture: ${fixturePath} (${original.length} bytes, ${original.split("\n").length} lines)`);

  await Parser.init();
  const language = await Language.load(require.resolve("tree-sitter-openfoam/tree-sitter-openfoam.wasm"));
  const parser = new Parser();
  parser.setLanguage(language);

  // A small, realistic single-character edit (as if a user typed one char)
  // roughly in the middle of the file.
  const mid = Math.floor(original.length / 2);
  const insertAt = original.indexOf("\n", mid) + 1;
  const edited = original.slice(0, insertAt) + "x" + original.slice(insertAt);

  const RUNS = 200;

  // Full reparse (no old tree at all) baseline, repeated.
  let fullTotal = 0;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    parser.parse(edited);
    fullTotal += performance.now() - t0;
  }

  // Incremental: parse the original once, apply tree.edit(), reparse with
  // the edited tree passed in, repeated (re-deriving a fresh base tree
  // each iteration so the edit is always applied to an unedited tree).
  let incTotal = 0;
  const edit = computeEdit(original, edited);
  for (let i = 0; i < RUNS; i++) {
    const baseTree = parser.parse(original);
    baseTree.edit(edit);
    const t0 = performance.now();
    parser.parse(edited, baseTree);
    incTotal += performance.now() - t0;
    baseTree.delete();
  }

  const fullAvg = fullTotal / RUNS;
  const incAvg = incTotal / RUNS;
  console.log(`Full reparse:        ${fullAvg.toFixed(4)} ms/parse (avg of ${RUNS})`);
  console.log(`Incremental reparse: ${incAvg.toFixed(4)} ms/parse (avg of ${RUNS})`);
  console.log(`Speedup: ${(fullAvg / incAvg).toFixed(2)}x`);
}

main().catch(err => { console.error(err); process.exit(1); });
