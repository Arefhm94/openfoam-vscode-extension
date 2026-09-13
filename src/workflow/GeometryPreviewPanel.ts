import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export class GeometryPreviewPanel {
  public static currentPanel: GeometryPreviewPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

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
    this._panel.webview.html = this._buildHtml();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(async (msg: { command?: string; uris?: string[] }) => {
      if (msg.command === "openFile") {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: true,
          filters: { "Geometry files": ["stl", "obj", "vtk"] },
          title: "Add geometry layer(s)",
        });
        for (const uri of picked ?? []) this.previewGeometry(uri.fsPath);
      } else if (msg.command === "dropFiles") {
        for (const raw of msg.uris ?? []) {
          const p = uriStringToPath(raw);
          if (p && /\.(stl|obj|vtk)$/i.test(p)) this.previewGeometry(p);
        }
      }
    }, null, this._disposables);
  }

  public previewGeometry(filePath: string) {
    this._panel.reveal(undefined, true);
    this._panel.title = path.basename(filePath);
    try {
      const buf = fs.readFileSync(filePath);
      const headerStr = buf.slice(0, 6).toString('ascii').toLowerCase();
      const isBinary = headerStr !== 'solid ';
      const b64 = buf.toString('base64');
      this._panel.webview.postMessage({
        command: "previewGeometry",
        fileName: path.basename(filePath),
        dataBase64: b64,
        isBinary,
      });
    } catch (e) {
      vscode.window.showErrorMessage(`Could not read geometry file: ${filePath}`);
    }
  }

  private _buildHtml(): string {
    const nonce = getNonce();
    const csp = this._panel.webview.cspSource;
    const geoViewerUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'geo-viewer.js'),
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp}; img-src data: ${csp};">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Geometry Preview</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#111318;overflow:hidden;height:100vh;display:flex;flex-direction:column;font-family:var(--vscode-font-family,sans-serif)}
#geo-panel{display:flex;flex-direction:column;flex:1;position:relative}
#geo-header{display:flex;align-items:center;gap:8px;padding:5px 10px;background:rgba(10,10,18,0.95);border-bottom:1px solid #2a2d35;flex-shrink:0;flex-wrap:wrap}
#geo-label{font-size:10px;color:#aaa;flex:1 1 auto;min-width:100px;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#open-btn,#clear-btn{font-size:11px;background:#1c1f26;color:#ddd;border:1px solid #333;border-radius:3px;padding:3px 10px;cursor:pointer}
#open-btn:hover,#clear-btn:hover{background:#2a2f3a}
#layers{display:flex;flex-wrap:wrap;gap:6px;padding:5px 10px;background:rgba(10,10,18,0.85);
        border-bottom:1px solid #2a2d35;flex-shrink:0}
#layers:empty{display:none}
.layer-chip{display:flex;align-items:center;gap:5px;font-size:11px;color:#ddd;background:#1c1f26;
            border:1px solid #333;border-radius:12px;padding:2px 8px 2px 6px}
.layer-chip .swatch{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.layer-chip button{background:none;border:none;color:#999;cursor:pointer;font-size:12px;padding:0 2px;line-height:1}
.layer-chip button:hover{color:#fff}
.layer-chip.layer-hidden{opacity:0.4}
#geo-canvas{flex:1;width:100%;display:block;cursor:grab}
#geo-canvas:active{cursor:grabbing}
#axes-canvas{position:absolute;bottom:8px;left:8px;pointer-events:none;width:80px;height:80px}
#empty-state{position:absolute;inset:0;top:36px;display:flex;flex-direction:column;align-items:center;
             justify-content:center;gap:10px;color:#888;font-size:12px;pointer-events:none;text-align:center;padding:0 20px}
#empty-state button{pointer-events:auto}
body.drag-over #geo-panel{outline:2px dashed #4db8ff;outline-offset:-2px}
</style>
</head>
<body>
<div id="geo-panel">
  <div id="geo-header">
    <span id="geo-label">No geometry file open</span>
    <button id="open-btn">Add geometry layer…</button>
    <button id="clear-btn">Clear All</button>
  </div>
  <div id="layers"></div>
  <canvas id="geo-canvas"></canvas>
  <canvas id="axes-canvas" width="80" height="80"></canvas>
  <div id="empty-state">
    <div>Add STL/OBJ/VTK files to preview them here (pick several at once, or drag them in from the Explorer) — each becomes its own toggleable layer</div>
    <button id="empty-open-btn">Add geometry layer…</button>
  </div>
</div>
<script nonce="${nonce}">
  const vs = acquireVsCodeApi();
  const openFile = () => vs.postMessage({ command: 'openFile' });
  document.getElementById('open-btn').addEventListener('click', openFile);
  document.getElementById('empty-open-btn').addEventListener('click', openFile);

  // Drag a file in from VS Code's Explorer (or the OS) to add it as a layer.
  document.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('drag-over'); });
  document.addEventListener('dragleave', () => document.body.classList.remove('drag-over'));
  document.addEventListener('drop', e => {
    e.preventDefault();
    document.body.classList.remove('drag-over');
    const list = e.dataTransfer && e.dataTransfer.getData('text/uri-list');
    if (!list) return;
    const uris = list.split(/\\r?\\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
    if (uris.length) vs.postMessage({ command: 'dropFiles', uris });
  });
  document.getElementById('clear-btn').addEventListener('click', () => window.postMessage({ command: 'clearLayers' }, '*'));
</script>
<script nonce="${nonce}" src="${geoViewerUri}"></script>
</body>
</html>`;
  }

  public dispose() {
    GeometryPreviewPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) this._disposables.pop()?.dispose();
  }
}

function getNonce() {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => c[Math.floor(Math.random() * c.length)]).join("");
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
