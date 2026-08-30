import { describe, expect, it } from "vitest";
import { Bm25Index, tokenize } from "../lib/rag/bm25";

describe("tokenize", () => {
  it("lowercases and strips punctuation, dropping single-character tokens", () => {
    expect(tokenize("Ohm's Law: V = I R.")).toEqual(["ohm", "law"]);
  });

  it("tokenizes non-Latin scripts (Devanagari)", () => {
    expect(tokenize("ओम का नियम")).toEqual(["ओम", "का", "नियम"]);
  });
});

describe("Bm25Index", () => {
  const corpus = [
    { id: "a", text: "Ohm's Law relates voltage, current and resistance in a circuit." },
    { id: "b", text: "Photosynthesis converts light energy into chemical energy in plants." },
    { id: "c", text: "Newton's second law relates force, mass and acceleration." },
  ];

  it("ranks the document containing the exact query terms highest", () => {
    const index = new Bm25Index(corpus);
    const results = index.score("Ohm's Law resistance");
    expect(results[0].id).toBe("a");
  });

  it("returns no results for a query with zero term overlap", () => {
    const index = new Bm25Index(corpus);
    expect(index.score("quantum entanglement wavefunction")).toEqual([]);
  });

  it("returns an empty array for an empty corpus", () => {
    const index = new Bm25Index([]);
    expect(index.score("anything")).toEqual([]);
  });
});
