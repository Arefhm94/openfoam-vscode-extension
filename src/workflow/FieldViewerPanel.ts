import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

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
    this._panel.webview.html = this._buildHtml();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(async (msg: { command?: string; uris?: string[] }) => {
      if (msg.command === "openFile") {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { "VTK field data": ["vtk", "vtp"] },
          title: "Open field-data file",
        });
        if (picked?.[0]) this.previewField(picked[0].fsPath);
      } else if (msg.command === "dropFiles") {
        // This viewer shows one dataset at a time — if several files were
        // dropped together, take the first VTK/VTP one.
        const first = (msg.uris ?? []).map(uriStringToPath).find(p => p && /\.(vtk|vtp)$/i.test(p));
        if (first) this.previewField(first);
      }
    }, null, this._disposables);
  }

  public previewField(filePath: string): void {
    this._panel.reveal(undefined, true);
    this._panel.title = path.basename(filePath);
    try {
      const stat = fs.statSync(filePath);
      const MAX_BYTES = 25 * 1024 * 1024;
      if (stat.size > MAX_BYTES) {
        vscode.window.showWarningMessage(
          `OpenFOAM: ${path.basename(filePath)} is ${(stat.size / 1024 / 1024).toFixed(1)} MB — ` +
            `loading it in the field viewer may be slow.`,
        );
      }
      const buf = fs.readFileSync(filePath);
      this._panel.webview.postMessage({
        command: "previewField",
        fileName: path.basename(filePath),
        dataBase64: buf.toString("base64"),
      });
    } catch {
      vscode.window.showErrorMessage(`Could not read field data file: ${filePath}`);
    }
  }

  private _buildHtml(): string {
    const nonce = getNonce();
    const csp = this._panel.webview.cspSource;
    const scriptUri = this._panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "field-viewer.js"),
    );
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}' ${csp}; img-src data: ${csp}; connect-src ${csp};">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Field Viewer</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#111318;overflow:hidden;height:100vh;display:flex;flex-direction:column;
     font-family:var(--vscode-font-family,sans-serif);color:#ddd}
#field-panel{display:flex;flex-direction:column;flex:1;position:relative}
#field-header{display:flex;align-items:center;gap:10px;padding:5px 10px;
              background:rgba(10,10,18,0.95);border-bottom:1px solid #2a2d35;flex-shrink:0;flex-wrap:wrap}
#field-label{font-size:10px;color:#aaa;font-family:monospace;flex:1 1 auto;min-width:120px;
             overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#field-array{font-size:11px;background:#1c1f26;color:#ddd;border:1px solid #333;border-radius:3px;padding:2px 4px}
.rep-btn{font-size:11px;background:#1c1f26;color:#ccc;border:1px solid #333;border-radius:3px;
         padding:2px 8px;cursor:pointer}
.rep-btn.active{background:#3a5a8c;color:#fff;border-color:#4d7ab8}
#field-canvas{flex:1;width:100%;position:relative}
#legend{display:flex;align-items:center;gap:6px;padding:4px 10px;background:rgba(10,10,18,0.95);
        border-top:1px solid #2a2d35;font-size:10px;font-family:monospace;flex-shrink:0}
#legend-bar{height:10px;flex:1;border-radius:2px;border:1px solid #333}
#open-btn{font-size:11px;background:#1c1f26;color:#ddd;border:1px solid #333;border-radius:3px;padding:3px 10px;cursor:pointer}
#open-btn:hover{background:#2a2f3a}
#empty-state{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
             justify-content:center;gap:10px;color:#888;font-size:12px;pointer-events:none;text-align:center;padding:0 20px}
#empty-state button{pointer-events:auto}
body.drag-over #field-panel{outline:2px dashed #4db8ff;outline-offset:-2px}
</style>
</head>
<body>
<div id="field-panel">
  <div id="field-header">
    <span id="field-label">No field-data file open</span>
    <button id="open-btn">Open file…</button>
    <select id="field-array"></select>
    <button class="rep-btn active" data-rep="surface">Solid</button>
    <button class="rep-btn" data-rep="wireframe">Wireframe</button>
    <button class="rep-btn" data-rep="points">Points</button>
  </div>
  <div id="field-canvas">
    <div id="empty-state">
      <div>Open a .vtk/.vtp file with field data to preview it here, or drag one in from the Explorer</div>
      <button id="empty-open-btn">Open file…</button>
    </div>
  </div>
  <div id="legend">
    <span id="legend-min">0</span>
    <div id="legend-bar"></div>
    <span id="legend-max">1</span>
  </div>
</div>
<script nonce="${nonce}">
  const vs = acquireVsCodeApi();
  const openFile = () => vs.postMessage({ command: 'openFile' });
  document.getElementById('open-btn').addEventListener('click', openFile);
  document.getElementById('empty-open-btn').addEventListener('click', openFile);

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
</script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  public dispose(): void {
    FieldViewerPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) this._disposables.pop()?.dispose();
  }
}

function getNonce(): string {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => c[Math.floor(Math.random() * c.length)]).join("");
}

function uriStringToPath(raw: string): string | null {
  try {
    const uri = vscode.Uri.parse(raw.trim());
    return uri.scheme === "file" ? uri.fsPath : null;
  } catch {
    return null;
  }
}
