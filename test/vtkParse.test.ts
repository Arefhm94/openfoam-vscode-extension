import { describe, it, expect } from "vitest";
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
