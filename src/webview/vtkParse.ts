/**
 * Legacy VTK (ASCII) parser that keeps the indexed representation —
 * points + a VTK-format connectivity blob + named POINT_DATA/CELL_DATA
 * arrays — instead of flattening to a triangle soup the way
 * `geoViewer.ts`'s own `parseVTK()` does for its plain geometry preview.
 *
 * Pure (no DOM, no `three`, no `vtk.js`) so it's unit-testable and usable
 * from either renderer: `fieldViewer.ts` feeds `points`/`polys` straight
 * into `vtkPolyData.newInstance({ points, polys })`, and `pointData`/
 * `cellData` straight into `vtkDataArray.newInstance(...)`.
 *
 * Covers what `foamToVTK`/HELYX actually emit: POLYGONS (or
 * TRIANGLE_STRIPS) connectivity, and POINT_DATA/CELL_DATA blocks made of
 * SCALARS, VECTORS, NORMALS, and FIELD sub-arrays. Anything else in the
 * file (LINES, POLY_LINES, TENSORS, …) is safely skipped, not crashed on.
 */

export interface VTKArray {
  name: string;
  numComponents: number;
  data: Float32Array;
}

export interface ParsedVTK {
  /** Flat xyz, length = numPoints * 3. */
  points: Float32Array;
  /** VTK connectivity blob: `[n, i0..i(n-1), n, i0..i(n-1), ...]` — the
   *  same shape vtk.js's `vtkPolyData` `polys` array expects. */
  polys: Uint32Array;
  numPoints: number;
  numCells: number;
  pointData: VTKArray[];
  cellData: VTKArray[];
}

function findToken(tokens: string[], keyword: string, from = 0): number {
  for (let i = from; i < tokens.length; i++) {
    if (tokens[i] === keyword) return i;
  }
  return -1;
}

/** Reads SCALARS/VECTORS/NORMALS/FIELD sub-arrays starting at `from`,
 *  stopping at the next POINT_DATA/CELL_DATA marker or end of input. */
function readArrays(tokens: string[], count: number, from: number, out: VTKArray[]): void {
  let c = from;
  while (c < tokens.length) {
    const kw = tokens[c];
    if (kw === "POINT_DATA" || kw === "CELL_DATA") return;

    if (kw === "SCALARS") {
      const name = tokens[c + 1];
      // tokens[c + 2] is the data type (float/int/…), ignored.
      let numComponents = 1;
      let next = c + 3;
      const maybeCount = Number(tokens[next]);
      if (tokens[next] !== undefined && tokens[next] !== "LOOKUP_TABLE" && Number.isFinite(maybeCount)) {
        numComponents = maybeCount;
        next++;
      }
      if (tokens[next] === "LOOKUP_TABLE") next += 2; // "LOOKUP_TABLE <name>"
      const data = new Float32Array(count * numComponents);
      for (let k = 0; k < data.length; k++) data[k] = parseFloat(tokens[next++]);
      out.push({ name, numComponents, data });
      c = next;
    } else if (kw === "VECTORS" || kw === "NORMALS") {
      const name = tokens[c + 1];
      let next = c + 3; // skip name + data type
      const data = new Float32Array(count * 3);
      for (let k = 0; k < data.length; k++) data[k] = parseFloat(tokens[next++]);
      out.push({ name, numComponents: 3, data });
      c = next;
    } else if (kw === "FIELD") {
      const numArrays = parseInt(tokens[c + 2], 10);
      let next = c + 3;
      for (let a = 0; a < numArrays && next < tokens.length; a++) {
        const name = tokens[next];
        const numComponents = parseInt(tokens[next + 1], 10);
        const numTuples = parseInt(tokens[next + 2], 10);
        next += 4; // name, numComponents, numTuples, data type
        const data = new Float32Array(numComponents * numTuples);
        for (let k = 0; k < data.length; k++) data[k] = parseFloat(tokens[next++]);
        out.push({ name, numComponents, data });
      }
      c = next;
    } else {
      c++; // unrecognized marker (TENSORS, COLOR_SCALARS, …) — skip defensively
    }
  }
}

export function parseLegacyVTK(text: string): ParsedVTK | null {
  const tokens = text.split(/\s+/).filter(Boolean);

  const ptsIdx = findToken(tokens, "POINTS");
  if (ptsIdx < 0) return null;
  const numPoints = parseInt(tokens[ptsIdx + 1], 10);
  let cursor = ptsIdx + 3; // "POINTS", count, data type
  const points = new Float32Array(numPoints * 3);
  for (let k = 0; k < points.length; k++) points[k] = parseFloat(tokens[cursor++]);

  let polys = new Uint32Array(0);
  let numCells = 0;
  const polyIdx = findToken(tokens, "POLYGONS", cursor);
  const stripIdx = findToken(tokens, "TRIANGLE_STRIPS", cursor);
  const cellIdx = polyIdx < 0 ? stripIdx : stripIdx < 0 ? polyIdx : Math.min(polyIdx, stripIdx);
  if (cellIdx >= 0) {
    numCells = parseInt(tokens[cellIdx + 1], 10);
    const totalInts = parseInt(tokens[cellIdx + 2], 10);
    let pc = cellIdx + 3;
    polys = new Uint32Array(totalInts);
    for (let k = 0; k < totalInts; k++) polys[k] = parseInt(tokens[pc++], 10);
    cursor = pc;
  }

  const pointData: VTKArray[] = [];
  const cellData: VTKArray[] = [];
  const pdIdx = findToken(tokens, "POINT_DATA", cursor);
  const cdIdx = findToken(tokens, "CELL_DATA", cursor);
  for (const idx of [pdIdx, cdIdx].filter(i => i >= 0).sort((a, b) => a - b)) {
    const count = parseInt(tokens[idx + 1], 10);
    readArrays(tokens, count, idx + 2, tokens[idx] === "POINT_DATA" ? pointData : cellData);
  }

  return { points, polys, numPoints, numCells, pointData, cellData };
}
