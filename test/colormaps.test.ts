import { describe, it, expect } from "vitest";
import { COLORMAPS, findColormap, toCssGradientStops } from "../src/webview/colormaps";

describe("colormaps", () => {
  it("has at least the conventional cool-warm default plus vivid alternatives", () => {
    const ids = COLORMAPS.map(c => c.id);
    expect(ids).toContain("coolwarm");
    expect(ids).toContain("jet");
    expect(ids.length).toBeGreaterThanOrEqual(4);
  });

  it("every preset's stops are sorted, span [0,1], and have valid RGB ranges", () => {
    for (const cmap of COLORMAPS) {
      expect(cmap.stops.length).toBeGreaterThanOrEqual(2);
      expect(cmap.stops[0][0]).toBe(0);
      expect(cmap.stops[cmap.stops.length - 1][0]).toBe(1);
      let prevT = -1;
      for (const [t, r, g, b] of cmap.stops) {
        expect(t).toBeGreaterThan(prevT);
        prevT = t;
        for (const c of [r, g, b]) {
          expect(c).toBeGreaterThanOrEqual(0);
          expect(c).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("findColormap resolves a known id and falls back to the default for an unknown one", () => {
    expect(findColormap("jet").id).toBe("jet");
    expect(findColormap("no-such-map").id).toBe(COLORMAPS[0].id);
  });

  it("toCssGradientStops produces a comma-separated rgb()+percent stop list", () => {
    const css = toCssGradientStops(findColormap("coolwarm"));
    expect(css).toMatch(/^rgb\(\d+,\d+,\d+\) 0%/);
    expect(css).toContain("100%");
    expect(css.split(",").length).toBeGreaterThan(3); // at least 3 stops * (r,g,b grouped, but split on "," also splits inside rgb(...) — just sanity-check it's non-trivial
  });
});
