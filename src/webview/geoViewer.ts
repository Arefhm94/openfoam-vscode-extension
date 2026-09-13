import * as THREE from 'three';

const geoCanvas  = document.getElementById('geo-canvas')  as HTMLCanvasElement;
const geoLabel   = document.getElementById('geo-label')   as HTMLElement;
const axesCanvas = document.getElementById('axes-canvas') as HTMLCanvasElement;
const axCtx      = axesCanvas?.getContext('2d') ?? null;

let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let ready = false;
const target = new THREE.Vector3(0, 0, 0);

// ── Multi-geometry layers ───────────────────────────────────────
// Each opened file becomes its own layer — kept in its native scale/
// position (not individually re-centered/rescaled, unlike the single-
// geometry thumbnail path below) so multiple case parts line up exactly
// as they do on disk; the camera auto-fits to all of them combined.
interface Layer { id: number; name: string; mesh: THREE.Mesh; visible: boolean }
let layers: Layer[] = [];
let nextLayerId = 1;
const LAYER_COLORS = [0x4db8ff, 0xff8a4d, 0x4dff9e, 0xff4d94, 0xc74dff, 0xffe14d, 0x4dfff2, 0xff4d4d];
const layersEl = document.getElementById('layers');

function renderLayerList(): void {
  if (!layersEl) return;
  layersEl.innerHTML = '';
  for (const l of layers) {
    const chip = document.createElement('span');
    chip.className = 'layer-chip' + (l.visible ? '' : ' layer-hidden');

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = '#' + (l.mesh.material as THREE.MeshPhongMaterial).color.getHexString();
    chip.appendChild(swatch);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = l.name;
    nameSpan.title = 'Click to toggle visibility';
    nameSpan.style.cursor = 'pointer';
    nameSpan.addEventListener('click', () => {
      l.visible = !l.visible;
      l.mesh.visible = l.visible;
      renderLayerList();
      renderer?.render(scene!, camera!);
    });
    chip.appendChild(nameSpan);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove layer';
    removeBtn.addEventListener('click', () => removeLayer(l.id));
    chip.appendChild(removeBtn);

    layersEl.appendChild(chip);
  }
}

function updateLayerLabel(): void {
  if (!layers.length) { geoLabel.textContent = 'No geometry file open'; return; }
  geoLabel.textContent = `${layers.length} layer${layers.length === 1 ? '' : 's'}` +
    '  |  left-drag rotate (pivots on what you click)  |  right-drag pan  |  scroll zoom  |  click a layer to toggle it';
}

/** Auto-fits the camera target/distance to the combined bounding box of
 *  every visible layer, so adding/removing a layer keeps everything in
 *  frame without each geometry fighting over its own normalized scale. */
function fitCameraToLayers(): void {
  if (!layers.length) return;
  const box = new THREE.Box3();
  let any = false;
  for (const l of layers) {
    if (!l.visible) continue;
    box.union(new THREE.Box3().setFromObject(l.mesh));
    any = true;
  }
  if (!any) return;
  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);
  target.copy(center);
  sph.r = maxDim * 1.8;
  // These used to be fixed (0.3–50, near 0.01, far 1000) back when every
  // geometry was individually re-normalized to a ~2-unit box. Now that
  // layers keep their real-world scale (needed so multiple parts line up
  // correctly), a fixed zoom/clip range is wrong in either direction: a
  // small part (millimeters) would clip through the near plane, a large
  // one (hundreds of metres) could sit past the far plane or get clamped
  // to an unusably close zoom the instant the wheel is touched. Scale
  // both to the geometry actually loaded.
  zoomMin = maxDim * 0.02;
  zoomMax = maxDim * 60;
  if (camera) {
    camera.near = Math.max(maxDim / 5000, 1e-6);
    camera.far = Math.max(maxDim * 200, 1000);
    camera.updateProjectionMatrix();
  }
  updateCamera();
}

// ── Clip plane: X/Y/Z (or flipped), position slider — three.js supports
// real per-material clipping (`renderer.localClippingEnabled` +
// `material.clippingPlanes`), one shared `THREE.Plane` applied to every
// layer's material. Not capped (the removed side just shows the open
// shell, visible thanks to the existing `DoubleSide` materials) — a
// filled cross-section needs a separate cap-geometry pass, deferred.
const clipPlaneThree = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
let clipAxis: 0 | 1 | 2 = 0;
let clipFlipped = false;
let clipEnabled = false;

function updateClipPlane(): void {
  if (!layers.length) return;
  const box = new THREE.Box3();
  let any = false;
  for (const l of layers) { if (!l.visible) continue; box.union(new THREE.Box3().setFromObject(l.mesh)); any = true; }
  if (!any) return;
  const axisKey = (['x', 'y', 'z'] as const)[clipAxis];
  const lo = box.min[axisKey], hi = box.max[axisKey];
  const slider = document.getElementById('clip-slider') as HTMLInputElement | null;
  const t = slider ? Number(slider.value) / 100 : 0.5;
  const pos = lo + (hi - lo) * t;
  const normal = new THREE.Vector3(0, 0, 0);
  normal[axisKey] = clipFlipped ? -1 : 1;
  // Plane equation normal·p + constant = 0; three.js keeps the side where
  // normal·p + constant >= 0. For normal=+1 on this axis, keeping p>=pos
  // needs constant=-pos; for normal=-1, keeping p<=pos needs constant=+pos.
  clipPlaneThree.normal.copy(normal);
  clipPlaneThree.constant = clipFlipped ? pos : -pos;
  renderer?.render(scene!, camera!);
}

function setClipEnabled(enabled: boolean): void {
  clipEnabled = enabled;
  document.getElementById('clip-toggle')?.classList.toggle('active', enabled);
  for (const l of layers) {
    (l.mesh.material as THREE.Material).clippingPlanes = enabled ? [clipPlaneThree] : [];
  }
  if (enabled) updateClipPlane();
  else renderer?.render(scene!, camera!);
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

function addLayer(fileName: string, geo: THREE.BufferGeometry): void {
  init();
  document.getElementById('empty-state')?.style.setProperty('display', 'none');
  const color = LAYER_COLORS[layers.length % LAYER_COLORS.length];
  const mat = new THREE.MeshPhongMaterial({ color, specular: 0x334455, shininess: 40, side: THREE.DoubleSide });
  if (clipEnabled) mat.clippingPlanes = [clipPlaneThree];
  const layerMesh = new THREE.Mesh(geo, mat);
  scene!.add(layerMesh);
  layers.push({ id: nextLayerId++, name: fileName, mesh: layerMesh, visible: true });
  renderLayerList();
  fitCameraToLayers();
  updateLayerLabel();
  if (clipEnabled) updateClipPlane(); // new layer changed the combined bounds
}

function removeLayer(id: number): void {
  const idx = layers.findIndex(l => l.id === id);
  if (idx < 0) return;
  const [l] = layers.splice(idx, 1);
  scene?.remove(l.mesh);
  l.mesh.geometry.dispose();
  (l.mesh.material as THREE.Material).dispose();
  renderLayerList();
  if (layers.length) fitCameraToLayers();
  else document.getElementById('empty-state')?.style.setProperty('display', 'flex');
  updateLayerLabel();
  renderer?.render(scene!, camera!);
}

function clearAllLayers(): void {
  for (const l of layers) {
    scene?.remove(l.mesh);
    l.mesh.geometry.dispose();
    (l.mesh.material as THREE.Material).dispose();
  }
  layers = [];
  renderLayerList();
  document.getElementById('empty-state')?.style.setProperty('display', 'flex');
  updateLayerLabel();
  renderer?.render(scene!, camera!);
}

// Z-up spherical orbit: phi=polar from Z, theta=azimuth
const sph = { theta: Math.PI / 4, phi: Math.PI / 3, r: 3 };
let isDown = false, lx = 0, ly = 0;
let dragMode: 'rotate' | 'pan' = 'rotate';
// Rescaled by fitCameraToLayers() to the actual loaded geometry's size —
// see the comment there for why this can no longer be a fixed range.
let zoomMin = 0.3, zoomMax = 50;

function updateCamera() {
  if (!camera) return;
  camera.position.set(
    sph.r * Math.sin(sph.phi) * Math.cos(sph.theta),
    sph.r * Math.sin(sph.phi) * Math.sin(sph.theta),
    sph.r * Math.cos(sph.phi),
  );
  camera.position.add(target);
  camera.up.set(0, 0, 1);
  camera.lookAt(target);
}

function panCamera(dx: number, dy: number) {
  if (!camera) return;
  const toTarget = target.clone().sub(camera.position).normalize();
  const right = toTarget.clone().cross(camera.up).normalize();
  const up = camera.up.clone().normalize();
  const panScale = Math.max(0.001, sph.r * 0.0018);
  const pan = right.multiplyScalar(-dx * panScale).add(up.multiplyScalar(dy * panScale));
  target.add(pan);
}

// ── Rotate around the clicked point ─────────────────────────────────
// Raycast on rotate-drag start, and if it hits visible geometry, re-aim
// the orbit at that point instead of the scene's overall center — the
// camera's own position doesn't move (only `camera.lookAt(target)`
// changes), so this is a "look at what you clicked" snap, not a
// teleport; subsequent drag then orbits around that point.
const raycaster = new THREE.Raycaster();
function pickPoint(clientX: number, clientY: number): THREE.Vector3 | null {
  if (!camera) return null;
  const rect = geoCanvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  const meshes = layers.filter(l => l.visible).map(l => l.mesh);
  const hits = raycaster.intersectObjects(meshes, false);
  return hits.length ? hits[0].point : null;
}

function retargetTo(point: THREE.Vector3): void {
  if (!camera) return;
  const offset = camera.position.clone().sub(point);
  const r = offset.length();
  if (r < 1e-9) return;
  target.copy(point);
  sph.r = r;
  sph.phi = Math.acos(Math.max(-1, Math.min(1, offset.z / r)));
  sph.theta = Math.atan2(offset.y, offset.x);
}

function init() {
  if (ready) return;
  const w = geoCanvas.clientWidth  || 800;
  const h = geoCanvas.clientHeight || 400;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111318);

  camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 1000);
  updateCamera();

  renderer = new THREE.WebGLRenderer({ canvas: geoCanvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(w, h, false);
  renderer.localClippingEnabled = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const d1 = new THREE.DirectionalLight(0xffffff, 0.9);
  d1.position.set(5, 4, 10);
  scene.add(d1);
  const d2 = new THREE.DirectionalLight(0x6688bb, 0.4);
  d2.position.set(-5, -4, -3);
  scene.add(d2);

  geoCanvas.addEventListener('contextmenu', e => e.preventDefault());
  geoCanvas.addEventListener('mousedown', e => {
    isDown = true;
    lx = e.clientX;
    ly = e.clientY;
    dragMode = e.button === 2 ? 'pan' : 'rotate';
    if (dragMode === 'rotate') {
      const p = pickPoint(e.clientX, e.clientY);
      if (p) retargetTo(p);
    }
  });
  window.addEventListener('mouseup', () => isDown = false);
  window.addEventListener('mousemove', e => {
    if (!isDown) return;
    const dx = e.clientX - lx;
    const dy = e.clientY - ly;
    if (dragMode === 'pan') {
      panCamera(dx, dy);
    } else {
      sph.theta -= dx * 0.01;
      sph.phi = Math.max(0.05, Math.min(Math.PI - 0.05, sph.phi + dy * 0.01));
    }
    lx = e.clientX; ly = e.clientY;
    updateCamera();
  });
  geoCanvas.addEventListener('wheel', e => {
    // Exponential in the raw wheel delta rather than a fixed ±10% per
    // tick — smooth on both notched wheels and trackpads, and
    // deliberately gentle (the old fixed-step feel was reported as too
    // sensitive).
    sph.r = Math.max(zoomMin, Math.min(zoomMax, sph.r * Math.exp(e.deltaY * 0.0006)));
    updateCamera();
    e.preventDefault();
  }, { passive: false });

  new ResizeObserver(() => {
    if (!renderer || !camera) return;
    const w = geoCanvas.clientWidth, h = geoCanvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }).observe(geoCanvas);

  renderer.setAnimationLoop(() => {
    renderer!.render(scene!, camera!);
    drawAxes();
  });
  ready = true;
}

// ── Axes indicator (2D canvas overlay) ───────────────────────
const AX_DEFS = [
  { v: new THREE.Vector3(1, 0, 0), color: '#e05555', label: 'X' },
  { v: new THREE.Vector3(0, 1, 0), color: '#55c055', label: 'Y' },
  { v: new THREE.Vector3(0, 0, 1), color: '#5599ee', label: 'Z' },
];

function drawAxes() {
  if (!axCtx || !camera) return;
  const S = 40, LEN = 28;
  axCtx.clearRect(0, 0, 80, 80);
  axCtx.fillStyle = 'rgba(0,0,0,0.35)';
  axCtx.beginPath(); axCtx.arc(S, S, 38, 0, Math.PI * 2); axCtx.fill();

  const proj = AX_DEFS.map(ax => {
    const v = ax.v.clone().applyQuaternion(camera!.quaternion.clone().conjugate());
    return { color: ax.color, label: ax.label, sx: v.x, sy: -v.y, depth: v.z };
  });
  proj.sort((a, b) => a.depth - b.depth);

  for (const ax of proj) {
    const x2 = S + ax.sx * LEN, y2 = S + ax.sy * LEN;
    axCtx.globalAlpha = ax.depth > 0 ? 1.0 : 0.35;
    axCtx.strokeStyle = ax.color; axCtx.lineWidth = 2;
    axCtx.beginPath(); axCtx.moveTo(S, S); axCtx.lineTo(x2, y2); axCtx.stroke();
    axCtx.fillStyle = ax.color;
    axCtx.font = 'bold 9px monospace'; axCtx.textAlign = 'center'; axCtx.textBaseline = 'middle';
    axCtx.fillText(ax.label, x2 + ax.sx * 8, y2 + ax.sy * 8);
  }
  axCtx.globalAlpha = 1;
}

// ── STL utilities ─────────────────────────────────────────────
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

function parseSTL(bytes: Uint8Array, isBinary: boolean, normalize = true): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();

  if (isBinary) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = view.getUint32(80, true);
    const pos = new Float32Array(n * 9), nrm = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) {
      const base = 84 + i * 50;
      const nx = view.getFloat32(base, true), ny = view.getFloat32(base + 4, true), nz = view.getFloat32(base + 8, true);
      for (let v = 0; v < 3; v++) {
        const vb = base + 12 + v * 12, idx = (i * 3 + v) * 3;
        pos[idx]     = view.getFloat32(vb,     true);
        pos[idx + 1] = view.getFloat32(vb + 4, true);
        pos[idx + 2] = view.getFloat32(vb + 8, true);
        nrm[idx] = nx; nrm[idx + 1] = ny; nrm[idx + 2] = nz;
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal',   new THREE.BufferAttribute(nrm, 3));
  } else {
    const text = new TextDecoder().decode(bytes);
    const pos: number[] = [], nrm: number[] = [];
    let cn = [0, 0, 1];
    for (const ln of text.split('\n')) {
      const t = ln.trim();
      if (t.startsWith('facet normal')) { const p = t.split(/\s+/); cn = [+p[2], +p[3], +p[4]]; }
      else if (t.startsWith('vertex '))  { const p = t.split(/\s+/); pos.push(+p[1], +p[2], +p[3]); nrm.push(...cn); }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('normal',   new THREE.BufferAttribute(new Float32Array(nrm), 3));
  }

  if (normalize) normalizeGeometry(geo);
  return geo;
}

function normalizeGeometry(geo: THREE.BufferGeometry): void {
  geo.computeBoundingBox();
  const c = new THREE.Vector3();
  geo.boundingBox!.getCenter(c);
  geo.translate(-c.x, -c.y, -c.z);
  geo.computeBoundingBox();
  const sz = new THREE.Vector3();
  geo.boundingBox!.getSize(sz);
  const s = 2 / Math.max(sz.x, sz.y, sz.z, 0.001);
  geo.scale(s, s, s);
}

function parseOBJ(bytes: Uint8Array, normalize = true): THREE.BufferGeometry {
  const text = new TextDecoder().decode(bytes);
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  const v: number[][] = [], vn: number[][] = [];
  for (const ln of text.split('\n')) {
    const t = ln.trim();
    if (t.startsWith('v ')) {
      const p = t.split(/\s+/);
      v.push([+p[1], +p[2], +p[3]]);
    } else if (t.startsWith('vn ')) {
      const p = t.split(/\s+/);
      vn.push([+p[1], +p[2], +p[3]]);
    } else if (t.startsWith('f ')) {
      const parts = t.split(/\s+/).slice(1);
      for (const part of parts) {
        const vi = parseInt(part.split('/')[0]);
        idx.push(vi > 0 ? vi - 1 : v.length + vi);
        if (vn.length) {
          const ni = parseInt(part.split('/')[2] || '0');
          const nvi = ni > 0 ? ni - 1 : vn.length + ni;
          if (nvi >= 0 && nvi < vn.length) nrm.push(...vn[nvi]);
        }
      }
    }
  }
  for (const vi of idx) if (vi >= 0 && vi < v.length) pos.push(...v[vi]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  if (nrm.length) geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  geo.setIndex(idx);
  if (!nrm.length) geo.computeVertexNormals(); // OBJ had no `vn` lines
  if (normalize) normalizeGeometry(geo);
  return geo;
}

function parseVTK(bytes: Uint8Array, normalize = true): THREE.BufferGeometry {
  const text = new TextDecoder().decode(bytes);
  const lines = text.split('\n');
  const pos: number[] = [];
  let i = 0;
  // Skip header
  while (i < lines.length && !lines[i].includes('POINTS')) i++;
  if (i >= lines.length) return new THREE.BufferGeometry();
  const ptsMatch = lines[i].match(/POINTS\s+(\d+)/);
  if (!ptsMatch) return new THREE.BufferGeometry();
  const numPts = parseInt(ptsMatch[1]);
  i++;
  const pts: number[] = [];
  while (i < lines.length && pts.length < numPts * 3) {
    const nums = lines[i].trim().split(/\s+/);
    for (const n of nums) { const f = parseFloat(n); if (!isNaN(f)) pts.push(f); }
    i++;
  }
  // Find POLYGONS or TRIANGLE_STRIP
  while (i < lines.length && !lines[i].includes('POLYGONS') && !lines[i].includes('TRIANGLE_STRIP')) i++;
  if (i >= lines.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    if (normalize) normalizeGeometry(geo);
    return geo;
  }
  const polyMatch = lines[i].match(/(POLYGONS|TRIANGLE_STRIP)\s+(\d+)\s+(\d+)/);
  if (!polyMatch) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    if (normalize) normalizeGeometry(geo);
    return geo;
  }
  i++;
  const numCells = parseInt(polyMatch[2]);
  let count = 0;
  while (i < lines.length && count < numCells) {
    const nums = lines[i].trim().split(/\s+/);
    if (nums.length >= 4) {
      const nv = parseInt(nums[0]);
      for (let j = 1; j < nv - 1; j++) {
        const a = parseInt(nums[1]), b = parseInt(nums[1 + j]), c = parseInt(nums[1 + j + 1]);
        if (!isNaN(a) && !isNaN(b) && !isNaN(c) && a >= 0 && b >= 0 && c >= 0 && a * 3 < pts.length && b * 3 < pts.length && c * 3 < pts.length) {
          pos.push(pts[a * 3], pts[a * 3 + 1], pts[a * 3 + 2]);
          pos.push(pts[b * 3], pts[b * 3 + 1], pts[b * 3 + 2]);
          pos.push(pts[c * 3], pts[c * 3 + 1], pts[c * 3 + 2]);
        }
      }
    }
    count++;
    i++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.computeVertexNormals(); // legacy VTK POLYGONS carry no normals of their own
  if (normalize) normalizeGeometry(geo);
  return geo;
}

// ── Inline thumbnail renderer (shared offscreen) ──────────────
let thumbRenderer: THREE.WebGLRenderer | null = null;

function getThumbRenderer(): THREE.WebGLRenderer {
  if (!thumbRenderer) {
    const offCanvas = document.createElement('canvas');
    offCanvas.width = 300; offCanvas.height = 200;
    thumbRenderer = new THREE.WebGLRenderer({ canvas: offCanvas, antialias: true, preserveDrawingBuffer: true });
    thumbRenderer.setSize(300, 200, false);
  }
  return thumbRenderer;
}

function renderMiniGeo(imgEl: HTMLImageElement, dataBase64: string, isBinary: boolean, ext?: string): void {
  try {
    const bytes = b64ToBytes(dataBase64);
    const extLower = (ext || '.stl').toLowerCase();
    let geo: THREE.BufferGeometry;
    if (extLower === '.obj') {
      geo = parseOBJ(bytes);
    } else if (extLower === '.vtk') {
      geo = parseVTK(bytes);
    } else {
      geo = parseSTL(bytes, isBinary);
    }
    const r     = getThumbRenderer();

    const sc = new THREE.Scene();
    sc.background = new THREE.Color(0x1a1d23);
    const cam = new THREE.PerspectiveCamera(45, 300 / 200, 0.01, 100);
    // Z-up isometric view for thumbnail
    cam.position.set(1.6, 1.6, 1.4);
    cam.up.set(0, 0, 1);
    cam.lookAt(0, 0, 0);

    sc.add(new THREE.AmbientLight(0xffffff, 0.5));
    const dl = new THREE.DirectionalLight(0xffffff, 0.9); dl.position.set(3, 2, 5); sc.add(dl);
    const dl2 = new THREE.DirectionalLight(0x6688bb, 0.3); dl2.position.set(-3, -2, -3); sc.add(dl2);

    const mat = new THREE.MeshPhongMaterial({ color: 0x4db8ff, specular: 0x223344, shininess: 30, side: THREE.DoubleSide });
    sc.add(new THREE.Mesh(geo, mat));

    r.render(sc, cam);
    imgEl.src = r.domElement.toDataURL('image/png');

    geo.dispose(); mat.dispose();
  } catch {
    imgEl.style.opacity = '0.15';
  }
}

// ── Nav panel: stepped rotate/pan/zoom, fit, reset, wireframe, screenshot ──
const ROTATE_STEP = Math.PI / 12; // 15°
const PAN_STEP_PX = 40;

function rotateStep(dTheta: number, dPhi: number): void {
  sph.theta += dTheta;
  sph.phi = Math.max(0.05, Math.min(Math.PI - 0.05, sph.phi + dPhi));
  updateCamera();
}

function resetView(): void {
  sph.theta = Math.PI / 4;
  sph.phi = Math.PI / 3;
  fitCameraToLayers();
}

let wireframeOn = false;
function toggleWireframe(): void {
  wireframeOn = !wireframeOn;
  for (const l of layers) {
    (l.mesh.material as THREE.MeshPhongMaterial).wireframe = wireframeOn;
  }
  document.getElementById('nav-wireframe')?.classList.toggle('active', wireframeOn);
  renderer?.render(scene!, camera!);
}

function takeScreenshot(): void {
  if (!renderer || !scene || !camera) return;
  renderer.render(scene, camera); // ensure the buffer holds the latest frame
  const dataUrl = geoCanvas.toDataURL('image/png');
  (window as any).vsApi?.postMessage({ command: 'saveScreenshot', dataBase64: dataUrl.split(',')[1] });
}

const NAV_BUTTONS: [string, () => void][] = [
  ['nav-rot-left', () => rotateStep(ROTATE_STEP, 0)],
  ['nav-rot-right', () => rotateStep(-ROTATE_STEP, 0)],
  ['nav-tilt-up', () => rotateStep(0, -ROTATE_STEP)],
  ['nav-tilt-down', () => rotateStep(0, ROTATE_STEP)],
  ['nav-pan-left', () => { panCamera(-PAN_STEP_PX, 0); updateCamera(); }],
  ['nav-pan-right', () => { panCamera(PAN_STEP_PX, 0); updateCamera(); }],
  ['nav-pan-up', () => { panCamera(0, -PAN_STEP_PX); updateCamera(); }],
  ['nav-pan-down', () => { panCamera(0, PAN_STEP_PX); updateCamera(); }],
  ['nav-fit', () => fitCameraToLayers()],
  ['nav-reset', resetView],
  ['nav-wireframe', toggleWireframe],
  ['nav-screenshot', takeScreenshot],
];
for (const [id, fn] of NAV_BUTTONS) {
  document.getElementById(id)?.addEventListener('click', fn);
}

// ── Loading state ────────────────────────────────────────────
// Shown from the moment a file is chosen until it's actually parsed and
// added as a layer — previously the "Add geometry layer…" empty-state
// stayed on screen for that whole window, which for a large file looked
// like nothing had happened. Parsing/building the mesh is synchronous
// (single-threaded JS), so simply showing the overlay and immediately
// running that work in the same tick would never let the browser paint
// the overlay first — deferred one frame (double rAF, which reliably
// lands after the next paint) so the spinner is actually visible before
// the heavy work blocks the thread.
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

// ── Message handler ────────────────────────────────────────────
window.addEventListener('message', (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.command === 'loading') {
    showLoading(msg.fileName);
  } else if (msg.command === 'previewGeometry') {
    showLoading(msg.fileName);
    afterPaint(() => {
      try {
        const bytes = b64ToBytes(msg.dataBase64);
        const ext = (msg.fileName || '').toLowerCase();
        // Loaded in native scale/position (no per-file normalize) so
        // multiple layers line up the way they do on disk; addLayer()
        // auto-fits the camera to all of them combined.
        let geo: THREE.BufferGeometry;
        if (ext.endsWith('.obj')) {
          geo = parseOBJ(bytes, false);
        } else if (ext.endsWith('.vtk')) {
          geo = parseVTK(bytes, false);
        } else {
          geo = parseSTL(bytes, msg.isBinary, false);
        }
        addLayer(msg.fileName || `layer ${layers.length + 1}`, geo);
      } catch (err: any) {
        geoLabel.textContent = 'Parse error: ' + err.message;
      } finally {
        hideLoading();
      }
    });
  } else if (msg.command === 'clearLayers') {
    clearAllLayers();
  } else if (msg.command === 'geoDataReady') {
    const img = document.getElementById(msg.canvasId) as HTMLImageElement | null;
    if (img) renderMiniGeo(img, msg.dataBase64, msg.isBinary, msg.ext);
  }
});

// Tell the host we're ready to receive the initial file — postMessage()
// doesn't queue, so a payload posted before this listener is attached
// (e.g. an external <script src> tag still fetching over the network)
// would otherwise be silently dropped.
(window as any).vsApi?.postMessage({ command: 'ready' });
