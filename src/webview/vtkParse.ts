/**
 * Legacy VTK parser (both ASCII and BINARY) that keeps the indexed
 * representation — points + a VTK-format connectivity blob + named
 * POINT_DATA/CELL_DATA arrays — instead of flattening to a triangle soup
 * the way `geoViewer.ts`'s own `parseVTK()` does for its plain geometry
 * preview.
 *
 * Pure (no DOM, no `three`, no `vtk.js`) so it's unit-testable and usable
 * from either renderer: `fieldViewer.ts` feeds `points`/`polys` straight
 * into `vtkPolyData.newInstance({ points, polys })`, and `pointData`/
 * `cellData` straight into `vtkDataArray.newInstance(...)`.
 *
 * Covers what `foamToVTK`/HELYX actually emit: `DATASET POLYDATA` with
 * POLYGONS (or TRIANGLE_STRIPS) connectivity, and POINT_DATA/CELL_DATA
 * blocks made of SCALARS, VECTORS, NORMALS, and FIELD sub-arrays.
 * Anything else in the file (LINES, POLY_LINES, TENSORS, UNSTRUCTURED_GRID
 * CELLS, …) is safely skipped, not crashed on.
 *
 * **BINARY matters here, not just ASCII**: real OpenFOAM/HELYX
 * `sampleSurface`/`postProcessing/**\/VTK` output defaults to the
 * `BINARY` legacy format (confirmed against a real example file in this
 * repo), which an earlier version of this parser — built and tested only
 * against ASCII fixtures — could not read at all (a plain
 * `text.split(/\s+/)` tokenizer run over raw binary bytes just produces
 * garbage). Legacy-VTK binary data is always big-endian ("network
 * order"), with plain ASCII keyword lines in between fixed-size binary
 * blocks; connectivity (POLYGONS/TRIANGLE_STRIPS) is always written as
 * 4-byte int regardless of the platform's `vtkIdType`, per VTK's own
 * legacy writer.
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

export function parseLegacyVTK(text: string): ParsedVTK | null {
  // The first 3 lines of a legacy-VTK file are always plain ASCII text —
  // version, title, then "ASCII" or "BINARY" — even when the rest of the
  // file is binary, so it's always safe to read them as a string.
  const nl1 = text.indexOf("\n");
  if (nl1 < 0) return null;
  const nl2 = text.indexOf("\n", nl1 + 1);
  if (nl2 < 0) return null;
  const nl3 = text.indexOf("\n", nl2 + 1);
  if (nl3 < 0) return null;
  const formatLine = text.slice(nl2 + 1, nl3).trim().toUpperCase();

  if (formatLine === "BINARY") {
    return parseBinaryLegacyVTK(binaryStringToBytes(text), nl3 + 1);
  }
  return parseAsciiLegacyVTK(text);
}

function binaryStringToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

// ── ASCII ────────────────────────────────────────────────────────────

function findToken(tokens: string[], keyword: string, from = 0): number {
  for (let i = from; i < tokens.length; i++) {
    if (tokens[i] === keyword) return i;
  }
  return -1;
}

/** Reads SCALARS/VECTORS/NORMALS/FIELD sub-arrays starting at `from`,
 *  stopping at the next POINT_DATA/CELL_DATA marker or end of input. */
function readAsciiArrays(tokens: string[], count: number, from: number, out: VTKArray[]): void {
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

function parseAsciiLegacyVTK(text: string): ParsedVTK | null {
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
    readAsciiArrays(tokens, count, idx + 2, tokens[idx] === "POINT_DATA" ? pointData : cellData);
  }

  return { points, polys, numPoints, numCells, pointData, cellData };
}

// ── BINARY ───────────────────────────────────────────────────────────

const BYTES_PER_TYPE: Record<string, number> = {
  float: 4, double: 8,
  int: 4, unsigned_int: 4, long: 4, unsigned_long: 4, vtkIdType: 4,
  short: 2, unsigned_short: 2,
  char: 1, unsigned_char: 1, signed_char: 1, bit: 1,
};

function isAsciiWhitespace(b: number): boolean {
  return b === 0x0a || b === 0x0d || b === 0x20 || b === 0x09;
}

/** Only ever called right after consuming an exact, known-length binary
 *  block, so any whitespace bytes encountered here are real ASCII
 *  delimiters between sections — never binary data misread as
 *  whitespace. */
function skipDelimiterWhitespace(bytes: Uint8Array, pos: number): number {
  let p = pos;
  while (p < bytes.length && isAsciiWhitespace(bytes[p])) p++;
  return p;
}

function readAsciiLine(bytes: Uint8Array, pos: number): { line: string; next: number } {
  let end = pos;
  while (end < bytes.length && bytes[end] !== 0x0a) end++;
  let line = "";
  for (let i = pos; i < end; i++) line += String.fromCharCode(bytes[i]);
  if (line.endsWith("\r")) line = line.slice(0, -1);
  return { line, next: Math.min(end + 1, bytes.length) };
}

function parseBinaryLegacyVTK(bytes: Uint8Array, startPos: number): ParsedVTK | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = startPos;

  let points = new Float32Array(0);
  let numPoints = 0;
  let polys = new Uint32Array(0);
  let numCells = 0;
  const pointData: VTKArray[] = [];
  const cellData: VTKArray[] = [];
  let section: "point" | "cell" | null = null;
  let sectionCount = 0;

  // Reads `count` values of `dtype`, big-endian, starting at `pos`, and
  // advances `pos` past them. Values are widened to Float32Array — safe
  // for connectivity/index data (well under float32's 2^24 exact-integer
  // range for any realistically-sized mesh) and lossless for `float`.
  function readTypedArray(dtype: string, count: number): Float32Array {
    const bpe = BYTES_PER_TYPE[dtype] ?? 4;
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      if (pos + bpe > bytes.length) { out[i] = 0; continue; }
      let v: number;
      switch (dtype) {
        case "double": v = view.getFloat64(pos, false); break;
        case "int": case "long": case "vtkIdType": v = view.getInt32(pos, false); break;
        case "unsigned_int": case "unsigned_long": v = view.getUint32(pos, false); break;
        case "short": v = view.getInt16(pos, false); break;
        case "unsigned_short": v = view.getUint16(pos, false); break;
        case "char": case "signed_char": v = view.getInt8(pos); break;
        case "unsigned_char": case "bit": v = view.getUint8(pos); break;
        default: v = view.getFloat32(pos, false); break; // "float" and anything unrecognized
      }
      out[i] = v;
      pos += bpe;
    }
    return out;
  }

  while (pos < bytes.length) {
    pos = skipDelimiterWhitespace(bytes, pos);
    if (pos >= bytes.length) break;
    const { line, next } = readAsciiLine(bytes, pos);
    pos = next;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    const kw = parts[0];

    if (kw === "DATASET") {
      // "DATASET POLYDATA" etc. — no binary payload, just move on.
      continue;
    } else if (kw === "POINTS") {
      numPoints = parseInt(parts[1], 10);
      points = readTypedArray(parts[2] || "float", numPoints * 3);
    } else if (kw === "POLYGONS" || kw === "TRIANGLE_STRIPS") {
      numCells = parseInt(parts[1], 10);
      const totalInts = parseInt(parts[2], 10);
      polys = Uint32Array.from(readTypedArray("int", totalInts));
    } else if (kw === "POINT_DATA") {
      section = "point";
      sectionCount = parseInt(parts[1], 10);
    } else if (kw === "CELL_DATA") {
      section = "cell";
      sectionCount = parseInt(parts[1], 10);
    } else if (kw === "SCALARS") {
      const name = parts[1];
      const dtype = parts[2] || "float";
      const numComponents = parts[3] ? parseInt(parts[3], 10) : 1;
      // SCALARS is always followed by a "LOOKUP_TABLE <name>" line.
      pos = skipDelimiterWhitespace(bytes, pos);
      const lt = readAsciiLine(bytes, pos);
      if (lt.line.trim().toUpperCase().startsWith("LOOKUP_TABLE")) pos = lt.next;
      const data = readTypedArray(dtype, sectionCount * numComponents);
      (section === "cell" ? cellData : pointData).push({ name, numComponents, data });
    } else if (kw === "VECTORS" || kw === "NORMALS") {
      const name = parts[1];
      const dtype = parts[2] || "float";
      const data = readTypedArray(dtype, sectionCount * 3);
      (section === "cell" ? cellData : pointData).push({ name, numComponents: 3, data });
    } else if (kw === "FIELD") {
      const numArrays = parseInt(parts[2], 10);
      for (let a = 0; a < numArrays; a++) {
        pos = skipDelimiterWhitespace(bytes, pos);
        const hdr = readAsciiLine(bytes, pos);
        pos = hdr.next;
        const hp = hdr.line.trim().split(/\s+/);
        const name = hp[0];
        const numComponents = parseInt(hp[1], 10);
        const numTuples = parseInt(hp[2], 10);
        const dtype = hp[3] || "float";
        const data = readTypedArray(dtype, numComponents * numTuples);
        (section === "cell" ? cellData : pointData).push({ name, numComponents, data });
      }
    } else {
      // An unrecognized keyword (LINES, CELL_TYPES, UNSTRUCTURED_GRID's
      // CELLS, TENSORS, METADATA/INFORMATION, …) has no binary-payload
      // size we know how to skip safely — stop here rather than risk
      // misreading the rest of the file as something else. Whatever was
      // already parsed (points, connectivity, and any arrays read so
      // far) is still returned and usable.
      break;
    }
  }

  if (numPoints === 0 && points.length === 0) return null;
  return { points, polys, numPoints, numCells, pointData, cellData };
}
