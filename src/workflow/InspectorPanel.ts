import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import {
  DictNode,
  buildNodeMap,
  findNodeAtLine,
  parseOpenFOAM,
} from "../parsers/OpenFOAMParser";

export class InspectorPanel {
  public static currentPanel: InspectorPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _currentFilePath: string | undefined;
  private _tree: DictNode | undefined;
  private _nodeMap: Map<string, DictNode> = new Map();

  public static createOrShow(
    extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
  ) {
    if (InspectorPanel.currentPanel) {
      InspectorPanel.currentPanel._panel.reveal(vscode.ViewColumn.Beside, true);
      InspectorPanel.currentPanel._tryLoadActiveEditor();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "openfoamInspector",
      "∇",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")],
      },
    );

    InspectorPanel.currentPanel = new InspectorPanel(panel, extensionUri, context);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    _context: vscode.ExtensionContext,
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._panel.webview.html = this._buildHtml();
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.onDidReceiveMessage(
      (m) => this._handleMessage(m),
      null,
      this._disposables,
    );
    vscode.window.onDidChangeTextEditorSelection(
      (e) => this._onCursorChange(e),
      null,
      this._disposables,
    );
    this._tryLoadActiveEditor();
  }

  public loadDocument(doc: vscode.TextDocument) {
    if (doc.uri.scheme !== "file") return;
    if (doc.languageId !== "openfoam" && !this._isOFPath(doc.uri.fsPath)) return;
    this._loadFile(doc.uri.fsPath, doc.getText());
  }

  private _isOFPath(p: string) {
    return p.includes("/system/") || p.includes("/constant/") || /\/\d+(\.\d+)?\//.test(p);
  }

  private _tryLoadActiveEditor() {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const doc = ed.document;
    if (doc.languageId === "openfoam" || this._isOFPath(doc.uri.fsPath)) {
      this._loadFile(doc.uri.fsPath, doc.getText());
    }
  }

  private _loadFile(filePath: string, source: string) {
    this._currentFilePath = filePath;
    try {
      this._tree = parseOpenFOAM(source);
      this._nodeMap = buildNodeMap(this._tree);
    } catch {
      this._tree = undefined;
      this._nodeMap = new Map();
    }
    this._panel.webview.postMessage({
      command: "treeData",
      tree: this._tree,
      filePath,
      fileName: path.basename(filePath),
      ...this._discoverWorkspace(),
    });
  }

  private _discoverWorkspace() {
    const roots = vscode.workspace.workspaceFolders;
    if (!roots) return { dirs: [], filesByDir: {} };
    const root = roots[0].uri.fsPath;
    const known = ["system", "constant"];
    try {
      fs.readdirSync(root).forEach((e) => {
        if (/^\d+(\.\d+)?$/.test(e) && fs.statSync(path.join(root, e)).isDirectory())
          known.unshift(e);
      });
    } catch { /* */ }
    const dirs: { label: string; path: string }[] = [];
    const filesByDir: Record<string, { name: string; path: string }[]> = {};
    for (const d of known) {
      const dp = path.join(root, d);
      if (!fs.existsSync(dp)) continue;
      dirs.push({ label: d + "/", path: dp });
      try {
        filesByDir[dp] = fs.readdirSync(dp)
          .filter((f) => fs.statSync(path.join(dp, f)).isFile() && !f.startsWith("."))
          .map((f) => ({ name: f, path: path.join(dp, f) }));
      } catch { filesByDir[dp] = []; }
    }
    return { dirs, filesByDir };
  }

  private _onCursorChange(e: vscode.TextEditorSelectionChangeEvent) {
    if (!this._tree) return;
    const doc = e.textEditor.document;
    if (doc.uri.fsPath !== this._currentFilePath && !this._isOFPath(doc.uri.fsPath)) return;
    const line = e.selections[0].active.line;
    const node = findNodeAtLine(this._tree, line);
    if (node && node.id !== "root") {
      this._panel.webview.postMessage({ command: "highlightNode", nodeId: node.id });
    }
  }

  private async _handleMessage(msg: any) {
    switch (msg.command) {
      case "jumpToLine": await this._jumpToLine(msg.line); break;
      case "saveParam": await this._saveParam(msg.filePath, msg.line, msg.value); break;
      case "saveFile": await this._saveCurrentFile(); break;
      case "loadFile":
        try { this._loadFile(msg.filePath, fs.readFileSync(msg.filePath, "utf-8")); }
        catch { /* */ }
        break;
      case "requestGeoData": {
        const resolved = this._resolveGeomPath(msg.value);
        if (!resolved) break;
        try {
          const buf = fs.readFileSync(resolved);
          const header = buf.slice(0, 6).toString("ascii").toLowerCase();
          const isBinary = header !== "solid ";
          this._panel.webview.postMessage({
            command: "geoDataReady",
            canvasId: msg.canvasId,
            dataBase64: buf.toString("base64"),
            isBinary,
          });
        } catch { /* unreadable */ }
        break;
      }
      case "openGeoFromThumb": {
        const resolved = this._resolveGeomPath(msg.value);
        if (resolved) this.previewGeometry(resolved);
        break;
      }
    }
  }

  private _resolveGeomPath(value: string): string | null {
    if (!this._currentFilePath) return null;
    const name = path.basename(value);
    let caseRoot: string | null = null;
    let dir = path.dirname(this._currentFilePath);
    for (let i = 0; i < 12; i++) {
      if (
        fs.existsSync(path.join(dir, "system", "controlDict")) ||
        fs.existsSync(path.join(dir, "system", "fvSchemes"))
      ) { caseRoot = dir; break; }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (!caseRoot) return null;
    const candidates = [
      path.join(caseRoot, value),
      path.join(caseRoot, "constant", "triSurface", name),
      path.join(caseRoot, "constant", "geometry", name),
      path.join(caseRoot, "constant", name),
    ];
    return candidates.find(c => fs.existsSync(c)) ?? null;
  }

  /** Load an STL/OBJ file into the inline 3D viewer. Called from extension.ts command. */
  public previewGeometry(filePath: string) {
    this._panel.reveal(vscode.ViewColumn.Beside, true);
    try {
      const buf = fs.readFileSync(filePath);
      const headerStr = buf.slice(0, 6).toString('ascii').toLowerCase();
      const isBinary = headerStr !== 'solid ';
      // Send as base64 so we can handle both ASCII and binary without encoding issues
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

  private async _saveCurrentFile() {
    if (!this._currentFilePath) return;
    try {
      const doc = await vscode.workspace.openTextDocument(this._currentFilePath);
      await doc.save();
    } catch { /* */ }
  }

  private async _jumpToLine(line: number) {
    if (!this._currentFilePath) return;
    try {
      const doc = await vscode.workspace.openTextDocument(this._currentFilePath);
      const ed = await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.One, preserveFocus: true,
      });
      const pos = new vscode.Position(line, 0);
      ed.selection = new vscode.Selection(pos, pos);
      ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    } catch { /* */ }
  }

  private async _saveParam(filePath: string, line: number, value: string) {
    try {
      const doc = await vscode.workspace.openTextDocument(filePath);
      const m = doc.lineAt(line).text.match(/^(\s*\w[\w.]*\s+)(.+?)(\s*;)$/);
      if (!m) return;
      const edit = new vscode.WorkspaceEdit();
      edit.replace(
        doc.uri,
        new vscode.Range(new vscode.Position(line, m[1].length),
          new vscode.Position(line, m[1].length + m[2].length)),
        value,
      );
      await vscode.workspace.applyEdit(edit);
    } catch { /* */ }
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
<title>∇</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

body{
  font-family:-apple-system,'Segoe UI',system-ui,sans-serif;
  background:var(--vscode-editor-background);
  color:var(--vscode-editor-foreground);
  height:100vh;display:flex;flex-direction:column;overflow:hidden;
  font-size:11px;
}

/* ── Nav ── */
#nav{
  display:flex;flex-direction:column;flex-shrink:0;
  background:var(--vscode-sideBar-background,var(--vscode-editor-background));
  border-bottom:1px solid var(--vscode-panel-border,var(--vscode-editorWidget-border,transparent));
}
#dir-tabs{
  display:flex;align-items:stretch;height:26px;
  border-bottom:1px solid var(--vscode-panel-border,transparent);
  overflow-x:auto;overflow-y:hidden;
}
#dir-tabs::-webkit-scrollbar{display:none;}
.dir-tab{
  padding:0 14px;border:none;background:transparent;
  color:var(--vscode-tab-inactiveForeground,#888);
  font-size:10px;font-family:inherit;letter-spacing:.04em;
  cursor:pointer;border-bottom:2px solid transparent;
  transition:color .15s,border-color .15s;white-space:nowrap;flex-shrink:0;
}
.dir-tab:hover{color:var(--vscode-editor-foreground);}
.dir-tab.active{color:var(--vscode-tab-activeForeground,var(--vscode-editor-foreground));border-bottom-color:var(--vscode-focusBorder);}
#chips-scroll{overflow-x:auto;overflow-y:hidden;}
#chips-scroll::-webkit-scrollbar{height:2px;}
#chips-scroll::-webkit-scrollbar-thumb{background:var(--vscode-scrollbarSlider-background,#555);}
#file-chips{display:flex;align-items:center;gap:5px;padding:5px 10px;white-space:nowrap;min-height:30px;}
.file-chip{
  padding:3px 12px;border-radius:20px;
  font-size:10px;font-family:inherit;letter-spacing:.02em;
  background:transparent;
  border:1px solid var(--vscode-widget-border,var(--vscode-panel-border,transparent));
  color:var(--vscode-tab-inactiveForeground,#888);
  cursor:pointer;flex-shrink:0;transition:all .15s;
}
.file-chip:hover{border-color:var(--vscode-focusBorder);color:var(--vscode-editor-foreground);}
.file-chip.active{border-color:var(--vscode-focusBorder);color:var(--vscode-tab-activeForeground,var(--vscode-editor-foreground));background:var(--vscode-list-activeSelectionBackground,transparent);}

/* ── Canvas ── */
#main-split{flex:1;display:flex;flex-direction:column;overflow:hidden;}
#wrap{flex:1;overflow:auto;background:var(--vscode-editor-background);}
#wrap::-webkit-scrollbar{width:5px;height:5px;}
#wrap::-webkit-scrollbar-track{background:transparent;}
#wrap::-webkit-scrollbar-thumb{background:var(--vscode-scrollbarSlider-background,#555);border-radius:3px;}
#canvas{position:relative;}
#canvas svg{position:absolute;top:0;left:0;pointer-events:none;overflow:visible;}

/* ── Pill ── */
.pill{
  position:absolute;display:flex;align-items:center;gap:4px;
  padding:4px 12px;border-radius:20px;white-space:nowrap;
  background:var(--vscode-editorWidget-background,var(--vscode-editor-background));
  border:1px solid var(--vscode-widget-border,var(--vscode-panel-border,transparent));
  color:var(--vscode-editor-foreground);
  font-size:10px;font-family:inherit;cursor:pointer;user-select:none;
  transition:border-color .15s,background .15s;
}
.pill:hover{border-color:var(--vscode-focusBorder);background:var(--vscode-list-hoverBackground,var(--vscode-editorWidget-background));}
.pill.highlighted{border-color:var(--vscode-focusBorder);background:var(--vscode-list-activeSelectionBackground,transparent);}
.arr{font-size:7px;color:var(--vscode-descriptionForeground,#888);}
.cnt{color:var(--vscode-descriptionForeground,#888);font-size:8px;background:var(--vscode-badge-background,rgba(128,128,128,.2));border-radius:6px;padding:0 5px;margin-left:auto;}

/* ── Param card ── */
.card{
  position:absolute;
  background:var(--vscode-editorWidget-background,var(--vscode-editor-background));
  border:1px solid var(--vscode-widget-border,var(--vscode-panel-border,transparent));
  border-radius:6px;padding:6px 10px;
  transition:border-color .15s;
}
.card:hover{border-color:var(--vscode-focusBorder);}
.card.highlighted{border-color:var(--vscode-focusBorder);}
.card-grid{display:grid;grid-template-columns:max-content 6px minmax(0,1fr);align-items:center;row-gap:3px;}
.ck{color:var(--vscode-descriptionForeground,#888);cursor:pointer;white-space:nowrap;font-size:10px;line-height:1.8;font-family:inherit;transition:color .1s;}
.ck:hover{color:var(--vscode-editor-foreground);}
.cs{color:var(--vscode-editorLineNumber-foreground,#555);font-size:10px;}
.cv{display:flex;align-items:center;min-width:0;}

/* ── Inputs ── */
.vnum,.vstr,.vref,.vvec{
  background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,transparent);
  border-radius:3px;padding:2px 6px;font-size:10px;
  font-family:'Cascadia Code','Fira Code','Consolas',monospace;
  width:100%;outline:none;min-width:0;transition:border-color .12s;
}
.vnum{color:#f0a060;text-align:right;} .vstr{color:#4ecba0;} .vref{color:#9d80e8;} .vvec{color:#6ab4e8;}
.vnum:focus{border-color:#f0a060;} .vstr:focus{border-color:#4ecba0;} .vref:focus{border-color:#9d80e8;} .vvec:focus{border-color:#6ab4e8;}

/* ── Toggle ── */
.tog{position:relative;display:inline-block;width:26px;height:14px;flex-shrink:0;}
.tog input{opacity:0;width:0;height:0;position:absolute;}
.tog-t{position:absolute;inset:0;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,var(--vscode-widget-border,transparent));border-radius:14px;cursor:pointer;transition:background .15s,border-color .15s;}
.tog-t::before{content:'';position:absolute;width:10px;height:10px;left:1px;top:1px;background:var(--vscode-descriptionForeground,#888);border-radius:50%;transition:transform .15s,background .15s;opacity:.5;}
.tog input:checked+.tog-t{background:var(--vscode-list-activeSelectionBackground,transparent);border-color:var(--vscode-focusBorder);}
.tog input:checked+.tog-t::before{background:var(--vscode-focusBorder);transform:translateX(12px);opacity:1;}

/* ── Edges ── */
.edge{stroke-width:1.5;fill:none;opacity:0.85;}

/* ── Flat block cards ── */
.fcard{
  position:absolute;
  background:var(--vscode-editorWidget-background,var(--vscode-editor-background));
  border:1px solid var(--vscode-widget-border,var(--vscode-panel-border,rgba(128,128,128,.15)));
  border-radius:6px;overflow:hidden;transition:border-color .15s;
}
.fcard:hover{border-color:var(--vscode-focusBorder);}
.fcard.highlighted{border-color:var(--vscode-focusBorder);background:var(--vscode-list-activeSelectionBackground,transparent);}
.fhead{
  padding:4px 10px;display:flex;align-items:center;gap:4px;
  color:var(--vscode-editor-foreground);font-size:10px;font-family:inherit;
  cursor:pointer;user-select:none;white-space:nowrap;overflow:hidden;
  border-bottom:1px solid var(--vscode-widget-border,var(--vscode-panel-border,rgba(128,128,128,.1)));
}
.fhead.fhead-np{border-bottom:none;}
.fhead:hover{background:var(--vscode-list-hoverBackground,transparent);}

/* ── Empty ── */
#empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;color:var(--vscode-descriptionForeground,#555);font-size:10px;pointer-events:none;font-family:inherit;}
#empty span:first-child{font-size:22px;}

/* ── 3D Geo Panel (bottom split) ── */
#split-handle{display:none;height:5px;cursor:ns-resize;flex-shrink:0;background:var(--vscode-panel-border,#333);position:relative;}
#split-handle::after{content:'';position:absolute;inset:-3px 0;cursor:ns-resize;}
#split-handle:hover{background:var(--vscode-focusBorder,#007fd4);}
#geo-panel{display:none;flex-direction:column;flex-shrink:0;background:#111318;position:relative;height:300px;}
#geo-header{display:flex;align-items:center;padding:5px 10px;background:rgba(10,10,18,0.95);border-bottom:1px solid #2a2d35;flex-shrink:0;}
#geo-close{background:none;border:none;color:#aaa;font-size:14px;cursor:pointer;margin-right:8px;line-height:1;}
#geo-close:hover{color:#fff;}
#geo-label{font-size:10px;color:#aaa;flex:1;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#geo-canvas{flex:1;width:100%;display:block;cursor:grab;}
#geo-canvas:active{cursor:grabbing;}
#axes-canvas{position:absolute;bottom:8px;left:8px;pointer-events:none;width:80px;height:80px;}
/* ── Inline Geo Thumbnails ── */
.geo-ref{display:flex;flex-direction:column;gap:3px;}
.geo-thumb{width:150px;height:100px;border-radius:4px;display:block;background:#111318;object-fit:cover;cursor:pointer;border:1px solid rgba(77,184,255,0.2);}
.geo-thumb:hover{border-color:rgba(77,184,255,0.6);}
.geo-block-thumb{width:calc(100% - 20px);height:100px;border-radius:4px;display:block;background:#111318;object-fit:cover;cursor:pointer;border:1px solid rgba(77,184,255,0.2);margin:0 10px 8px;}
</style>
</head>
<body>
<div id="nav">
  <div id="dir-tabs"></div>
  <div id="chips-scroll"><div id="file-chips"></div></div>
</div>
<div id="main-split">
<div id="wrap"><div id="canvas">
  <div id="empty"><span>∇</span><span>open an openfoam file</span></div>
</div></div>
<div id="split-handle"></div>
<div id="geo-panel">
  <div id="geo-header">
    <button id="geo-close">✕</button>
    <span id="geo-label"></span>
  </div>
  <canvas id="geo-canvas"></canvas>
  <canvas id="axes-canvas" width="80" height="80"></canvas>
</div>
</div>

<script nonce="${nonce}">
const vscode=acquireVsCodeApi();

// ── Layout constants ──────────────────────────────────────────
const HEAD_H=24,PARAM_H=17,CPAD=10,CGAP=6;
const EDGE_PALETTE=['#4ec9b0','#c586c0','#ce9178','#9cdcfe','#dcdcaa','#f48771','#b5cea8','#d7ba7d'];
const CMIN=140,CMAX=280,CCHARW=6.8;
const PX=8,LEVEL_H=8,TOP_MARGIN=6;

// ── State ─────────────────────────────────────────────────────
let S={dirs:[],byDir:{},activeDir:'',activeFile:'',tree:null};

// ── Bus ──────────────────────────────────────────────────────
window.addEventListener('message',e=>{
  const m=e.data;
  if(m.command==='treeData'){
    S.dirs=m.dirs||[];S.byDir=m.filesByDir||{};
    S.activeFile=m.filePath;S.tree=m.tree;
    const d=S.dirs.find(d=>m.filePath&&m.filePath.startsWith(d.path));
    S.activeDir=d?d.path:(S.dirs[0]?S.dirs[0].path:'');
    renderNav();renderTree();
  } else if(m.command==='highlightNode'){
    hl(m.nodeId);
  }
});

// ── Nav ──────────────────────────────────────────────────────
function renderNav(){
  const dt=document.getElementById('dir-tabs');
  dt.innerHTML='';
  S.dirs.forEach(d=>{
    const b=mk('button','dir-tab'+(d.path===S.activeDir?' active':''));
    b.textContent=d.label;
    b.onclick=()=>{S.activeDir=d.path;renderNav();renderChips();};
    dt.appendChild(b);
  });
  renderChips();
}
function renderChips(){
  const fc=document.getElementById('file-chips');
  fc.innerHTML='';
  (S.byDir[S.activeDir]||[]).forEach(f=>{
    const b=mk('button','file-chip'+(f.path===S.activeFile?' active':''));
    b.textContent=f.name;
    b.onclick=()=>{S.activeFile=f.path;renderChips();vscode.postMessage({command:'loadFile',filePath:f.path});};
    fc.appendChild(b);
  });
}

// ── Node helpers ─────────────────────────────────────────────
function bkids(n){return(n.children||[]).filter(c=>c.type==='block');}
function pkids(n){return(n.children||[]).filter(c=>c.type==='param');}

// DFS collect: leaves first so children are placed adjacent to parent
function collectBlocks(n,depth,parentId,out){
  if(n.id!=='root')out.push({node:n,depth,parentId});
  const bk=bkids(n);
  const leaves=bk.filter(c=>bkids(c).length===0);
  const internal=bk.filter(c=>bkids(c).length>0);
  for(const c of [...leaves,...internal])collectBlocks(c,depth+1,n.id,out);
}

// Estimate card width from content (block name + longest param row)
const GEO_RE=/\.(stl|obj|vtk)$/i;
function isGeoVal(v){return GEO_RE.test(v||'');}
function estimateW(n){
  let w=n.name.length*CCHARW+48; // header pill
  if(isGeoVal(n.name))w=Math.max(w,175);
  for(const p of pkids(n)){
    const rw=(p.name.length+(p.rawValue||'').length)*CCHARW+CPAD*2+28;
    if(rw>w)w=rw;
    if(isGeoVal(p.rawValue))w=Math.max(w,175);
  }
  return Math.min(CMAX,Math.max(CMIN,Math.ceil(w)));
}

// ── Render tree ──────────────────────────────────────────────
function renderTree(){
  const canvas=document.getElementById('canvas');
  canvas.innerHTML='';
  if(!S.tree||(S.tree.children||[]).length===0){
    canvas.innerHTML='<div id="empty"><span>∇</span><span>no structure found</span></div>';
    return;
  }
  const all=[];
  for(const c of bkids(S.tree))collectBlocks(c,0,'root',all);
  if(!all.length){
    canvas.innerHTML='<div id="empty"><span>∇</span><span>no blocks found</span></div>';
    return;
  }

  // Per-card widths and cumulative x positions
  const cw=new Map(); // node.id → card width
  all.forEach(({node})=>cw.set(node.id,estimateW(node)));
  const xpos=new Map(); // node.id → left x
  let cx=PX;
  all.forEach(({node})=>{xpos.set(node.id,cx);cx+=cw.get(node.id)+CGAP;});

  const xLeft=id=>xpos.get(id)||PX;
  const xMid =id=>xLeft(id)+(cw.get(id)||CMIN)/2;

  // Card height: header + optional block thumbnail + param rows
  const GEO_EXTRA=103; // 100px thumb + 3px gap, beyond normal PARAM_H
  const BLOCK_THUMB_H=108; // 100px thumb + 8px bottom margin
  const cardH=n=>{
    const p=pkids(n);
    const blockGeo=isGeoVal(n.name)?BLOCK_THUMB_H:0;
    const extra=p.reduce((s,pm)=>s+(isGeoVal(pm.rawValue)?GEO_EXTRA:0),0);
    return HEAD_H+blockGeo+(p.length?CPAD+p.length*PARAM_H+extra+CPAD:0);
  };

  // Assign non-overlapping levels to connector bars (interval graph coloring)
  const conns=[];
  for(const {node} of all){
    const bk=bkids(node);
    if(!bk.length)continue;
    const px=xMid(node.id);
    const cxs=bk.map(c=>xMid(c.id));
    conns.push({node,bk,px,minX:Math.min(px,...cxs),maxX:Math.max(px,...cxs),level:0});
  }
  conns.sort((a,b)=>a.minX-b.minX);
  for(let i=0;i<conns.length;i++){
    const used=new Set();
    for(let j=0;j<i;j++){
      if(conns[j].minX<conns[i].maxX&&conns[j].maxX>conns[i].minX)used.add(conns[j].level);
    }
    let lv=0;while(used.has(lv))lv++;
    conns[i].level=lv;
  }
  const maxLevel=conns.reduce((m,c)=>Math.max(m,c.level),0);
  const PY=TOP_MARGIN+(maxLevel+1)*LEVEL_H;

  const maxH=all.reduce((m,{node})=>Math.max(m,cardH(node)),0);
  const totalW=cx-CGAP+PX;
  const totalH=PY+maxH+PX;
  canvas.style.width=totalW+'px';
  canvas.style.height=totalH+'px';

  // SVG for connectors
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.style.cssText='position:absolute;top:0;left:0;overflow:visible;pointer-events:none;';
  svg.setAttribute('width',totalW);svg.setAttribute('height',totalH);
  canvas.appendChild(svg);

  // Draw orthogonal connectors at their assigned level (no overlaps)
  for(let ci=0;ci<conns.length;ci++){
    const conn=conns[ci];
    const color=EDGE_PALETTE[ci%EDGE_PALETTE.length];
    const barY=PY-(conn.level+1)*LEVEL_H;
    sline(svg,conn.px,PY,conn.px,barY,color);
    sline(svg,conn.minX,barY,conn.maxX,barY,color);
    for(const c of conn.bk)sline(svg,xMid(c.id),barY,xMid(c.id),PY,color);
  }

  // Render flat block cards
  for(const {node} of all){
    const x=xLeft(node.id);
    const params=pkids(node);
    const bk=bkids(node);

    const el=mk('div','fcard');
    el.id='c_'+sid(node.id);
    el.style.cssText='left:'+x+'px;top:'+PY+'px;width:'+cw.get(node.id)+'px;';

    // Header row
    const head=mk('div','fhead'+(params.length?'':' fhead-np'));
    head.id='p_'+sid(node.id);
    head.dataset.line=node.line;
    if(bk.length||params.length){const a=mk('span','arr');a.textContent='▾';head.appendChild(a);}
    const lbl=mk('span','');lbl.textContent=node.name;head.appendChild(lbl);
    if(params.length){const c=mk('span','cnt');c.textContent=params.length;head.appendChild(c);}
    head.addEventListener('click',()=>vscode.postMessage({command:'jumpToLine',line:+head.dataset.line}));
    el.appendChild(head);

    // Inline 3D thumbnail when the block name is a geometry file
    if(isGeoVal(node.name)){
      const img=mk('img','geo-block-thumb');
      const gid='gt_'+Math.random().toString(36).slice(2,9);
      img.id=gid;
      img.title='Click to open full 3D viewer';
      img.addEventListener('click',e=>{e.stopPropagation();vscode.postMessage({command:'openGeoFromThumb',value:node.name});});
      el.appendChild(img);
      vscode.postMessage({command:'requestGeoData',value:node.name,canvasId:gid});
    }

    // Params grid
    if(params.length){
      const grid=mk('div','card-grid');
      grid.style.padding=CPAD+'px '+CPAD+'px';
      params.forEach(param=>{
        const k=mk('span','ck');k.textContent=param.name;
        const s=mk('span','cs');s.textContent=':';
        const v=mk('div','cv');v.appendChild(widget(param));
        k.onclick=()=>vscode.postMessage({command:'jumpToLine',line:param.line});
        grid.appendChild(k);grid.appendChild(s);grid.appendChild(v);
      });
      el.appendChild(grid);
    }
    canvas.appendChild(el);
  }
}

function sline(svg,x1,y1,x2,y2,color){
  const l=document.createElementNS('http://www.w3.org/2000/svg','line');
  l.setAttribute('x1',x1);l.setAttribute('y1',y1);
  l.setAttribute('x2',x2);l.setAttribute('y2',y2);
  l.setAttribute('class','edge');
  if(color)l.setAttribute('stroke',color);
  svg.appendChild(l);
}

// ── Widget ───────────────────────────────────────────────────
const BON=new Set(['true','yes','on']);
const TM={true:'false',false:'true',yes:'no',no:'yes',on:'off',off:'on'};
function widget(param){
  const raw=param.rawValue||'',vt=param.valueType;
  if(vt==='boolean'){
    const isOn=BON.has(raw.toLowerCase());
    const label=mk('label','tog');
    const cb=mk('input','');cb.type='checkbox';cb.checked=isOn;
    const t=mk('span','tog-t');
    label.appendChild(cb);label.appendChild(t);
    let cur=raw;
    cb.addEventListener('change',e=>{
      e.stopPropagation();
      const lo=cur.toLowerCase(),nl=TM[lo]||(BON.has(lo)?'false':'true');
      let nv=nl;
      if(cur===cur.toUpperCase())nv=nl.toUpperCase();
      else if(cur[0]===cur[0].toUpperCase())nv=nl[0].toUpperCase()+nl.slice(1);
      cur=nv;cb.checked=BON.has(nl);
      vscode.postMessage({command:'saveParam',filePath:S.activeFile,line:param.line,value:nv});
    });
    return label;
  }
  if(/\.(stl|obj|vtk)$/i.test(raw)){
    const wrap=mk('div','geo-ref');
    const inp=mk('input','vstr');inp.value=raw;inp.type='text';
    let cur=raw;
    inp.addEventListener('click',e=>e.stopPropagation());
    inp.addEventListener('blur',()=>{if(inp.value!==cur){cur=inp.value;vscode.postMessage({command:'saveParam',filePath:S.activeFile,line:param.line,value:cur});}});
    inp.addEventListener('keydown',e=>{if(e.key==='Enter')inp.blur();if(e.key==='Escape'){inp.value=cur;inp.blur();}});
    wrap.appendChild(inp);
    const img=mk('img','geo-thumb');
    const gid='gt_'+Math.random().toString(36).slice(2,9);
    img.id=gid;
    img.title='Click to open full 3D viewer';
    img.addEventListener('click',e=>{e.stopPropagation();vscode.postMessage({command:'openGeoFromThumb',value:raw});});
    wrap.appendChild(img);
    vscode.postMessage({command:'requestGeoData',value:raw,canvasId:gid});
    return wrap;
  }
  let cls='vstr';
  if(vt==='number')cls='vnum';
  if(vt==='reference')cls='vref';
  if(vt==='vector')cls='vvec';
  const inp=mk('input',cls);inp.value=raw;inp.type=vt==='number'?'number':'text';
  let cur=raw;
  inp.addEventListener('click',e=>e.stopPropagation());
  inp.addEventListener('blur',()=>{if(inp.value!==cur){cur=inp.value;vscode.postMessage({command:'saveParam',filePath:S.activeFile,line:param.line,value:cur});}});
  inp.addEventListener('keydown',e=>{if(e.key==='Enter')inp.blur();if(e.key==='Escape'){inp.value=cur;inp.blur();}});
  return inp;
}

// ── Cmd+S / Ctrl+S ──────────────────────────────────────────
document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&e.key==='s'){
    e.preventDefault();
    if(document.activeElement&&document.activeElement.tagName==='INPUT')document.activeElement.blur();
    vscode.postMessage({command:'saveFile'});
  }
});

// ── Highlight ────────────────────────────────────────────────
function hl(nodeId){
  document.querySelectorAll('.highlighted').forEach(e=>e.classList.remove('highlighted'));
  const s=sid(nodeId);
  const el=document.getElementById('c_'+s)||document.getElementById('p_'+s);
  if(el){el.classList.add('highlighted');el.scrollIntoView({behavior:'smooth',block:'nearest',inline:'nearest'});}
}

// ── Split panel resize ───────────────────────────────────────
{
  const sh=document.getElementById('split-handle');
  const gp=document.getElementById('geo-panel');
  let drag=false,sy=0,sh0=0;
  sh.addEventListener('mousedown',e=>{drag=true;sy=e.clientY;sh0=gp.clientHeight;e.preventDefault();});
  window.addEventListener('mousemove',e=>{
    if(!drag)return;
    const h=Math.max(120,Math.min(window.innerHeight-180,sh0+(sy-e.clientY)));
    gp.style.height=h+'px';
  });
  window.addEventListener('mouseup',()=>drag=false);
}

// ── Utils ────────────────────────────────────────────────────
function mk(tag,cls){const e=document.createElement(tag);if(cls)e.className=cls;return e;}
function sid(s){return String(s).replace(/[^a-zA-Z0-9_-]/g,'_');}
</script>

<script nonce="${nonce}" src="${geoViewerUri}"></script>
</body>
</html>`;
  }

  public dispose() {
    InspectorPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) this._disposables.pop()?.dispose();
  }
}

function getNonce() {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 32 }, () => c[Math.floor(Math.random() * c.length)]).join("");
}
