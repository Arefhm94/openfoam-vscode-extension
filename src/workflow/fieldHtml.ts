import * as vscode from "vscode";

/** Shared HTML shell for the vtk.js field-data viewer — used both by the
 *  standalone `FieldViewerPanel` and by the `.vtk`/`.vtp` custom editor,
 *  so a file opened either way looks and behaves the same. */
export function buildFieldHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  const csp = webview.cspSource;
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "field-viewer.js"));
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
#field-panel{display:flex;flex-direction:column;flex:1;min-height:0;position:relative}
#field-header{display:flex;align-items:center;gap:10px;padding:5px 10px;
              background:rgba(10,10,18,0.95);border-bottom:1px solid #2a2d35;flex-shrink:0;flex-wrap:wrap}
#field-label{font-size:10px;color:#aaa;font-family:monospace;flex:1 1 auto;min-width:120px;
             overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#field-array{font-size:11px;background:#1c1f26;color:#ddd;border:1px solid #333;border-radius:3px;padding:2px 4px}
.rep-btn{font-size:11px;background:#1c1f26;color:#ccc;border:1px solid #333;border-radius:3px;
         padding:2px 8px;cursor:pointer}
.rep-btn.active{background:#3a5a8c;color:#fff;border-color:#4d7ab8}
#field-canvas{flex:1;min-height:0;width:100%;position:relative}
#legend-panel{position:absolute;top:8px;left:8px;display:flex;flex-direction:column;align-items:center;
              gap:6px;background:rgba(10,10,18,0.78);border:1px solid #2a2d35;border-radius:6px;padding:8px 10px;
              font-size:10px;font-family:monospace;visibility:hidden}
#colormap-select{font-size:10px;background:#1c1f26;color:#ddd;border:1px solid #333;border-radius:3px;padding:1px 3px;
                  max-width:110px}
#legend-vert{display:flex;flex-direction:column;align-items:center;gap:4px}
#legend-bar{width:14px;height:130px;border-radius:2px;border:1px solid #333}
#open-btn{font-size:11px;background:#1c1f26;color:#ddd;border:1px solid #333;border-radius:3px;padding:3px 10px;cursor:pointer}
#open-btn:hover{background:#2a2f3a}
#empty-state{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
             justify-content:center;gap:10px;color:#888;font-size:12px;pointer-events:none;text-align:center;padding:0 20px}
#empty-state button{pointer-events:auto}
#loading-state{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;
               justify-content:center;gap:12px;color:#ccc;font-size:12px;background:rgba(17,19,24,0.85);z-index:10}
.spinner{width:28px;height:28px;border-radius:50%;border:3px solid #333;border-top-color:#4db8ff;
         animation:spin 0.8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
body.drag-over #field-panel{outline:2px dashed #4db8ff;outline-offset:-2px}
#nav-panel{position:absolute;bottom:8px;right:8px;display:flex;flex-direction:column;gap:6px;
           background:rgba(10,10,18,0.78);border:1px solid #2a2d35;border-radius:6px;padding:6px}
.nav-compass{display:grid;grid-template-columns:repeat(3,22px);grid-template-rows:repeat(3,22px);gap:2px}
.nav-row{display:flex;gap:4px;justify-content:center}
.nav-btn{width:22px;height:22px;font-size:11px;line-height:1;padding:0;display:flex;align-items:center;
         justify-content:center;background:#1c1f26;color:#ddd;border:1px solid #333;border-radius:3px;cursor:pointer}
.nav-btn:hover{background:#2a2f3a}
.nav-btn.nav-center{background:#2a3244}
.nav-btn.active{background:#3a5a8c;color:#fff;border-color:#4d7ab8}
.nav-divider{height:1px;background:#333;margin:2px 0}
#clip-slider{width:100%}
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
    <div id="loading-state">
      <div class="spinner"></div>
      <div id="loading-text">Loading…</div>
    </div>
    <div id="nav-panel" title="View controls">
      <div class="nav-compass">
        <button class="nav-btn" id="nav-tilt-up" style="grid-area:1/2" title="Tilt up 15°">&#9650;</button>
        <button class="nav-btn" id="nav-rot-left" style="grid-area:2/1" title="Rotate left 15°">&#9664;</button>
        <button class="nav-btn nav-center" id="nav-fit" style="grid-area:2/2" title="Fit view to the dataset">&#8862;</button>
        <button class="nav-btn" id="nav-rot-right" style="grid-area:2/3" title="Rotate right 15°">&#9654;</button>
        <button class="nav-btn" id="nav-tilt-down" style="grid-area:3/2" title="Tilt down 15°">&#9660;</button>
      </div>
      <div class="nav-compass">
        <button class="nav-btn" id="nav-pan-up" style="grid-area:1/2" title="Pan up">&#9650;</button>
        <button class="nav-btn" id="nav-pan-left" style="grid-area:2/1" title="Pan left">&#9664;</button>
        <button class="nav-btn nav-center" id="nav-reset" style="grid-area:2/2" title="Reset view">&#8962;</button>
        <button class="nav-btn" id="nav-pan-right" style="grid-area:2/3" title="Pan right">&#9654;</button>
        <button class="nav-btn" id="nav-pan-down" style="grid-area:3/2" title="Pan down">&#9660;</button>
      </div>
      <div class="nav-row">
        <button class="nav-btn" id="nav-ortho" title="Toggle orthographic/perspective projection">&#9633;</button>
        <button class="nav-btn" id="nav-screenshot" title="Save screenshot as PNG">&#128247;</button>
      </div>
      <div class="nav-divider"></div>
      <div class="nav-row" title="Clip plane">
        <button class="nav-btn" id="clip-toggle" title="Toggle clip plane">&#9986;</button>
        <button class="nav-btn active" id="clip-axis-x" title="Clip along X">X</button>
        <button class="nav-btn" id="clip-axis-y" title="Clip along Y">Y</button>
        <button class="nav-btn" id="clip-axis-z" title="Clip along Z">Z</button>
        <button class="nav-btn" id="clip-flip" title="Flip clip direction">&#8644;</button>
      </div>
      <input type="range" id="clip-slider" min="0" max="100" value="50">
    </div>
    <div id="legend-panel" title="Color legend">
      <select id="colormap-select"></select>
      <div id="legend-vert">
        <span id="legend-max">1</span>
        <div id="legend-bar"></div>
        <span id="legend-min">0</span>
      </div>
    </div>
  </div>
</div>
<script nonce="${nonce}">
  const vs = acquireVsCodeApi();
  window.vsApi = vs;
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

function getNonce(): string {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => c[Math.floor(Math.random() * c.length)]).join("");
}
