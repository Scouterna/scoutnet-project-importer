import type { Cell, Column, Row } from "./protocol.ts";

export const emptyCell: Cell = { text: "", value: null };

export const columnLetter = (index: number): string => {
  let letter = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter;
  }
  return letter;
};

export const isBlankRow = (row: Row): boolean => row.cells.every((cell) => cell.text === "");

const isTextCell = (cell: Cell): boolean => typeof cell.value === "string" && cell.date === undefined;

const lookahead = 20;

// Returns the sheet row number of the guessed header row.
export const guessHeaderRow = (rows: Row[]): number => {
  const candidates = rows.filter((row) => !isBlankRow(row)).slice(0, lookahead);
  if (candidates.length === 0) return 1;
  const filled = (row: Row) => row.cells.filter((cell) => cell.text !== "").length;
  const widest = Math.max(...candidates.map(filled));
  const needed = Math.max(2, Math.ceil(widest * 0.6));
  const found = candidates.find(
    (row) => filled(row) >= needed && row.cells.every((cell) => cell.text === "" || isTextCell(cell)),
  );
  return (found ?? candidates[0]!).sheetRow;
};

export const uniqueNames = (letters: string[], texts: string[]): string[] => {
  const bases = texts.map((text, i) => text.trim() || `Column ${letters[i]}`);
  const counts = new Map<string, number>();
  for (const base of bases) counts.set(base, (counts.get(base) ?? 0) + 1);
  return bases.map((base, i) => (counts.get(base)! > 1 ? `${base} (Column ${letters[i]})` : base));
};

export type Table = { columns: Column[]; rows: Row[] };

// `rows` is the whole sheet. Rows above the header are ignored, as are empty rows and columns.
export const buildTable = (rows: Row[], headerRow: number): Table => {
  const header = rows.find((row) => row.sheetRow === headerRow);
  const data = rows.filter((row) => row.sheetRow > headerRow && !isBlankRow(row));
  const width = Math.max(header?.cells.length ?? 0, ...data.map((row) => row.cells.length));
  const keep: number[] = [];
  for (let i = 0; i < width; i++) {
    if (header?.cells[i]?.text || data.some((row) => row.cells[i]?.text)) keep.push(i);
  }
  const letters = keep.map(columnLetter);
  const names = uniqueNames(
    letters,
    keep.map((i) => header?.cells[i]?.text ?? ""),
  );
  return {
    columns: keep.map((index, i) => ({ index, letter: letters[i]!, name: names[i]! })),
    rows: data.map((row) => ({
      sheetRow: row.sheetRow,
      cells: keep.map((i) => row.cells[i] ?? emptyCell),
    })),
  };
};
