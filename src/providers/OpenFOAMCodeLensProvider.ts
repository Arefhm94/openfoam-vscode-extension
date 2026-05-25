import * as vscode from "vscode";

const BOOL_PATTERN = /^(\s*\w[\w.]*\s+)(true|false|yes|no|on|off)(\s*;)/i;
const BOOL_ON = new Set(["true", "yes", "on"]);

const TOGGLE_MAP: Record<string, string> = {
  true: "false", false: "true",
  yes: "no", no: "yes",
  on: "off", off: "on",
};

export class OpenFOAMInlayHintsProvider implements vscode.InlayHintsProvider {
  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
  ): vscode.InlayHint[] {
    const hints: vscode.InlayHint[] = [];

    for (let i = range.start.line; i <= range.end.line; i++) {
      const text = document.lineAt(i).text;
      const match = BOOL_PATTERN.exec(text);
      if (!match) continue;

      const value = match[2];
      const isOn = BOOL_ON.has(value.toLowerCase());
      const position = new vscode.Position(i, match[1].length);

      const labelPart = new vscode.InlayHintLabelPart(isOn ? "⬤ " : "○ ");
      labelPart.tooltip = isOn ? "ON — click to toggle off" : "OFF — click to toggle on";
      labelPart.command = {
        title: "Toggle",
        command: "openfoam.toggleBoolean",
        arguments: [document.uri, i],
      };

      const hint = new vscode.InlayHint(
        position,
        [labelPart],
        vscode.InlayHintKind.Parameter,
      );
      hint.paddingLeft = false;
      hint.paddingRight = false;

      hints.push(hint);
    }

    return hints;
  }
}

export async function executeToggleBoolean(
  uri: vscode.Uri,
  lineNumber: number,
): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const lineText = doc.lineAt(lineNumber).text;
  const match = BOOL_PATTERN.exec(lineText);
  if (!match) return;

  const original = match[2];
  const lower = original.toLowerCase();
  const newLower = TOGGLE_MAP[lower];
  if (!newLower) return;

  let newValue = newLower;
  if (original === original.toUpperCase()) {
    newValue = newLower.toUpperCase();
  } else if (original[0] === original[0].toUpperCase()) {
    newValue = newLower[0].toUpperCase() + newLower.slice(1);
  }

  const prefixLen = match[1].length;
  const start = new vscode.Position(lineNumber, prefixLen);
  const end = new vscode.Position(lineNumber, prefixLen + original.length);

  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, new vscode.Range(start, end), newValue);
  await vscode.workspace.applyEdit(edit);
}
