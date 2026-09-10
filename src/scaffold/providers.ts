import { InsertableFeature, normalizeFields, NormalizedField } from "./features";

/**
 * The subset of `data/keyword-db.json` the scaffold engine reads. Loosely
 * typed on purpose — the shapes vary by section and providers pick apart
 * only what they need.
 */
export interface ScaffoldDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  boundaryConditions?: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  algorithms?: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schemes?: Record<string, Record<string, any>>;
}

/** RAS/LES model → block template. Structure is stable; no DB data exists
 * for these, so this small hand-authored set is UI convenience (and
 * supersedes the old hardcoded `openfoam.insertTurbulenceBlock`). */
const TURBULENCE_MODELS: Array<{ name: string; kind: "RAS" | "LES"; extra?: string }> = [
  { name: "kOmegaSST", kind: "RAS" },
  { name: "kEpsilon", kind: "RAS" },
  { name: "kOmega", kind: "RAS" },
  { name: "realizableKE", kind: "RAS" },
  { name: "SpalartAllmaras", kind: "RAS" },
  { name: "LaunderSharmaKE", kind: "RAS" },
  { name: "laminar", kind: "RAS" },
  { name: "Smagorinsky", kind: "LES", extra: "    delta           cubeRootVol;\n    cubeRootVolCoeffs { deltaCoeff 1; }\n" },
  { name: "WALE", kind: "LES", extra: "    delta           cubeRootVol;\n    cubeRootVolCoeffs { deltaCoeff 1; }\n" },
  { name: "kEqn", kind: "LES", extra: "    delta           cubeRootVol;\n" },
  { name: "dynamicKEqn", kind: "LES", extra: "    delta           cubeRootVol;\n" },
];

function turbulenceBody(m: { name: string; kind: "RAS" | "LES"; extra?: string }): string {
  if (m.kind === "LES") {
    return `simulationType  LES;\n\nLES\n{\n    LESModel        ${m.name};\n    turbulence      on;\n    printCoeffs     on;\n${m.extra ?? ""}}`;
  }
  return `simulationType  RAS;\n\nRAS\n{\n    RASModel        ${m.name};\n    turbulence      on;\n    printCoeffs     on;\n}`;
}

export interface CollectOptions {
  /** Restrict to one `categoryKey` (from a pre-filtered invocation). */
  category?: string;
  /** BC value-type filter (scalar/vector/…): drops BCs whose `appliesTo` excludes it. */
  fieldValueType?: string;
}

export function collectFeatures(db: ScaffoldDb, opts: CollectOptions = {}): InsertableFeature[] {
  const out: InsertableFeature[] = [];
  const want = (key: string) => !opts.category || opts.category === key;

  // ── Boundary conditions — full prompt flow ──────────────────────────────
  if (want("boundaryConditions") && db.boundaryConditions) {
    for (const [name, info] of Object.entries(db.boundaryConditions)) {
      const appliesTo: string[] = Array.isArray(info?.appliesTo) ? info.appliesTo : [];
      if (opts.fieldValueType && appliesTo.length && !appliesTo.includes(opts.fieldValueType)) continue;
      const fields = normalizeFields(info?.keywords).filter(f => f.name !== "type");
      out.push({
        id: `bc:${name}`,
        label: name,
        categoryLabel: "Boundary condition",
        categoryKey: "boundaryConditions",
        brief: String(info?.brief ?? ""),
        fields: fields.filter(f => f.required),
        typeKeyword: name,
        target: { blockPath: ["boundaryField"], wrap: "namedBlock", nameLabel: "Patch name" },
      });
    }
  }

  // ── fvSolution algorithms (SIMPLE/PIMPLE/PISO/FLUID) — full prompt flow ──
  if (want("algorithms") && db.algorithms) {
    for (const [name, info] of Object.entries(db.algorithms)) {
      const fields: NormalizedField[] = normalizeFields(info?.keywords).filter(f => f.required);
      out.push({
        id: `algo:${name}`,
        label: name,
        categoryLabel: "Solution algorithm",
        categoryKey: "algorithms",
        brief: `${name} pressure–velocity coupling block`,
        fields,
        target: { file: "system/fvSolution", blockPath: [name], wrap: "entries" },
      });
    }
  }

  // ── Turbulence models — catalog (hand-authored templates) ───────────────
  if (want("turbulenceModels")) {
    for (const m of TURBULENCE_MODELS) {
      out.push({
        id: `turb:${m.name}`,
        label: m.name,
        categoryLabel: `Turbulence model (${m.kind})`,
        categoryKey: "turbulenceModels",
        brief: `${m.kind} model — writes the ${m.kind} { } block`,
        fields: [],
        catalogBody: turbulenceBody(m),
        target: { file: "constant/momentumTransport", blockPath: [], wrap: "entries" },
      });
    }
  }

  // ── Schemes — catalog only (searchable; inserts a starting point) ───────
  if (want("schemes") && db.schemes) {
    for (const [cat, members] of Object.entries(db.schemes)) {
      for (const [name, info] of Object.entries(members)) {
        const brief = String(info?.brief ?? "");
        const usage = String(info?.usage ?? "").trim();
        out.push({
          id: `scheme:${cat}:${name}`,
          label: name,
          categoryLabel: `Scheme (${cat})`,
          categoryKey: "schemes",
          brief,
          fields: [],
          catalogBody: usage || `${name};`,
          target: { blockPath: [], wrap: "entries" },
        });
      }
    }
  }

  return out;
}
