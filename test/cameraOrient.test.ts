import { describe, it, expect } from "vitest";
import { computeFaceOnView } from "../src/webview/cameraOrient";

// Regression test for the actual, final root cause of the "field viewer
// shows nothing" reports: vtk.js's `renderer.resetCamera()` only fits
// distance, never direction, so a near-planar dataset (a real
// `sampleSurface`/foamToVTK slice) left at the default camera direction
// can render edge-on — a sliver with ~zero screen-space area, visually
// indistinguishable from nothing rendered at all, even though the
// geometry/mapper/coloring are all correct.
describe("computeFaceOnView", () => {
  it("looks predominantly along the thinnest axis (X here), not away from it", () => {
    // Mirrors the real example that exposed the bug: a plane essentially
    // flat in X (~0 thickness), spanning widely in Y and modestly in Z.
    const bounds = [-1e-15, 1e-15, -5000, 3000, -1e-6, 325];
    const view = computeFaceOnView(bounds);
    const center = { x: 0, y: -1000, z: 162.5 };
    const offsetX = Math.abs(view.position[0] - center.x);
    const offsetY = Math.abs(view.position[1] - center.y);
    const offsetZ = Math.abs(view.position[2] - center.z);
    // The offset along the thin axis (X) must dominate over the offsets
    // along the two wide axes (Y, Z) — this is the exact inversion bug
    // that was caught and fixed: an earlier version did the opposite
    // (biased *away* from the thin axis) and still rendered the plane
    // edge-on.
    expect(offsetX).toBeGreaterThan(offsetY);
    expect(offsetX).toBeGreaterThan(offsetZ);
  });

  it("centers the focal point on the bounds", () => {
    const bounds = [0, 10, -20, 20, 5, 15];
    const view = computeFaceOnView(bounds);
    expect(view.focalPoint).toEqual([5, 0, 10]);
  });

  it("uses Z-up, matching geoViewer.ts's convention", () => {
    const view = computeFaceOnView([0, 10, 0, 10, 0, 10]);
    expect(view.viewUp).toEqual([0, 0, 1]);
  });

  it("places the camera farther away for a larger dataset", () => {
    const small = computeFaceOnView([0, 1, 0, 1, 0, 0.01]);
    const large = computeFaceOnView([0, 1000, 0, 1000, 0, 10]);
    const distOf = (v: ReturnType<typeof computeFaceOnView>) =>
      Math.hypot(...v.position.map((p, i) => p - v.focalPoint[i]));
    expect(distOf(large)).toBeGreaterThan(distOf(small));
  });

  it("doesn't degenerate for a fully flat (zero-thickness) dataset", () => {
    const view = computeFaceOnView([0, 100, 0, 50, 0, 0]);
    expect(Number.isFinite(view.position[0])).toBe(true);
    expect(Number.isFinite(view.position[1])).toBe(true);
    expect(Number.isFinite(view.position[2])).toBe(true);
    // Position must differ from the focal point (a degenerate zero-length
    // view direction would make the camera unable to look at anything).
    const dist = Math.hypot(...view.position.map((p, i) => p - view.focalPoint[i]));
    expect(dist).toBeGreaterThan(0);
  });

  it("picks whichever axis is thinnest, not always X", () => {
    // Thin in Z this time (a horizontal slab) — the bug's inverted
    // version would have looked away from Z (i.e. mostly in X/Y),
    // rendering this edge-on too.
    const bounds = [-5000, 3000, -4000, 4000, -1e-9, 1e-9];
    const view = computeFaceOnView(bounds);
    const offsetZ = Math.abs(view.position[2] - view.focalPoint[2]);
    const offsetX = Math.abs(view.position[0] - view.focalPoint[0]);
    const offsetY = Math.abs(view.position[1] - view.focalPoint[1]);
    expect(offsetZ).toBeGreaterThan(offsetX);
    expect(offsetZ).toBeGreaterThan(offsetY);
  });
});
