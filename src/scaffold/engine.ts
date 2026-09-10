import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { InsertableFeature, renderTemplate } from "./features";
import { openStagingTab } from "./stagingTab";
import { collectRankedForDoc, findCaseRoot, loadKeywordDb } from "./context";

// ── quick-pick helpers (promisified) ───────────────────────────────────────

interface FeatureItem extends vscode.QuickPickItem {
  feature: InsertableFeature;
}

function pickFeature(features: InsertableFeature[], filtered: boolean): Promise<InsertableFeature | undefined> {
  const qp = vscode.window.createQuickPick<FeatureItem>();
  qp.placeholder = filtered ? "Search…" : "Search boundary conditions, algorithms, turbulence models, schemes…";
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;
  qp.items = features.map(f => ({
    label: f.label,
    description: f.categoryLabel,
    detail: f.brief || undefined,
    feature: f,
  }));
  return new Promise(resolve => {
    qp.onDidAccept(() => { resolve(qp.selectedItems[0]?.feature); qp.hide(); });
    qp.onDidHide(() => { resolve(undefined); qp.dispose(); });
    qp.show();
  });
}

/** Pick an existing name or type a new one (patch, instance name, ...). */
function pickOrType(label: string, suggestions: string[]): Promise<string | undefined> {
  const qp = vscode.window.createQuickPick();
  qp.title = label;
  qp.placeholder = `${label} — pick an existing one or type a new name`;
  qp.items = suggestions.map(s => ({ label: s }));
  return new Promise(resolve => {
    qp.onDidAccept(() => { resolve(qp.selectedItems[0]?.label ?? (qp.value.trim() || undefined)); qp.hide(); });
    qp.onDidHide(() => { resolve(undefined); qp.dispose(); });
    qp.show();
  });
}

// ── main flow ──────────────────────────────────────────────────────────────

export async function runSearchInsert(
  context: vscode.ExtensionContext,
  arg?: { category?: string; featureId?: string },
): Promise<void> {
  let db: unknown;
  try {
    db = loadKeywordDb(context);
  } catch {
    vscode.window.showErrorMessage("OpenFOAM: keyword-db.json not found or unreadable.");
    return;
  }

  const editor = vscode.window.activeTextEditor;
  const doc = editor?.document;
  const caseRoot = doc ? findCaseRoot(doc.uri.fsPath) : null;

  const features = collectRankedForDoc(db, doc, arg?.category);
  if (!features.length) {
    vscode.window.showInformationMessage("OpenFOAM: nothing to insert for this context.");
    return;
  }

  const feature = arg?.featureId
    ? features.find(f => f.id === arg.featureId)
    : await pickFeature(features, !!arg?.category);
  if (!feature) return;

  // Resolve the target dictionary file.
  let targetFsPath: string;
  if (feature.target.file) {
    if (!caseRoot) {
      vscode.window.showWarningMessage("OpenFOAM: no case root found — open a file inside the case first.");
      return;
    }
    targetFsPath = path.join(caseRoot, feature.target.file);
  } else {
    if (!doc) { vscode.window.showWarningMessage("OpenFOAM: open the target file first."); return; }
    targetFsPath = doc.uri.fsPath;
  }

  // For a named-block target (a BC patch, ...) the one thing that decides
  // *where* the block goes — not just a value — is still a quick pick.
  const effectivePath = [...feature.target.blockPath];
  if (feature.target.wrap === "namedBlock") {
    const suggestions = caseRoot ? boundaryPatchSuggestions(caseRoot) : [];
    const name = await pickOrType(feature.target.nameLabel ?? "Name", suggestions);
    if (!name) return;
    effectivePath.push(name);
  }

  // Open a staging tab: a real, editable OpenFOAM buffer pre-filled with a
  // draft of the block, plus "Write / Change target / Discard" buttons.
  // Nothing is written to disk until the user presses Write.
  await openStagingTab({
    body: renderTemplate(feature),
    targetFsPath,
    caseRoot,
    blockPath: effectivePath,
    label: feature.label,
  });
}

function boundaryPatchSuggestions(caseRoot: string): string[] {
  try {
    const txt = fs.readFileSync(path.join(caseRoot, "constant", "polyMesh", "boundary"), "utf8");
    const names = new Set<string>();
    const re = /^\s*([A-Za-z_][\w.]*)\s*\n\s*\{/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt))) names.add(m[1]);
    return [...names];
  } catch {
    return [];
  }
}

