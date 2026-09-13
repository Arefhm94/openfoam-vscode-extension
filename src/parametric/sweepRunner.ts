import * as fs from "fs";
import * as path from "path";
import { getParser, parseText } from "../treeSitter/parser";
import { substituteEntryValue, replaceRange } from "./substitute";
import { Variant } from "./paramSet";

const SKIP_DIRS = new Set(["postProcessing", "dynamicCode", ".git", "node_modules"]);
function isProcessorDir(name: string): boolean {
  return /^processor\d+$/.test(name);
}

/** Recursively copies a case directory, skipping run artifacts that a
 *  fresh variant shouldn't inherit (`postProcessing/`, `processorN/`,
 *  `dynamicCode/`, VCS/package dirs). */
export function copyCaseDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || isProcessorDir(entry.name)) continue;
      copyCaseDir(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

export interface VariantResult {
  variant: Variant;
  caseDir: string;
  /** Edits whose `key` wasn't found in the target file — the file is
   *  otherwise untouched, so the case is still valid, just missing that
   *  one substitution. */
  missedEdits: { file: string; key: string }[];
}

/**
 * Materializes one cloned, edited case directory per variant, sibling to
 * `caseRoot` (`<caseRoot>_<variant.name>`). Mirrors Dakota's own
 * "black-box" pattern — write the parameters into a fresh case copy,
 * then hand off to whatever runs the solver — just done directly in
 * TypeScript via the existing tree-sitter infrastructure instead of an
 * external analysis-driver script.
 */
export async function runSweep(caseRoot: string, variants: Variant[]): Promise<VariantResult[]> {
  const parser = await getParser();
  const results: VariantResult[] = [];

  for (const variant of variants) {
    const caseDir = `${caseRoot}_${variant.name}`;
    copyCaseDir(caseRoot, caseDir);
    const missedEdits: VariantResult["missedEdits"] = [];

    // Group edits by file so a file with multiple substitutions is only
    // parsed/rewritten once.
    const byFile = new Map<string, typeof variant.edits>();
    for (const edit of variant.edits) {
      const list = byFile.get(edit.file) ?? [];
      list.push(edit);
      byFile.set(edit.file, list);
    }

    for (const [file, edits] of byFile) {
      const filePath = path.join(caseDir, file);
      let text: string;
      try {
        text = fs.readFileSync(filePath, "utf8");
      } catch {
        for (const e of edits) missedEdits.push({ file, key: e.key });
        continue;
      }
      for (const edit of edits) {
        const tree = parseText(parser, text);
        const sub = substituteEntryValue(tree, edit.blockPath, edit.key, edit.value);
        if (!sub) {
          missedEdits.push({ file, key: edit.key });
          continue;
        }
        text = replaceRange(text, sub.range, sub.text);
      }
      fs.writeFileSync(filePath, text, "utf8");
    }

    results.push({ variant, caseDir, missedEdits });
  }

  return results;
}
