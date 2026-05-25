import * as THREE from 'three';

const geoPanel   = document.getElementById('geo-panel')   as HTMLElement;
const splitHandle = document.getElementById('split-handle') as HTMLElement;
const geoCanvas  = document.getElementById('geo-canvas')  as HTMLCanvasElement;
const geoLabel   = document.getElementById('geo-label')   as HTMLElement;
const geoClose   = document.getElementById('geo-close')   as HTMLElement;
const axesCanvas = document.getElementById('axes-canvas') as HTMLCanvasElement;
const axCtx      = axesCanvas?.getContext('2d') ?? null;

let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let mesh: THREE.Mesh | null = null;
let ready = false;
const target = new THREE.Vector3(0, 0, 0);

// Z-up spherical orbit: phi=polar from Z, theta=azimuth
let sph = { theta: Math.PI / 4, phi: Math.PI / 3, r: 3 };
let isDown = false, lx = 0, ly = 0;
let dragMode: 'rotate' | 'pan' = 'rotate';

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
    dragMode = (e.button === 2 || e.shiftKey) ? 'pan' : 'rotate';
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
    sph.r = Math.max(0.3, Math.min(50, sph.r * (e.deltaY > 0 ? 1.1 : 0.9)));
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

function parseSTL(bytes: Uint8Array, isBinary: boolean): THREE.BufferGeometry {
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

  geo.computeBoundingBox();
  const c = new THREE.Vector3();
  geo.boundingBox!.getCenter(c);
  geo.translate(-c.x, -c.y, -c.z);
  geo.computeBoundingBox();
  const sz = new THREE.Vector3();
  geo.boundingBox!.getSize(sz);
  const s = 2 / Math.max(sz.x, sz.y, sz.z, 0.001);
  geo.scale(s, s, s);
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

function renderMiniGeo(imgEl: HTMLImageElement, dataBase64: string, isBinary: boolean): void {
  try {
    const bytes = b64ToBytes(dataBase64);
    const geo   = parseSTL(bytes, isBinary);
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

// ── Show / hide panel ─────────────────────────────────────────
function showPanel() {
  geoPanel.style.display   = 'flex';
  splitHandle.style.display = 'block';
}
function hidePanel() {
  geoPanel.style.display   = 'none';
  splitHandle.style.display = 'none';
  renderer?.setAnimationLoop(null);
}

geoClose?.addEventListener('click', hidePanel);

window.addEventListener('message', (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.command === 'previewGeometry') {
    showPanel();
    geoLabel.textContent = msg.fileName || '';
    init();
    renderer?.setAnimationLoop(() => { renderer!.render(scene!, camera!); drawAxes(); });
    try {
      const bytes = b64ToBytes(msg.dataBase64);
      const geo   = parseSTL(bytes, msg.isBinary);
      if (mesh && scene) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      const mat = new THREE.MeshPhongMaterial({ color: 0x4db8ff, specular: 0x334455, shininess: 40, side: THREE.DoubleSide });
      mesh = new THREE.Mesh(geo, mat);
      scene!.add(mesh);
      const triCount = geo.attributes.position.count / 3;
      geoLabel.textContent = msg.fileName + ' — ' + triCount.toLocaleString() + ' tri  |  drag rotate  |  right-drag/Shift+drag pan  |  scroll zoom';
    } catch (err: any) {
      geoLabel.textContent = 'Parse error: ' + err.message;
    }
  } else if (msg.command === 'hideGeoViewer') {
    hidePanel();
  } else if (msg.command === 'geoDataReady') {
    const img = document.getElementById(msg.canvasId) as HTMLImageElement | null;
    if (img) renderMiniGeo(img, msg.dataBase64, msg.isBinary);
  }
});
