import { describe, expect, it } from "vitest";
import { email, memberNo, name, nameKey, personnummer, splitName } from "./normalise.ts";

const today = new Date(2026, 9, 29);

describe("memberNo and email", () => {
  it("trims member numbers and keeps them exact", () => {
    expect(memberNo(" 3001234 ")).toBe("3001234");
    expect(memberNo("ab1")).not.toBe(memberNo("AB1"));
  });
  it("ignores email case and surrounding space", () => {
    expect(email(" anna@example.se ")).toBe(email("Anna@Example.se"));
  });
});

describe("personnummer", () => {
  it("accepts all listed formats", () => {
    expect(personnummer("20100101-1234", today)).toBe("201001011234");
    expect(personnummer("201001011234", today)).toBe("201001011234");
    expect(personnummer("100101-1234", today)).toBe("201001011234");
    expect(personnummer("1001011234", today)).toBe("201001011234");
    expect(personnummer(" 100101-1234 ", today)).toBe("201001011234");
  });
  it("reads a two-digit year with plus as 100 years or older", () => {
    expect(personnummer("200101+1234", today)).toBe("192001011234");
    expect(personnummer("200101-1234", today)).toBe("202001011234");
  });
  it("uses the previous century for years in the future", () => {
    expect(personnummer("270101-1234", today)).toBe("192701011234");
    expect(personnummer("261030-1234", today)).toBe("192610301234");
    expect(personnummer("261029-1234", today)).toBe("202610291234");
    expect(personnummer("261029+1234", today)).toBe("192610291234");
  });
  it("restores a leading zero lost in Excel (exactly 9 digits)", () => {
    expect(personnummer("501011234", today)).toBe("200501011234");
    expect(personnummer(" 501011234 ", today)).toBe("200501011234");
    expect(personnummer("123", today)).toBeNull();
    expect(personnummer("50101123456", today)).toBeNull();
    expect(personnummer("501011234+", today)).toBeNull();
    expect(personnummer("513011234", today)).toBeNull();
  });
  it("rejects other forms", () => {
    for (const bad of ["", "abc", "10010112", "20100101+1234", "2010-01-01-1234", "100101 1234", "100101--1234", "10010112345", "1001011234x"])
      expect(personnummer(bad, today)).toBeNull();
  });
  it("validates month and day, not the check digit", () => {
    expect(personnummer("201013011234", today)).toBeNull();
    expect(personnummer("200100011234", today)).toBeNull();
    expect(personnummer("200101321234", today)).toBeNull();
    expect(personnummer("200101001234", today)).toBeNull();
    expect(personnummer("200102311234", today)).toBe("200102311234");
    expect(personnummer("200101010000", today)).toBe("200101010000");
  });
});

describe("names", () => {
  it("ignores case and spacing but keeps diacritics", () => {
    expect(name("Åsa", "Öberg")).toBe(nameKey("  åsa   ÖBERG ", "firstLast"));
    expect(nameKey("Asa Oberg", "firstLast")).not.toBe(name("Åsa", "Öberg"));
  });
  it("normalises to NFC", () => {
    expect(name("Åsa", "Berg")).toBe(name("Åsa", "Berg"));
  });
  it("splits Last, First", () => {
    expect(splitName("Öberg, Åsa", "lastFirst")).toEqual({ first: "Åsa", last: "Öberg" });
    expect(nameKey("Öberg, Åsa", "lastFirst")).toBe(name("Åsa", "Öberg"));
    expect(nameKey("Åsa Öberg", "lastFirst")).toBeNull();
  });
  it("splits First Last at the last space and returns null for split layout", () => {
    expect(splitName("Anna Maria Lind", "firstLast")).toEqual({ first: "Anna Maria", last: "Lind" });
    expect(splitName("Anna", "firstLast")).toBeNull();
    expect(splitName("A B", "split")).toBeNull();
  });
  it("gives no key for empty names", () => {
    expect(name(null, " ")).toBeNull();
    expect(name("Åsa", null)).toBe("åsa");
  });
});
