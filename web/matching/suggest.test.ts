import { describe, expect, it } from "vitest";
import type { Column } from "../spreadsheet/protocol.ts";
import { suggestSources } from "./suggest.ts";

const cols = (...names: string[]): Column[] => names.map((name, index) => ({ index, letter: "A", name }));

describe("suggestSources", () => {
  it("suggests from Swedish headers, ranked, with split name", () => {
    expect(suggestSources(cols("Kost", "E-post", "Efternamn", "Förnamn", "Medlemsnummer"))).toEqual([
      { kind: "memberNo", column: "Medlemsnummer" },
      { kind: "email", column: "E-post" },
      { kind: "name", layout: "split", first: "Förnamn", last: "Efternamn" },
    ]);
  });
  it("suggests from English headers, case-insensitively", () => {
    expect(suggestSources(cols(" MEMBER NUMBER ", "SSN", "Email", "Name"))).toEqual([
      { kind: "memberNo", column: " MEMBER NUMBER " },
      { kind: "ssno", column: "SSN" },
      { kind: "email", column: "Email" },
      { kind: "name", layout: "firstLast", column: "Name" },
    ]);
  });
  it("prefers split names over a single name column", () => {
    expect(suggestSources(cols("Namn", "First name", "Last name"))).toEqual([
      { kind: "name", layout: "split", first: "First name", last: "Last name" },
    ]);
  });
  it("suggests nothing for a lone first-name column or unknown headers", () => {
    expect(suggestSources(cols("Förnamn", "Kost"))).toEqual([]);
  });
});
