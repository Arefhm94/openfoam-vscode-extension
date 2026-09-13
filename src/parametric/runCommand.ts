import * as path from "path";
import * as vscode from "vscode";
import * as fs from "fs";
import { cartesianVariants, ParamDef } from "./paramSet";
import { runSweep } from "./sweepRunner";
import { buildAnalysisDriverScript, buildDakotaInput } from "./dakotaExport";
import { findCaseRootFromPath } from "../shared/caseRoot";

/**
 * `OpenFOAM: Start Parametric Study` — prompts for one or more
 * parameters (each: a target file, an optional block path, a key, and a
 * comma-separated list of values), then materializes the full grid of
 * variant case directories via `runSweep`. Text-prompt driven, in the
 * same "explicit, reviewable steps" spirit as the scaffold engine — nothing
 * is written until the params are confirmed.
 */
/** Prompts for one or more parameters; `[]` if the user backs out immediately. */
export async function promptParams(caseRoot: string, doneLabel: string): Promise<ParamDef[]> {
  const params: ParamDef[] = [];
  for (;;) {
    const param = await promptOneParam(caseRoot, params.length);
    if (!param) break;
    params.push(param);
    const more = await vscode.window.showQuickPick(["Add another parameter", doneLabel], {
      placeHolder: `${params.length} parameter(s) so far`,
    });
    if (more !== "Add another parameter") break;
  }
  return params;
}

export function activeCaseRoot(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  return (editor ? findCaseRootFromPath(editor.document.uri.fsPath) : undefined) ?? undefined;
}

export async function runParametricStudyCommand(): Promise<void> {
  const caseRoot = activeCaseRoot();
  if (!caseRoot) {
    vscode.window.showWarningMessage("OpenFOAM: open a file inside a case first.");
    return;
  }

  const params = await promptParams(caseRoot, "Run the sweep");
  if (!params.length) return;

  const variants = cartesianVariants(params);
  const proceed = await vscode.window.showWarningMessage(
    `Create ${variants.length} variant case ${variants.length === 1 ? "directory" : "directories"} ` +
      `next to ${path.basename(caseRoot)}?`,
    { modal: true, detail: variants.map(v => `${v.name}: ${JSON.stringify(v.params)}`).join("\n") },
    "Create",
  );
  if (proceed !== "Create") return;

  const results = await runSweep(caseRoot, variants);
  const missed = results.flatMap(r => r.missedEdits.map(e => `${r.variant.name}: ${e.file} → '${e.key}' not found`));
  if (missed.length) {
    vscode.window.showWarningMessage(`OpenFOAM: some substitutions didn't match:\n${missed.join("\n")}`);
  }
  const openFolder = "Reveal first variant";
  const choice = await vscode.window.showInformationMessage(
    `OpenFOAM: created ${results.length} variant case(s) next to ${path.basename(caseRoot)}.`,
    openFolder,
  );
  if (choice === openFolder && results[0]) {
    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(results[0].caseDir));
  }
}

async function promptOneParam(caseRoot: string, index: number): Promise<ParamDef | undefined> {
  const file = await vscode.window.showInputBox({
    title: `Parameter ${index + 1}: target file`,
    prompt: "Case-relative dictionary file, e.g. system/controlDict",
    placeHolder: "system/controlDict",
  });
  if (!file) return undefined;

  const blockPathRaw = await vscode.window.showInputBox({
    title: `Parameter ${index + 1}: block path (optional)`,
    prompt: "Comma-separated nesting, e.g. PIMPLE — leave empty for a top-level key",
    placeHolder: "",
  });
  if (blockPathRaw === undefined) return undefined;

  const key = await vscode.window.showInputBox({
    title: `Parameter ${index + 1}: key`,
    prompt: "The dictionary key to vary, e.g. deltaT",
    placeHolder: "deltaT",
    validateInput: v => (v.trim() ? undefined : "required"),
  });
  if (!key) return undefined;

  const valuesRaw = await vscode.window.showInputBox({
    title: `Parameter ${index + 1}: values`,
    prompt: "Comma-separated values to sweep over",
    placeHolder: "0.001, 0.01, 0.1",
    validateInput: v => (v.split(",").map(s => s.trim()).filter(Boolean).length ? undefined : "at least one value"),
  });
  if (!valuesRaw) return undefined;

  return {
    name: key,
    file: path.isAbsolute(file) ? path.relative(caseRoot, file) : file,
    blockPath: blockPathRaw.split(",").map(s => s.trim()).filter(Boolean),
    key: key.trim(),
    values: valuesRaw.split(",").map(s => s.trim()).filter(Boolean),
  };
}

/**
 * `OpenFOAM: Export Parametric Study to Dakota` — only registered/shown
 * once a `dakota` binary is detected on `PATH` (see `extension.ts`'s
 * `openfoam.dakotaAvailable` context key). Same parameter prompts as the
 * native sweep; writes `dakota.in` + a driver script into the case root
 * instead of materializing variant directories itself.
 */
export async function runDakotaExportCommand(context: vscode.ExtensionContext): Promise<void> {
  const caseRoot = activeCaseRoot();
  if (!caseRoot) {
    vscode.window.showWarningMessage("OpenFOAM: open a file inside a case first.");
    return;
  }

  const params = await promptParams(caseRoot, "Export to Dakota");
  if (!params.length) return;

  const driverPath = path.join(caseRoot, "dakota_driver.js");
  const inputPath = path.join(caseRoot, "dakota.in");
  fs.writeFileSync(driverPath, buildAnalysisDriverScript(caseRoot, params, context.extensionPath), { mode: 0o755 });
  fs.writeFileSync(inputPath, buildDakotaInput(params, "./dakota_driver.js"));

  const choice = await vscode.window.showInformationMessage(
    `OpenFOAM: wrote ${path.basename(inputPath)} and ${path.basename(driverPath)}. ` +
      `Fill in the TODOs in the driver (solver command + objective extraction) before running Dakota.`,
    "Open driver script",
  );
  if (choice) {
    const doc = await vscode.workspace.openTextDocument(driverPath);
    await vscode.window.showTextDocument(doc);
  }
}
