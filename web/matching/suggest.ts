import type { Column } from "../spreadsheet/protocol.ts";
import type { Source } from "./matcher.ts";

const headers = {
  memberNo: ["medlemsnummer", "medlemsnr", "medlem nr", "member number", "member no", "member_no", "memberno", "member_number"],
  ssno: ["personnummer", "personnr", "pnr", "ssn", "ssno"],
  email: ["e-post", "epost", "e-postadress", "epostadress", "email", "e-mail", "email address"],
  first: ["förnamn", "fornamn", "first name", "first_name", "firstname", "given name"],
  last: ["efternamn", "last name", "last_name", "lastname", "surname", "family name"],
  full: ["namn", "name", "fullständigt namn", "full name"],
};

const norm = (s: string): string => s.trim().toLocaleLowerCase("sv").replace(/\s+/g, " ");

/** Suggests sources from header names, ranked memberNo, ssno, email, name. */
export const suggestSources = (columns: Column[]): Source[] => {
  const find = (list: string[]): string | null =>
    columns.find((c) => list.includes(norm(c.name)))?.name ?? null;
  const sources: Source[] = [];
  const m = find(headers.memberNo);
  if (m) sources.push({ kind: "memberNo", column: m });
  const s = find(headers.ssno);
  if (s) sources.push({ kind: "ssno", column: s });
  const e = find(headers.email);
  if (e) sources.push({ kind: "email", column: e });
  const first = find(headers.first);
  const last = find(headers.last);
  if (first && last) {
    sources.push({ kind: "name", layout: "split", first, last });
  } else {
    const full = find(headers.full);
    if (full) sources.push({ kind: "name", layout: "firstLast", column: full });
  }
  return sources;
};
