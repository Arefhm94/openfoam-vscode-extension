import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { buildFieldHtml } from "./fieldHtml";
import { saveScreenshotDialog } from "./screenshot";

/**
 * The vtk.js-backed field-data viewer — color-by-array, a legend, and a
 * solid/wireframe/points toggle for `.vtk`/`.vtp` datasets that carry
 * point/cell data (mirrors `GeometryPreviewPanel.ts`'s pattern; kept
 * separate since plain STL/OBJ geometry has no field data to show).
 */
export class FieldViewerPanel {
  public static currentPanel: FieldViewerPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _ready = false;
  private _pending: (() => void)[] = [];
  private _lastBaseName = "field-screenshot";

  public static createOrShow(extensionUri: vscode.Uri): FieldViewerPanel {
    if (FieldViewerPanel.currentPanel) {
      FieldViewerPanel.currentPanel._panel.reveal(undefined, true);
      return FieldViewerPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      "openfoamFieldViewer",
      "Field Viewer",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      },
    );

    FieldViewerPanel.currentPanel = new FieldViewerPanel(panel, extensionUri);
    return FieldViewerPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._panel.webview.html = buildFieldHtml(this._panel.webview, this._extensionUri);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(async (msg: { command?: string; uris?: string[]; dataBase64?: string }) => {
      if (msg.command === "ready") {
        this._ready = true;
        const queued = this._pending;
        this._pending = [];
        for (const fn of queued) fn();
      } else if (msg.command === "openFile") {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { "VTK field data": ["vtk", "vtp"] },
          title: "Open field-data file",
        });
        if (picked?.[0]) this.previewField(picked[0].fsPath);
      } else if (msg.command === "dropFiles") {
        // Routed through the unified `openfoam.preview` command rather
        // than assuming everything dropped here is field data — a
        // dropped `.stl`/`.obj`/bare-geometry `.vtk` should open in the
        // full three.js geometry viewer, not this one. This viewer still
        // only shows one dataset at a time, so only the first field file
        // (if any) actually lands here.
        for (const raw of msg.uris ?? []) {
          const p = uriStringToPath(raw);
          if (p && /\.(stl|obj|vtk|vtp)$/i.test(p)) vscode.commands.executeCommand("openfoam.preview", vscode.Uri.file(p));
        }
      } else if (msg.command === "saveScreenshot" && msg.dataBase64) {
        await saveScreenshotDialog(msg.dataBase64, this._lastBaseName);
      }
    }, null, this._disposables);
  }

  public previewField(filePath: string): void {
    this._panel.reveal(undefined, true);
    this._panel.title = path.basename(filePath);
    this._lastBaseName = path.basename(filePath, path.extname(filePath));
    const fileName = path.basename(filePath);
    const run = () => {
      // Posted before the (synchronous, potentially slow for a large
      // file) read below — postMessage to a webview is async IPC, so
      // the webview can paint its loading spinner while this host-side
      // read+encode work still runs.
      this._panel.webview.postMessage({ command: "loading", fileName });
      try {
        const stat = fs.statSync(filePath);
        const MAX_BYTES = 25 * 1024 * 1024;
        if (stat.size > MAX_BYTES) {
          vscode.window.showWarningMessage(
            `OpenFOAM: ${fileName} is ${(stat.size / 1024 / 1024).toFixed(1)} MB — ` +
              `loading it in the field viewer may be slow.`,
          );
        }
        const buf = fs.readFileSync(filePath);
        this._panel.webview.postMessage({
          command: "previewField",
          fileName,
          dataBase64: buf.toString("base64"),
        });
      } catch {
        vscode.window.showErrorMessage(`Could not read field data file: ${filePath}`);
      }
    };
    if (this._ready) run(); else this._pending.push(run);
  }

  public dispose(): void {
    FieldViewerPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) this._disposables.pop()?.dispose();
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
