/**
 * Colormap presets for the field viewer's legend — a mix of the
 * conventional scientific-visualization default (cool-to-warm, ParaView's
 * own default) and more vivid alternatives, per explicit user request for
 * a choice beyond the single fixed diverging map this viewer shipped
 * with. Each preset is a small set of `[t, r, g, b]` control points
 * (t and r/g/b all 0-1) fed straight into `vtkColorTransferFunction.
 * addRGBPoint(t, r, g, b)`; kept here (not in `fieldViewer.ts`) so the
 * data is plain and testable without a vtk.js/DOM dependency.
 */

export type ColorStop = [t: number, r: number, g: number, b: number];

export interface Colormap {
  id: string;
  label: string;
  stops: ColorStop[];
}

export const COLORMAPS: Colormap[] = [
  {
    id: "coolwarm",
    label: "Cool → Warm (default)",
    stops: [
      [0.0, 0.231, 0.298, 0.753],
      [0.5, 0.865, 0.865, 0.865],
      [1.0, 0.706, 0.016, 0.150],
    ],
  },
  {
    id: "jet",
    label: "Jet (vivid)",
    stops: [
      [0.0, 0, 0, 0.5],
      [0.125, 0, 0, 1],
      [0.375, 0, 1, 1],
      [0.625, 1, 1, 0],
      [0.875, 1, 0, 0],
      [1.0, 0.5, 0, 0],
    ],
  },
  {
    id: "viridis",
    label: "Viridis",
    stops: [
      [0.0, 0x44 / 255, 0x01 / 255, 0x54 / 255],
      [0.25, 0x3b / 255, 0x52 / 255, 0x8b / 255],
      [0.5, 0x21 / 255, 0x90 / 255, 0x8d / 255],
      [0.75, 0x5d / 255, 0xc8 / 255, 0x63 / 255],
      [1.0, 0xfd / 255, 0xe7 / 255, 0x25 / 255],
    ],
  },
  {
    id: "plasma",
    label: "Plasma",
    stops: [
      [0.0, 0x0d / 255, 0x08 / 255, 0x87 / 255],
      [0.25, 0x7e / 255, 0x03 / 255, 0xa8 / 255],
      [0.5, 0xcc / 255, 0x47 / 255, 0x78 / 255],
      [0.75, 0xf8 / 255, 0x94 / 255, 0x41 / 255],
      [1.0, 0xf0 / 255, 0xf9 / 255, 0x21 / 255],
    ],
  },
  {
    id: "grayscale",
    label: "Grayscale",
    stops: [
      [0.0, 0, 0, 0],
      [1.0, 1, 1, 1],
    ],
  },
];

export function findColormap(id: string): Colormap {
  return COLORMAPS.find(c => c.id === id) ?? COLORMAPS[0];
}

/** A CSS `linear-gradient()` stop list matching a preset — for drawing
 *  the legend bar itself without needing a canvas/WebGL round-trip. */
export function toCssGradientStops(cmap: Colormap): string {
  return cmap.stops
    .map(([t, r, g, b]) => `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)}) ${t * 100}%`)
    .join(", ");
}
