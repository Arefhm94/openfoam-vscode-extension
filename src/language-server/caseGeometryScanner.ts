import * as fs from 'fs';
import * as path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GeometryInfo {
  /** Base name without extension, e.g. "building" */
  name: string;
  /** Full filename with extension, e.g. "building.stl" */
  filename: string;
  /** Absolute path on disk */
  filePath: string;
  /** Named solid regions inside an ASCII STL (empty for non-STL or binary STL) */
  regions: string[];
}

export interface CaseGeometry {
  /** Surface mesh files from constant/triSurface/ */
  surfaces: GeometryInfo[];
  /** Feature edge mesh files (.eMesh) */
  featureEdgeMeshes: string[];
  /** Patch names from constant/polyMesh/boundary */
  boundaryPatches: string[];
}

export interface STLStats {
  format: 'ascii' | 'binary';
  triangleCount: number;
  solids: string[];
  bbox: { xMin: number; xMax: number; yMin: number; yMax: number; zMin: number; zMax: number } | null;
  fileSizeBytes: number;
}

export interface PatchInfo {
  name: string;
  type: string;
  nFaces: number;
  startFace: number;
}

// ── Cache entry ───────────────────────────────────────────────────────────────

interface CacheEntry {
  mtimes: Record<string, number>;
  geometry: CaseGeometry;
}

// Surface file extensions recognised as geometry
const SURFACE_EXTS = new Set(['.stl', '.STL', '.obj', '.OBJ', '.vtk', '.nas', '.brep', '.igs', '.step']);

const cache = new Map<string, CacheEntry>();

// Per-file STL stats cache (keyed by filePath, invalidated by mtime)
const stlStatsCache = new Map<string, { mtime: number; stats: STLStats }>();

// Patch info cache (keyed by caseRoot, invalidated by boundary file mtime)
const patchInfoCache = new Map<string, { mtime: number; patches: PatchInfo[] }>();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Scan the case directory and return all geometry information.
 * Results are cached per caseRoot and invalidated when directory mtimes change.
 */
export function scanCaseGeometry(caseRoot: string): CaseGeometry {
  const triSurfaceDir = path.join(caseRoot, 'constant', 'triSurface');
  const eMeshDir      = path.join(caseRoot, 'constant', 'extendedFeatureEdgeMesh');
  const boundaryFile  = path.join(caseRoot, 'constant', 'polyMesh', 'boundary');

  const currentMtimes = gatherMtimes([triSurfaceDir, eMeshDir, boundaryFile]);
  const cached = cache.get(caseRoot);
  if (cached && mtimesMatch(cached.mtimes, currentMtimes)) {
    return cached.geometry;
  }

  const geometry: CaseGeometry = {
    surfaces: scanTriSurfaces(triSurfaceDir),
    featureEdgeMeshes: scanFeatureEdgeMeshes(triSurfaceDir, eMeshDir),
    boundaryPatches: scanBoundaryPatches(boundaryFile),
  };

  // Populate STL regions for each surface
  for (const surf of geometry.surfaces) {
    if (surf.filename.toLowerCase().endsWith('.stl')) {
      surf.regions = extractSTLRegions(surf.filePath);
    }
  }

  cache.set(caseRoot, { mtimes: currentMtimes, geometry });
  return geometry;
}

/**
 * Return just the surface names (without extension) declared in constant/triSurface/.
 * Convenience wrapper for completion providers.
 */
export function getSurfaceNames(caseRoot: string): string[] {
  return scanCaseGeometry(caseRoot).surfaces.map(s => s.name);
}

/**
 * Return surface filenames (with extension) from constant/triSurface/.
 */
export function getSurfaceFilenames(caseRoot: string): string[] {
  return scanCaseGeometry(caseRoot).surfaces.map(s => s.filename);
}

/**
 * Return all .eMesh file names.
 */
export function getFeatureEdgeMeshNames(caseRoot: string): string[] {
  return scanCaseGeometry(caseRoot).featureEdgeMeshes;
}

/**
 * Return patch names parsed from constant/polyMesh/boundary.
 */
export function getBoundaryPatchNames(caseRoot: string): string[] {
  return scanCaseGeometry(caseRoot).boundaryPatches;
}

/**
 * Return named regions inside an STL file.
 */
export function getSTLRegionsForSurface(caseRoot: string, surfaceName: string): string[] {
  const geo = scanCaseGeometry(caseRoot);
  // Match by name (without ext) or filename
  const surf = geo.surfaces.find(
    s => s.name === surfaceName ||
         s.filename === surfaceName ||
         s.filename === surfaceName + '.stl' ||
         s.filename === surfaceName + '.STL'
  );
  return surf?.regions ?? [];
}

/**
 * Parse an STL file and return statistics including triangle count, bounding box,
 * solid names, and file size. Results are cached by mtime.
 */
export function getSTLStats(filePath: string): STLStats | null {
  try {
    const stat = fs.statSync(filePath);
    const cached = stlStatsCache.get(filePath);
    if (cached && cached.mtime === stat.mtimeMs) return cached.stats;

    const stats = parseSTLStats(filePath, stat.size);
    if (stats) stlStatsCache.set(filePath, { mtime: stat.mtimeMs, stats });
    return stats;
  } catch {
    return null;
  }
}

/**
 * Return full patch info (name, type, nFaces, startFace) from constant/polyMesh/boundary.
 */
export function getPatchInfoList(caseRoot: string): PatchInfo[] {
  const boundaryFile = path.join(caseRoot, 'constant', 'polyMesh', 'boundary');
  try {
    const stat = fs.statSync(boundaryFile);
    const cached = patchInfoCache.get(caseRoot);
    if (cached && cached.mtime === stat.mtimeMs) return cached.patches;

    const patches = parsePatchInfo(boundaryFile);
    patchInfoCache.set(caseRoot, { mtime: stat.mtimeMs, patches });
    return patches;
  } catch {
    return [];
  }
}

// ── Private scanning functions ────────────────────────────────────────────────

function scanTriSurfaces(triSurfaceDir: string): GeometryInfo[] {
  const surfaces: GeometryInfo[] = [];
  try {
    const entries = fs.readdirSync(triSurfaceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name);
      if (!SURFACE_EXTS.has(ext)) continue;
      const name = path.basename(entry.name, ext);
      surfaces.push({
        name,
        filename: entry.name,
        filePath: path.join(triSurfaceDir, entry.name),
        regions: [],
      });
    }
  } catch { /* directory doesn't exist — return empty */ }
  return surfaces;
}

function scanFeatureEdgeMeshes(triSurfaceDir: string, eMeshDir: string): string[] {
  const meshes: string[] = [];

  // eMesh files may live in constant/triSurface/ alongside the STLs
  for (const dir of [triSurfaceDir, eMeshDir]) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.emesh')) {
          if (!meshes.includes(entry.name)) meshes.push(entry.name);
        }
      }
    } catch { /* skip missing dirs */ }
  }
  return meshes;
}

function scanBoundaryPatches(boundaryFile: string): string[] {
  const patches: string[] = [];
  try {
    const text = fs.readFileSync(boundaryFile, 'utf-8');
    const lines = text.split('\n');
    let depth = 0;
    let headerPassed = false;

    for (let i = 0; i < lines.length; i++) {
      const ln = stripComments(lines[i]).trim();
      if (!ln) continue;

      // Skip FoamFile header block
      if (/^FoamFile\b/.test(ln)) { headerPassed = false; continue; }
      if (!headerPassed) {
        for (const ch of ln) {
          if (ch === '{') depth++;
          if (ch === '}') { depth--; if (depth <= 0) { headerPassed = true; depth = 0; } }
        }
        continue;
      }

      // After the header: the file contains:
      //   <count>       <- optional integer line
      //   (             <- opening paren (list format)
      //   patchName { type patch; nFaces N; startFace N; }
      //   patchName
      //   {
      //     ...
      //   }
      //   )             <- closing paren
      if (/^\d+$/.test(ln) || ln === '(' || ln === ')') continue;

      // Track brace depth inside the list
      for (const ch of ln) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
      }

      // A patch name appears at depth 0 (inside the list paren)
      // and looks like an identifier on its own line (followed later by {)
      if (depth === 0) {
        const nameM = ln.match(/^([\w.]+)\s*(\{.*)?$/);
        if (nameM) {
          const candidate = nameM[1];
          if (!isKnownHeader(candidate) && !patches.includes(candidate)) {
            patches.push(candidate);
          }
        }
      }
    }
  } catch { /* file doesn't exist */ }
  return patches;
}

function parsePatchInfo(boundaryFile: string): PatchInfo[] {
  const patches: PatchInfo[] = [];
  try {
    const text = fs.readFileSync(boundaryFile, 'utf-8');
    const lines = text.split('\n');
    let depth = 0;
    let headerPassed = false;
    let currentPatch: Partial<PatchInfo> | null = null;

    for (const rawLine of lines) {
      const ln = stripComments(rawLine).trim();
      if (!ln) continue;

      if (/^FoamFile\b/.test(ln)) { headerPassed = false; continue; }
      if (!headerPassed) {
        for (const ch of ln) {
          if (ch === '{') depth++;
          if (ch === '}') { depth--; if (depth <= 0) { headerPassed = true; depth = 0; } }
        }
        continue;
      }

      if (/^\d+$/.test(ln) || ln === '(' || ln === ')') continue;

      const prevDepth = depth;
      for (const ch of ln) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
      }

      if (prevDepth === 0 && depth === 0) {
        // Patch name line
        const nameM = ln.match(/^([\w.]+)\s*(\{.*)?$/);
        if (nameM && !isKnownHeader(nameM[1])) {
          currentPatch = { name: nameM[1], type: '', nFaces: 0, startFace: 0 };
        }
      } else if (currentPatch && depth >= 1) {
        // Inside patch block
        const typeM = ln.match(/\btype\s+([\w]+)\s*;/);
        if (typeM) currentPatch.type = typeM[1];
        const nFacesM = ln.match(/\bnFaces\s+(\d+)\s*;/);
        if (nFacesM) currentPatch.nFaces = parseInt(nFacesM[1], 10);
        const startFaceM = ln.match(/\bstartFace\s+(\d+)\s*;/);
        if (startFaceM) currentPatch.startFace = parseInt(startFaceM[1], 10);
        // Single-line form: name { type patch; nFaces N; startFace N; }
      }

      if (currentPatch && prevDepth > 0 && depth === 0) {
        patches.push({
          name: currentPatch.name!,
          type: currentPatch.type || 'patch',
          nFaces: currentPatch.nFaces ?? 0,
          startFace: currentPatch.startFace ?? 0,
        });
        currentPatch = null;
      }
    }
  } catch { /* file doesn't exist */ }
  return patches;
}

/** Read up to 500 lines of an ASCII STL and extract "solid <name>" entries. */
function extractSTLRegions(filePath: string): string[] {
  const regions: string[] = [];
  try {
    const fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(80);
    fs.readSync(fd, header, 0, 80, 0);
    fs.closeSync(fd);

    // Binary STL starts with arbitrary 80-byte header — it does NOT start with "solid "
    // Actually it CAN start with "solid " but the 5th byte check is not reliable.
    // Safest: if it starts with "solid " treat as ASCII, otherwise skip.
    const headerStr = header.toString('ascii', 0, 6);
    if (headerStr.toLowerCase() !== 'solid ') return regions;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n', 500);
    for (const line of lines) {
      const m = line.trim().match(/^solid\s+(\S+.*)$/i);
      if (m) {
        const name = m[1].trim();
        if (name && !regions.includes(name)) regions.push(name);
      }
    }
  } catch { /* skip unreadable files */ }
  return regions;
}

function parseSTLStats(filePath: string, fileSizeBytes: number): STLStats | null {
  try {
    const fd = fs.openSync(filePath, 'r');
    const headerBuf = Buffer.alloc(84);
    fs.readSync(fd, headerBuf, 0, 84, 0);
    fs.closeSync(fd);

    const headerStr = headerBuf.toString('ascii', 0, 6).toLowerCase();
    const isAscii = headerStr === 'solid ';

    if (isAscii) {
      return parseASCIISTLStats(filePath, fileSizeBytes);
    } else {
      return parseBinarySTLStats(filePath, fileSizeBytes, headerBuf);
    }
  } catch {
    return null;
  }
}

function parseASCIISTLStats(filePath: string, fileSizeBytes: number): STLStats {
  let triangleCount = 0;
  const solids: string[] = [];
  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  let zMin = Infinity, zMax = -Infinity;
  let hasBbox = false;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.startsWith('solid ')) {
        const name = line.slice(6).trim();
        if (name && !solids.includes(name)) solids.push(name);
      } else if (line.startsWith('facet normal')) {
        triangleCount++;
      } else if (line.startsWith('vertex ')) {
        const parts = line.split(/\s+/);
        const x = parseFloat(parts[1]), y = parseFloat(parts[2]), z = parseFloat(parts[3]);
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
          if (x < xMin) xMin = x; if (x > xMax) xMax = x;
          if (y < yMin) yMin = y; if (y > yMax) yMax = y;
          if (z < zMin) zMin = z; if (z > zMax) zMax = z;
          hasBbox = true;
        }
      }
    }
  } catch { /* partial read ok */ }

  return {
    format: 'ascii',
    triangleCount,
    solids,
    bbox: hasBbox ? { xMin, xMax, yMin, yMax, zMin, zMax } : null,
    fileSizeBytes,
  };
}

function parseBinarySTLStats(filePath: string, fileSizeBytes: number, headerBuf: Buffer): STLStats {
  // Binary STL: 80 bytes header + 4 bytes triangle count + 50 bytes per triangle
  const triangleCount = headerBuf.readUInt32LE(80);
  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;
  let zMin = Infinity, zMax = -Infinity;
  let hasBbox = false;

  const MAX_TRIS_FOR_BBOX = 200_000;
  if (triangleCount <= MAX_TRIS_FOR_BBOX) {
    try {
      const fileSize = 84 + triangleCount * 50;
      const buf = Buffer.alloc(fileSize);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buf, 0, fileSize, 0);
      fs.closeSync(fd);

      for (let i = 0; i < triangleCount; i++) {
        const offset = 84 + i * 50;
        // normal: 12 bytes, then 3 vertices × 12 bytes
        for (let v = 0; v < 3; v++) {
          const vOff = offset + 12 + v * 12;
          const x = buf.readFloatLE(vOff);
          const y = buf.readFloatLE(vOff + 4);
          const z = buf.readFloatLE(vOff + 8);
          if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
            if (x < xMin) xMin = x; if (x > xMax) xMax = x;
            if (y < yMin) yMin = y; if (y > yMax) yMax = y;
            if (z < zMin) zMin = z; if (z > zMax) zMax = z;
            hasBbox = true;
          }
        }
      }
    } catch { /* skip */ }
  }

  return {
    format: 'binary',
    triangleCount,
    solids: [],
    bbox: hasBbox ? { xMin, xMax, yMin, yMax, zMin, zMax } : null,
    fileSizeBytes,
  };
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

function gatherMtimes(paths: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const p of paths) {
    try { result[p] = fs.statSync(p).mtimeMs; } catch { result[p] = -1; }
  }
  return result;
}

function mtimesMatch(a: Record<string, number>, b: Record<string, number>): boolean {
  for (const k of Object.keys(b)) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function stripComments(line: string): string {
  const idx = line.indexOf('//');
  return idx >= 0 ? line.slice(0, idx) : line;
}

const HEADER_KEYWORDS = new Set([
  'FoamFile', 'version', 'format', 'class', 'location', 'object',
  'note', 'arch', 'entryPoints', 'codebuild',
]);

function isKnownHeader(word: string): boolean {
  return HEADER_KEYWORDS.has(word) || /^\d/.test(word);
}
