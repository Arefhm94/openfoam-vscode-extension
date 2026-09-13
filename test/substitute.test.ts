import { describe, it, expect, beforeAll } from "vitest";
import { getParser, parseText } from "../src/treeSitter/parser";
import type { Parser } from "../src/treeSitter/parser";
import { findEntry, substituteEntryValue, replaceRange } from "../src/parametric/substitute";

let parser: Parser;
beforeAll(async () => {
  parser = await getParser();
});

describe("findEntry", () => {
  it("finds a top-level entry", () => {
    const src = "application simpleFoam;\ndeltaT 0.001;\n";
    const entry = findEntry(parseText(parser, src), [], "deltaT");
    expect(entry?.name).toBe("deltaT");
  });

  it("finds a nested entry via blockPath", () => {
    const src = "PIMPLE\n{\n    nCorrectors 2;\n    nOuterCorrectors 1;\n}\n";
    const entry = findEntry(parseText(parser, src), ["PIMPLE"], "nCorrectors");
    expect(entry?.detail).toBe("2");
  });

  it("returns null when the key or block doesn't exist", () => {
    const src = "application simpleFoam;\n";
    expect(findEntry(parseText(parser, src), [], "deltaT")).toBeNull();
    expect(findEntry(parseText(parser, src), ["PIMPLE"], "nCorrectors")).toBeNull();
  });
});

describe("substituteEntryValue", () => {
  it("rewrites a top-level scalar entry, preserving indentation", () => {
    const src = "application simpleFoam;\ndeltaT      0.001;\nendTime     100;\n";
    const sub = substituteEntryValue(parseText(parser, src), [], "deltaT", "0.01");
    expect(sub).not.toBeNull();
    const out = replaceRange(src, sub!.range, sub!.text);
    expect(out).toBe("application simpleFoam;\ndeltaT    0.01;\nendTime     100;\n");
  });

  it("rewrites a nested entry without touching sibling entries", () => {
    const src = "PIMPLE\n{\n    nCorrectors      2;\n    nOuterCorrectors 1;\n}\n";
    const sub = substituteEntryValue(parseText(parser, src), ["PIMPLE"], "nCorrectors", "5");
    const out = replaceRange(src, sub!.range, sub!.text);
    expect(out).toBe("PIMPLE\n{\n    nCorrectors    5;\n    nOuterCorrectors 1;\n}\n");
  });

  it("returns null for a key that isn't present", () => {
    const src = "application simpleFoam;\n";
    expect(substituteEntryValue(parseText(parser, src), [], "deltaT", "0.01")).toBeNull();
  });
});

describe("replaceRange", () => {
  it("replaces a single-line range in place", () => {
    const text = "a\nbbb\nc";
    const out = replaceRange(text, { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } }, "X");
    expect(out).toBe("a\nX\nc");
  });
});
