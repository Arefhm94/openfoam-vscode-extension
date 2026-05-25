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

    InspectorPanel.currentPanel = new InspectorPanel(panel, context);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    _context: vscode.ExtensionContext,
  ) {
    this._panel = panel;
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
      case "closeGeoViewer":
        this._panel.webview.postMessage({ command: "hideGeoViewer" });
        break;
    }
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
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}';">
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

/* ── 3D Geo Viewer ── */
#geo-overlay{display:none;position:fixed;inset:0;z-index:9000;flex-direction:column;background:rgba(0,0,0,0.88);}
#geo-header{display:flex;align-items:center;padding:6px 10px;background:rgba(10,10,18,0.95);border-bottom:1px solid #333;flex-shrink:0;}
#geo-close{background:none;border:none;color:#aaa;font-size:14px;cursor:pointer;margin-right:8px;line-height:1;}
#geo-close:hover{color:#fff;}
#geo-label{font-size:11px;color:#ccc;flex:1;font-family:inherit;}
#geo-canvas{flex:1;width:100%;display:block;cursor:grab;}
#geo-canvas:active{cursor:grabbing;}
</style>
</head>
<body>
<div id="geo-overlay">
  <div id="geo-header">
    <button id="geo-close">✕</button>
    <span id="geo-label"></span>
  </div>
  <canvas id="geo-canvas"></canvas>
</div>
<div id="nav">
  <div id="dir-tabs"></div>
  <div id="chips-scroll"><div id="file-chips"></div></div>
</div>
<div id="wrap"><div id="canvas">
  <div id="empty"><span>∇</span><span>open an openfoam file</span></div>
</div></div>

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
function estimateW(n){
  let w=n.name.length*CCHARW+48; // header pill
  for(const p of pkids(n)){
    const rw=(p.name.length+(p.rawValue||'').length)*CCHARW+CPAD*2+28;
    if(rw>w)w=rw;
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

  // Card height: header + param rows
  const cardH=n=>{
    const p=pkids(n);
    return HEAD_H+(p.length?CPAD+p.length*PARAM_H+CPAD:0);
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

// ── Utils ────────────────────────────────────────────────────
function mk(tag,cls){const e=document.createElement(tag);if(cls)e.className=cls;return e;}
function sid(s){return String(s).replace(/[^a-zA-Z0-9_-]/g,'_');}

// ── 3D Geometry Viewer (inline WebGL) ───────────────────────
(function(){
  const overlay=document.getElementById('geo-overlay');
  const canvas=document.getElementById('geo-canvas');
  const label=document.getElementById('geo-label');
  if(!overlay||!canvas||!label)return;

  let gl=null,prog=null,vBuf=null,nBuf=null,triCount=0;
  let rotX=0.4,rotY=0.3,zoom=1,dragging=false,lastX=0,lastY=0;
  let raf=null;

  document.getElementById('geo-close').addEventListener('click',()=>{
    overlay.style.display='none';
    cancelAnimationFrame(raf);
    vscode.postMessage({command:'closeGeoViewer'});
  });

  canvas.addEventListener('mousedown',e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;});
  window.addEventListener('mousemove',e=>{
    if(!dragging)return;
    rotY+=(e.clientX-lastX)*0.01;
    rotX+=(e.clientY-lastY)*0.01;
    lastX=e.clientX;lastY=e.clientY;
  });
  window.addEventListener('mouseup',()=>dragging=false);
  canvas.addEventListener('wheel',e=>{zoom*=e.deltaY>0?0.9:1.1;zoom=Math.max(0.1,Math.min(10,zoom));e.preventDefault();},{passive:false});

  function initGL(){
    gl=canvas.getContext('webgl')||canvas.getContext('experimental-webgl');
    if(!gl)return false;
    const vs=gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs,\`
      attribute vec3 aPos;
      attribute vec3 aNorm;
      uniform mat4 uMVP;
      uniform mat4 uModel;
      varying vec3 vNorm;
      void main(){
        vNorm=normalize((uModel*vec4(aNorm,0.0)).xyz);
        gl_Position=uMVP*vec4(aPos,1.0);
      }
    \`);
    gl.compileShader(vs);
    const fs_=gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs_,\`
      precision mediump float;
      varying vec3 vNorm;
      void main(){
        vec3 light=normalize(vec3(0.5,1.0,0.8));
        float d=max(dot(vNorm,light),0.0)*0.7+0.3;
        gl_FragColor=vec4(d*0.5,d*0.75,d,1.0);
      }
    \`);
    gl.compileShader(fs_);
    prog=gl.createProgram();
    gl.attachShader(prog,vs);gl.attachShader(prog,fs_);
    gl.linkProgram(prog);gl.useProgram(prog);
    vBuf=gl.createBuffer();nBuf=gl.createBuffer();
    gl.enable(gl.DEPTH_TEST);
    return true;
  }

  function mat4mul(a,b){
    const r=new Float32Array(16);
    for(let i=0;i<4;i++)for(let j=0;j<4;j++){
      let s=0;for(let k=0;k<4;k++)s+=a[i*4+k]*b[k*4+j];r[i*4+j]=s;
    }return r;
  }
  function mat4persp(fov,asp,n,f){
    const t=Math.tan(fov/2);
    return new Float32Array([
      1/(asp*t),0,0,0,  0,1/t,0,0,
      0,0,-(f+n)/(f-n),-1,  0,0,-2*f*n/(f-n),0
    ]);
  }
  function mat4rotX(a){const c=Math.cos(a),s=Math.sin(a);return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]);}
  function mat4rotY(a){const c=Math.cos(a),s=Math.sin(a);return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]);}
  function mat4scale(sx,sy,sz){return new Float32Array([sx,0,0,0, 0,sy,0,0, 0,0,sz,0, 0,0,0,1]);}
  function mat4trans(tx,ty,tz){return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, tx,ty,tz,1]);}

  function render(verts,norms){
    canvas.width=canvas.clientWidth;canvas.height=canvas.clientHeight;
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.clearColor(0.07,0.07,0.1,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);

    const asp=canvas.width/canvas.height;
    const P=mat4persp(Math.PI/4,asp,0.01,100);
    const T=mat4trans(0,0,-3/zoom);
    const RX=mat4rotX(rotX),RY=mat4rotY(rotY);
    const M=mat4mul(RY,RX);
    const MVP=mat4mul(P,mat4mul(T,M));

    const aPos=gl.getAttribLocation(prog,'aPos');
    const aNorm=gl.getAttribLocation(prog,'aNorm');
    gl.bindBuffer(gl.ARRAY_BUFFER,vBuf);
    gl.bufferData(gl.ARRAY_BUFFER,verts,gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aPos);gl.vertexAttribPointer(aPos,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,nBuf);
    gl.bufferData(gl.ARRAY_BUFFER,norms,gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aNorm);gl.vertexAttribPointer(aNorm,3,gl.FLOAT,false,0,0);

    gl.uniformMatrix4fv(gl.getUniformLocation(prog,'uMVP'),false,MVP);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog,'uModel'),false,M);
    gl.drawArrays(gl.TRIANGLES,0,verts.length/3);
  }

  function animate(verts,norms){
    raf=requestAnimationFrame(()=>animate(verts,norms));
    render(verts,norms);
  }

  function b64ToBytes(b64){
    const bin=atob(b64);const u=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u;
  }

  function parseSTLBinary(buf){
    const view=new DataView(buf.buffer||buf);
    const n=view.getUint32(80,true);
    const verts=new Float32Array(n*9),norms=new Float32Array(n*9);
    let xMin=Infinity,xMax=-Infinity,yMin=Infinity,yMax=-Infinity,zMin=Infinity,zMax=-Infinity;
    for(let i=0;i<n;i++){
      const base=84+i*50;
      const nx=view.getFloat32(base,true),ny=view.getFloat32(base+4,true),nz=view.getFloat32(base+8,true);
      for(let v=0;v<3;v++){
        const vb=base+12+v*12;
        const x=view.getFloat32(vb,true),y=view.getFloat32(vb+4,true),z=view.getFloat32(vb+8,true);
        const idx=(i*3+v)*3;
        verts[idx]=x;verts[idx+1]=y;verts[idx+2]=z;
        norms[idx]=nx;norms[idx+1]=ny;norms[idx+2]=nz;
        if(x<xMin)xMin=x;if(x>xMax)xMax=x;
        if(y<yMin)yMin=y;if(y>yMax)yMax=y;
        if(z<zMin)zMin=z;if(z>zMax)zMax=z;
      }
    }
    // Centre and normalise
    const cx=(xMin+xMax)/2,cy=(yMin+yMax)/2,cz=(zMin+zMax)/2;
    const sc=2/Math.max(xMax-xMin,yMax-yMin,zMax-zMin,0.001);
    for(let i=0;i<verts.length;i+=3){verts[i]=(verts[i]-cx)*sc;verts[i+1]=(verts[i+1]-cy)*sc;verts[i+2]=(verts[i+2]-cz)*sc;}
    return {verts,norms,triCount:n};
  }

  function parseSTLAscii(text){
    const lines=text.split('\\n');
    const pos=[],nrm=[];
    let cn=[0,0,1];
    for(const ln of lines){
      const t=ln.trim();
      if(t.startsWith('facet normal')){const p=t.split(/\\s+/);cn=[+p[2],+p[3],+p[4]];}
      else if(t.startsWith('vertex ')){const p=t.split(/\\s+/);pos.push(+p[1],+p[2],+p[3]);nrm.push(...cn);}
    }
    if(!pos.length)return null;
    let xMin=Infinity,xMax=-Infinity,yMin=Infinity,yMax=-Infinity,zMin=Infinity,zMax=-Infinity;
    for(let i=0;i<pos.length;i+=3){
      if(pos[i]<xMin)xMin=pos[i];if(pos[i]>xMax)xMax=pos[i];
      if(pos[i+1]<yMin)yMin=pos[i+1];if(pos[i+1]>yMax)yMax=pos[i+1];
      if(pos[i+2]<zMin)zMin=pos[i+2];if(pos[i+2]>zMax)zMax=pos[i+2];
    }
    const cx=(xMin+xMax)/2,cy=(yMin+yMax)/2,cz=(zMin+zMax)/2;
    const sc=2/Math.max(xMax-xMin,yMax-yMin,zMax-zMin,0.001);
    const verts=new Float32Array(pos.length);
    for(let i=0;i<pos.length;i+=3){verts[i]=(pos[i]-cx)*sc;verts[i+1]=(pos[i+1]-cy)*sc;verts[i+2]=(pos[i+2]-cz)*sc;}
    return {verts,norms:new Float32Array(nrm),triCount:pos.length/9};
  }

  window.addEventListener('message',ev=>{
    const msg=ev.data;
    if(msg.command==='previewGeometry'){
      overlay.style.display='flex';
      label.textContent=msg.fileName||'';
      if(!gl&&!initGL()){label.textContent='WebGL not supported';return;}
      cancelAnimationFrame(raf);
      const bytes=b64ToBytes(msg.dataBase64);
      let parsed=null;
      if(msg.isBinary){
        parsed=parseSTLBinary(bytes);
      } else {
        const text=new TextDecoder().decode(bytes);
        parsed=parseSTLAscii(text);
      }
      if(!parsed){label.textContent='Could not parse geometry';return;}
      label.textContent=\`\${msg.fileName} — \${parsed.triCount.toLocaleString()} triangles  |  drag to rotate  |  scroll to zoom\`;
      animate(parsed.verts,parsed.norms);
    }
    if(msg.command==='hideGeoViewer'){
      overlay.style.display='none';
      cancelAnimationFrame(raf);
    }
  });
})();
</script>
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
