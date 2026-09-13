import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { buildGeometryHtml } from "./geometryHtml";
import { saveScreenshotDialog } from "./screenshot";

export class GeometryPreviewPanel {
  public static currentPanel: GeometryPreviewPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _ready = false;
  private _pending: (() => void)[] = [];
  private _lastBaseName = "geometry-screenshot";

  public static createOrShow(extensionUri: vscode.Uri) {
    if (GeometryPreviewPanel.currentPanel) {
      GeometryPreviewPanel.currentPanel._panel.reveal(undefined, true);
      return GeometryPreviewPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      "openfoamGeometryPreview",
      "Geometry Preview",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      },
    );

    GeometryPreviewPanel.currentPanel = new GeometryPreviewPanel(panel, extensionUri);
    return GeometryPreviewPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._panel.webview.html = buildGeometryHtml(this._panel.webview, this._extensionUri);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(async (msg: { command?: string; uris?: string[]; dataBase64?: string }) => {
      if (msg.command === "ready") {
        this._ready = true;
        const queued = this._pending;
        this._pending = [];
        for (const fn of queued) fn();
      } else if (msg.command === "openFile") {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: true,
          filters: { "Geometry files": ["stl", "obj", "vtk"] },
          title: "Add geometry layer(s)",
        });
        for (const uri of picked ?? []) this.previewGeometry(uri.fsPath);
      } else if (msg.command === "dropFiles") {
        // Routed through the unified `openfoam.preview` command rather
        // than assuming everything dropped here is plain geometry — a
        // dropped `.vtp`/field-data `.vtk` should still open in the
        // field viewer, not fail to render as a bare mesh.
        for (const raw of msg.uris ?? []) {
          const p = uriStringToPath(raw);
          if (p && /\.(stl|obj|vtk|vtp)$/i.test(p)) vscode.commands.executeCommand("openfoam.preview", vscode.Uri.file(p));
        }
      } else if (msg.command === "saveScreenshot" && msg.dataBase64) {
        await saveScreenshotDialog(msg.dataBase64, this._lastBaseName);
      }
    }, null, this._disposables);
  }

  public previewGeometry(filePath: string) {
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
        const buf = fs.readFileSync(filePath);
        const headerStr = buf.slice(0, 6).toString('ascii').toLowerCase();
        const isBinary = headerStr !== 'solid ';
        const b64 = buf.toString('base64');
        this._panel.webview.postMessage({
          command: "previewGeometry",
          fileName,
          dataBase64: b64,
          isBinary,
        });
      } catch {
        vscode.window.showErrorMessage(`Could not read geometry file: ${filePath}`);
      }
    };
    if (this._ready) run(); else this._pending.push(run);
  }

  public dispose() {
    GeometryPreviewPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) this._disposables.pop()?.dispose();
  }
}

/** One line of a dropped `text/uri-list` payload → a real fs path, or
 *  `null` for anything that isn't a `file://` URI. */
function uriStringToPath(raw: string): string | null {
  try {
    const uri = vscode.Uri.parse(raw.trim());
    return uri.scheme === "file" ? uri.fsPath : null;
  } catch {
    return null;
  }
}
