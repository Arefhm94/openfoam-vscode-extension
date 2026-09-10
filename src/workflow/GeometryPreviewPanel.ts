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
body{background:#111318;overflow:hidden;height:100vh;display:flex;flex-direction:column}
#geo-panel{display:flex;flex-direction:column;flex:1;position:relative}
#geo-header{display:flex;align-items:center;padding:5px 10px;background:rgba(10,10,18,0.95);border-bottom:1px solid #2a2d35;flex-shrink:0}
#geo-label{font-size:10px;color:#aaa;flex:1;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#geo-canvas{flex:1;width:100%;display:block;cursor:grab}
#geo-canvas:active{cursor:grabbing}
#axes-canvas{position:absolute;bottom:8px;left:8px;pointer-events:none;width:80px;height:80px}
</style>
</head>
<body>
<div id="geo-panel">
  <div id="geo-header">
    <span id="geo-label"></span>
  </div>
  <canvas id="geo-canvas"></canvas>
  <canvas id="axes-canvas" width="80" height="80"></canvas>
</div>
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
