import { describe, expect, it } from "vitest";
import type { TrimmedParticipant } from "../../shared/api-types.ts";
import type { Cell, Column, Row } from "../spreadsheet/protocol.ts";
import { buildIndexes, match, type MatchResult, type Source } from "./matcher.ts";

const today = new Date(2026, 9, 29);

const p = (memberNo: string, o: Partial<TrimmedParticipant> = {}): TrimmedParticipant => ({
  memberNo, firstName: null, lastName: null, ssno: null, email: null, cancelled: false, confirmed: true, answers: {}, ...o,
});
const cell = (text: string): Cell => ({ text, value: text === "" ? null : text });
const columns = (...names: string[]): Column[] => names.map((name, index) => ({ index, letter: String.fromCharCode(65 + index), name }));
// sheetRow = position + 2
const rowsOf = (...rows: string[][]): Row[] => rows.map((r, i) => ({ sheetRow: i + 2, cells: r.map(cell) }));

const run = (
  participants: TrimmedParticipant[],
  cols: Column[],
  rows: Row[],
  sources: Source[],
  extra: Partial<Parameters<typeof match>[0]> = {},
): MatchResult => {
  const pool = new Set(participants.filter((x) => !x.cancelled && x.confirmed).map((x) => x.memberNo));
  const indexes = buildIndexes(participants, sources.map((s) => s.kind), today);
  return match({ rows, columns: cols, sources, indexes, pool, today, ...extra });
};

const sum = (r: MatchResult) =>
  r.totals.matched + r.totals.ambiguous + r.totals.unmatched + r.totals.excluded + r.totals.conflictRows;

describe("identifiers", () => {
  it("matches personnummer in any format and email ignoring case", () => {
    const ps = [p("1", { ssno: "20100101-1234" }), p("2", { email: "Anna@Example.se" })];
    const r = run(ps, columns("pnr", "mail"), rowsOf(["1001011234", ""], ["", " anna@example.se "], ["bad", "x"]), [
      { kind: "ssno", column: "pnr" }, { kind: "email", column: "mail" },
    ]);
    expect(r.outcomes.map((o) => o.status)).toEqual(["matched", "matched", "unmatched"]);
    expect(r.outcomes[0]).toEqual({ status: "matched", memberNo: "1", source: 0 });
    expect(r.outcomes[1]).toEqual({ status: "matched", memberNo: "2", source: 1 });
  });
  it("handles + in personnummer and participant-side formats with the same normaliser", () => {
    const ps = [p("1", { ssno: "192001011234" }), p("2", { ssno: "200101-1234" })];
    const r = run(ps, columns("pnr"), rowsOf(["200101+1234"], ["200101-1234"]), [{ kind: "ssno", column: "pnr" }]);
    expect(r.outcomes.map((o) => o.status === "matched" && o.memberNo)).toEqual(["1", "2"]);
  });
  it("matches a personnummer that lost its leading zero", () => {
    const r = run([p("1", { ssno: "20050101-1234" })], columns("pnr"), rowsOf(["501011234"]), [{ kind: "ssno", column: "pnr" }]);
    expect(r.outcomes[0]).toEqual({ status: "matched", memberNo: "1", source: 0 });
  });
  it("never matches empty values, even if participants have none", () => {
    const ps = [p("1"), p("2")];
    const r = run(ps, columns("nr", "mail"), rowsOf(["", ""]), [{ kind: "memberNo", column: "nr" }, { kind: "email", column: "mail" }]);
    expect(r.outcomes[0]).toEqual({ status: "unmatched" });
    expect(r.sourceCounts[0]).toEqual({ unique: 0, ambiguous: 0, none: 0, empty: 1 });
  });
  it("compares member numbers as trimmed exact text", () => {
    const r = run([p("3001234")], columns("nr"), rowsOf([" 3001234 "], ["03001234"]), [{ kind: "memberNo", column: "nr" }]);
    expect(r.outcomes.map((o) => o.status)).toEqual(["matched", "unmatched"]);
  });
});

describe("names", () => {
  const ps = [p("1", { firstName: "Åsa", lastName: "Öberg" })];
  it("matches diacritics ignoring case and spaces, not folded", () => {
    const r = run(ps, columns("f", "l"), rowsOf(["  åsa ", "ÖBERG"], ["Asa", "Oberg"]), [{ kind: "name", layout: "split", first: "f", last: "l" }]);
    expect(r.outcomes.map((o) => o.status)).toEqual(["matched", "unmatched"]);
  });
  it("reads First Last and Last, First from one column", () => {
    const a = run(ps, columns("n"), rowsOf(["  åsa   ÖBERG "]), [{ kind: "name", layout: "firstLast", column: "n" }]);
    const b = run(ps, columns("n"), rowsOf(["Öberg, Åsa"], ["Åsa Öberg"]), [{ kind: "name", layout: "lastFirst", column: "n" }]);
    expect(a.outcomes[0]!.status).toBe("matched");
    expect(b.outcomes.map((o) => o.status)).toEqual(["matched", "unmatched"]);
  });
  it("matches multi-part first names only as the full string", () => {
    const multi = [p("1", { firstName: "Anna Maria", lastName: "Lind" })];
    const r = run(multi, columns("n"), rowsOf(["Anna Maria Lind"], ["Anna Lind"]), [{ kind: "name", layout: "firstLast", column: "n" }]);
    expect(r.outcomes.map((o) => o.status)).toEqual(["matched", "unmatched"]);
  });
});

describe("ranked matching", () => {
  const sources: Source[] = [
    { kind: "memberNo", column: "nr" }, { kind: "ssno", column: "pnr" }, { kind: "email", column: "mail" },
  ];
  const cols = columns("nr", "pnr", "mail");
  it("a shared parent email is ambiguous unless a higher source is unique", () => {
    const ps = [
      p("1", { email: "parent@x.se" }), p("2", { email: "parent@x.se" }), p("3", { email: "parent@x.se", ssno: "20100101-1234" }),
    ];
    const r = run(ps, cols, rowsOf(["", "", "parent@x.se"], ["", "100101-1234", "parent@x.se"]), sources);
    expect(r.outcomes[0]).toEqual({ status: "ambiguous", candidates: ["1", "2", "3"] });
    expect(r.outcomes[1]).toEqual({ status: "matched", memberNo: "3", source: 1 });
    expect(r.ambiguous).toEqual([{ sheetRow: 2, candidates: ["1", "2", "3"] }]);
  });
  it("lower source fills a gap (empty or no match or ambiguous higher source)", () => {
    const ps = [p("1", { ssno: "20100101-1234" }), p("4", { ssno: "20110202-1111" }), p("2", { email: "a@x.se" }), p("3", { email: "a@x.se" })];
    const r = run(ps, cols, rowsOf(["", "1001011234", ""], ["999", "110202-1111", ""]), sources);
    expect(r.outcomes.map((o) => o.status === "matched" && o.source)).toEqual([1, 1]);
    expect(r.totals.matchedBySource).toEqual([0, 2, 0]);
  });
  it("an ambiguous source does not block a later unique one", () => {
    const ps = [p("1", { email: "a@x.se", ssno: "20100101-1234" }), p("2", { email: "a@x.se" })];
    const r = run(ps, columns("mail", "pnr"), rowsOf(["a@x.se", "1001011234"]), [{ kind: "email", column: "mail" }, { kind: "ssno", column: "pnr" }]);
    expect(r.outcomes[0]).toEqual({ status: "matched", memberNo: "1", source: 1 });
  });
  it("applies no fuzzy matching", () => {
    const r = run([p("1", { email: "anna@x.se" })], columns("mail"), rowsOf(["anna@x.s"], ["anna@x.se."]), [{ kind: "email", column: "mail" }]);
    expect(r.totals.unmatched).toBe(2);
  });
  it("treats a missing column as empty and reports it", () => {
    const r = run([p("1")], columns("nr"), rowsOf(["1"]), [{ kind: "memberNo", column: "nr" }, { kind: "email", column: "gone" }]);
    expect(r.missingSources).toEqual([1]);
    expect(r.sourceCounts[1]).toEqual({ unique: 0, ambiguous: 0, none: 0, empty: 1 });
    expect(r.outcomes[0]!.status).toBe("matched");
  });
});

describe("pool and excluded", () => {
  const ps = [
    p("1", { cancelled: true, email: "c@x.se" }), p("2", { confirmed: false }), p("3", { email: "c@x.se" }), p("4"), p("5", { email: "d@x.se" }),
  ];
  const sources: Source[] = [{ kind: "memberNo", column: "nr" }, { kind: "email", column: "mail" }];
  it("counts rows matching only excluded participants as excluded and leaves them out", () => {
    const r = run(ps, columns("nr", "mail"), rowsOf(["1", ""], ["2", ""], ["4", ""]), sources);
    expect(r.outcomes.map((o) => o.status)).toEqual(["excluded", "excluded", "matched"]);
    expect(r.excludedRows).toEqual([2, 3]);
    expect(r.totals.excluded).toBe(2);
  });
  it("matches a pooled participant even when an excluded one shares the key, and a lower source can rescue", () => {
    const r = run(ps, columns("nr", "mail"), rowsOf(["", "c@x.se"], ["4", "d@x.se"]), sources);
    expect(r.outcomes.map((o) => o.status === "matched" && o.memberNo)).toEqual(["3", "4"]);
  });
  it("a source naming exactly one excluded participant ends the chain as excluded", () => {
    const two = [p("A", { cancelled: true, firstName: "Åsa", lastName: "Öberg" }), p("B", { firstName: "Bo", lastName: "Berg" })];
    const r = run(two, columns("nr", "f", "l"), rowsOf(["A", "Bo", "Berg"]), [
      { kind: "memberNo", column: "nr" }, { kind: "name", layout: "split", first: "f", last: "l" },
    ]);
    expect(r.outcomes[0]).toEqual({ status: "excluded" });
    expect(r.sourceCounts[1].unique).toBe(1);
  });
  it("several participants all excluded still lets a lower unique source match", () => {
    const three = [p("A", { cancelled: true, email: "s@x.se" }), p("C", { cancelled: true, email: "s@x.se" }), p("B", { firstName: "Bo", lastName: "Berg" })];
    const r = run(three, columns("mail", "f", "l"), rowsOf(["s@x.se", "Bo", "Berg"]), [
      { kind: "email", column: "mail" }, { kind: "name", layout: "split", first: "f", last: "l" },
    ]);
    expect(r.outcomes[0]).toEqual({ status: "matched", memberNo: "B", source: 1 });
  });
  it("ranks ambiguous above excluded and excluded above unmatched", () => {
    const more = [p("1", { cancelled: true, email: "e@x.se" }), p("5", { email: "a@x.se" }), p("6", { email: "a@x.se" })];
    const r = run(more, columns("mail"), rowsOf(["e@x.se"], ["a@x.se"], ["z@x.se"]), [{ kind: "email", column: "mail" }]);
    expect(r.outcomes.map((o) => o.status)).toEqual(["excluded", "ambiguous", "unmatched"]);
  });
});

describe("counts", () => {
  it("counts each source alone, against the pool", () => {
    const ps = [p("1", { email: "a@x.se" }), p("2", { email: "b@x.se" }), p("3", { email: "b@x.se" }), p("4", { cancelled: true })];
    const r = run(ps, columns("nr", "mail"), rowsOf(["1", "a@x.se"], ["4", "b@x.se"], ["9", ""], ["", ""]), [
      { kind: "memberNo", column: "nr" }, { kind: "email", column: "mail" },
    ]);
    expect(r.sourceCounts[0]).toEqual({ unique: 1, ambiguous: 0, none: 2, empty: 1 });
    expect(r.sourceCounts[1]).toEqual({ unique: 1, ambiguous: 1, none: 0, empty: 2 });
  });
  it("adds up to the row count, with conflict rows counted under conflictRows and not matched", () => {
    const ps = [p("1"), p("2", { cancelled: true }), p("3", { email: "s@x.se" }), p("4", { email: "s@x.se" })];
    const rows = rowsOf(["1", "", ""], ["1", "", ""], ["2", "", ""], ["", "s@x.se", ""], ["9", "", ""], ["1", "", ""]);
    const r = run(ps, columns("nr", "mail"), rows, [{ kind: "memberNo", column: "nr" }, { kind: "email", column: "mail" }]);
    expect(r.totals).toMatchObject({ matched: 0, ambiguous: 1, unmatched: 1, excluded: 1, conflictRows: 3 });
    expect(sum(r)).toBe(rows.length);
    const w = run(ps, columns("nr", "mail"), rows, [{ kind: "memberNo", column: "nr" }, { kind: "email", column: "mail" }], { winners: new Map([["1", 3]]) });
    // the winner moves to matched; the other two stay under conflictRows
    expect(w.totals).toMatchObject({ matched: 1, conflictRows: 2 });
    expect(sum(w)).toBe(rows.length);
  });
});

describe("resolutions", () => {
  const ps = [p("1", { email: "p@x.se", ssno: "20100101-1234" }), p("2", { email: "p@x.se" })];
  const cols = columns("mail", "pnr");
  const rows = rowsOf(["p@x.se", ""]);
  const email: Source = { kind: "email", column: "mail" };
  const ssno: Source = { kind: "ssno", column: "pnr" };
  it("a pick matches the row to that sibling", () => {
    const r = run(ps, cols, rows, [email, ssno], { resolutions: new Map([[2, "2"]]) });
    expect(r.outcomes[0]).toEqual({ status: "matched", memberNo: "2", source: null });
    expect(r.totals).toMatchObject({ matched: 1, matchedByResolution: 1, ambiguous: 0 });
  });
  it("ignores a pick that is not a candidate", () => {
    const r = run(ps, cols, rows, [email], { resolutions: new Map([[2, "9"]]) });
    expect(r.outcomes[0]!.status).toBe("ambiguous");
  });
  it("drops a pick when a source change removes that participant from the candidates", () => {
    const other = [p("1", { email: "p@x.se" }), p("2", { email: "p@x.se" }), p("8", { email: "z@x.se" }), p("9", { email: "z@x.se" })];
    const twoCols = columns("mail", "alt");
    const rows2 = rowsOf(["p@x.se", "z@x.se"]);
    const resolutions = new Map([[2, "2"]]);
    expect(run(other, twoCols, rows2, [{ kind: "email", column: "mail" }], { resolutions }).outcomes[0]!.status).toBe("matched");
    const changed = run(other, twoCols, rows2, [{ kind: "email", column: "alt" }], { resolutions });
    expect(changed.outcomes[0]).toEqual({ status: "ambiguous", candidates: ["8", "9"] });
  });
  it("ignores resolutions for rows that are not ambiguous", () => {
    const r = run(ps, cols, rowsOf(["p@x.se", "1001011234"]), [email, ssno], { resolutions: new Map([[2, "2"]]) });
    expect(r.outcomes[0]).toEqual({ status: "matched", memberNo: "1", source: 1 });
  });
  it("pools candidates from every source that gave several", () => {
    const sib = [p("1", { email: "a@x.se", firstName: "F", lastName: "L" }), p("2", { email: "a@x.se" }), p("3", { firstName: "F", lastName: "L" })];
    const name: Source = { kind: "name", layout: "split", first: "f", last: "l" };
    const c = columns("mail", "f", "l");
    const r = run(sib, c, rowsOf(["a@x.se", "F", "L"]), [email, name]);
    expect(r.outcomes[0]).toEqual({ status: "ambiguous", candidates: ["1", "2", "3"] });
    const picked = run(sib, c, rowsOf(["a@x.se", "F", "L"]), [email, name], { resolutions: new Map([[2, "3"]]) });
    expect(picked.outcomes[0]).toEqual({ status: "matched", memberNo: "3", source: null });
  });
});

describe("conflicts", () => {
  const ps = [p("3001234"), p("5")];
  const cols = columns("nr");
  const rows = rowsOf(["3001234"], ["5"], ["3001234"]);
  const nr: Source = { kind: "memberNo", column: "nr" };
  it("flags duplicate rows and matches none of them", () => {
    const r = run(ps, cols, rows, [nr]);
    expect(r.conflicts).toEqual([{ memberNo: "3001234", sheetRows: [2, 4], winner: null }]);
    expect(r.outcomes.map((o) => o.status)).toEqual(["conflict", "matched", "conflict"]);
  });
  it("matches only the winner", () => {
    const r = run(ps, cols, rows, [nr], { winners: new Map([["3001234", 4]]) });
    expect(r.outcomes.map((o) => o.status)).toEqual(["conflict", "matched", "matched"]);
    expect(r.conflicts[0]!.winner).toBe(4);
  });
  it("skip leaves them all out; a winner not in the group is ignored", () => {
    const skip = run(ps, cols, rows, [nr], { winners: new Map([["3001234", "skip" as const]]) });
    expect(skip.outcomes.map((o) => o.status)).toEqual(["conflict", "matched", "conflict"]);
    expect(skip.totals.matched).toBe(1);
    const bad = run(ps, cols, rows, [nr], { winners: new Map([["3001234", 3]]) });
    expect(bad.conflicts[0]!.winner).toBeNull();
    expect(bad.totals.matched).toBe(1);
  });
  it("computes conflicts after resolutions", () => {
    const sib = [p("1", { email: "a@x.se" }), p("2", { email: "a@x.se" })];
    const r = run(sib, columns("nr", "mail"), rowsOf(["1", ""], ["", "a@x.se"]), [nr, { kind: "email", column: "mail" }], { resolutions: new Map([[3, "1"]]) });
    expect(r.conflicts).toEqual([{ memberNo: "1", sheetRows: [2, 3], winner: null }]);
  });
});

describe("timing", () => {
  it("builds indexes and matches 20,000 x 20,000 with 3 sources under 1 s", () => {
    const n = 20000;
    const ps: TrimmedParticipant[] = [];
    for (let i = 0; i < n; i++) {
      const month = String((i % 12) + 1).padStart(2, "0");
      const day = String((i % 28) + 1).padStart(2, "0");
      ps.push(p(String(1000000 + i), {
        firstName: `Förnamn${i % 5000}`, lastName: `Efternamn${i % 7919}`, ssno: `${2000 + (i % 20)}${month}${day}-${String(1000 + (i % 9000))}`,
        email: `person${i % 15000}@example.se`, cancelled: i % 50 === 0,
      }));
    }
    const cols = columns("nr", "pnr", "mail", "f", "l");
    const rows: Row[] = [];
    for (let i = 0; i < n; i++) {
      const q = ps[(i * 7) % n]!;
      rows.push({ sheetRow: i + 2, cells: [
        i % 3 === 0 ? cell(q.memberNo) : cell(""), cell(i % 3 === 1 ? q.ssno! : ""), cell(q.email!), cell(q.firstName!), cell(q.lastName!),
      ] });
    }
    const sources: Source[] = [
      { kind: "memberNo", column: "nr" }, { kind: "email", column: "mail" }, { kind: "name", layout: "split", first: "f", last: "l" },
    ];
    const start = performance.now();
    const indexes = buildIndexes(ps, sources.map((s) => s.kind), today);
    const pool = new Set(ps.filter((x) => !x.cancelled).map((x) => x.memberNo));
    const r = match({ rows, columns: cols, sources, indexes, pool, today });
    const ms = performance.now() - start;
    console.log(`match timing: ${ms.toFixed(0)} ms`);
    expect(sum(r)).toBe(n);
    expect(ms).toBeLessThan(1000);
  });
});
