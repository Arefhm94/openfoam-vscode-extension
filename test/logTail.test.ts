import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LogTail, findLikelyLogFile } from "../src/monitor/logTail";

let tmpRoot: string | undefined;
afterEach(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = undefined;
});

function mkCase(): string {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openfoam-logtail-"));
  return tmpRoot;
}

function touch(file: string, ageMs: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "content\n");
  const t = new Date(Date.now() - ageMs);
  fs.utimesSync(file, t, t);
}

describe("findLikelyLogFile", () => {
  it("returns null when nothing matches", () => {
    const root = mkCase();
    expect(findLikelyLogFile(root)).toBeNull();
  });

  it("picks a canonical log.<solver> over other .out files, even if older", () => {
    const root = mkCase();
    touch(path.join(root, "topoSet.out"), 1000); // newer
    touch(path.join(root, "log.simpleFoam"), 5000); // older, but canonical
    expect(findLikelyLogFile(root)).toBe(path.join(root, "log.simpleFoam"));
  });

  it("prefers a *.out with 'solve' in its name over unrelated .out logs (the real ambiguity in examples/Helyx/complex/log/)", () => {
    const root = mkCase();
    const log = path.join(root, "log");
    touch(path.join(log, "check_convergence_gen_10p.out"), 500); // newest overall
    touch(path.join(log, "topoSet.out"), 2000);
    touch(path.join(log, "helyxHexMesh.out"), 3000);
    touch(path.join(log, "helyxSolve_gen_10p.out"), 4000); // oldest, but the real solver log
    expect(findLikelyLogFile(root)).toBe(path.join(log, "helyxSolve_gen_10p.out"));
  });

  it("falls back to most-recently-modified when nothing looks like a solve log", () => {
    const root = mkCase();
    touch(path.join(root, "topoSet.out"), 2000);
    touch(path.join(root, "caseSetup.out"), 500); // newest
    expect(findLikelyLogFile(root)).toBe(path.join(root, "caseSetup.out"));
  });

  it("skips postProcessing/ and processorN/ directories", () => {
    const root = mkCase();
    touch(path.join(root, "postProcessing", "log.simpleFoam"), 100);
    touch(path.join(root, "processor0", "log.simpleFoam"), 100);
    expect(findLikelyLogFile(root)).toBeNull();
  });
});

describe("LogTail", () => {
  it("reads the whole file on the first poll, then only new bytes after that", () => {
    const root = mkCase();
    const file = path.join(root, "log.simpleFoam");
    fs.writeFileSync(file, "Time = 1\nDICPCG:  Solving for p, Initial residual = 1, Final residual = 0.1, No Iterations 3\n");

    const tail = new LogTail(file);
    const first = tail.poll();
    expect(first?.residuals).toHaveLength(1);

    const second = tail.poll(); // nothing new appended yet
    expect(second?.residuals).toHaveLength(0);

    fs.appendFileSync(file, "Time = 2\nDICPCG:  Solving for p, Initial residual = 0.5, Final residual = 0.05, No Iterations 2\n");
    const third = tail.poll();
    expect(third?.residuals).toHaveLength(1);
    expect(third?.residuals[0].time).toBe(2);
  });

  it("returns null and lets the caller reset when the file shrinks (rotated/truncated)", () => {
    const root = mkCase();
    const file = path.join(root, "log.simpleFoam");
    fs.writeFileSync(file, "Time = 1\nTime = 2\nTime = 3\n");
    const tail = new LogTail(file);
    tail.poll();
    fs.writeFileSync(file, "Time = 1\n"); // shrank
    expect(tail.poll()).toBeNull();
  });
});
