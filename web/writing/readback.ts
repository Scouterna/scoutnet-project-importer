import { parseNumber } from "../mapping/values.ts";

export type ReadbackKind = "text" | "number" | "yesNo" | "choice";

const lines = (s: string): string => s.replace(/\r\n?/g, "\n").trim();

const isEmpty = (a: string | string[] | null): boolean => a === null || a === "" || (Array.isArray(a) && a.length === 0);

// Whether the answer Scoutnet now returns is the one that was written.
export const readsBack = (kind: ReadbackKind, written: string, now: string | string[] | null): boolean => {
  if (written === "" && (kind === "text" || kind === "number")) return isEmpty(now);
  if (now === null || Array.isArray(now)) return false;
  if (kind === "text") return lines(now) === lines(written);
  if (kind === "number") {
    const a = parseNumber({ text: now, value: null });
    const b = parseNumber({ text: written, value: null });
    return a !== null && b !== null && a === b;
  }
  return now === written;
};
