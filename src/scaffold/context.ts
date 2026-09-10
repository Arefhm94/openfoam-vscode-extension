import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { collectFeatures, CollectOptions } from "./providers";
import { InsertableFeature } from "./features";

/** Cached parse of `data/keyword-db.json`. */
let cachedDb: unknown;
export function loadKeywordDb(context: vscode.ExtensionContext): unknown {
  if (cachedDb) return cachedDb;
  const p = path.join(context.extensionPath, "data", "keyword-db.json");
  cachedDb = JSON.parse(fs.readFileSync(p, "utf8"));
  return cachedDb;
}

// (There are already two copies of this walk — extension.ts and
// language-server/caseContext.ts — consolidating them all is out of scope.)
export function findCaseRoot(filePath: string): string | null {
  let dir = path.dirname(filePath);
  for (let i = 0; i < 12; i++) {
    if (
      fs.existsSync(path.join(dir, "system", "controlDict")) ||
      fs.existsSync(path.join(dir, "system", "fvSchemes"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function detectFieldValueType(doc: vscode.TextDocument): string | undefined {
  const clsM = doc.getText().match(/\bclass\s+(\w+)\s*;/);
  if (clsM) {
    const c = clsM[1];
    if (/SymmTensor/.test(c)) return "symmTensor";
    if (/Tensor/.test(c)) return "tensor";
    if (/Vector/.test(c)) return "vector";
    if (/Scalar/.test(c)) return "scalar";
  }
  const fname = path.basename(doc.uri.fsPath);
  if (fname === "U") return "vector";
  if (
    ["p", "p_rgh", "k", "epsilon", "omega", "nut", "nuTilda", "T", "rho", "mu", "nu"].includes(fname) ||
    fname.startsWith("alpha")
  ) {
    return "scalar";
  }
  return undefined;
}

export function isBoundaryFieldDoc(doc: vscode.TextDocument | undefined): boolean {
  if (!doc) return false;
  if (/\bclass\s+\w*(Scalar|Vector|Tensor)Field\s*;/.test(doc.getText())) return true;
  return /\/0(\.\d+)?\//.test(doc.uri.path);
}

type Db = Parameters<typeof collectFeatures>[0];

/**
 * The features to offer for `doc`, ranked so the context-appropriate
 * category leads (nothing hidden). Shared by the QuickPick engine and the
 * `??` inline completion so both stay in sync.
 */
export function collectRankedForDoc(
  db: unknown,
  doc: vscode.TextDocument | undefined,
  category?: string,
): InsertableFeature[] {
  const opts: CollectOptions = {};
  if (category) opts.category = category;
  if (isBoundaryFieldDoc(doc)) opts.fieldValueType = detectFieldValueType(doc!);

  let features = collectFeatures(db as Db, opts);
  if (!category) {
    const firstKey = isBoundaryFieldDoc(doc)
      ? "boundaryConditions"
      : /fvSolution/.test(doc?.uri.path ?? "")
        ? "algorithms"
        : /momentumTransport|turbulenceProperties/.test(doc?.uri.path ?? "")
          ? "turbulenceModels"
          : undefined;
    if (firstKey) {
      features = [
        ...features.filter(f => f.categoryKey === firstKey),
        ...features.filter(f => f.categoryKey !== firstKey),
      ];
    }
  }
  return features;
}
