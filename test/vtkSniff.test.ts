import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { looksLikeFieldData } from "../src/shared/vtkSniff";

// Regression test for the real bug this fixed: a legacy-VTK file's
// POINT_DATA/CELL_DATA section always comes *after* the POINTS/POLYGONS
// data it describes, so for any mesh with more than a handful of points
// it sits well past the first few KB — the original 8 KB sniff missed it
// on every real example file, misrouting field-data VTKs to the plain
// geometry viewer instead of the field viewer.
describe("looksLikeFieldData", () => {
  const tmpFiles: string[] = [];
  afterEach(() => {
    for (const f of tmpFiles.splice(0)) {
      try { fs.unlinkSync(f); } catch { /* ignore */ }
    }
  });

  function writeTmp(content: string): string {
    const p = path.join(os.tmpdir(), `vtksniff-${Date.now()}-${Math.random().toString(36).slice(2)}.vtk`);
    fs.writeFileSync(p, content);
    tmpFiles.push(p);
    return p;
  }

  it("finds POINT_DATA even when it appears well past 8 KB of geometry data", () => {
    const nPoints = 5000; // "0 0 0\n" per line * 5000 lines >> 8 KB
    const pointLines = Array.from({ length: nPoints }, () => "0 0 0").join("\n");
    const content =
      `# vtk DataFile Version 2.0\ntest\nASCII\nDATASET POLYDATA\n` +
      `POINTS ${nPoints} float\n${pointLines}\n` +
      `POINT_DATA ${nPoints}\nSCALARS p float 1\nLOOKUP_TABLE default\n` +
      Array.from({ length: nPoints }, () => "1.0").join("\n");
    const file = writeTmp(content);
    expect(fs.statSync(file).size).toBeGreaterThan(8192);
    expect(looksLikeFieldData(file)).toBe(true);
  });

  it("finds CELL_DATA past the 8 KB mark too", () => {
    const filler = "0 0 0\n".repeat(3000);
    const content = `# vtk DataFile Version 2.0\ntest\nASCII\n${filler}CELL_DATA 10\n`;
    const file = writeTmp(content);
    expect(looksLikeFieldData(file)).toBe(true);
  });

  it("returns false for bare geometry with no field data at all", () => {
    const content = `# vtk DataFile Version 2.0\ntest\nASCII\nDATASET POLYDATA\nPOINTS 4 float\n0 0 0\n1 0 0\n1 1 0\n0 1 0\nPOLYGONS 1 5\n4 0 1 2 3\n`;
    const file = writeTmp(content);
    expect(looksLikeFieldData(file)).toBe(false);
  });

  it("returns false for a nonexistent file rather than throwing", () => {
    expect(looksLikeFieldData("/no/such/file.vtk")).toBe(false);
  });
});
