import { describe, expect, it } from "vitest";
import { buildTable, columnLetter, guessHeaderRow, uniqueNames } from "./headers.ts";
import type { Cell, Row } from "./protocol.ts";

const text = (s: string): Cell => ({ text: s, value: s === "" ? null : s });
const num = (n: number): Cell => ({ text: String(n), value: n });
const row = (sheetRow: number, ...cells: Cell[]): Row => ({ sheetRow, cells });
const strs = (sheetRow: number, ...values: string[]) => row(sheetRow, ...values.map(text));

describe("columnLetter", () => {
  it("maps indexes to letters", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(701)).toBe("ZZ");
    expect(columnLetter(702)).toBe("AAA");
  });
});

describe("guessHeaderRow", () => {
  it("skips a title and a note above the table", () => {
    const rows = [
      strs(1, "Anmälda till lägret"),
      strs(2, "Exporterad 2024-01-01"),
      strs(3, "Medlemsnummer", "Förnamn", "Efternamn", "Kost"),
      row(4, num(1), text("Åsa"), text("Öberg"), text("")),
    ];
    expect(guessHeaderRow(rows)).toBe(3);
  });
  it("picks the first row when it is the header", () => {
    expect(guessHeaderRow([strs(1, "A", "B"), strs(2, "x", "y")])).toBe(1);
  });
  it("skips blank rows and reports the sheet row", () => {
    expect(guessHeaderRow([strs(1, "", ""), strs(2, "", ""), strs(5, "A", "B")])).toBe(5);
  });
  it("skips a row containing numbers or dates", () => {
    const date: Cell = { text: "2024-01-01", value: "2024-01-01", date: "2024-01-01" };
    const rows = [row(1, num(1), text("b")), row(2, date, text("b")), strs(3, "a", "b")];
    expect(guessHeaderRow(rows)).toBe(3);
  });
  it("falls back to the first non-empty row", () => {
    expect(guessHeaderRow([row(1, num(1), num(2)), row(2, num(3), num(4))])).toBe(1);
    expect(guessHeaderRow([])).toBe(1);
  });
});

describe("uniqueNames", () => {
  it("names empty and duplicate headers", () => {
    expect(uniqueNames(["A", "B", "C"], ["Namn", "", "Namn"])).toEqual([
      "Namn (Column A)",
      "Column B",
      "Namn (Column C)",
    ]);
  });
  it("trims names", () => {
    expect(uniqueNames(["A", "B"], ["  Namn ", "x"])).toEqual(["Namn", "x"]);
  });
});

describe("buildTable", () => {
  it("uses the chosen row as header and starts data below it", () => {
    const rows = [strs(1, "title"), strs(3, "a", "b"), strs(4, "h1", "h2"), strs(5, "1", "2")];
    const t = buildTable(rows, 4);
    expect(t.columns.map((c) => c.name)).toEqual(["h1", "h2"]);
    expect(t.rows.map((r) => r.sheetRow)).toEqual([5]);
  });
  it("drops blank rows and columns but keeps letters", () => {
    const rows = [
      strs(1, "Namn", "", "Kost"),
      strs(2, "Eva", "", "Vegan"),
      strs(3, "", "", ""),
      strs(4, "Olle", "", ""),
    ];
    const t = buildTable(rows, 1);
    expect(t.columns).toEqual([
      { index: 0, letter: "A", name: "Namn" },
      { index: 2, letter: "C", name: "Kost" },
    ]);
    expect(t.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ["Eva", "Vegan"],
      ["Olle", ""],
    ]);
  });
  it("keeps a column with an empty header but data, named by letter", () => {
    const t = buildTable([strs(1, "a", "", "c"), strs(2, "1", "2", "3")], 1);
    expect(t.columns.map((c) => c.name)).toEqual(["a", "Column B", "c"]);
  });
  it("has no data rows when the header is the last row", () => {
    const t = buildTable([strs(1, "a", "b"), strs(2, "x", "y")], 2);
    expect(t.rows).toEqual([]);
    expect(t.columns.map((c) => c.name)).toEqual(["x", "y"]);
  });
});
