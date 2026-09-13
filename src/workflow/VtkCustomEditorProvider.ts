import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { looksLikeFieldData } from "../shared/vtkSniff";
import { buildFieldHtml } from "./fieldHtml";
import { buildGeometryHtml } from "./geometryHtml";
import { saveScreenshotDialog } from "./screenshot";

/**
 * Makes `.vtk`/`.vtp`/`.stl`/`.obj` the default editor for those
 * extensions, so double-clicking one (in VS Code's own Explorer, not
 * just the Case Explorer) opens it directly in the right viewer instead
 * of as raw text — a `.vtp`, or a `.vtk` that actually carries
 * POINT_DATA/CELL_DATA, opens in the field viewer; `.stl`/`.obj` and
 * plain-geometry `.vtk` open in the 3D preview. Read-only: this only
 * previews the file, it never edits it.
 */
export class VtkCustomEditorProvider implements vscode.CustomReadonlyEditorProvider {
  public static readonly viewType = "openfoam.vtkPreview";

  constructor(private readonly extensionUri: vscode.Uri) {}

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      VtkCustomEditorProvider.viewType,
      new VtkCustomEditorProvider(context.extensionUri),
      { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true },
    );
  }

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => { /* nothing to release */ } };
  }

  resolveCustomEditor(document: vscode.CustomDocument, webviewPanel: vscode.WebviewPanel): void {
    const extensionUri = this.extensionUri;
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
    };

    const filePath = document.uri.fsPath;
    const ext = path.extname(filePath).toLowerCase();
    const isField = ext === ".vtp" || (ext === ".vtk" && looksLikeFieldData(filePath));
    webviewPanel.title = path.basename(filePath);

    const sendPayload = () => {
      // Posted before the (synchronous, potentially slow for a large
      // file) read below — postMessage to a webview is async IPC, so
      // the webview can paint its loading spinner while this host-side
      // read+encode work still runs.
      webviewPanel.webview.postMessage({ command: "loading", fileName: path.basename(filePath) });
      try {
        if (isField) {
          const buf = fs.readFileSync(filePath);
          webviewPanel.webview.postMessage({
            command: "previewField",
            fileName: path.basename(filePath),
            dataBase64: buf.toString("base64"),
          });
        } else {
          const buf = fs.readFileSync(filePath);
          const headerStr = buf.slice(0, 6).toString("ascii").toLowerCase();
          webviewPanel.webview.postMessage({
            command: "previewGeometry",
            fileName: path.basename(filePath),
            dataBase64: buf.toString("base64"),
            isBinary: headerStr !== "solid ",
          });
        }
      } catch {
        vscode.window.showErrorMessage(`OpenFOAM: could not read ${path.basename(filePath)}`);
      }
    };

    webviewPanel.webview.html = isField
      ? buildFieldHtml(webviewPanel.webview, extensionUri)
      : buildGeometryHtml(webviewPanel.webview, extensionUri);

    const sub = webviewPanel.webview.onDidReceiveMessage(async (msg: { command?: string; uris?: string[]; dataBase64?: string }) => {
      if (msg.command === "ready") {
        sendPayload();
      } else if (msg.command === "openFile") {
        // This tab is bound to one fixed document — hand off to the
        // standalone, multi-file panel rather than trying to swap this
        // editor's own content.
        vscode.commands.executeCommand(isField ? "openfoam.previewField" : "openfoam.previewGeometry");
      } else if (msg.command === "dropFiles") {
        // Route each dropped file through the unified command's own
        // detection rather than assuming it matches this tab's fixed
        // document type — dropping a plain .stl onto an already-open
        // field-data tab (or vice versa) should still open correctly,
        // not get forced into whatever this tab happens to be.
        for (const raw of msg.uris ?? []) {
          const p = uriStringToPath(raw);
          if (!p) continue;
          vscode.commands.executeCommand("openfoam.preview", vscode.Uri.file(p));
        }
      } else if (msg.command === "saveScreenshot" && msg.dataBase64) {
        await saveScreenshotDialog(msg.dataBase64, path.basename(filePath, path.extname(filePath)));
      }
    });
    webviewPanel.onDidDispose(() => sub.dispose());
  }
}

function uriStringToPath(raw: string): string | null {
  try {
    const uri = vscode.Uri.parse(raw.trim());
    return uri.scheme === "file" ? uri.fsPath : null;
  } catch {
    return null;
  }
}
