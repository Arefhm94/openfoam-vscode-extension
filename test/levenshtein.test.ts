import { describe, it, expect } from "vitest";
import { levenshtein, closestMatch } from "../src/shared/levenshtein";

describe("levenshtein", () => {
  it("is 0 for identical strings", () => {
    expect(levenshtein("wallDist", "wallDist")).toBe(0);
  });
  it("counts a single substitution", () => {
    expect(levenshtein("walldis", "walldist")).toBe(1); // one insertion
  });
  it("handles empty strings", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });
});

describe("closestMatch", () => {
  const candidates = ["stopAt", "startFrom", "writeControl", "purgeWrite", "deltaT"];

  it("finds the nearest candidate within the distance threshold", () => {
    expect(closestMatch("stopat", candidates)).toBe("stopAt");
    expect(closestMatch("deltaTT", candidates)).toBe("deltaT");
  });

  it("returns undefined when nothing is close enough", () => {
    expect(closestMatch("completelyUnrelatedNonsense", candidates)).toBeUndefined();
  });
});
