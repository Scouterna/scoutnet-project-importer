import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { decodeCsv, hasSpreadsheetSignature, detectSeparator, isCsvFile, isoDate, toCell } from "./cells.ts";

const roundtrip = (cells: Record<string, XLSX.CellObject>): XLSX.WorkSheet => {
  const sheet: XLSX.WorkSheet = { ...cells, "!ref": "A1:A1" };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "S");
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" });
  const read = XLSX.read(bytes, { type: "array", cellDates: true, cellNF: true, dense: true });
  return read.Sheets.S!;
};

const cellAt = (sheet: XLSX.WorkSheet) => toCell(sheet["!data"]![0]![0]);

describe("toCell", () => {
  it("keeps the leading zeros of a formatted member number", () => {
    const sheet = roundtrip({ A1: { t: "n", v: 12345, z: "0000000" } });
    expect(cellAt(sheet)).toEqual({ text: "0012345", value: 12345 });
  });
  it("keeps personnummer and zero-prefixed text as text", () => {
    expect(toCell({ t: "s", v: "20100101-1234" })).toEqual({
      text: "20100101-1234",
      value: "20100101-1234",
    });
    expect(toCell({ t: "s", v: " 0123 ", w: " 0123 " })).toEqual({ text: "0123", value: " 0123 " });
  });
  it("recognises an Excel date serial", () => {
    const sheet = roundtrip({ A1: { t: "n", v: 45292, z: "yyyy-mm-dd" } });
    expect(cellAt(sheet)).toEqual({ text: "2024-01-01", value: "2024-01-01", date: "2024-01-01" });
  });
  it("keeps the displayed text of a date as shown", () => {
    const sheet = roundtrip({ A1: { t: "n", v: 45292, z: "d/m/yy" } });
    expect(cellAt(sheet)).toMatchObject({ text: "1/1/24", date: "2024-01-01" });
  });
  it("shows the ISO date for the locale short date (format 14, m/d/yy)", () => {
    const date = new Date(Date.UTC(2010, 0, 1));
    expect(toCell({ t: "n", v: date, w: "1/1/10", z: "m/d/yy" })).toEqual({
      text: "2010-01-01",
      value: "2010-01-01",
      date: "2010-01-01",
    });
    expect(toCell({ t: "n", v: date, w: "1/1/10", z: 14 })).toMatchObject({ text: "2010-01-01" });
  });
  it("keeps the shown text of a custom date format", () => {
    expect(toCell({ t: "n", v: new Date(Date.UTC(2010, 0, 1)), w: "1 Jan 2010", z: "d mmm yyyy" })).toMatchObject({
      text: "1 Jan 2010",
      date: "2010-01-01",
    });
  });
  it("falls back to String(v) without w", () => {
    expect(toCell({ t: "n", v: 7 })).toEqual({ text: "7", value: 7 });
    expect(toCell({ t: "b", v: true })).toEqual({ text: "true", value: true });
  });
  it("treats missing and empty cells as empty", () => {
    expect(toCell(undefined)).toEqual({ text: "", value: null });
    expect(toCell({ t: "z" })).toEqual({ text: "", value: null });
  });
  it("reads error cells as text", () => {
    expect(toCell({ t: "e", v: 7, w: "#DIV/0!" })).toEqual({ text: "#DIV/0!", value: null });
  });
});

describe("isoDate", () => {
  it("uses UTC components (how SheetJS builds dates) and omits a zero time", () => {
    expect(isoDate(new Date(Date.UTC(2024, 0, 1)))).toBe("2024-01-01");
    expect(isoDate(new Date(Date.UTC(2024, 0, 1, 13, 5, 9)))).toBe("2024-01-01T13:05:09");
  });
});

describe("decodeCsv", () => {
  const encode = (s: string) => new TextEncoder().encode(s);
  it("decodes UTF-8 and strips the BOM", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encode("Åsa Öberg")]);
    expect(decodeCsv(bytes)).toBe("Åsa Öberg");
    expect(decodeCsv(encode("Åsa"))).toBe("Åsa");
  });
  it("falls back to Windows-1252", () => {
    const bytes = new Uint8Array([0xc5, 0x73, 0x61, 0x20, 0xd6, 0x62, 0x65, 0x72, 0x67]);
    expect(decodeCsv(bytes)).toBe("Åsa Öberg");
  });
});

describe("detectSeparator", () => {
  it("detects semicolon, comma and tab", () => {
    expect(detectSeparator("a;b;c\n1,5;2;3")).toBe(";");
    expect(detectSeparator("a,b,c")).toBe(",");
    expect(detectSeparator("a\tb\tc")).toBe("\t");
  });
  it("ignores separators inside quotes and leading blank lines", () => {
    expect(detectSeparator('\n"a;b;c",d')).toBe(",");
  });
});

describe("isCsvFile", () => {
  it("matches by extension or MIME type", () => {
    expect(isCsvFile({ name: "A.CSV" })).toBe(true);
    expect(isCsvFile({ name: "export", type: "text/csv" })).toBe(true);
    expect(isCsvFile({ name: "a.xlsx" })).toBe(false);
  });
});

describe("hasSpreadsheetSignature", () => {
  it("accepts zip and OLE2 and rejects other bytes", () => {
    expect(hasSpreadsheetSignature(new Uint8Array([0x50, 0x4b, 3, 4]))).toBe(true);
    expect(hasSpreadsheetSignature(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toBe(true);
    expect(hasSpreadsheetSignature(new Uint8Array([1, 2, 3, 4]))).toBe(false);
    expect(hasSpreadsheetSignature(new Uint8Array())).toBe(false);
  });
});
