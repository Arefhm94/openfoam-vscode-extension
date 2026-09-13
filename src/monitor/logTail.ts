import * as fs from "fs";
import * as path from "path";
import { ParsedLog, parseResidualLog } from "./residualLog";

/**
 * Incrementally tails a solver log: remembers the last byte offset read
 * and only parses newly-appended bytes on each `poll()` — the example
 * logs already reach multi-MB (`helyxSolve_gen_10p.out` is 2.4 MB), so
 * re-parsing the whole file on every tick would not scale to a live run.
 */
export class LogTail {
  private offset = 0;
  private lastTime: number | null = null;

  constructor(public readonly filePath: string) {}

  /** Reads and parses whatever has been appended since the last call
   *  (or the whole file, the first time). Returns `null` if the file
   *  shrank (rotated/truncated) or vanished — callers should reset. */
  poll(): ParsedLog | null {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.filePath);
    } catch {
      return null;
    }
    if (stat.size < this.offset) return null; // rotated/truncated — caller should reset()

    if (stat.size === this.offset) {
      return { residuals: [], courant: [], executionTimes: [], lastTime: this.lastTime, finished: false };
    }

    const fd = fs.openSync(this.filePath, "r");
    try {
      const len = stat.size - this.offset;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, this.offset);
      this.offset = stat.size;
      const parsed = parseResidualLog(buf.toString("utf8"), this.lastTime);
      this.lastTime = parsed.lastTime;
      return parsed;
    } finally {
      fs.closeSync(fd);
    }
  }

  reset(): void {
    this.offset = 0;
    this.lastTime = null;
  }
}

const LOG_NAME_RE = /^(log\..*|.*\.out)$/i;
const SKIP_DIRS = new Set(["postProcessing", "dynamicCode", ".git", "node_modules"]);
const PROCESSOR_DIR_RE = /^processor\d+$/;

interface LogCandidate {
  path: string;
  mtime: number;
  /** Higher wins: 2 = canonical `log.<solver>`, 1 = a `*.out` whose name
   *  says "solve", 0 = anything else matching `LOG_NAME_RE` (mesh/setup/
   *  monitor logs like `topoSet.out`, `check_convergence_*.out`). */
  tier: number;
}

const SOLVE_NAME_RE = /solve/i;

/**
 * The likeliest solver log under `caseRoot`. A case commonly has several
 * `*.out` logs alongside the real solve log (mesh generation, case
 * setup, a bespoke convergence monitor — see
 * `examples/Helyx/complex/log/`, which has all of these); picking
 * whichever is merely most-recently-modified can land on the wrong one.
 * So candidates are ranked by tier first (canonical `log.<solver>` >
 * a `*.out` with "solve" in its name > anything else matching
 * `LOG_NAME_RE`), most-recently-modified within a tier. Shallow-ish
 * search (log files are almost always directly in the case root or one
 * `log/` subdirectory down).
 */
export function findLikelyLogFile(caseRoot: string): string | null {
  const candidates: LogCandidate[] = [];
  const scan = (dir: string, depth: number): void => {
    if (depth > 2) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !PROCESSOR_DIR_RE.test(e.name)) scan(full, depth + 1);
      } else if (e.isFile() && LOG_NAME_RE.test(e.name)) {
        try {
          const mtime = fs.statSync(full).mtimeMs;
          const tier = e.name.startsWith("log.") ? 2 : SOLVE_NAME_RE.test(e.name) ? 1 : 0;
          candidates.push({ path: full, mtime, tier });
        } catch {
          /* skip */
        }
      }
    }
  };
  scan(caseRoot, 0);
  if (!candidates.length) return null;

  const bestTier = Math.max(...candidates.map(c => c.tier));
  const inBestTier = candidates.filter(c => c.tier === bestTier);
  return inBestTier.reduce((a, b) => (b.mtime > a.mtime ? b : a)).path;
}
