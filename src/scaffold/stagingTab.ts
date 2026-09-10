import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { getParser, parseText } from "../treeSitter/parser";
import { locateInsertion } from "./blockLocator";

/**
 * The "Search & Configure" staging tab.
 *
 * Picking a feature opens an **untitled OpenFOAM editor** pre-filled with a
 * plain-text draft of the block. It's a real editor — syntax highlighting,
 * completion and diagnostics all work — so the user edits the settings as
 * ordinary dictionary text. Three CodeLens "buttons" sit at the top:
 *   • Write to <target>   — inserts the buffer into the resolved file
 *   • Change target…      — edits the file path / block nesting
 *   • Discard             — closes the tab, writes nothing
 * Nothing touches disk until **Write**.
 */

interface PendingWrite {
  targetFsPath: string; // absolute path of the dictionary file to write into
  caseRoot: string | null; // for showing / editing a case-relative path
  blockPath: string[]; // structural nesting inside the target file
  label: string; // feature label, for status messages
}

const pending = new Map<string, PendingWrite>();

export function forgetStagingTab(uri: vscode.Uri): void {
  pending.delete(uri.toString());
}

function relLabel(p: PendingWrite): string {
  const rel = p.caseRoot ? path.relative(p.caseRoot, p.targetFsPath) : p.targetFsPath;
  return p.blockPath.length ? `${rel}  ›  ${p.blockPath.join(" › ")}` : rel;
}

function relFile(p: PendingWrite): string {
  return p.caseRoot ? path.relative(p.caseRoot, p.targetFsPath) : p.targetFsPath;
}

/** Case-relative paths of every plausible dictionary file, for autocomplete. */
function listCaseDictFiles(caseRoot: string): string[] {
  const out: string[] = [];
  const skipDir = new Set(["postProcessing", "dynamicCode", "node_modules", "triSurface", "polyMesh"]);
  const walk = (dir: string, depth: number): void => {
    if (out.length > 800 || depth > 6) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (skipDir.has(e.name) || /^processor\d+$/.test(e.name)) continue;
        walk(full, depth + 1);
      } else if (e.isFile() && !/\.(vtk|stl|obj|nas|eMesh|gz|png|jpg|foam)$/i.test(e.name)) {
        out.push(path.relative(caseRoot, full));
      }
    }
  };
  walk(caseRoot, 0);
  return out.sort();
}

export async function openStagingTab(init: {
  body: string;
  targetFsPath: string;
  caseRoot: string | null;
  blockPath: string[];
  label: string;
}): Promise<void> {
  const content = init.body.endsWith("\n") ? init.body : init.body + "\n";
  const doc = await vscode.workspace.openTextDocument({ language: "openfoam", content });
  pending.set(doc.uri.toString(), {
    targetFsPath: init.targetFsPath,
    caseRoot: init.caseRoot,
    blockPath: [...init.blockPath],
    label: init.label,
  });
  const shown = await vscode.window.showTextDocument(doc, { preview: false });
  scaffoldLenses.refresh();
  updateStagingContext(shown);
  vscode.window.setStatusBarMessage(
    `$(edit) OpenFOAM: edit the block, then press “Write” at the top of the tab`,
    5000,
  );
}

// ── CodeLens "buttons" ─────────────────────────────────────────────────────

class ScaffoldCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._changed.event;
  refresh(): void {
    this._changed.fire();
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    const p = pending.get(doc.uri.toString());
    if (!p) return [];
    const top = new vscode.Range(0, 0, 0, 0);
    return [
      new vscode.CodeLens(top, {
        title: `$(check)  WRITE  →  ${relLabel(p)}`,
        command: "openfoam.scaffold.write",
        arguments: [doc.uri],
      }),
      new vscode.CodeLens(top, {
        title: "$(edit)  CHANGE TARGET",
        command: "openfoam.scaffold.changeTarget",
        arguments: [doc.uri],
      }),
      new vscode.CodeLens(top, {
        title: "$(trash)  DISCARD",
        command: "openfoam.scaffold.discard",
        arguments: [doc.uri],
      }),
    ];
  }
}

export const scaffoldLenses = new ScaffoldCodeLensProvider();

/** Drives the `when` clause of the always-visible editor-title buttons. */
function updateStagingContext(editor?: vscode.TextEditor): void {
  const on = !!editor && pending.has(editor.document.uri.toString());
  void vscode.commands.executeCommand("setContext", "openfoam.stagingTab", on);
}

/** Title-bar commands pass the editor's URI; fall back to the active editor. */
function resolveStagingUri(arg: unknown): vscode.Uri | undefined {
  if (arg instanceof vscode.Uri && pending.has(arg.toString())) return arg;
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active && pending.has(active.toString())) return active;
  return undefined;
}

export function registerStagingTab(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: "openfoam" }, scaffoldLenses),
    vscode.commands.registerCommand("openfoam.scaffold.write", a => scaffoldWrite(resolveStagingUri(a))),
    vscode.commands.registerCommand("openfoam.scaffold.changeTarget", a => scaffoldChangeTarget(resolveStagingUri(a))),
    vscode.commands.registerCommand("openfoam.scaffold.discard", a => scaffoldDiscard(resolveStagingUri(a))),
    vscode.window.onDidChangeActiveTextEditor(updateStagingContext),
    vscode.workspace.onDidCloseTextDocument(d => {
      forgetStagingTab(d.uri);
      updateStagingContext(vscode.window.activeTextEditor);
    }),
  );
}

function scratchDocFor(uri: vscode.Uri): vscode.TextDocument | undefined {
  const key = uri.toString();
  return vscode.workspace.textDocuments.find(d => d.uri.toString() === key);
}

async function closeScratch(doc: vscode.TextDocument): Promise<void> {
  forgetStagingTab(doc.uri);
  try {
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  } catch {
    /* tab already gone */
  }
}

async function scaffoldChangeTarget(uri: vscode.Uri | undefined): Promise<void> {
  if (!uri) return;
  const p = pending.get(uri.toString());
  if (!p) return;

  const files = p.caseRoot ? listCaseDictFiles(p.caseRoot) : [];
  const qp = vscode.window.createQuickPick();
  qp.title = "Scaffold target file";
  qp.placeholder = p.blockPath.length
    ? `pick or type a file — append  > block  to change nesting (current: ${p.blockPath.join(" › ")})`
    : "pick or type a case-relative file path";
  qp.value = relFile(p);
  qp.items = files.map(f => ({ label: f }));
  qp.matchOnDetail = true;

  const chosen = await new Promise<string | undefined>(resolve => {
    qp.onDidAccept(() => {
      resolve(qp.selectedItems[0]?.label ?? (qp.value.trim() || undefined));
      qp.hide();
    });
    qp.onDidHide(() => { resolve(undefined); qp.dispose(); });
    qp.show();
  });
  if (chosen == null) return;

  const parts = chosen.split(">").map(s => s.trim()).filter(Boolean);
  const fileSpec = parts[0];
  if (!fileSpec) return;
  p.targetFsPath =
    p.caseRoot && !path.isAbsolute(fileSpec) ? path.join(p.caseRoot, fileSpec) : fileSpec;
  if (parts.length > 1) p.blockPath = parts.slice(1); // only overwrite nesting if given
  scaffoldLenses.refresh();
}

async function scaffoldDiscard(uri: vscode.Uri | undefined): Promise<void> {
  if (!uri) return;
  const doc = scratchDocFor(uri);
  if (doc) await closeScratch(doc);
  else forgetStagingTab(uri);
}

async function scaffoldWrite(uri: vscode.Uri | undefined): Promise<void> {
  if (!uri) return;
  const p = pending.get(uri.toString());
  const scratch = scratchDocFor(uri);
  if (!p || !scratch) return;

  const body = scratch.getText().replace(/\s+$/, "");
  if (!body.trim()) {
    vscode.window.showWarningMessage("OpenFOAM: the block is empty — nothing to write.");
    return;
  }

  const targetUri = vscode.Uri.file(p.targetFsPath);
  if (!fs.existsSync(p.targetFsPath)) {
    const edit = new vscode.WorkspaceEdit();
    edit.createFile(targetUri, { overwrite: false, ignoreIfExists: true });
    edit.insert(targetUri, new vscode.Position(0, 0), defaultDictHeader(path.basename(p.targetFsPath)));
    await vscode.workspace.applyEdit(edit);
    await vscode.workspace.save(targetUri).then(undefined, () => undefined);
  }

  const target = await vscode.workspace.openTextDocument(targetUri);
  const parser = await getParser();
  const tree = parseText(parser, target.getText());
  const ins = locateInsertion(tree, target.getText(), p.blockPath);
  const text = ins.render(body);

  const edit = new vscode.WorkspaceEdit();
  edit.insert(targetUri, new vscode.Position(ins.position.line, ins.position.character), text);
  await vscode.workspace.applyEdit(edit);
  await vscode.workspace.save(targetUri).then(undefined, () => undefined);

  const label = p.label;
  const baseName = path.basename(p.targetFsPath);
  await closeScratch(scratch);

  const shown = await vscode.window.showTextDocument(targetUri, { preview: false });
  const at = new vscode.Position(ins.position.line, ins.position.character);
  shown.revealRange(new vscode.Range(at, at), vscode.TextEditorRevealType.InCenter);
  vscode.window.setStatusBarMessage(`$(check) OpenFOAM: wrote ${label} to ${baseName}`, 3000);
}

function defaultDictHeader(object: string): string {
  return `/*--------------------------------*- C++ -*----------------------------------*\\
\\*---------------------------------------------------------------------------*/
FoamFile
{
    version     2.0;
    format      ascii;
    class       dictionary;
    object      ${object};
}
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

// ************************************************************************* //
`;
}
