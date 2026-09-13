import * as fs from "fs";
import * as path from "path";

/**
 * Walks up from `filePath` (a real filesystem path) looking for the
 * OpenFOAM case root — the nearest ancestor directory whose `system/`
 * contains `controlDict` or `fvSchemes`. Returns `null` if none is found
 * within 12 levels (or the filesystem root is hit first).
 *
 * The one shared implementation — `extension.ts`, `caseContext.ts` (via a
 * URI-based wrapper), and `scaffold/context.ts` all previously carried
 * their own copy of this exact walk.
 */
export function findCaseRootFromPath(filePath: string): string | null {
  let dir = path.dirname(filePath);
  for (let i = 0; i < 12; i++) {
    if (
      fs.existsSync(path.join(dir, "system", "controlDict")) ||
      fs.existsSync(path.join(dir, "system", "fvSchemes"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}
