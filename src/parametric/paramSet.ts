/** One parameter to sweep: which dictionary entry it targets, and the
 *  set of discrete values to try (a Latin-Hypercube/continuous sampler
 *  is future scope — see the Dakota-export tier for that). */
export interface ParamDef {
  name: string;
  file: string; // case-relative, e.g. "system/controlDict"
  blockPath: string[]; // [] for a top-level entry
  key: string;
  values: string[];
}

export interface VariantEdit {
  file: string;
  blockPath: string[];
  key: string;
  value: string;
}

export interface Variant {
  name: string;
  /** `{ paramName: value }` — for labeling / the dashboard's x-axis. */
  params: Record<string, string>;
  edits: VariantEdit[];
}

/** Every combination of `params`' values (a full grid — Dakota calls
 *  this a "multidim parameter study"). `params: []` yields `[]`. */
export function cartesianVariants(params: ParamDef[]): Variant[] {
  if (!params.length) return [];
  let combos: Record<string, string>[] = [{}];
  for (const p of params) {
    const next: Record<string, string>[] = [];
    for (const combo of combos) {
      for (const v of p.values) next.push({ ...combo, [p.name]: v });
    }
    combos = next;
  }
  return combos.map((combo, i) => ({
    name: `variant_${String(i + 1).padStart(3, "0")}`,
    params: combo,
    edits: params.map(p => ({ file: p.file, blockPath: p.blockPath, key: p.key, value: combo[p.name] })),
  }));
}
