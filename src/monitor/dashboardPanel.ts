import * as path from "path";
import * as vscode from "vscode";
import { LogTail, findLikelyLogFile } from "./logTail";
import { ResidualSample, CourantSample, ExecutionTimeSample, finalResidualMagnitude } from "./residualLog";
import { classifyTrend, Trend } from "./convergence";

const POLL_MS = 1000;

interface FieldHistory {
  key: string; // "solver:field"
  solver: string;
  field: string;
  points: { time: number; value: number }[];
}

/**
 * A live residual/run dashboard — one reusable webview panel (same
 * singleton pattern as `docs/docPanel.ts`) that tails a solver log with
 * `LogTail` and charts each field's final residual on a log scale, plus
 * an info strip (time step, Courant, ExecutionTime) and a per-field
 * converging/diverging/stalled badge from `classifyTrend`.
 */
let panel: vscode.WebviewPanel | undefined;
let tail: LogTail | undefined;
let pollHandle: ReturnType<typeof setInterval> | undefined;
let histories = new Map<string, FieldHistory>();
// The webview's script needs a tick to load and attach its `message`
// listener after `webview.html` is (re)assigned — posting before that
// silently drops the message (no queueing). So the *first* read (which,
// for an already-finished run, is the entire log — there's no "new
// growth" to fall back on afterwards) waits for the webview's own
// `{type:'ready'}` handshake instead of racing it.
let pendingStart: (() => void) | null = null;

export function showDashboard(logPath: string): void {
  if (!panel) {
    panel = vscode.window.createWebviewPanel(
      "openfoamRunDashboard",
      "OpenFOAM Run",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    panel.onDidDispose(() => {
      panel = undefined;
      pendingStart = null;
      stopPolling();
    });
    panel.webview.onDidReceiveMessage(async (msg: { type: string }) => {
      if (msg.type === "ready" && pendingStart) {
        const start = pendingStart;
        pendingStart = null;
        start();
      } else if (msg.type === "openFile") {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          title: "Select a solver log file to monitor",
        });
        if (picked?.[0]) showDashboard(picked[0].fsPath);
      }
    });
  }
  panel.title = `Run: ${path.basename(path.dirname(logPath)) || path.basename(logPath)}`;
  histories = new Map();
  tail = new LogTail(logPath);
  stopPolling();
  pendingStart = () => startPolling(logPath);
  panel.webview.html = shellHtml();
  panel.reveal(vscode.ViewColumn.Beside, true);
}

function startPolling(logPath: string): void {
  stopPolling();
  let firstTick = true;
  const tick = (): void => {
    if (!panel || !tail) return;
    const parsed = tail.poll();
    if (!parsed) {
      // File shrank/rotated/vanished — restart from scratch once it's back.
      tail = new LogTail(logPath);
      histories = new Map();
      return;
    }
    const gotAnything = parsed.residuals.length || parsed.courant.length || parsed.executionTimes.length;
    if (!gotAnything) {
      // The first read is the *entire* existing log (a finished run has no
      // further growth to fall back on) — if that came up empty, say so
      // instead of leaving the panel on "Reading log…" forever.
      if (firstTick) panel.webview.postMessage({ type: "noData" });
      firstTick = false;
      return;
    }
    firstTick = false;

    const residualUpdates = parsed.residuals.map(r => absorbResidual(r));
    for (const c of parsed.courant) postCourant(c);
    for (const e of parsed.executionTimes) postExecutionTime(e);
    if (residualUpdates.length) {
      panel.webview.postMessage({ type: "residuals", updates: residualUpdates });
    }
    if (parsed.finished) {
      panel.webview.postMessage({ type: "finished" });
    }
  };
  tick();
  pollHandle = setInterval(tick, POLL_MS);
}

function stopPolling(): void {
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = undefined;
}

interface ResidualUpdate {
  key: string;
  solver: string;
  field: string;
  time: number;
  value: number;
  iterations: number;
  trend: Trend;
}

function absorbResidual(r: ResidualSample): ResidualUpdate {
  const key = `${r.solver}:${r.field}`;
  let h = histories.get(key);
  if (!h) {
    h = { key, solver: r.solver, field: r.field, points: [] };
    histories.set(key, h);
  }
  const value = finalResidualMagnitude(r);
  h.points.push({ time: r.time, value });
  return {
    key,
    solver: r.solver,
    field: r.field,
    time: r.time,
    value,
    iterations: r.iterations,
    trend: classifyTrend(h.points),
  };
}

function postCourant(c: CourantSample): void {
  panel?.webview.postMessage({ type: "courant", ...c });
}
function postExecutionTime(e: ExecutionTimeSample): void {
  panel?.webview.postMessage({ type: "executionTime", ...e });
}

/** Auto-detects the likely log file under `caseRoot` and opens the
 *  dashboard for it, or asks the user to pick one manually if none is
 *  found. */
export async function openDashboardForCase(caseRoot: string): Promise<void> {
  let logPath = findLikelyLogFile(caseRoot);
  if (!logPath) {
    const picked = await vscode.window.showOpenDialog({
      defaultUri: vscode.Uri.file(caseRoot),
      canSelectMany: false,
      title: "Select a solver log file to monitor",
    });
    logPath = picked?.[0]?.fsPath ?? null;
  }
  if (!logPath) {
    vscode.window.showInformationMessage("OpenFOAM: no log file found to monitor.");
    return;
  }
  showDashboard(logPath);
}

function shellHtml(): string {
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground);
         background: var(--vscode-editor-background); margin: 0; padding: 10px 14px; }
  #toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
  #info { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px;
          color: var(--vscode-descriptionForeground); flex: 1 1 auto; }
  #info b { color: var(--vscode-foreground); }
  button { font: inherit; font-size: 11px; padding: 3px 10px; cursor: pointer; border-radius: 3px;
           border: 1px solid var(--vscode-button-border, transparent);
           background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  #mode-group { display: inline-flex; border-radius: 3px; overflow: hidden;
                border: 1px solid var(--vscode-button-border, var(--vscode-panel-border)); }
  #mode-group button { border: none; border-radius: 0; }
  #mode-group button + button { border-left: 1px solid var(--vscode-panel-border); }
  #mode-group button.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  #legend { display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; margin-bottom: 6px; }
  #legend span.item { cursor: pointer; user-select: none; padding: 1px 4px; border-radius: 3px; }
  #legend span.item:hover { background: var(--vscode-list-hoverBackground); }
  #legend span.item.hidden-series { opacity: 0.4; text-decoration: line-through; }
  .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
  .badge { font-size: 10px; padding: 0 5px; border-radius: 3px; margin-left: 5px; }
  .badge.converging { background: #2e7d3222; color: #4caf50; }
  .badge.diverging { background: #c6282822; color: #f44336; }
  .badge.stalled { background: #f9a82522; color: #f9a825; }
  .badge.unknown { background: transparent; color: var(--vscode-descriptionForeground); }
  #chart-wrap { position: relative; }
  canvas { width: 100%; height: 340px; background: var(--vscode-textCodeBlock-background); border-radius: 4px; }
  canvas.mode-zoom { cursor: crosshair; }
  canvas.mode-pan { cursor: grab; }
  canvas.mode-pan:active { cursor: grabbing; }
  #selbox { position: absolute; border: 1px solid #4db8ff; background: rgba(77,184,255,0.15);
            display: none; pointer-events: none; }
  #tooltip { position: absolute; pointer-events: none; background: var(--vscode-editorHoverWidget-background);
             border: 1px solid var(--vscode-editorHoverWidget-border); border-radius: 4px; padding: 4px 8px;
             font-size: 11px; font-family: var(--vscode-editor-font-family, monospace); white-space: nowrap;
             display: none; z-index: 10; }
  #status { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 8px; }
  #summary { display: flex; gap: 18px; margin-top: 8px; flex-wrap: wrap; align-items: flex-start; }
  #summary-stats { font-size: 11px; color: var(--vscode-descriptionForeground); }
  #summary-table table { border-collapse: collapse; font-size: 11px; }
  #summary-table th, #summary-table td { text-align: left; padding: 1px 10px 1px 0; }
  #summary-table th { color: var(--vscode-descriptionForeground); font-weight: normal; }
  #hint { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 6px; }
</style></head>
<body>
  <div id="toolbar">
    <div id="info">
      <span>Time: <b id="i-time">–</b></span>
      <span>Courant (mean/max): <b id="i-courant">–</b></span>
      <span>ExecutionTime: <b id="i-exec">–</b></span>
      <span>Wall clock: <b id="i-clock">–</b></span>
    </div>
    <span id="mode-group">
      <button id="mode-zoom-btn" class="active" title="Drag a box to zoom into it">🔍 Box Zoom</button>
      <button id="mode-pan-btn" title="Drag to pan">✋ Pan</button>
    </span>
    <button id="zoom-in-btn" title="Zoom in">➕</button>
    <button id="zoom-out-btn" title="Zoom out">➖</button>
    <button id="autoscale-btn" title="Fit all data">⟲ Autoscale</button>
    <button id="open-btn">Open Log File…</button>
  </div>
  <div id="legend"></div>
  <div id="chart-wrap">
    <canvas id="chart" width="900" height="340" class="mode-zoom"></canvas>
    <div id="selbox"></div>
    <div id="tooltip"></div>
  </div>
  <div id="status">Reading log…</div>
  <div id="summary">
    <div id="summary-stats"></div>
    <div id="summary-table"></div>
  </div>
  <div id="hint">Drag a box to zoom (or scroll) · Pan mode to drag the view · double-click/Autoscale to fit · click a legend entry to toggle it</div>

<script nonce="${nonce}">
  const vs = acquireVsCodeApi();
  const canvas = document.getElementById('chart');
  const ctx = canvas.getContext('2d');
  const legendEl = document.getElementById('legend');
  const statusEl = document.getElementById('status');
  const tooltipEl = document.getElementById('tooltip');
  const selBoxEl = document.getElementById('selbox');
  const series = new Map(); // key -> { color, points: [{time, value}], trend, hidden }
  const palette = ['#4db8ff','#ff8a4d','#4dff9e','#ff4d94','#c74dff','#ffe14d','#4dfff2','#ff4d4d'];
  let colorIdx = 0;
  let viewMin = null, viewMax = null;   // time window; null = auto-fit to full data range
  let valMin = null, valMax = null;     // value (linear, not log) window; null = auto-fit to visible data
  let mode = 'zoom';                    // 'zoom' (drag = box-zoom) | 'pan' (drag = pan), Plotly-style mode bar
  let layout = null;                    // set by draw(): screen<->time/value mapping for the last frame
  let execHistory = [];                 // [{time, clockTime}] — for the "avg cost per iteration" stat

  function colorFor(key) {
    let s = series.get(key);
    if (!s) {
      s = { color: palette[colorIdx++ % palette.length], points: [], trend: 'unknown', hidden: false };
      series.set(key, s);
    }
    return s;
  }

  function dataDomain() {
    let tMin = Infinity, tMax = -Infinity;
    for (const s of series.values()) {
      for (const p of s.points) { if (p.time < tMin) tMin = p.time; if (p.time > tMax) tMax = p.time; }
    }
    if (!isFinite(tMin)) return [0, 1];
    if (tMin === tMax) return [tMin - 1, tMax + 1];
    return [tMin, tMax];
  }

  function renderLegend() {
    legendEl.innerHTML = '';
    for (const [key, s] of series) {
      const span = document.createElement('span');
      span.className = 'item' + (s.hidden ? ' hidden-series' : '');
      span.innerHTML = '<span class="swatch" style="background:' + s.color + '"></span>' + key +
        '<span class="badge ' + s.trend + '">' + s.trend + '</span>';
      span.title = 'Click to ' + (s.hidden ? 'show' : 'hide');
      span.addEventListener('click', () => { s.hidden = !s.hidden; renderLegend(); draw(); });
      legendEl.appendChild(span);
    }
  }

  function renderSummary() {
    const rows = [];
    for (const [key, s] of series) {
      if (!s.points.length) continue;
      const last = s.points[s.points.length - 1];
      rows.push(
        '<tr><td style="color:' + s.color + '">' + key + '</td><td>' + last.value.toExponential(3) +
        '</td><td><span class="badge ' + s.trend + '">' + s.trend + '</span></td></tr>',
      );
    }
    document.getElementById('summary-table').innerHTML = rows.length
      ? '<table><thead><tr><th>Field</th><th>Last residual</th><th>Trend</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>'
      : '';

    const [dMin, dMax] = dataDomain();
    const parts = [];
    if (series.size) {
      parts.push('Time steps spanned: <b>' + (isFinite(dMin) ? (dMax - dMin).toPrecision(5) : '–') + '</b>');
      parts.push('Fields tracked: <b>' + series.size + '</b>');
    }
    if (execHistory.length >= 2) {
      const first = execHistory[0], last = execHistory[execHistory.length - 1];
      const dTime = last.time - first.time, dClock = last.clockTime - first.clockTime;
      if (dTime > 0 && dClock > 0) parts.push('Avg cost: <b>' + (dClock / dTime).toPrecision(3) + ' s/iteration</b>');
    }
    document.getElementById('summary-stats').innerHTML = parts.join(' &nbsp;·&nbsp; ');
  }

  function draw() {
    const w = canvas.width = canvas.clientWidth * devicePixelRatio;
    const h = canvas.height = 340 * devicePixelRatio;
    ctx.clearRect(0, 0, w, h);
    const pad = 36 * devicePixelRatio;

    const visible = [...series.values()].filter(s => !s.hidden && s.points.length);
    if (!visible.length) { layout = null; return; }

    const [dataMin, dataMax] = dataDomain();
    const tMin = viewMin ?? dataMin, tMax = viewMax ?? dataMax;

    let yMin, yMax;
    if (valMin != null && valMax != null) {
      yMin = Math.log10(Math.max(valMin, 1e-300));
      yMax = Math.log10(Math.max(valMax, 1e-300));
    } else {
      const inView = visible.flatMap(s => s.points.filter(p => p.time >= tMin && p.time <= tMax));
      const forRange = inView.length ? inView : visible.flatMap(s => s.points);
      const logs = forRange.map(p => Math.log10(Math.max(Math.abs(p.value), 1e-300)));
      yMin = Math.min(...logs); yMax = Math.max(...logs);
    }
    if (yMin === yMax) { yMin -= 1; yMax += 1; }

    const plotW = w - pad * 1.4, plotH = h - pad * 1.6;
    const x = t => pad + (tMax === tMin ? 0 : (t - tMin) / (tMax - tMin)) * plotW;
    const y = v => h - pad - ((Math.log10(Math.max(Math.abs(v), 1e-300)) - yMin) / (yMax - yMin)) * plotH;
    layout = { pad, plotW, plotH, tMin, tMax, yMin, yMax, h, w };

    // axes
    ctx.strokeStyle = 'rgba(128,128,128,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, pad * 0.5); ctx.lineTo(pad, h - pad); ctx.lineTo(w - pad * 0.4, h - pad); ctx.stroke();
    ctx.fillStyle = 'rgba(160,160,160,0.9)';
    ctx.font = (10 * devicePixelRatio) + 'px monospace';
    ctx.fillText('1e' + yMax.toFixed(0), 2, pad);
    ctx.fillText('1e' + yMin.toFixed(0), 2, h - pad);
    ctx.fillText(tMin.toPrecision(5), pad, h - 4);
    ctx.textAlign = 'right';
    ctx.fillText(tMax.toPrecision(5), w - pad * 0.4, h - 4);
    ctx.textAlign = 'left';

    for (const s of visible) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5 * devicePixelRatio;
      ctx.beginPath();
      let started = false;
      for (const p of s.points) {
        const px = x(p.time), py = y(p.value);
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }

  function screenToTime(clientX) {
    if (!layout) return null;
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * devicePixelRatio;
    const frac = (px - layout.pad) / layout.plotW;
    return layout.tMin + frac * (layout.tMax - layout.tMin);
  }

  function screenToValue(clientY) {
    if (!layout) return null;
    const rect = canvas.getBoundingClientRect();
    const py = (clientY - rect.top) * devicePixelRatio;
    const frac = (layout.h - layout.pad - py) / layout.plotH;
    return Math.pow(10, layout.yMin + frac * (layout.yMax - layout.yMin));
  }

  function autoscale() { viewMin = viewMax = valMin = valMax = null; draw(); }

  function zoomAroundCenter(factor) {
    if (!layout) return;
    const [dataMin, dataMax] = dataDomain();
    const curMin = viewMin ?? dataMin, curMax = viewMax ?? dataMax;
    const cx = (curMin + curMax) / 2;
    let newMin = cx - (cx - curMin) * factor, newMax = cx + (curMax - cx) * factor;
    newMin = Math.max(newMin, dataMin); newMax = Math.min(newMax, dataMax);
    if (newMax - newMin >= (dataMax - dataMin) * 1e-6) { viewMin = newMin; viewMax = newMax; }

    const curYMin = layout.yMin, curYMax = layout.yMax;
    const cy = (curYMin + curYMax) / 2;
    const newYMin = cy - (cy - curYMin) * factor, newYMax = cy + (curYMax - cy) * factor;
    valMin = Math.pow(10, newYMin); valMax = Math.pow(10, newYMax);
    draw();
  }

  function showTooltip(clientX, clientY) {
    const t = screenToTime(clientX);
    if (t == null) { tooltipEl.style.display = 'none'; return; }
    const rows = [];
    for (const [key, s] of series) {
      if (s.hidden || !s.points.length) continue;
      let nearest = s.points[0];
      for (const p of s.points) if (Math.abs(p.time - t) < Math.abs(nearest.time - t)) nearest = p;
      rows.push('<span style="color:' + s.color + '">' + key + '</span>: ' + nearest.value.toExponential(3) + ' @ t=' + nearest.time);
    }
    if (!rows.length) { tooltipEl.style.display = 'none'; return; }
    tooltipEl.innerHTML = rows.join('<br>');
    tooltipEl.style.display = 'block';
    const wrapRect = canvas.parentElement.getBoundingClientRect();
    tooltipEl.style.left = Math.min(clientX - wrapRect.left + 12, wrapRect.width - tooltipEl.offsetWidth - 4) + 'px';
    tooltipEl.style.top = (clientY - wrapRect.top + 12) + 'px';
  }

  canvas.addEventListener('wheel', ev => {
    if (!layout) return;
    ev.preventDefault();
    const [dataMin, dataMax] = dataDomain();
    const curMin = viewMin ?? dataMin, curMax = viewMax ?? dataMax;
    const cursorT = screenToTime(ev.clientX);
    if (cursorT == null) return;
    const zoom = ev.deltaY > 0 ? 1.15 : 1 / 1.15;
    let newMin = cursorT - (cursorT - curMin) * zoom;
    let newMax = cursorT + (curMax - cursorT) * zoom;
    newMin = Math.max(newMin, dataMin);
    newMax = Math.min(newMax, dataMax);
    if (newMax - newMin < (dataMax - dataMin) * 1e-6) return;
    viewMin = newMin; viewMax = newMax;
    draw();
  }, { passive: false });

  // ── Drag: box-zoom in 'zoom' mode (Plotly's default drag behaviour —
  // draw a rectangle, zoom both axes into it), plain pan in 'pan' mode. ──
  let dragging = false, dragStartX = 0, dragStartY = 0, panMin = 0, panMax = 0;
  canvas.addEventListener('mousedown', ev => {
    if (!layout) return;
    dragging = true;
    dragStartX = ev.clientX; dragStartY = ev.clientY;
    tooltipEl.style.display = 'none';
    if (mode === 'pan') {
      const [dataMin, dataMax] = dataDomain();
      panMin = viewMin ?? dataMin; panMax = viewMax ?? dataMax;
    } else {
      const wrapRect = canvas.parentElement.getBoundingClientRect();
      selBoxEl.style.left = (ev.clientX - wrapRect.left) + 'px';
      selBoxEl.style.top = (ev.clientY - wrapRect.top) + 'px';
      selBoxEl.style.width = '0px';
      selBoxEl.style.height = '0px';
      selBoxEl.style.display = 'block';
    }
  });
  window.addEventListener('mousemove', ev => {
    if (dragging && layout && mode === 'pan') {
      const dxFrac = (ev.clientX - dragStartX) / (layout.plotW / devicePixelRatio);
      const span = panMax - panMin;
      viewMin = panMin - dxFrac * span;
      viewMax = panMax - dxFrac * span;
      draw();
    } else if (dragging && layout && mode === 'zoom') {
      const wrapRect = canvas.parentElement.getBoundingClientRect();
      const x0 = Math.min(dragStartX, ev.clientX) - wrapRect.left, x1 = Math.max(dragStartX, ev.clientX) - wrapRect.left;
      const y0 = Math.min(dragStartY, ev.clientY) - wrapRect.top, y1 = Math.max(dragStartY, ev.clientY) - wrapRect.top;
      selBoxEl.style.left = x0 + 'px'; selBoxEl.style.top = y0 + 'px';
      selBoxEl.style.width = (x1 - x0) + 'px'; selBoxEl.style.height = (y1 - y0) + 'px';
    } else if (canvas.matches(':hover')) {
      showTooltip(ev.clientX, ev.clientY);
    }
  });
  window.addEventListener('mouseup', ev => {
    if (dragging && mode === 'zoom' && layout) {
      const movedEnough = Math.abs(ev.clientX - dragStartX) > 4 && Math.abs(ev.clientY - dragStartY) > 4;
      if (movedEnough) {
        const t0 = screenToTime(dragStartX), t1 = screenToTime(ev.clientX);
        const v0 = screenToValue(dragStartY), v1 = screenToValue(ev.clientY);
        if (t0 != null && t1 != null && v0 != null && v1 != null) {
          viewMin = Math.min(t0, t1); viewMax = Math.max(t0, t1);
          valMin = Math.min(v0, v1); valMax = Math.max(v0, v1);
          draw();
        }
      }
      selBoxEl.style.display = 'none';
    }
    dragging = false;
  });
  canvas.addEventListener('mouseleave', () => { tooltipEl.style.display = 'none'; });
  canvas.addEventListener('dblclick', autoscale);

  function setMode(next) {
    mode = next;
    document.getElementById('mode-zoom-btn').classList.toggle('active', mode === 'zoom');
    document.getElementById('mode-pan-btn').classList.toggle('active', mode === 'pan');
    canvas.classList.toggle('mode-zoom', mode === 'zoom');
    canvas.classList.toggle('mode-pan', mode === 'pan');
  }
  document.getElementById('mode-zoom-btn').addEventListener('click', () => setMode('zoom'));
  document.getElementById('mode-pan-btn').addEventListener('click', () => setMode('pan'));
  document.getElementById('zoom-in-btn').addEventListener('click', () => zoomAroundCenter(1 / 1.4));
  document.getElementById('zoom-out-btn').addEventListener('click', () => zoomAroundCenter(1.4));
  document.getElementById('autoscale-btn').addEventListener('click', autoscale);
  document.getElementById('open-btn').addEventListener('click', () => vs.postMessage({ type: 'openFile' }));

  window.addEventListener('message', ev => {
    const msg = ev.data;
    if (msg.type === 'residuals') {
      for (const u of msg.updates) {
        const s = colorFor(u.key);
        s.points.push({ time: u.time, value: u.value });
        s.trend = u.trend;
      }
      renderLegend();
      renderSummary();
      draw();
      const last = msg.updates[msg.updates.length - 1];
      if (last) document.getElementById('i-time').textContent = String(last.time);
      if (statusEl.textContent.indexOf('Watching') === 0 || statusEl.textContent.indexOf('Reading') === 0) {
        statusEl.textContent = 'Watching for new solver output…';
      }
    } else if (msg.type === 'courant') {
      document.getElementById('i-courant').textContent = msg.mean.toPrecision(4) + ' / ' + msg.max.toPrecision(4);
    } else if (msg.type === 'executionTime') {
      document.getElementById('i-exec').textContent = msg.executionTime.toFixed(1) + ' s';
      document.getElementById('i-clock').textContent = msg.clockTime.toFixed(0) + ' s';
      execHistory.push({ time: msg.time, clockTime: msg.clockTime });
      renderSummary();
    } else if (msg.type === 'finished') {
      statusEl.textContent = 'Run finished — see the summary below for the final state of each field.';
      renderSummary();
    } else if (msg.type === 'noData') {
      statusEl.textContent = "No residual lines found in this log (wrong file, or the solver hasn't logged an iteration yet).";
    }
  });

  new ResizeObserver(draw).observe(canvas);
  // Tell the host we're ready to receive data — posting before this
  // listener is attached would otherwise silently drop the message
  // (there's no queueing), which is exactly what left this panel stuck
  // on the initial placeholder for an already-finished run.
  vs.postMessage({ type: 'ready' });
</script>
</body></html>`;
}
