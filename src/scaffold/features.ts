/**
 * Data model for the "Search & Configure" scaffold engine. The engine is
 * data-driven: providers (see `providers.ts`) turn slices of
 * `data/keyword-db.json` into `InsertableFeature` descriptors, and the
 * engine's quick-pick → prompt → preview → write pipeline works off the
 * descriptor alone. Adding/enriching a category is a provider/data change,
 * never an engine change.
 */

/** One prompt-able parameter, normalized from the DB's several FieldSpec shapes. */
export interface NormalizedField {
  name: string;
  type?: string;
  required: boolean;
  default?: string;
  options?: string[];
  description?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RawFieldMap = Record<string, any>;

/** Flattens a `{ name: {required,type,options,default,description} }` map. */
export function normalizeFields(map: RawFieldMap | undefined): NormalizedField[] {
  if (!map) return [];
  return Object.entries(map).map(([name, s]) => ({
    name,
    type: typeof s?.type === "string" ? s.type : undefined,
    required: s?.required === true,
    default: s?.default != null ? String(s.default) : undefined,
    options: Array.isArray(s?.options) ? s.options.map(String) : undefined,
    description: typeof s?.description === "string" ? s.description : undefined,
  }));
}

export interface TargetSpec {
  /**
   * Case-root-relative dictionary file, e.g. `"system/fvSolution"`. When
   * omitted, the target is the currently active document (used for
   * boundary conditions, which go into whichever `0/<field>` file is open).
   */
  file?: string;
  /** Nested block path to place the content in/under, e.g. `["boundaryField"]`. */
  blockPath: string[];
  /**
   * `"entries"` — the rendered `key value;` lines go straight into the last
   * block of `blockPath`.
   * `"namedBlock"` — wrap them in a `<name> { ... }` block first (a patch
   * for BCs, a function-object instance name, ...), prompting for `<name>`.
   */
  wrap: "entries" | "namedBlock";
  /** For `wrap: "namedBlock"` — the prompt label for the block name. */
  nameLabel?: string;
}

export interface InsertableFeature {
  id: string;
  label: string;
  categoryLabel: string;
  categoryKey: string;
  brief: string;
  /** Required parameters to prompt for. Empty ⇒ catalog-only (no prompts). */
  fields: NormalizedField[];
  /** For catalog-only features: the block body to insert verbatim. */
  catalogBody?: string;
  /** Rendered as the first `type <keyword>;` line (BCs, function objects). */
  typeKeyword?: string;
  target: TargetSpec;
}

const INDENT = "    ";

/**
 * Assembles the `key value;` body for a feature from the collected values.
 * Not the enclosing block — `blockLocator`/the engine synthesizes wrappers.
 */
export function renderBody(feature: InsertableFeature, values: Record<string, string>): string {
  if (feature.fields.length === 0 && feature.catalogBody) return feature.catalogBody;
  const lines: string[] = [];
  if (feature.typeKeyword) lines.push(`type${INDENT}${INDENT}${feature.typeKeyword};`);
  for (const f of feature.fields) {
    const v = values[f.name];
    if (v == null || v === "") continue;
    lines.push(`${f.name}${INDENT}${INDENT}${v};`);
  }
  return lines.join("\n");
}

function seedValue(f: NormalizedField): string {
  if (f.default && f.default.length) return f.default;
  if (f.options && f.options.length) return f.options[0];
  return `<${f.type || "value"}>`;
}

/**
 * A ready-to-edit plain-text draft of the block: every required field on
 * its own `key value;` line, seeded from its `default` (else the first
 * enum option, else a `<type>` placeholder). This is what gets dropped
 * into the staging tab for the user to edit as ordinary dictionary text
 * before pressing **Write**. Catalog-only features use their body as-is.
 */
export function renderTemplate(feature: InsertableFeature): string {
  if (feature.fields.length === 0) return feature.catalogBody ?? "";
  const lines: string[] = [];
  if (feature.typeKeyword) lines.push(`type${INDENT}${INDENT}${feature.typeKeyword};`);
  for (const f of feature.fields) {
    lines.push(`${f.name}${INDENT}${INDENT}${seedValue(f)};`);
  }
  return lines.join("\n");
}

function escapeSnippet(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\$/g, "\\$").replace(/}/g, "\\}");
}
function escapeChoice(s: string): string {
  return s.replace(/[\\,|]/g, m => "\\" + m);
}

/**
 * The block as an LSP/TextMate **snippet** (`${1:…}` / `${n|a,b,c|}` tab
 * stops), for the `??` inline-completion path: the user picks a feature in
 * the completion popup and tabs through the fields right where they typed.
 * Wrapped in a `<name> { … }` block for `namedBlock` targets so a boundary
 * condition typed inside `boundaryField` becomes a whole patch entry.
 */
export function renderSnippet(feature: InsertableFeature): string {
  const inner: string[] = [];
  if (feature.fields.length === 0) {
    inner.push(escapeSnippet(feature.catalogBody ?? ""));
  } else {
    if (feature.typeKeyword) inner.push(`type${INDENT}${INDENT}${feature.typeKeyword};`);
    let tab = 1;
    for (const f of feature.fields) {
      const ph =
        f.options && f.options.length
          ? `\${${tab}|${f.options.map(escapeChoice).join(",")}|}`
          : `\${${tab}:${escapeSnippet(seedValue(f))}}`;
      inner.push(`${f.name}${INDENT}${INDENT}${ph};`);
      tab++;
    }
  }
  const body = inner.join("\n");
  if (feature.target.wrap === "namedBlock") {
    const nameStop = `\${${feature.fields.length + 1}:${escapeSnippet(feature.target.nameLabel ?? "name")}}`;
    const indented = body.split("\n").map(l => (l ? INDENT + l : l)).join("\n");
    return `${nameStop}\n{\n${indented}\n}`;
  }
  return body;
}
