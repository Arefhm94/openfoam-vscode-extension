/**
 * Pure parser for OpenFOAM/HELYX solver logs — no `vscode`, no `fs`, so
 * it's unit-testable and usable from both the incremental tailer
 * (`logTail.ts`) and a one-shot full-file parse. Verified against a real
 * excerpt of `examples/Helyx/complex/log/helyxSolve_gen_10p.out`
 * (`test/fixtures/helyxSolve-excerpt.log`), not a synthetic guess at the
 * format — this is generic OpenFOAM solver-log shape, not HELYX-specific:
 *
 *   Time = 2
 *   AMG:  Solving for Up, Initial residual = ( 18.1 116.3 17.1 5.9 ), Final residual = ( 0.28 0.29 0.23 0.16 ), No Iterations 2
 *   smoothSolver:  Solving for k, Initial residual = 0.0285, Final residual = 2.74e-05, No Iterations 9
 *   Region: region0 Courant Number mean: 1.83 max: 4019.7
 *   ExecutionTime = 205.02 s  ExecutionStepTime = 11.35 s  ClockTime = 304 s
 */

export interface ResidualSample {
  time: number;
  solver: string;
  field: string;
  /** A scalar field has one entry; a vector/tensor field (e.g. `Up`) keeps
   *  every component rather than collapsing them. */
  initialResidual: number[];
  finalResidual: number[];
  iterations: number;
}

export interface CourantSample {
  time: number;
  region: string;
  mean: number;
  max: number;
}

export interface ExecutionTimeSample {
  time: number;
  executionTime: number;
  stepTime: number;
  clockTime: number;
}

export interface ParsedLog {
  residuals: ResidualSample[];
  courant: CourantSample[];
  executionTimes: ExecutionTimeSample[];
  /** The last `Time = N` seen, even if nothing else followed it yet. */
  lastTime: number | null;
  /** True once an `End` / `Finalising parallel run` line was seen. */
  finished: boolean;
}

const TIME_RE = /^Time\s*=\s*([-\d.eE+]+)\s*$/;
const NUMS_RE = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
// "<solver>:  Solving for <field>, Initial residual = <value|(tuple)>, Final residual = <value|(tuple)>, No Iterations <n>"
const RESIDUAL_RE =
  /^(\S+):\s+Solving for (\S+),\s+Initial residual = (\([^)]*\)|\S+),\s+Final residual = (\([^)]*\)|\S+),\s+No Iterations (\d+)/;
const COURANT_RE = /^Region:\s+(\S+)\s+Courant Number mean:\s+([-\d.eE+]+)\s+max:\s+([-\d.eE+]+)/;
const EXEC_TIME_RE =
  /^ExecutionTime\s*=\s*([-\d.eE+]+)\s*s\s+ExecutionStepTime\s*=\s*([-\d.eE+]+)\s*s\s+ClockTime\s*=\s*([-\d.eE+]+)\s*s/;
const FINISHED_RE = /^(End|Finalising parallel run)\s*$/;

function numsIn(token: string): number[] {
  return (token.match(NUMS_RE) ?? []).map(Number);
}

/** Parses a chunk of solver-log text (a full file, or a newly-appended
 *  tail) into structured samples. `startTime` seeds the "current Time="
 *  context for a chunk that begins mid-block (as an incremental tail's
 *  next read often does). */
export function parseResidualLog(text: string, startTime: number | null = null): ParsedLog {
  const residuals: ResidualSample[] = [];
  const courant: CourantSample[] = [];
  const executionTimes: ExecutionTimeSample[] = [];
  let time = startTime;
  let finished = false;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const timeM = TIME_RE.exec(line);
    if (timeM) {
      time = Number(timeM[1]);
      continue;
    }
    if (FINISHED_RE.test(line)) {
      finished = true;
      continue;
    }
    if (time == null) continue; // haven't seen a "Time = " yet — nothing to attribute this to

    const resM = RESIDUAL_RE.exec(line);
    if (resM) {
      residuals.push({
        time,
        solver: resM[1],
        field: resM[2],
        initialResidual: numsIn(resM[3]),
        finalResidual: numsIn(resM[4]),
        iterations: Number(resM[5]),
      });
      continue;
    }

    const courantM = COURANT_RE.exec(line);
    if (courantM) {
      courant.push({ time, region: courantM[1], mean: Number(courantM[2]), max: Number(courantM[3]) });
      continue;
    }

    const execM = EXEC_TIME_RE.exec(line);
    if (execM) {
      executionTimes.push({
        time,
        executionTime: Number(execM[1]),
        stepTime: Number(execM[2]),
        clockTime: Number(execM[3]),
      });
      continue;
    }
  }

  return { residuals, courant, executionTimes, lastTime: time, finished };
}

/** The final residual's largest component — the natural single number to
 *  chart for a vector/tensor field (e.g. `Up`) alongside plain scalars. */
export function finalResidualMagnitude(s: ResidualSample): number {
  return s.finalResidual.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
}
