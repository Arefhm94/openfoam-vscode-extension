import { describe, it, expect } from "vitest";
import { regressionSlope, classifyTrend } from "../src/monitor/convergence";

describe("regressionSlope", () => {
  it("is 0 for a flat line", () => {
    expect(regressionSlope([1, 2, 3, 4], [5, 5, 5, 5])).toBeCloseTo(0);
  });
  it("is positive for an increasing line, negative for decreasing", () => {
    expect(regressionSlope([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1);
    expect(regressionSlope([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
  });
  it("returns 0 for fewer than 2 points", () => {
    expect(regressionSlope([1], [1])).toBe(0);
    expect(regressionSlope([], [])).toBe(0);
  });
});

describe("classifyTrend", () => {
  const at = (values: number[]): { time: number; value: number }[] =>
    values.map((value, i) => ({ time: i, value }));

  it("is unknown with too little history", () => {
    expect(classifyTrend(at([1, 0.1, 0.01]))).toBe("unknown");
  });

  it("recognizes a converging (steadily decaying) residual", () => {
    const decaying = at(Array.from({ length: 20 }, (_, i) => 10 ** -(i * 0.5)));
    expect(classifyTrend(decaying)).toBe("converging");
  });

  it("recognizes a diverging (growing) residual", () => {
    const growing = at(Array.from({ length: 20 }, (_, i) => 10 ** (i * 0.3)));
    expect(classifyTrend(growing)).toBe("diverging");
  });

  it("recognizes a stalled (flat) residual", () => {
    const flat = at(Array.from({ length: 20 }, () => 0.01));
    expect(classifyTrend(flat)).toBe("stalled");
  });
});
