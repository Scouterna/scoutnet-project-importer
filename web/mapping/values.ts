import type { Cell } from "../spreadsheet/protocol.ts";

/** NFC, lower case (Swedish locale), trimmed, punctuation stripped, spaces collapsed. */
export const groupKey = (text: string): string =>
  text
    .normalize("NFC")
    .toLocaleLowerCase("sv")
    .replace(/\p{P}/gu, "")
    .replace(/\s+/g, " ")
    .trim();

const SPACE = "[ \\u00a0\\u202f]";
const numberText = new RegExp(`^-?(\\d+|\\d{1,3}(${SPACE}\\d{3})+)([.,]\\d+)?$`);

export const parseNumber = (cell: Cell): number | null => {
  if (typeof cell.value === "number") return Number.isFinite(cell.value) ? cell.value : null;
  const text = cell.text.trim();
  if (!numberText.test(text)) return null;
  const n = Number(text.replace(new RegExp(SPACE, "g"), "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const yes = new Set(["ja", "yes", "x", "1", "true"]);
const no = new Set(["nej", "no", "0", "false"]);

export const parseYesNo = (text: string): "1" | "0" | null => {
  const t = text.trim().toLocaleLowerCase("sv");
  return yes.has(t) ? "1" : no.has(t) ? "0" : null;
};

const distance = (a: string, b: string): number => {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
};

/**
 * On group keys: both 3+ characters; one is a prefix of the other, or the edit distance is small.
 * Also accepts the shorter key minus one trailing character as a 3+ character prefix ("vego" ~ "vegetarisk").
 */
export const resembles = (a: string, b: string): boolean => {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  // Keys this short ("1", "ja") resemble almost anything by edit distance.
  if (short.length < 3) return false;
  if (short.length >= 3 && long.startsWith(short)) return true;
  if (short.length >= 4 && long.startsWith(short.slice(0, -1))) return true;
  return distance(a, b) <= (long.length <= 5 ? 1 : 2);
};
