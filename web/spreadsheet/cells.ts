import type { Cell } from "./protocol.ts";

// The parts of a SheetJS cell object we read.
export type SheetCell = { t?: string; v?: unknown; w?: string; z?: string | number };

const pad = (n: number) => String(n).padStart(2, "0");

// SheetJS 0.20 builds cell dates from the serial number as UTC, so read the UTC components.
export const isoDate = (date: Date): string => {
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const h = date.getUTCHours();
  const m = date.getUTCMinutes();
  const s = date.getUTCSeconds();
  return h === 0 && m === 0 && s === 0 ? day : `${day}T${pad(h)}:${pad(m)}:${pad(s)}`;
};

export const toCell = (cell: SheetCell | undefined): Cell => {
  if (!cell || cell.t === "z" || cell.v === undefined || cell.v === null) {
    return { text: cell?.w?.trim() ?? "", value: null };
  }
  const { v } = cell;
  const shown = cell.w?.trim();
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const date = isoDate(v);
    // SheetJS renders format 14 (the locale's short date) US-style, so show the ISO date instead.
    const localeShort = cell.z === 14 || (typeof cell.z === "string" && cell.z.toLowerCase() === "m/d/yy");
    return { text: (localeShort ? date : shown) || date, value: date, date };
  }
  if (cell.t === "e") return { text: shown || String(v), value: null };
  const value = typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : String(v);
  return { text: shown || String(v).trim(), value };
};

export const isBlankSheetCell = (cell: SheetCell | undefined): boolean =>
  !cell || cell.v === undefined || cell.v === null || (typeof cell.v === "string" && cell.v.trim() === "");

export const isCsvFile = (file: { name: string; type?: string }): boolean =>
  /\.csv$/i.test(file.name) || file.type === "text/csv";

// UTF-8 when valid (BOM stripped), otherwise Windows-1252.
export const decodeCsv = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
};

// Picks the separator that is most common outside quotes on the first non-empty line.
export const detectSeparator = (text: string): string => {
  const line = text.split(/\r\n|\n|\r/).find((l) => l.trim() !== "") ?? "";
  const counts = new Map([[",", 0], [";", 0], ["\t", 0]]);
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && counts.has(ch)) counts.set(ch, counts.get(ch)! + 1);
  }
  let best = ",";
  for (const [sep, n] of counts) if (n > counts.get(best)!) best = sep;
  return best;
};

// xlsx and ods are zip files, xls (and encrypted xlsx) are OLE2. SheetJS would read anything else as text.
export const hasSpreadsheetSignature = (bytes: Uint8Array): boolean =>
  (bytes[0] === 0x50 && bytes[1] === 0x4b) ||
  (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0);
