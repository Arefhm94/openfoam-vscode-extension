/**
 * The convergence heuristic from Part G of the plan: a trailing-window
 * linear regression on log10(residual) vs. iteration, mirroring the
 * moving-average/delta approach the example case's own
 * `check_convergence_gen_*.out` monitor already uses. Plain arithmetic —
 * no library, no bundled model.
 */

export type Trend = "converging" | "diverging" | "stalled" | "unknown";

/** Least-squares slope of `ys` against `xs` (both same length). */
export function regressionSlope(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

const FLOOR = 1e-300; // avoids log10(0) = -Infinity for an exactly-zero residual

/**
 * Classifies the trailing `windowSize` points of a residual time series
 * (`{ time, value }`, `value` = the (already-magnitude-reduced) final
 * residual). `"unknown"` until there's enough history to say anything.
 */
export function classifyTrend(
  history: { time: number; value: number }[],
  windowSize = 20,
): Trend {
  const win = history.slice(-windowSize);
  if (win.length < 5) return "unknown";
  const xs = win.map(p => p.time);
  const ys = win.map(p => Math.log10(Math.max(Math.abs(p.value), FLOOR)));
  const slope = regressionSlope(xs, ys);
  if (slope > 0.01) return "diverging";
  if (Math.abs(slope) < 0.001) return "stalled";
  return "converging";
}
