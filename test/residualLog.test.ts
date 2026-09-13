import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseResidualLog, finalResidualMagnitude } from "../src/monitor/residualLog";

const FIXTURE = fs.readFileSync(
  path.join(__dirname, "fixtures", "helyxSolve-excerpt.log"),
  "utf8",
);

describe("parseResidualLog against a real HELYX solver-log excerpt", () => {
  it("attributes every residual line to the right Time block", () => {
    const { residuals } = parseResidualLog(FIXTURE);
    const t1 = residuals.filter(r => r.time === 1);
    const t2 = residuals.filter(r => r.time === 2);
    // Time=1: p (x2), Up, w, h, epsilon, k = 7 lines; same shape at Time=2.
    expect(t1).toHaveLength(7);
    expect(t2).toHaveLength(7);
  });

  it("parses a scalar residual line", () => {
    const { residuals } = parseResidualLog(FIXTURE);
    const k1 = residuals.find(r => r.time === 1 && r.field === "k")!;
    expect(k1.solver).toBe("smoothSolver");
    expect(k1.initialResidual).toEqual([1]);
    expect(k1.finalResidual[0]).toBeCloseTo(0.000841452599);
    expect(k1.iterations).toBe(15);
  });

  it("keeps every component of a vector/coupled residual line (Up)", () => {
    const { residuals } = parseResidualLog(FIXTURE);
    const up2 = residuals.find(r => r.time === 2 && r.field === "Up")!;
    expect(up2.initialResidual).toHaveLength(4);
    expect(up2.finalResidual).toHaveLength(4);
    expect(up2.finalResidual[1]).toBeCloseTo(0.2951205328);
  });

  it("parses the Courant number line", () => {
    const { courant } = parseResidualLog(FIXTURE);
    expect(courant).toEqual([
      { time: 1, region: "region0", mean: 1.715180541, max: 2298.097879 },
      { time: 2, region: "region0", mean: 1.838347267, max: 4019.777925 },
    ]);
  });

  it("parses the ExecutionTime line", () => {
    const { executionTimes } = parseResidualLog(FIXTURE);
    expect(executionTimes[0]).toEqual({ time: 1, executionTime: 193.55, stepTime: 108.63, clockTime: 292 });
    expect(executionTimes[1]).toEqual({ time: 2, executionTime: 205.02, stepTime: 11.35, clockTime: 304 });
  });

  it("tracks lastTime and leaves finished false mid-run", () => {
    const parsed = parseResidualLog(FIXTURE);
    expect(parsed.lastTime).toBe(2);
    expect(parsed.finished).toBe(false);
  });

  it("recognizes an End marker as finished", () => {
    expect(parseResidualLog("Time = 5\nEnd\n").finished).toBe(true);
    expect(parseResidualLog("Time = 5\nFinalising parallel run\n").finished).toBe(true);
  });

  it("ignores residual-shaped lines before any Time= is seen", () => {
    const { residuals } = parseResidualLog(
      "DICPCG:  Solving for p, Initial residual = 1, Final residual = 0.1, No Iterations 3\nTime = 1\n" +
        "DICPCG:  Solving for p, Initial residual = 1, Final residual = 0.1, No Iterations 3\n",
    );
    expect(residuals).toHaveLength(1);
  });

  it("seeds an incremental tail chunk with the caller's startTime", () => {
    const chunk = "DICPCG:  Solving for p, Initial residual = 1, Final residual = 0.1, No Iterations 3\n";
    const { residuals } = parseResidualLog(chunk, 7);
    expect(residuals[0].time).toBe(7);
  });
});

describe("finalResidualMagnitude", () => {
  it("is the value itself for a scalar residual", () => {
    const { residuals } = parseResidualLog(FIXTURE);
    const k1 = residuals.find(r => r.time === 1 && r.field === "k")!;
    expect(finalResidualMagnitude(k1)).toBeCloseTo(0.000841452599);
  });

  it("is the largest-magnitude component for a vector residual", () => {
    const { residuals } = parseResidualLog(FIXTURE);
    const up1 = residuals.find(r => r.time === 1 && r.field === "Up")!;
    expect(finalResidualMagnitude(up1)).toBeCloseTo(0.6904542581);
  });
});
