import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { parseLegacyVTK } from "../src/webview/vtkParse";

// A minimal, valid legacy-VTK POLYDATA file with both POINT_DATA and
// CELL_DATA — the shape `foamToVTK` output takes, but no real sample with
// field data exists in examples/ (checked: the committed .vtk fixtures are
// bare featureEdgeMesh geometry), so this is a small synthetic fixture
// covering the sections that matter: POLYGONS connectivity, SCALARS (with
// an explicit numComponents and a defaulted one), and VECTORS.
const FIXTURE = `
# vtk DataFile Version 2.0
test
ASCII
DATASET POLYDATA
POINTS 4 float
0 0 0
1 0 0
1 1 0
0 1 0
POLYGONS 1 5
4 0 1 2 3
POINT_DATA 4
SCALARS p float
LOOKUP_TABLE default
1.0 2.0 3.0 4.0
CELL_DATA 1
VECTORS U float
0.1 0.2 0.3
`;

describe("parseLegacyVTK", () => {
  it("reads POINTS and the POLYGONS connectivity blob as-is", () => {
    const v = parseLegacyVTK(FIXTURE)!;
    expect(v.numPoints).toBe(4);
    expect(Array.from(v.points)).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    expect(v.numCells).toBe(1);
    expect(Array.from(v.polys)).toEqual([4, 0, 1, 2, 3]);
  });

  it("reads a POINT_DATA SCALARS array (numComponents defaults to 1)", () => {
    const v = parseLegacyVTK(FIXTURE)!;
    expect(v.pointData).toHaveLength(1);
    expect(v.pointData[0]).toMatchObject({ name: "p", numComponents: 1 });
    expect(Array.from(v.pointData[0].data)).toEqual([1, 2, 3, 4]);
  });

  it("reads a CELL_DATA VECTORS array (3 components)", () => {
    const v = parseLegacyVTK(FIXTURE)!;
    expect(v.cellData).toHaveLength(1);
    expect(v.cellData[0]).toMatchObject({ name: "U", numComponents: 3 });
    const [x, y, z] = v.cellData[0].data;
    expect(x).toBeCloseTo(0.1);
    expect(y).toBeCloseTo(0.2);
    expect(z).toBeCloseTo(0.3);
  });

  it("returns null when there's no POINTS section", () => {
    expect(parseLegacyVTK("not a vtk file")).toBeNull();
  });

  it("parses geometry fine when there is no field data at all", () => {
    const v = parseLegacyVTK(`DATASET POLYDATA\nPOINTS 3 float\n0 0 0\n1 0 0\n0 1 0\nPOLYGONS 1 4\n3 0 1 2\n`)!;
    expect(v.numPoints).toBe(3);
    expect(v.pointData).toEqual([]);
    expect(v.cellData).toEqual([]);
  });
});

// The real bug this covers: OpenFOAM/HELYX `sampleSurface`/`postProcessing`
// output defaults to the legacy **BINARY** format (confirmed against a real
// example committed in this repo), which the ASCII-only tokenizer above
// cannot read at all — every real field-data .vtk was silently unreadable.
// Legacy-VTK binary values are always big-endian ("network order").
function float32BE(values: number[]): Buffer {
  const buf = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => buf.writeFloatBE(v, i * 4));
  return buf;
}
function int32BE(values: number[]): Buffer {
  const buf = Buffer.alloc(values.length * 4);
  values.forEach((v, i) => buf.writeInt32BE(v, i * 4));
  return buf;
}
/** `Buffer.toString('latin1')` maps each byte 0-255 straight to the same
 *  code unit, matching what `atob(base64)` produces in a real webview —
 *  the exact string shape `parseLegacyVTK` is fed at runtime. */
function toBinaryString(buf: Buffer): string {
  return buf.toString("latin1");
}

describe("parseLegacyVTK — BINARY format", () => {
  it("reads points, POLYGONS connectivity, a POINT_DATA SCALARS array, and a CELL_DATA VECTORS array", () => {
    const text =
      "# vtk DataFile Version 2.0\ntest\nBINARY\nDATASET POLYDATA\n" +
      "POINTS 4 float\n" + toBinaryString(float32BE([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0])) +
      "\nPOLYGONS 1 5\n" + toBinaryString(int32BE([4, 0, 1, 2, 3])) +
      "\nPOINT_DATA 4\nSCALARS p float 1\nLOOKUP_TABLE default\n" + toBinaryString(float32BE([1, 2, 3, 4])) +
      "\nCELL_DATA 1\nVECTORS U float\n" + toBinaryString(float32BE([0.1, 0.2, 0.3]));

    const v = parseLegacyVTK(text)!;
    expect(v.numPoints).toBe(4);
    expect(Array.from(v.points)).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    expect(v.numCells).toBe(1);
    expect(Array.from(v.polys)).toEqual([4, 0, 1, 2, 3]);
    expect(v.pointData).toHaveLength(1);
    expect(v.pointData[0]).toMatchObject({ name: "p", numComponents: 1 });
    expect(Array.from(v.pointData[0].data)).toEqual([1, 2, 3, 4]);
    expect(v.cellData).toHaveLength(1);
    expect(v.cellData[0]).toMatchObject({ name: "U", numComponents: 3 });
    expect(v.cellData[0].data[0]).toBeCloseTo(0.1);
    expect(v.cellData[0].data[1]).toBeCloseTo(0.2);
    expect(v.cellData[0].data[2]).toBeCloseTo(0.3);
  });

  it("handles bare binary geometry with no field data at all", () => {
    const text =
      "# vtk DataFile Version 2.0\ntest\nBINARY\nDATASET POLYDATA\n" +
      "POINTS 3 float\n" + toBinaryString(float32BE([0, 0, 0, 1, 0, 0, 0, 1, 0])) +
      "\nPOLYGONS 1 4\n" + toBinaryString(int32BE([3, 0, 1, 2]));
    const v = parseLegacyVTK(text)!;
    expect(v.numPoints).toBe(3);
    expect(Array.from(v.polys)).toEqual([3, 0, 1, 2]);
    expect(v.pointData).toEqual([]);
    expect(v.cellData).toEqual([]);
  });

  // End-to-end against the real file that exposed the bug — this is
  // exactly what HELYX/OpenFOAM's `sampleSurface`/foamToVTK output
  // actually looks like, not a hand-built approximation of it.
  it("reads a real HELYX postProcessing sample-surface VTK file (binary, real field data)", () => {
    const realFile = path.join(
      __dirname, "..", "examples", "Helyx", "complex", "postProcessing", "p_ymid.vtk",
    );
    if (!fs.existsSync(realFile)) return; // example assets are optional in some checkouts
    const text = toBinaryString(fs.readFileSync(realFile));
    const v = parseLegacyVTK(text)!;
    expect(v).not.toBeNull();
    expect(v.numPoints).toBe(126390);
    expect(v.numCells).toBe(257202);
    expect(v.points.length).toBe(126390 * 3);
    expect(v.pointData.length).toBeGreaterThan(0);
    expect(v.pointData.some(a => a.name === "p")).toBe(true);
  });
});
