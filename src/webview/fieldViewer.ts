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
import vtkInteractorStyleTrackballCamera from '@kitware/vtk.js/Interaction/Style/InteractorStyleTrackballCamera';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import { Representation } from '@kitware/vtk.js/Rendering/Core/Property/Constants';
import { parseLegacyVTK, VTKArray } from './vtkParse';

const container  = document.getElementById('field-canvas')  as HTMLElement;
const label      = document.getElementById('field-label')   as HTMLElement;
const arraySelect = document.getElementById('field-array')  as HTMLSelectElement;
const repButtons = document.querySelectorAll<HTMLButtonElement>('[data-rep]');
const legendBar  = document.getElementById('legend-bar')    as HTMLElement;
const legendMin  = document.getElementById('legend-min')    as HTMLElement;
const legendMax  = document.getElementById('legend-max')    as HTMLElement;

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

// A ParaView-ish "cool to warm" diverging colormap, applied over whatever
// [min, max] the selected channel has.
function buildLookupTable(): ReturnType<typeof vtkColorTransferFunction.newInstance> {
  const t = vtkColorTransferFunction.newInstance();
  t.addRGBPoint(0.0,  0.231, 0.298, 0.753);
  t.addRGBPoint(0.5,  0.865, 0.865, 0.865);
  t.addRGBPoint(1.0,  0.706, 0.016, 0.150);
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
  interactor.bindEvents(container);
  interactor.setInteractorStyle(vtkInteractorStyleTrackballCamera.newInstance());

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
  legendBar.parentElement!.style.visibility = 'visible';

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
    legendBar.parentElement!.style.visibility = 'hidden';
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
  renderer?.resetCamera();
  renderWindow?.render();

  label.textContent = `${fileName} — ${parsed.numPoints.toLocaleString()} pts, ${parsed.numCells.toLocaleString()} cells` +
    (channels.length ? `  |  ${channels.length} selectable field${channels.length === 1 ? '' : 's'}` : '');
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

window.addEventListener('message', (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.command === 'previewField') {
    try {
      const text = atob(msg.dataBase64);
      loadDataset(text, msg.fileName || '');
    } catch (err) {
      label.textContent = 'Parse error: ' + (err instanceof Error ? err.message : String(err));
    }
  }
});

// Static legend gradient (matches buildLookupTable's 3 control points).
legendBar.style.background =
  'linear-gradient(to right, rgb(59,76,192), rgb(221,221,221), rgb(180,4,38))';
