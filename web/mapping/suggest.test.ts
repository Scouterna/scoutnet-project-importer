import { describe, expect, it } from "vitest";
import type { Column } from "../spreadsheet/protocol.ts";
import { suggestPairings } from "./suggest.ts";

const cols = (...names: string[]): Column[] => names.map((name, index) => ({ index, letter: "A", name }));
const qs = (...labels: string[]) => labels.map((label, i) => ({ id: String(i + 1), label }));

describe("suggestPairings", () => {
  it("pairs equal headers ignoring case, spaces and punctuation", () => {
    expect([...suggestPairings(cols(" mat "), qs("Kost", "Mat"))]).toEqual([[" mat ", "2"]]);
    expect([...suggestPairings(cols("Gillar du gifflar"), qs("Gillar du gifflar?"))]).toEqual([["Gillar du gifflar", "1"]]);
  });
  it("falls back to containment either way", () => {
    expect(suggestPairings(cols("Favoritfilm 2026", "Allergi"), qs("Favoritfilm", "Allergier och annat")).size).toBe(2);
  });
  it("lets equality win over containment regardless of column order", () => {
    const out = suggestPairings(cols("Mat och dryck", "Mat"), qs("Mat"));
    expect([...out]).toEqual([["Mat", "1"]]);
  });
  it("suggests a question for one column only, the first winning", () => {
    expect([...suggestPairings(cols("Film 1", "Film 2"), qs("Film"))]).toEqual([["Film 1", "1"]]);
  });
  it("ignores short and empty keys for containment", () => {
    expect(suggestPairings(cols("Ja", "?"), qs("Ja eller nej", ""))).toEqual(new Map());
  });
  it("leaves dissimilar columns unmapped", () => {
    expect(suggestPairings(cols("Kost"), qs("Favoritfilm")).size).toBe(0);
  });
});
