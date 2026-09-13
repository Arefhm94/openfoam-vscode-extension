import * as fs from "fs";
import * as vscode from "vscode";

/** Shared "Save screenshot as PNG" flow for the geometry/field viewers —
 *  the webview does the actual capture (`canvas.toDataURL('image/png')`)
 *  and posts the base64 payload here; this just handles the save dialog
 *  and the write, the same way for every viewer/panel that offers it. */
export async function saveScreenshotDialog(dataBase64: string, suggestedBaseName: string): Promise<void> {
  const uri = await vscode.window.showSaveDialog({
    filters: { "PNG image": ["png"] },
    defaultUri: vscode.Uri.file(`${suggestedBaseName}.png`),
  });
  if (!uri) return;
  try {
    fs.writeFileSync(uri.fsPath, Buffer.from(dataBase64, "base64"));
  } catch {
    vscode.window.showErrorMessage(`OpenFOAM: could not save screenshot to ${uri.fsPath}`);
  }
}
