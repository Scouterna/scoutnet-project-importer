import type { TrimmedParticipant } from "../../shared/api-types.ts";
import type { Column, Row } from "../spreadsheet/protocol.ts";
import * as normalise from "./normalise.ts";

export type SourceKind = "memberNo" | "ssno" | "email" | "name";

export type Source =
  | { kind: "memberNo" | "ssno" | "email"; column: string }
  | { kind: "name"; layout: "firstLast" | "lastFirst"; column: string }
  | { kind: "name"; layout: "split"; first: string; last: string };

/** normalised key → memberNos of ALL participants having it */
export type Index = Map<string, string[]>;
export type Indexes = Partial<Record<SourceKind, Index>>;

export type RowOutcome =
  | { status: "matched"; memberNo: string; source: number | null } // source null: picked by the user
  | { status: "ambiguous"; candidates: string[] }
  | { status: "excluded" }
  | { status: "unmatched" }
  | { status: "conflict"; memberNo: string };

export type SourceCounts = { unique: number; ambiguous: number; none: number; empty: number };

export type MatchResult = {
  /** aligned to the input rows */
  outcomes: RowOutcome[];
  /** aligned to the sources; a source whose column is missing counts every row as empty */
  sourceCounts: SourceCounts[];
  /** indexes of sources with a missing column */
  missingSources: number[];
  /**
   * matched + ambiguous + unmatched + excluded + conflictRows === rows.length.
   * conflictRows counts every row in a conflict group that is not matched, so the winner is
   * under matched, and the other rows (or all rows when skipped) are under conflictRows.
   */
  totals: {
    matched: number;
    matchedBySource: number[];
    matchedByResolution: number;
    ambiguous: number;
    unmatched: number;
    excluded: number;
    conflictRows: number;
  };
  ambiguous: { sheetRow: number; candidates: string[] }[];
  /** winner: the chosen sheetRow, "skip", or null when undecided */
  conflicts: { memberNo: string; sheetRows: number[]; winner: number | "skip" | null }[];
  unmatchedRows: number[];
  excludedRows: number[];
};

const sourceColumns = (source: Source): string[] =>
  source.kind === "name" && source.layout === "split" ? [source.first, source.last] : [(source as { column: string }).column];

/** Key of a participant for a source kind, or null when it has none. */
const participantKey = (p: TrimmedParticipant, kind: SourceKind, today: Date): string | null => {
  switch (kind) {
    case "memberNo": {
      const k = normalise.memberNo(p.memberNo);
      return k === "" ? null : k;
    }
    case "ssno": return p.ssno == null ? null : normalise.personnummer(p.ssno, today);
    case "email": {
      const k = p.email == null ? "" : normalise.email(p.email);
      return k === "" ? null : k;
    }
    case "name": return normalise.name(p.firstName, p.lastName);
  }
};

export const buildIndex = (participants: TrimmedParticipant[], kind: SourceKind, today: Date = new Date()): Index => {
  const index: Index = new Map();
  for (const p of participants) {
    const key = participantKey(p, kind, today);
    if (key === null) continue;
    const list = index.get(key);
    if (list) list.push(p.memberNo);
    else index.set(key, [p.memberNo]);
  }
  return index;
};

export const buildIndexes = (participants: TrimmedParticipant[], kinds: SourceKind[], today: Date = new Date()): Indexes => {
  const indexes: Indexes = {};
  for (const kind of kinds) indexes[kind] = buildIndex(participants, kind, today);
  return indexes;
};

export type MatchInput = {
  rows: Row[];
  columns: Column[];
  sources: Source[];
  indexes: Indexes;
  /** memberNos of participants available after step 1 */
  pool: ReadonlySet<string>;
  resolutions?: ReadonlyMap<number, string>;
  winners?: ReadonlyMap<string, number | "skip">;
  today?: Date;
};

// identified: the value names exactly one participant overall and that one is outside the pool
type Eval = { state: "empty" | "none" | "unique" | "ambiguous" | "excluded"; pooled: string[]; identified?: boolean };
const emptyEval: Eval = { state: "empty", pooled: [] };
const noPooled: string[] = [];

export const match = (input: MatchInput): MatchResult => {
  const { rows, columns, sources, indexes, pool } = input;
  const resolutions = input.resolutions ?? new Map();
  const winners = input.winners ?? new Map();
  const today = input.today ?? new Date();

  // resolve column names to positions once
  const positions = new Map<string, number>();
  columns.forEach((c, i) => { if (!positions.has(c.name)) positions.set(c.name, i); });
  const resolved = sources.map((source) => {
    const cols = sourceColumns(source).map((n) => positions.get(n));
    return cols.every((c) => c !== undefined) ? (cols as number[]) : null;
  });
  const missingSources = resolved.flatMap((r, i) => (r === null ? [i] : []));

  const sourceCounts: SourceCounts[] = sources.map(() => ({ unique: 0, ambiguous: 0, none: 0, empty: 0 }));
  const outcomes: RowOutcome[] = new Array(rows.length);
  const evals: Eval[] = new Array(sources.length);

  const evaluate = (source: Source, cols: number[], row: Row): Eval => {
    let key: string | null;
    if (source.kind === "name") {
      if (source.layout === "split") {
        const first = row.cells[cols[0]!]?.text ?? "";
        const last = row.cells[cols[1]!]?.text ?? "";
        if (first.trim() === "" && last.trim() === "") return emptyEval;
        key = normalise.name(first, last);
      } else {
        const text = row.cells[cols[0]!]?.text ?? "";
        if (text.trim() === "") return emptyEval;
        key = normalise.nameKey(text, source.layout);
      }
    } else {
      const text = row.cells[cols[0]!]?.text ?? "";
      if (text.trim() === "") return emptyEval;
      key = source.kind === "memberNo" ? normalise.memberNo(text)
        : source.kind === "email" ? normalise.email(text)
        : normalise.personnummer(text, today);
    }
    if (key === null) return { state: "none", pooled: noPooled };
    const found = indexes[source.kind]?.get(key);
    if (!found) return { state: "none", pooled: noPooled };
    let pooled: string[] = noPooled;
    for (const m of found) {
      if (!pool.has(m)) continue;
      if (pooled === noPooled) pooled = [m];
      else pooled.push(m);
    }
    if (pooled.length === 1) return { state: "unique", pooled };
    if (pooled.length > 1) return { state: "ambiguous", pooled };
    return { state: "excluded", pooled, identified: found.length === 1 };
  };

  // pass 1: per-row chain
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    let outcome: RowOutcome | null = null;
    let candidates: string[] | null = null;
    let sawExcluded = false;
    for (let s = 0; s < sources.length; s++) {
      const cols = resolved[s];
      const ev = cols ? evaluate(sources[s]!, cols, row) : emptyEval;
      evals[s] = ev;
      const counts = sourceCounts[s]!;
      if (ev.state === "empty") counts.empty++;
      else if (ev.state === "unique") counts.unique++;
      else if (ev.state === "ambiguous") counts.ambiguous++;
      else counts.none++;
      if (outcome) continue;
      if (ev.state === "unique") outcome = { status: "matched", memberNo: ev.pooled[0]!, source: s };
      else if (ev.state === "ambiguous") {
        if (!candidates) candidates = [...ev.pooled];
        else for (const m of ev.pooled) if (!candidates.includes(m)) candidates.push(m);
      } else if (ev.state === "excluded") {
        // a value naming exactly one, excluded participant identifies the row: it must not fall through to another person
        if (ev.identified) outcome = { status: "excluded" };
        else sawExcluded = true;
      }
    }
    if (!outcome) {
      if (candidates) {
        const pick = resolutions.get(row.sheetRow);
        outcome = pick !== undefined && candidates.includes(pick)
          ? { status: "matched", memberNo: pick, source: null }
          : { status: "ambiguous", candidates };
      } else outcome = sawExcluded ? { status: "excluded" } : { status: "unmatched" };
    }
    outcomes[r] = outcome;
  }

  // pass 2: conflicts, after resolutions
  const byMember = new Map<string, number[]>();
  for (let r = 0; r < rows.length; r++) {
    const o = outcomes[r]!;
    if (o.status !== "matched") continue;
    const list = byMember.get(o.memberNo);
    if (list) list.push(r);
    else byMember.set(o.memberNo, [r]);
  }
  const conflicts: MatchResult["conflicts"] = [];
  for (const [memberNo, list] of byMember) {
    if (list.length < 2) continue;
    const sheetRows = list.map((r) => rows[r]!.sheetRow);
    const w = winners.get(memberNo);
    const winner = w === "skip" ? "skip" : w !== undefined && sheetRows.includes(w) ? w : null;
    conflicts.push({ memberNo, sheetRows, winner });
    for (const r of list) {
      if (winner !== "skip" && rows[r]!.sheetRow === winner) continue;
      outcomes[r] = { status: "conflict", memberNo };
    }
  }

  // totals and lists
  const totals: MatchResult["totals"] = {
    matched: 0, matchedBySource: sources.map(() => 0), matchedByResolution: 0,
    ambiguous: 0, unmatched: 0, excluded: 0, conflictRows: 0,
  };
  const ambiguous: MatchResult["ambiguous"] = [];
  const unmatchedRows: number[] = [];
  const excludedRows: number[] = [];
  for (let r = 0; r < rows.length; r++) {
    const o = outcomes[r]!;
    const sheetRow = rows[r]!.sheetRow;
    switch (o.status) {
      case "matched":
        totals.matched++;
        if (o.source === null) totals.matchedByResolution++;
        else totals.matchedBySource[o.source]!++;
        break;
      case "ambiguous": totals.ambiguous++; ambiguous.push({ sheetRow, candidates: o.candidates }); break;
      case "unmatched": totals.unmatched++; unmatchedRows.push(sheetRow); break;
      case "excluded": totals.excluded++; excludedRows.push(sheetRow); break;
      case "conflict": totals.conflictRows++; break;
    }
  }
  return { outcomes, sourceCounts, missingSources, totals, ambiguous, conflicts, unmatchedRows, excludedRows };
};
