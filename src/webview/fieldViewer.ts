/**
 * Field-data viewer: `.vtk`/`.vtp` datasets that carry point/cell arrays
 * (HELYX/OpenFOAM `foamToVTK` output, `postProcessing/**\/VTK/*.vtk`) get
 * color-by-array, a legend, and a solid/wireframe/points toggle — the
 * "pyvista/paraview-style" features plain STL/OBJ geometry can't support
 * because it carries no field data. Separate from `geoViewer.ts` (plain
 * geometry preview, three.js) — this uses `@kitware/vtk.js`, which ships
 * the real filters/mappers this needs instead of hand-rolling them.
 */
import '@kitware/vtk.js/Rendering/Profiles/Geometry';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import vtkPicker from '@kitware/vtk.js/Rendering/Core/Picker';
import { Representation } from '@kitware/vtk.js/Rendering/Core/Property/Constants';
import { parseLegacyVTK, VTKArray } from './vtkParse';
import { computeFaceOnView } from './cameraOrient';
import { COLORMAPS, findColormap, toCssGradientStops } from './colormaps';

const container  = document.getElementById('field-canvas')  as HTMLElement;
const label      = document.getElementById('field-label')   as HTMLElement;
const arraySelect = document.getElementById('field-array')  as HTMLSelectElement;
const repButtons = document.querySelectorAll<HTMLButtonElement>('[data-rep]');
const legendBar  = document.getElementById('legend-bar')    as HTMLElement;
const legendMin  = document.getElementById('legend-min')    as HTMLElement;
const legendMax  = document.getElementById('legend-max')    as HTMLElement;
const colormapSelect = document.getElementById('colormap-select') as HTMLSelectElement;
const legendPanel = document.getElementById('legend-panel') as HTMLElement;

interface NamedArray extends VTKArray {
  location: 'point' | 'cell';
}

/** One *selectable* thing in the array dropdown: either a plain scalar
 *  array, or one component/the magnitude of a multi-component (vector/
 *  tensor) array — "sub-features" of a field, individually pickable. */
interface Channel {
  label: string;
  location: 'point' | 'cell';
  raw: NamedArray;
  extract: 'magnitude' | number; // component index, or the vector/tensor magnitude
}

let renderWindow: ReturnType<typeof vtkRenderWindow.newInstance> | null = null;
let renderer: ReturnType<typeof vtkRenderer.newInstance> | null = null;
let glWindow: ReturnType<typeof vtkOpenGLRenderWindow.newInstance> | null = null;
let interactor: ReturnType<typeof vtkRenderWindowInteractor.newInstance> | null = null;
let actor: ReturnType<typeof vtkActor.newInstance> | null = null;
let mapper: ReturnType<typeof vtkMapper.newInstance> | null = null;
let lut: ReturnType<typeof vtkColorTransferFunction.newInstance> | null = null;
let polydata: ReturnType<typeof vtkPolyData.newInstance> | null = null;
let channels: Channel[] = [];
let ready = false;

let currentColormapId = 'coolwarm';

// Applied over whatever [min, max] the selected channel has. The palette
// itself is picked from `colormaps.ts`'s presets (cool-to-warm is the
// ParaView-conventional default; the others are more vivid alternatives)
// — user-selectable via `#colormap-select`, not fixed to one map.
function buildLookupTable(): ReturnType<typeof vtkColorTransferFunction.newInstance> {
  const t = vtkColorTransferFunction.newInstance();
  for (const [stopT, r, g, b] of findColormap(currentColormapId).stops) t.addRGBPoint(stopT, r, g, b);
  return t;
}

function init(): void {
  if (ready) return;
  renderWindow = vtkRenderWindow.newInstance();
  renderer = vtkRenderer.newInstance({ background: [0.067, 0.071, 0.094] });
  renderWindow.addRenderer(renderer);

  glWindow = vtkOpenGLRenderWindow.newInstance();
  glWindow.setContainer(container);
  renderWindow.addView(glWindow);

  // vtk.js's own canvas only ever gets `style.width:100%` (see
  // OpenGL/RenderWindow.js) — it never sets a CSS height. Left alone,
  // the canvas's rendered height falls back to its `height` *attribute*
  // (i.e. whatever glWindow.setSize() last wrote in pixels), which then
  // feeds back into `container.clientHeight` on the very next resize()
  // call, growing without bound in a flex container that has no
  // `min-height:0` to break the loop — this was a genuine bug (not a
  // vtk.js data/rendering issue) that left the canvas rendering into a
  // detached, oversized backing store while the visible container
  // stayed the wrong size. Pin both dimensions to the container's CSS
  // box instead so sizing is driven by layout, not by the canvas's own
  // attributes.
  const glCanvas = glWindow.getCanvas();
  if (glCanvas) {
    glCanvas.style.width = '100%';
    glCanvas.style.height = '100%';
    glCanvas.style.display = 'block';
  }

  const resize = () => {
    if (!glWindow) return;
    const w = container.clientWidth || 800, h = container.clientHeight || 400;
    glWindow.setSize(Math.max(1, w), Math.max(1, h));
    renderWindow?.render();
  };
  new ResizeObserver(resize).observe(container);

  interactor = vtkRenderWindowInteractor.newInstance();
  interactor.setView(glWindow);
  interactor.initialize();
  // Not using vtkInteractorStyleTrackballCamera's own mouse dispatch —
  // its default bindings (plain-left=rotate, shift+left=pan, no
  // right-click binding at all) don't match what was asked for
  // (right-click=pan, left-click=rotate pivoting on the clicked point,
  // gentler wheel zoom), and fighting its internal state machine to
  // retarget mid-gesture would be more fragile than just driving the
  // camera directly — see the mouse handlers below, which reuse the
  // same azimuth/elevation/translate/zoom primitives the nav-panel
  // buttons already use.
  bindMouseControls();

  lut = buildLookupTable();
  mapper = vtkMapper.newInstance();
  mapper.setLookupTable(lut);
  mapper.setInterpolateScalarsBeforeMapping(true);
  mapper.setUseLookupTableScalarRange(true);

  actor = vtkActor.newInstance();
  actor.setMapper(mapper);
  const prop = actor.getProperty();
  // The parsed geometry carries no normals (this is a raw points+polys
  // upload, not run through a normals filter), so lighting-dependent
  // shading can render the surface as flat/black depending on face
  // winding. Flat, unlit color is what most data-viz tools default to
  // anyway (it shows the true mapped color, not a shaded approximation)
  // and — the actual point here — guarantees the geometry is visible at
  // all, whether or not field data/coloring is present.
  prop.setLighting(false);
  prop.setColor(0.3, 0.72, 1.0);
  renderer.addActor(actor);

  resize();
  ready = true;
}

function orientCameraForBounds(bounds: number[]): void {
  const camera = renderer?.getActiveCamera();
  if (!camera) return;
  const view = computeFaceOnView(bounds);
  camera.setFocalPoint(...view.focalPoint);
  camera.setPosition(...view.position);
  camera.setViewUp(...view.viewUp);
}

/** Per-tuple magnitude for a multi-component array. */
function magnitudeOf(a: NamedArray): Float32Array {
  const n = a.data.length / a.numComponents;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sumSq = 0;
    for (let c = 0; c < a.numComponents; c++) {
      const v = a.data[i * a.numComponents + c];
      sumSq += v * v;
    }
    out[i] = Math.sqrt(sumSq);
  }
  return out;
}

function componentOf(a: NamedArray, comp: number): Float32Array {
  const n = a.data.length / a.numComponents;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = a.data[i * a.numComponents + comp];
  return out;
}

function channelValues(ch: Channel): Float32Array {
  return ch.extract === 'magnitude' ? magnitudeOf(ch.raw) : componentOf(ch.raw, ch.extract);
}

const COMPONENT_NAMES: Record<number, string[]> = {
  3: ['X', 'Y', 'Z'],
  6: ['XX', 'YY', 'ZZ', 'XY', 'YZ', 'XZ'],
};

/** Every array becomes one or more selectable channels: a plain scalar
 *  is one entry; a vector/tensor becomes its magnitude *and* each of its
 *  components, individually selectable — the "sub-features" of a field. */
function buildChannels(arrays: NamedArray[]): Channel[] {
  const out: Channel[] = [];
  for (const a of arrays) {
    if (a.numComponents === 1) {
      out.push({ label: `${a.name} — ${a.location}`, location: a.location, raw: a, extract: 'magnitude' });
      continue;
    }
    out.push({ label: `${a.name} (magnitude) — ${a.location}`, location: a.location, raw: a, extract: 'magnitude' });
    const names = COMPONENT_NAMES[a.numComponents];
    for (let c = 0; c < a.numComponents; c++) {
      const nm = names?.[c] ?? String(c);
      out.push({ label: `${a.name} — ${nm} — ${a.location}`, location: a.location, raw: a, extract: c });
    }
  }
  return out;
}

function applyChannel(index: number): void {
  if (!polydata || !mapper || !lut || !channels.length || index < 0 || index >= channels.length) return;
  const ch = channels[index];
  const values = channelValues(ch);
  const colorArrayName = '__color';

  const dataArray = vtkDataArray.newInstance({ name: colorArrayName, values, numberOfComponents: 1 });
  if (ch.location === 'point') {
    polydata.getPointData().removeArray(colorArrayName);
    polydata.getPointData().addArray(dataArray);
    polydata.getPointData().setActiveScalars(colorArrayName);
    mapper.setScalarModeToUsePointData();
  } else {
    polydata.getCellData().removeArray(colorArrayName);
    polydata.getCellData().addArray(dataArray);
    polydata.getCellData().setActiveScalars(colorArrayName);
    mapper.setScalarModeToUseCellData();
  }
  mapper.setColorByArrayName(colorArrayName);
  mapper.setColorModeToMapScalars();
  mapper.setScalarVisibility(true);
  polydata.modified();

  let min = Infinity, max = -Infinity;
  for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
  if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
  if (min === max) max = min + 1;
  lut.setMappingRange(min, max);
  mapper.setScalarRange(min, max);

  legendMin.textContent = min.toPrecision(4);
  legendMax.textContent = max.toPrecision(4);
  legendPanel.style.visibility = 'visible';

  renderWindow?.render();
}

function loadDataset(text: string, fileName: string): void {
  init();
  document.getElementById('empty-state')?.style.setProperty('display', 'none');
  const parsed = parseLegacyVTK(text);
  if (!parsed) { label.textContent = `${fileName} — not a readable legacy VTK file`; return; }

  const pts = vtkPoints.newInstance({ values: parsed.points, numberOfComponents: 3 });
  const polys = vtkCellArray.newInstance({ values: parsed.polys });
  polydata = vtkPolyData.newInstance();
  polydata.setPoints(pts);
  polydata.setPolys(polys);

  const arrays: NamedArray[] = [
    ...parsed.pointData.map(a => ({ ...a, location: 'point' as const })),
    ...parsed.cellData.map(a => ({ ...a, location: 'cell' as const })),
  ];
  channels = buildChannels(arrays);

  arraySelect.innerHTML = '';
  if (!channels.length) {
    const opt = document.createElement('option');
    opt.textContent = '(no field data — geometry only)';
    arraySelect.appendChild(opt);
    arraySelect.disabled = true;
    mapper?.setScalarVisibility(false);
    legendPanel.style.visibility = 'hidden';
  } else {
    arraySelect.disabled = false;
    channels.forEach((ch, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = ch.label;
      arraySelect.appendChild(opt);
    });
  }

  mapper?.setInputData(polydata);
  if (channels.length) applyChannel(0);
  if (actor) orientCameraForBounds(actor.getBounds());
  renderer?.resetCamera();
  if (clipEnabled) updateClipPlane(); // new bounds — reposition the plane, don't leave it stale/out of range
  renderWindow?.render();

  label.textContent = `${fileName} — ${parsed.numPoints.toLocaleString()} pts, ${parsed.numCells.toLocaleString()} cells` +
    (channels.length ? `  |  ${channels.length} selectable field${channels.length === 1 ? '' : 's'}` : '');
}

// ── Clip plane: X/Y/Z (or flipped), position slider — vtk.js's mapper
// ships real clipping-plane support (`addClippingPlane`, confirmed via
// `Rendering/Core/AbstractMapper.js`); this just drives one `vtkPlane`'s
// origin/normal from the UI. Not capped (the removed side just shows as
// an open shell) — a filled cross-section needs a separate cut/cap
// filter, deferred as a possible v2.
let clipPlane: ReturnType<typeof vtkPlane.newInstance> | null = null;
let clipAxis: 0 | 1 | 2 = 0;
let clipFlipped = false;
let clipEnabled = false;

function updateClipPlane(): void {
  if (!clipPlane || !polydata) return;
  const bounds = polydata.getBounds();
  const lo = bounds[clipAxis * 2], hi = bounds[clipAxis * 2 + 1];
  const slider = document.getElementById('clip-slider') as HTMLInputElement | null;
  const t = slider ? Number(slider.value) / 100 : 0.5;
  const pos = lo + (hi - lo) * t;
  const normal = [0, 0, 0];
  normal[clipAxis] = clipFlipped ? -1 : 1;
  const origin = [(bounds[0] + bounds[1]) / 2, (bounds[2] + bounds[3]) / 2, (bounds[4] + bounds[5]) / 2];
  origin[clipAxis] = pos;
  clipPlane.setNormal(normal[0], normal[1], normal[2]);
  clipPlane.setOrigin(origin[0], origin[1], origin[2]);
  renderWindow?.render();
}

function setClipEnabled(enabled: boolean): void {
  clipEnabled = enabled;
  document.getElementById('clip-toggle')?.classList.toggle('active', enabled);
  if (!mapper) return;
  mapper.removeAllClippingPlanes();
  if (enabled) {
    if (!clipPlane) clipPlane = vtkPlane.newInstance();
    mapper.addClippingPlane(clipPlane);
    updateClipPlane();
  } else {
    renderWindow?.render();
  }
}

function setClipAxis(axis: 0 | 1 | 2): void {
  clipAxis = axis;
  ['clip-axis-x', 'clip-axis-y', 'clip-axis-z'].forEach((id, i) =>
    document.getElementById(id)?.classList.toggle('active', i === axis));
  if (clipEnabled) updateClipPlane();
}

function toggleClipFlip(): void {
  clipFlipped = !clipFlipped;
  document.getElementById('clip-flip')?.classList.toggle('active', clipFlipped);
  if (clipEnabled) updateClipPlane();
}

document.getElementById('clip-toggle')?.addEventListener('click', () => setClipEnabled(!clipEnabled));
document.getElementById('clip-axis-x')?.addEventListener('click', () => setClipAxis(0));
document.getElementById('clip-axis-y')?.addEventListener('click', () => setClipAxis(1));
document.getElementById('clip-axis-z')?.addEventListener('click', () => setClipAxis(2));
document.getElementById('clip-flip')?.addEventListener('click', toggleClipFlip);
document.getElementById('clip-slider')?.addEventListener('input', () => { if (clipEnabled) updateClipPlane(); });
setClipAxis(0);

// ── Nav panel: stepped rotate/pan/zoom, fit, reset, ortho toggle, screenshot ──
// vtk.js's `Camera` ships the real orbit primitives (confirmed by reading
// the installed `Rendering/Core/Camera.js`): `azimuth`/`elevation` rotate
// the eye around the focal point in degrees, `zoom` scales the view angle
// (perspective) or the parallel scale (ortho) so one button works in both
// projection modes, and `translate` moves eye+focal point together in
// world space — there's no built-in screen-space "pan by pixels", so the
// pan buttons build that offset from the camera's own right/up vectors.
function getCamera() {
  return renderer?.getActiveCamera() ?? null;
}

function rotateStep(azimuthDeg: number, elevationDeg: number): void {
  const camera = getCamera();
  if (!camera || !renderer) return;
  if (azimuthDeg) camera.azimuth(azimuthDeg);
  if (elevationDeg) camera.elevation(elevationDeg);
  camera.orthogonalizeViewUp();
  renderer.resetCameraClippingRange();
  renderWindow?.render();
}

function cross3(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize3(v: number[]): number[] {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function panStep(dx: number, dy: number): void {
  const camera = getCamera();
  if (!camera || !renderer) return;
  const dop = camera.getDirectionOfProjection();
  const up = normalize3(camera.getViewUp());
  const right = normalize3(cross3(dop, up));
  const scale = camera.getDistance() * 0.08;
  camera.translate(
    (right[0] * dx + up[0] * dy) * scale,
    (right[1] * dx + up[1] * dy) * scale,
    (right[2] * dx + up[2] * dy) * scale,
  );
  renderer.resetCameraClippingRange();
  renderWindow?.render();
}

function zoomStep(factor: number): void {
  const camera = getCamera();
  if (!camera || !renderer) return;
  camera.zoom(factor);
  renderer.resetCameraClippingRange();
  renderWindow?.render();
}

// ── Mouse controls: left-drag rotates around the clicked point,
// right-drag pans, wheel zooms gently. Not vtk.js's own
// InteractorStyleTrackballCamera (see the comment in init()) — direct
// camera manipulation instead, reusing the same primitives the nav-panel
// buttons use, just driven continuously by drag deltas instead of
// discrete clicks.
const picker = vtkPicker.newInstance();

/** World-space point under (clientX, clientY), or null if nothing was
 *  hit — vtk.js "display" coordinates are canvas-relative and measured
 *  bottom-up (OpenGL convention), unlike the browser's top-down clientY. */
function pickWorldPoint(clientX: number, clientY: number): number[] | null {
  if (!renderer) return null;
  const rect = container.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = rect.height - (clientY - rect.top);
  picker.pick([x, y, 0], renderer);
  const actors = picker.getActors();
  if (!actors || !actors.length) return null;
  return picker.getPickPosition();
}

/** Re-aims the camera at `point` without moving its position — a small,
 *  expected "snap to what you clicked" (the same trade-off geoViewer.ts's
 *  `retarget()` makes), after which azimuth/elevation orbit around this
 *  new pivot instead of the old one. */
function retargetTo(point: number[]): void {
  const camera = getCamera();
  if (!camera) return;
  camera.setFocalPoint(point[0], point[1], point[2]);
  renderer?.resetCameraClippingRange();
}

let dragMode: 'rotate' | 'pan' = 'rotate';
let mouseDown = false, lastX = 0, lastY = 0;

function bindMouseControls(): void {
  container.addEventListener('contextmenu', e => e.preventDefault());
  container.addEventListener('mousedown', e => {
    mouseDown = true;
    lastX = e.clientX; lastY = e.clientY;
    dragMode = e.button === 2 ? 'pan' : 'rotate';
    if (dragMode === 'rotate') {
      const p = pickWorldPoint(e.clientX, e.clientY);
      if (p) retargetTo(p);
    }
  });
  window.addEventListener('mouseup', () => { mouseDown = false; });
  window.addEventListener('mousemove', e => {
    if (!mouseDown) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    if (dragMode === 'pan') {
      const camera = getCamera();
      if (!camera || !renderer) return;
      const dop = camera.getDirectionOfProjection();
      const up = normalize3(camera.getViewUp());
      const right = normalize3(cross3(dop, up));
      const scale = camera.getDistance() * 0.0015; // gentle, per-pixel — panStep's own scale is tuned for one discrete button click, not a continuous drag
      camera.translate(
        (-right[0] * dx + up[0] * dy) * scale,
        (-right[1] * dx + up[1] * dy) * scale,
        (-right[2] * dx + up[2] * dy) * scale,
      );
      renderer.resetCameraClippingRange();
      renderWindow?.render();
    } else {
      rotateStep(dx * 0.25, -dy * 0.25);
    }
  });
  container.addEventListener('wheel', e => {
    e.preventDefault();
    // Exponential in the raw wheel delta rather than a fixed per-tick
    // factor — smooth on both notched mouse wheels and trackpads, and
    // deliberately gentle (the fixed ±10-20%-per-tick feel from vtk.js's
    // own default dolly was reported as too sensitive).
    zoomStep(Math.exp(-e.deltaY * 0.0006));
  }, { passive: false });
}

function fitView(): void {
  // Keeps whatever direction the user has orbited to — only refits distance.
  renderer?.resetCamera();
  renderWindow?.render();
}

function resetView(): void {
  // Restores the good default direction too (see orientCameraForBounds),
  // not just the distance — for when the user has orbited to a bad angle.
  if (polydata) orientCameraForBounds(polydata.getBounds());
  renderer?.resetCamera();
  renderWindow?.render();
}

let orthoOn = false;
function toggleOrtho(): void {
  const camera = getCamera();
  if (!camera) return;
  orthoOn = !orthoOn;
  camera.setParallelProjection(orthoOn);
  document.getElementById('nav-ortho')?.classList.toggle('active', orthoOn);
  renderer?.resetCameraClippingRange();
  renderWindow?.render();
}

function takeScreenshot(): void {
  if (!glWindow || !renderWindow) return;
  renderWindow.render();
  const canvas = container.querySelector('canvas');
  if (!canvas) return;
  const dataUrl = (canvas as HTMLCanvasElement).toDataURL('image/png');
  (window as any).vsApi?.postMessage({ command: 'saveScreenshot', dataBase64: dataUrl.split(',')[1] });
}

const NAV_BUTTONS: [string, () => void][] = [
  ['nav-rot-left', () => rotateStep(-15, 0)],
  ['nav-rot-right', () => rotateStep(15, 0)],
  ['nav-tilt-up', () => rotateStep(0, 15)],
  ['nav-tilt-down', () => rotateStep(0, -15)],
  ['nav-pan-left', () => panStep(-1, 0)],
  ['nav-pan-right', () => panStep(1, 0)],
  ['nav-pan-up', () => panStep(0, 1)],
  ['nav-pan-down', () => panStep(0, -1)],
  ['nav-fit', fitView],
  ['nav-reset', resetView],
  ['nav-ortho', toggleOrtho],
  ['nav-screenshot', takeScreenshot],
];
for (const [id, fn] of NAV_BUTTONS) {
  document.getElementById(id)?.addEventListener('click', fn);
}

arraySelect.addEventListener('change', () => applyChannel(Number(arraySelect.value)));

repButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    if (!actor) return;
    const rep = btn.dataset.rep;
    const prop = actor.getProperty();
    if (rep === 'wireframe') prop.setRepresentation(Representation.WIREFRAME);
    else if (rep === 'points') prop.setRepresentation(Representation.POINTS);
    else prop.setRepresentation(Representation.SURFACE);
    repButtons.forEach(b => b.classList.toggle('active', b === btn));
    renderWindow?.render();
  });
});

// ── Loading state ────────────────────────────────────────────
// Shown from the moment a file is chosen until it's actually parsed and
// rendered — previously the "Open a .vtk/.vtp file…" empty-state stayed
// up for that whole window, which for a large file looked like nothing
// had happened. `loadDataset()` is synchronous (parse + vtk.js upload),
// so it's deferred one frame (double rAF) after showing the overlay so
// the browser actually paints the spinner before that blocking work runs.
const loadingEl = document.getElementById('loading-state');
const loadingTextEl = document.getElementById('loading-text');
function showLoading(fileName?: string): void {
  if (loadingTextEl) loadingTextEl.textContent = fileName ? `Loading ${fileName}…` : 'Loading…';
  if (loadingEl) loadingEl.style.display = 'flex';
  document.getElementById('empty-state')?.style.setProperty('display', 'none');
}
function hideLoading(): void {
  if (loadingEl) loadingEl.style.display = 'none';
}
function afterPaint(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

window.addEventListener('message', (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.command === 'loading') {
    showLoading(msg.fileName);
  } else if (msg.command === 'previewField') {
    showLoading(msg.fileName);
    afterPaint(() => {
      try {
        const text = atob(msg.dataBase64);
        loadDataset(text, msg.fileName || '');
      } catch (err) {
        label.textContent = 'Parse error: ' + (err instanceof Error ? err.message : String(err));
      } finally {
        hideLoading();
      }
    });
  }
});

// Vertical legend gradient (bottom = min, top = max — the conventional
// orientation), redrawn whenever the colormap selection changes.
function renderLegendGradient(): void {
  legendBar.style.background = `linear-gradient(to top, ${toCssGradientStops(findColormap(currentColormapId))})`;
}
renderLegendGradient();

if (colormapSelect) {
  for (const cmap of COLORMAPS) {
    const opt = document.createElement('option');
    opt.value = cmap.id;
    opt.textContent = cmap.label;
    colormapSelect.appendChild(opt);
  }
  colormapSelect.value = currentColormapId;
  colormapSelect.addEventListener('change', () => {
    currentColormapId = colormapSelect.value;
    lut = buildLookupTable();
    mapper?.setLookupTable(lut);
    renderLegendGradient();
    if (channels.length) applyChannel(Number(arraySelect.value) || 0);
    renderWindow?.render();
  });
}

// Tell the host we're ready to receive the initial file — postMessage()
// doesn't queue, so a payload posted before this listener is attached
// (e.g. an external <script src> tag still fetching over the network)
// would otherwise be silently dropped.
(window as any).vsApi?.postMessage({ command: 'ready' });
