import { describe, expect, it } from "vitest";
import { groupKey, parseNumber, parseYesNo, resembles } from "./values.ts";

const text = (t: string) => ({ text: t, value: null });

describe("groupKey", () => {
  it("ignores case, spaces and punctuation", () => {
    expect(groupKey("  Vego. ")).toBe("vego");
    expect(groupKey("Å  ÄR")).toBe("å är");
    expect(groupKey("e-post")).toBe("epost");
    expect(groupKey("...")).toBe("");
  });
});

describe("parseNumber", () => {
  it("accepts Swedish and English decimals and thousands groups", () => {
    expect(parseNumber(text("2,5"))).toBe(2.5);
    expect(parseNumber(text("1 234,5"))).toBe(1234.5);
    expect(parseNumber(text("1 234"))).toBe(1234);
    expect(parseNumber(text("1 234,5"))).toBe(1234.5);
    expect(parseNumber(text("1234.5"))).toBe(1234.5);
    expect(parseNumber(text("-3"))).toBe(-3);
    expect(parseNumber(text(" 7 "))).toBe(7);
  });
  it("uses numeric cell values directly", () => {
    expect(parseNumber({ text: "2,5 kr", value: 2.5 })).toBe(2.5);
    expect(parseNumber({ text: "0", value: 0 })).toBe(0);
  });
  it("rejects everything else", () => {
    for (const t of ["några", "1,2,3", "", "  ", "1 23", "2,", ",5", "1e3", "--1", "3 st"]) {
      expect(parseNumber(text(t))).toBeNull();
    }
  });
});

describe("parseYesNo", () => {
  it("recognises variants ignoring case and spaces", () => {
    for (const t of ["Ja", "JA", "Yes", "x", "X", "1", "TRUE", "true", " ja "]) expect(parseYesNo(t)).toBe("1");
    for (const t of ["Nej", " nej ", "No", "0", "FALSE", "false"]) expect(parseYesNo(t)).toBe("0");
  });
  it("returns null otherwise", () => {
    for (const t of ["kanske", "", "jaa"]) expect(parseYesNo(t)).toBeNull();
  });
});

describe("resembles", () => {
  it("accepts prefixes of 3+ characters", () => {
    expect(resembles("veg", "vegetarisk")).toBe(true);
    expect(resembles("vegetarisk", "veg")).toBe(true);
  });
  it("accepts the shorter key minus a trailing character", () => {
    expect(resembles("vego", "vegetarisk")).toBe(true);
  });
  it("accepts small spelling differences", () => {
    expect(resembles("kott", "kött")).toBe(true);
    expect(resembles("vegetarsk", "vegetarisk")).toBe(true);
    expect(resembles("ja", "jo")).toBe(false);
    expect(resembles("ab", "cd")).toBe(false);
  });
  it("rejects unrelated keys", () => {
    expect(resembles("kött", "vegetarisk")).toBe(false);
    expect(resembles("ve", "vegetarisk")).toBe(false);
    expect(resembles("", "vegetarisk")).toBe(false);
    expect(resembles("vegan", "vegetarisk")).toBe(false);
  });
});
