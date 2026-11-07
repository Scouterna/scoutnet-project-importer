export type NameLayout = "firstLast" | "lastFirst" | "split";

export const memberNo = (text: string): string => text.trim();

export const email = (text: string): string => text.trim().toLocaleLowerCase("sv");

const pad = (n: number, width: number): string => String(n).padStart(width, "0");

/**
 * Normalises a Swedish personnummer to "YYYYMMDDXXXX", or null when the form is not accepted.
 * Accepted: YYYYMMDD-XXXX, YYYYMMDDXXXX, YYMMDD-XXXX, YYMMDDXXXX, YYMMDD+XXXX.
 * A two-digit year gets the latest century that is not in the future relative to `today`;
 * "+" means 100 years or older, so one century less. Month 01-12 and day 01-31 are checked,
 * the check digit is not.
 */
export const personnummer = (text: string, today: Date): string | null => {
  let s = text.trim();
  // 9 digits: YYMMDDXXXX that lost its leading zero in Excel
  if (/^\d{9}$/.test(s)) s = `0${s}`;
  let year: number;
  let month: string;
  let day: string;
  let serial: string;
  const long = /^(\d{4})(\d{2})(\d{2})-?(\d{4})$/.exec(s);
  if (long) {
    year = Number(long[1]);
    month = long[2]!;
    day = long[3]!;
    serial = long[4]!;
  } else {
    const short = /^(\d{2})(\d{2})(\d{2})([-+]?)(\d{4})$/.exec(s);
    if (!short) return null;
    month = short[2]!;
    day = short[3]!;
    serial = short[5]!;
    const yy = Number(short[1]);
    const todayNumber = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    year = Math.floor(today.getFullYear() / 100) * 100 + yy;
    if (year * 10000 + Number(month) * 100 + Number(day) > todayNumber) year -= 100;
    if (short[4] === "+") year -= 100;
  }
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31 || year < 0) return null;
  return `${pad(year, 4)}${month}${day}${serial}`;
};

/** NFC, lower case (Swedish locale), trimmed, inner whitespace collapsed. No accent folding. */
export const nameText = (text: string): string =>
  text.normalize("NFC").toLocaleLowerCase("sv").trim().replace(/\s+/g, " ");

/** Key for a first and last name: normalised "first last". Null when both are empty. */
export const name = (first: string | null, last: string | null): string | null => {
  const key = nameText(`${first ?? ""} ${last ?? ""}`);
  return key === "" ? null : key;
};

/**
 * Splits one name cell. "lastFirst" splits at the first comma ("Öberg, Åsa"); no comma gives null.
 * "firstLast" splits at the last space ("Anna Maria Lind" → first "Anna Maria"); a single word gives null.
 * "split" is not a one-cell layout and gives null.
 */
export const splitName = (
  text: string,
  layout: NameLayout,
): { first: string; last: string } | null => {
  const s = text.trim();
  if (layout === "lastFirst") {
    const i = s.indexOf(",");
    if (i < 0) return null;
    return { first: s.slice(i + 1).trim(), last: s.slice(0, i).trim() };
  }
  if (layout === "firstLast") {
    const i = s.lastIndexOf(" ");
    if (i < 0) return null;
    return { first: s.slice(0, i).trim(), last: s.slice(i + 1).trim() };
  }
  return null;
};

/** Key for one name cell in a layout. For "firstLast" the whole string is the key. Null when empty or unsplittable. */
export const nameKey = (text: string, layout: "firstLast" | "lastFirst"): string | null => {
  if (layout === "firstLast") {
    const key = nameText(text);
    return key === "" ? null : key;
  }
  const parts = splitName(text, layout);
  return parts ? name(parts.first, parts.last) : null;
};
