/**
 * Pure geometry for picking a default camera view that shows a dataset
 * face-on rather than edge-on — the actual, final root cause behind
 * repeated "field viewer shows nothing" reports for real OpenFOAM/HELYX
 * sample-surface output this session.
 *
 * `vtk.js`'s `renderer.resetCamera()` only fits the camera's *distance*
 * to the current bounds — it explicitly preserves whatever direction the
 * camera already has (confirmed by instrumenting a real render: after
 * `resetCamera()`, the camera was still looking straight down the fixed
 * default direction it was created with). A `sampleSurface`/`foamToVTK`
 * slice is close to flat in one axis; if the default direction happens to
 * point straight down that thin axis, the whole plane projects to a
 * sliver with ~zero screen-space area — effectively invisible, even
 * though the geometry, mapper, and coloring are all correct.
 *
 * The fix is to look predominantly *along* the bounds' thinnest axis (a
 * near-planar dataset's normal direction), with a slight tilt from the
 * other two so it's a 3/4 view rather than a perfectly flat orthogonal
 * one. Looking *away* from the thin axis (i.e. mostly along the two wide
 * axes) is exactly the edge-on view that made it invisible in the first
 * place — an inverted version of this function was tried and visually
 * confirmed to still render a near-invisible sliver.
 */

export interface FaceOnView {
  position: [number, number, number];
  focalPoint: [number, number, number];
  viewUp: [number, number, number];
}

/**
 * @param bounds `[xmin, xmax, ymin, ymax, zmin, zmax]`, e.g. from
 *   `actor.getBounds()` / `polydata.getBounds()`.
 * @param distanceFactor how many multiples of the bounds' largest extent
 *   to place the camera away from the center (default 2.2, enough
 *   headroom for the whole dataset to fit in a typical perspective FOV
 *   without the fixed pipeline needing to be told the FOV here too).
 */
export function computeFaceOnView(bounds: number[], distanceFactor = 2.2): FaceOnView {
  const [xmin, xmax, ymin, ymax, zmin, zmax] = bounds;
  const dims = [xmax - xmin, ymax - ymin, zmax - zmin];
  const center: [number, number, number] = [(xmin + xmax) / 2, (ymin + ymax) / 2, (zmin + zmax) / 2];
  const maxDim = Math.max(...dims, 1e-6);
  const thinAxis = dims.indexOf(Math.min(...dims));

  const dir = [0.3, 0.3, 0.3];
  dir[thinAxis] = 1.5; // dominant component — look mostly along the normal
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  const dist = maxDim * distanceFactor;

  const position: [number, number, number] = [
    center[0] + (dir[0] / len) * dist,
    center[1] + (dir[1] / len) * dist,
    center[2] + (dir[2] / len) * dist,
  ];

  return { position, focalPoint: center, viewUp: [0, 0, 1] };
}
