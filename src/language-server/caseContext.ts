import * as fs from 'fs';
import * as path from 'path';

export interface VarDef {
  name: string;
  value: string;
  uri: string;
  line: number;
}

export function uriToPath(uri: string): string {
  try {
    return decodeURIComponent(new URL(uri).pathname);
  } catch {
    return uri;
  }
}

export function findCaseRoot(fileUri: string): string | null {
  let dir = path.dirname(uriToPath(fileUri));
  for (let i = 0; i < 12; i++) {
    if (
      fs.existsSync(path.join(dir, 'system', 'controlDict')) ||
      fs.existsSync(path.join(dir, 'system', 'fvSchemes'))
    ) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Expands OpenFOAM/HELYX environment-variable references (`$FOAM_CASE`,
 * `${FOAM_CASE}`, `$FOAM_CASENAME`, `$WM_PROJECT_DIR`, …) that appear in
 * `#include` paths. `$FOAM_CASE` maps to the case root — exactly what
 * `findCaseRoot()` already computes. Unknown `$VAR`s are left as-is so
 * resolution simply fails (as before) rather than misbehaving.
 */
export function expandOpenFoamVars(raw: string, caseRoot: string | null): string {
  const caseName = caseRoot ? path.basename(caseRoot) : undefined;
  const table: Record<string, string | undefined> = {
    FOAM_CASE: caseRoot ?? undefined,
    FOAM_CASENAME: caseName,
    PWD: caseRoot ?? undefined,
    WM_PROJECT_DIR: process.env.WM_PROJECT_DIR,
    WM_PROJECT_USER_DIR: process.env.WM_PROJECT_USER_DIR,
    FOAM_ETC: process.env.FOAM_ETC,
    FOAM_SRC: process.env.FOAM_SRC,
    FOAM_APP: process.env.FOAM_APP,
    FOAM_RUN: process.env.FOAM_RUN,
    FOAM_TUTORIALS: process.env.FOAM_TUTORIALS,
    HOME: process.env.HOME,
  };
  return raw.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, name) => table[name] ?? m);
}

export function resolveInclude(
  includePath: string,
  fromUri: string,
  caseRoot: string | null,
): string | null {
  const clean = expandOpenFoamVars(
    includePath.replace(/^["<]|[">]$/g, '').trim(),
    caseRoot,
  );
  const fromDir = path.dirname(uriToPath(fromUri));

  const candidates: string[] = [];
  if (path.isAbsolute(clean)) candidates.push(clean);
  candidates.push(path.join(fromDir, clean));
  if (caseRoot) {
    candidates.push(path.join(caseRoot, 'system', clean));
    candidates.push(path.join(caseRoot, clean));
  }

  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* skip */ }
  }
  return null;
}

const BLOCK_KWS = new Set([
  'FoamFile', 'ddtSchemes', 'd2dt2Schemes', 'gradSchemes', 'divSchemes',
  'laplacianSchemes', 'interpolationSchemes', 'snGradSchemes', 'fluxScheme',
  'solvers', 'relaxationFactors', 'residualControl', 'SIMPLE', 'PIMPLE', 'PISO',
  'boundaryField', 'internalField', 'dimensions', 'object', 'class', 'location',
  'format', 'version', 'RAS', 'LES', 'castellatedMeshControls', 'snapControls',
  'addLayersControls', 'meshQualityControls', 'blocks', 'vertices', 'edges',
  'boundary', 'mergePatchPairs', 'geometry',
]);

export function collectVariables(text: string, uri: string): VarDef[] {
  const vars: VarDef[] = [];
  const lines = text.split('\n');
  let depth = 0;
  let prevDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\/\/.*/, '').replace(/\/\*.*?\*\//g, '');
    prevDepth = depth;
    for (const ch of raw) {
      if (ch === '{') depth++;
      if (ch === '}') depth = Math.max(0, depth - 1);
    }
    if (prevDepth === 0 && depth === 0) {
      const m = raw.trim().match(/^(\w+)\s+([^;{}\s][^;{}]*?)\s*;/);
      if (m && !BLOCK_KWS.has(m[1])) {
        vars.push({ name: m[1], value: m[2].trim(), uri, line: i });
      }
    }
  }
  return vars;
}

export function resolveVariable(
  name: string,
  fromUri: string,
  caseRoot: string | null,
): VarDef | null {
  try {
    const vars = collectVariables(fs.readFileSync(uriToPath(fromUri), 'utf-8'), fromUri);
    const found = vars.find(v => v.name === name);
    if (found) return found;
  } catch { /* skip */ }

  if (!caseRoot) return null;

  try {
    const sysDir = path.join(caseRoot, 'system');
    for (const entry of fs.readdirSync(sysDir)) {
      const fp = path.join(sysDir, entry);
      try {
        if (!fs.statSync(fp).isFile()) continue;
        const fileUri = 'file://' + fp;
        if (fileUri === fromUri) continue;
        const vars = collectVariables(fs.readFileSync(fp, 'utf-8'), fileUri);
        const found = vars.find(v => v.name === name);
        if (found) return found;
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return null;
}
