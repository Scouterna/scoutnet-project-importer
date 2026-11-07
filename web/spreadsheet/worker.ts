import * as XLSX from "xlsx";
import {
  decodeCsv,
  detectSeparator,
  hasSpreadsheetSignature,
  isBlankSheetCell,
  isCsvFile,
  toCell,
} from "./cells.ts";
import type { SheetCell } from "./cells.ts";
import { buildTable, guessHeaderRow, isBlankRow } from "./headers.ts";
import type { Table } from "./headers.ts";
import type { TrimmedParticipant } from "../../shared/api-types.ts";
import { buildIndex, match } from "../matching/matcher.ts";
import type { Index, Indexes, MatchResult, Source, SourceKind } from "../matching/matcher.ts";
import { diffQuestion } from "../mapping/diff.ts";
import type { Outcome } from "../mapping/diff.ts";
import { buildValueTable } from "../mapping/table.ts";
import type { ValueEntry } from "../mapping/table.ts";
import { parseYesNo } from "../mapping/values.ts";
import { rowReason } from "../report/reasons.ts";
import type { AnswerInput } from "../report/reasons.ts";
import type { AnswerOutcome } from "../writing/outcomes.ts";
import { maxReviewLimit, previewRowCount, topRowCount } from "./protocol.ts";
import type {
  BodyReply,
  Cell,
  ErrorCode,
  FileReply,
  WrittenReply,
  PlanReply,
  ReviewItem,
  RowsReply,
  MappedReply,
  MatchRow,
  MatchedReply,
  MemberInfo,
  Reply,
  Request,
  Row,
  SheetInfo,
  SkippedReply,
  Stage,
} from "./protocol.ts";

// What step 5 needs: member → question → the new answer and what happens to it.
export type DiffEntry = { outcome: Outcome; value: string | null };
export type LastDiff = Map<string, Map<string, DiffEntry>>;

const yesNoOptions = [
  { id: "1", label: "Yes" },
  { id: "0", label: "No" },
];

type Grid = (SheetCell | undefined)[][];

const gridOf = (sheet: XLSX.WorkSheet): Grid => (sheet["!data"] as Grid | undefined) ?? [];

const width = (sheet: XLSX.WorkSheet): number =>
  sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]).e.c + 1 : 0;

const describeSheet = (name: string, sheet: XLSX.WorkSheet): SheetInfo => {
  let rows = 0;
  for (const row of gridOf(sheet)) {
    if (row?.some((cell) => !isBlankSheetCell(cell))) rows++;
  }
  return { name, rows, empty: rows === 0 };
};

const toRows = (sheet: XLSX.WorkSheet): Row[] => {
  const cols = width(sheet);
  const rows: Row[] = [];
  gridOf(sheet).forEach((row, r) => {
    if (!row) return;
    const cells = Array.from({ length: cols }, (_, c) => toCell(row[c]));
    rows.push({ sheetRow: r + 1, cells });
  });
  return rows;
};

const parse = async (file: Blob & { name: string }): Promise<XLSX.WorkBook> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (isCsvFile(file)) {
    const text = decodeCsv(bytes);
    return XLSX.read(text, { type: "string", raw: true, dense: true, FS: detectSeparator(text) });
  }
  if (!hasSpreadsheetSignature(bytes)) throw new Error("not a spreadsheet");
  return XLSX.read(bytes, { type: "array", cellDates: true, cellNF: true, raw: false, dense: true });
};

// ISO yyyy-mm-dd or yyyy-mm-ddThh:mm:ss, read as UTC like SheetJS does
const isoToDate = (iso: string): Date => new Date(iso.length > 10 ? `${iso}Z` : `${iso}T00:00:00Z`);

// A cell as it goes back into a file: dates as dates, numbers as numbers, text as text.
const cellValue = (cell: Cell | undefined): string | number | boolean | Date | null => {
  if (!cell) return null;
  if (cell.date !== undefined) return isoToDate(cell.date);
  return cell.value;
};

class RequestError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

// Handles one request at a time, in order. Replies go to `post`; the workbook and chosen table stay in here.
export type HandlerOptions = {
  // injectable for tests
  today?: () => Date;
  buildIndex?: (participants: TrimmedParticipant[], kind: SourceKind, today: Date) => Index;
};

export const createHandler = (post: (reply: Reply) => void, options: HandlerOptions = {}) => {
  const now = options.today ?? (() => new Date());
  const makeIndex = options.buildIndex ?? buildIndex;
  let book: XLSX.WorkBook | null = null;
  let current: { name: string; rows: Row[]; table: Table | null; headerRow: number } | null = null;
  // for the name of the export
  let loadedFile: { name: string; csv: boolean } | null = null;
  let queue: Promise<void> = Promise.resolve();
  let latestLoad = 0;
  let participants: { version: string; list: TrimmedParticipant[]; indexes: Indexes } | null = null;
  // kept for steps 4 and 5
  let lastMatch: MatchResult | null = null;
  // Value tables per (column, question and its options); dropped when the match result changes.
  let tables = new Map<string, { entries: ValueEntry[]; auto: Map<string, string> }>();
  // The last mapAnswers: per question the matched rows and their outcomes, and the diff by member.
  let perQuestion = new Map<string, { col: number; rows: Row[]; outcomes: { memberNo: string; outcome: Outcome; value: string | null }[] }>();
  let diff: LastDiff | null = null;
  // member → sheet row of its matched row, from the last mapAnswers
  let rowOf = new Map<string, number>();
  // The last writePlan: the members of each batch, in order. Depends on `diff`.
  let plan: string[][] | null = null;
  let membersByNo: { list: TrimmedParticipant[]; map: Map<string, TrimmedParticipant> } | null = null;

  const setLastMatch = (result: MatchResult | null) => {
    lastMatch = result;
    tables = new Map();
    perQuestion = new Map();
    rowOf = new Map();
    diff = null;
    plan = null;
  };

  const progress = (id: number, stage: Stage) => post({ type: "progress", id, stage });

  const checkCurrent = (id: number) => {
    if (id < latestLoad) throw new RequestError("superseded", "Replaced by a newer request.");
  };

  const load = async (id: number, file: Blob & { name: string }) => {
    checkCurrent(id);
    progress(id, "reading");
    let next: XLSX.WorkBook;
    try {
      const pending = parse(file);
      progress(id, "parsing");
      next = await pending;
    } catch {
      checkCurrent(id);
      throw new RequestError("unreadable", `The file "${file.name}" could not be read.`);
    }
    checkCurrent(id);
    progress(id, "indexing");
    const sheets = next.SheetNames.map((name) => describeSheet(name, next.Sheets[name]!));
    if (sheets.length === 0) {
      throw new RequestError("unreadable", `The file "${file.name}" could not be read.`);
    }
    checkCurrent(id);
    book = next;
    loadedFile = { name: file.name, csv: isCsvFile(file) };
    current = null;
    setLastMatch(null);
    const sheet = (sheets.find((s) => !s.empty) ?? sheets[0]!).name;
    post({ type: "loaded", id, fileName: file.name, sheets, sheet });
  };

  const selectSheet = (id: number, name: string) => {
    const sheet = book?.Sheets[name];
    if (!sheet) throw new RequestError("bad_request", "No such sheet.");
    const rows = toRows(sheet);
    setLastMatch(null);
    current = { name, rows, table: null, headerRow: 0 };
    const topRows = rows.filter((row) => !isBlankRow(row)).slice(0, topRowCount);
    post({ type: "sheet", id, sheet: name, topRows, headerRow: guessHeaderRow(rows) });
  };

  const selectHeader = (id: number, headerRow: number) => {
    if (!current) throw new RequestError("bad_request", "No sheet is selected.");
    const table = buildTable(current.rows, headerRow);
    current.table = table;
    current.headerRow = headerRow;
    setLastMatch(null);
    post({
      type: "table",
      id,
      columns: table.columns,
      rowCount: table.rows.length,
      preview: table.rows.slice(0, previewRowCount),
    });
  };

  const setParticipants = (id: number, version: string, list: TrimmedParticipant[]) => {
    // a new version drops the cached indexes
    participants = { version, list, indexes: {} };
    // current answers changed
    membersByNo = null;
    perQuestion = new Map();
    rowOf = new Map();
    diff = null;
    plan = null;
    post({ type: "participantsSet", id, version });
  };

  const info = (byNo: Map<string, TrimmedParticipant>, memberNo: string): MemberInfo => {
    const p = byNo.get(memberNo);
    return { memberNo, firstName: p?.firstName ?? null, lastName: p?.lastName ?? null, email: p?.email ?? null };
  };

  const runMatch = (req: Extract<Request, { type: "match" }>) => {
    const table = current?.table;
    if (!table) throw new RequestError("bad_request", "No table is selected.");
    if (!participants) throw new RequestError("bad_request", "No participants have been set.");
    const today = now();
    const { sources } = req;
    for (const source of sources) {
      const kind: SourceKind = source.kind;
      participants.indexes[kind] ??= makeIndex(participants.list, kind, today);
    }
    const pool = new Set<string>();
    const byNo = new Map<string, TrimmedParticipant>();
    for (const p of participants.list) {
      byNo.set(p.memberNo, p);
      if ((req.includeCancelled || !p.cancelled) && (req.includeUnconfirmed || p.confirmed)) pool.add(p.memberNo);
    }
    const result = match({
      rows: table.rows,
      columns: table.columns,
      sources,
      indexes: participants.indexes,
      pool,
      resolutions: new Map(req.resolutions),
      winners: new Map(req.winners),
      today,
    });
    setLastMatch(result);

    const positions = new Map<string, number>();
    table.columns.forEach((c, i) => {
      if (!positions.has(c.name)) positions.set(c.name, i);
    });
    const columnsOf = (s: Source): string[] => (s.kind === "name" && s.layout === "split" ? [s.first, s.last] : [(s as { column: string }).column]);
    const missing = new Set(result.missingSources);
    const rowBySheetRow = new Map<number, Row>(table.rows.map((r) => [r.sheetRow, r]));
    const listRow = (sheetRow: number): MatchRow => {
      const row = rowBySheetRow.get(sheetRow);
      const cells: Record<number, string> = {};
      sources.forEach((s, i) => {
        if (missing.has(i) || !row) return;
        cells[i] = columnsOf(s)
          .map((name) => row.cells[positions.get(name)!]?.text ?? "")
          .join(" ")
          .trim();
      });
      return { sheetRow, cells };
    };

    const hasRow = new Set<string>();
    for (const o of result.outcomes) if (o.status === "matched") hasRow.add(o.memberNo);
    const pendingAmbiguous = new Set<string>();
    for (const a of result.ambiguous) for (const m of a.candidates) pendingAmbiguous.add(m);
    const pendingConflict = new Set(result.conflicts.map((c) => c.memberNo));
    const withoutRow: MatchedReply["withoutRow"] = [];
    for (const p of participants.list) {
      if (!pool.has(p.memberNo) || hasRow.has(p.memberNo)) continue;
      const pending = pendingAmbiguous.has(p.memberNo) ? "ambiguous" : pendingConflict.has(p.memberNo) ? "conflict" : null;
      withoutRow.push({ ...info(byNo, p.memberNo), pending });
    }

    const reply: MatchedReply = {
      type: "matched",
      id: req.id,
      sourceCounts: result.sourceCounts,
      missingSources: result.missingSources,
      totals: result.totals,
      ambiguous: result.ambiguous.map((a) => ({
        ...listRow(a.sheetRow),
        candidates: a.candidates.map((m) => info(byNo, m)),
      })),
      conflicts: result.conflicts.map((c) => ({
        member: info(byNo, c.memberNo),
        rows: c.sheetRows.map(listRow),
        winner: c.winner,
      })),
      unmatched: result.unmatchedRows.map(listRow),
      excluded: result.excludedRows.map(listRow),
      withoutRow,
    };
    post(reply);
  };

  const runMapAnswers = (req: Extract<Request, { type: "mapAnswers" }>) => {
    const table = current?.table;
    if (!table || !lastMatch) throw new RequestError("bad_request", "No rows have been matched.");
    if (!participants) throw new RequestError("bad_request", "No participants have been set.");
    if (membersByNo?.list !== participants.list) {
      membersByNo = { list: participants.list, map: new Map(participants.list.map((p) => [p.memberNo, p])) };
    }
    const byNo = membersByNo.map;
    const positions = new Map<string, number>();
    table.columns.forEach((c, i) => {
      if (!positions.has(c.name)) positions.set(c.name, i);
    });
    // matched rows only; conflict losers are not "matched"
    const matched: { memberNo: string; row: Row }[] = [];
    lastMatch.outcomes.forEach((o, i) => {
      if (o.status === "matched") matched.push({ memberNo: o.memberNo, row: table.rows[i]! });
    });

    const nextPer: typeof perQuestion = new Map();
    const nextDiff: LastDiff = new Map();
    const questions: MappedReply["questions"] = [];
    for (const m of req.mappings) {
      const col = positions.get(m.column);
      if (col === undefined) throw new RequestError("bad_request", "No such column.");
      const { question } = m;
      const options = question.kind === "yesNo" ? yesNoOptions : question.choices;
      const hasTable = question.kind === "choice" || question.kind === "yesNo";

      let values: ValueEntry[] | undefined;
      let auto = new Map<string, string>();
      if (hasTable) {
        const cacheKey = JSON.stringify([m.column, question.id, question.kind, options]);
        let cached = tables.get(cacheKey);
        if (!cached) {
          const texts: string[] = [];
          for (const { row } of matched) {
            const text = row.cells[col]?.text.trim() ?? "";
            // recognised yes/no variants never need the table
            if (text !== "" && !(question.kind === "yesNo" && parseYesNo(text) !== null)) texts.push(text);
          }
          const entries = buildValueTable(texts, options);
          cached = {
            entries,
            auto: new Map(entries.flatMap((e) => (e.auto === null ? [] : [[e.key, e.auto] as [string, string]]))),
          };
          tables.set(cacheKey, cached);
        }
        values = cached.entries;
        auto = cached.auto;
      }

      const current = new Map<string, string | string[] | null>();
      for (const { memberNo } of matched) {
        current.set(memberNo, byNo.get(memberNo)?.answers[question.id] ?? null);
      }
      const result = diffQuestion({
        rows: matched.map(({ memberNo, row }) => ({
          memberNo,
          cell: row.cells[col] ?? { text: "", value: null },
        })),
        kind: question.kind,
        choices: question.choices,
        rules: { emptyCells: m.emptyCells, existing: m.existing, decisions: m.decisions },
        auto,
        current,
      });
      nextPer.set(question.id, { col, rows: matched.map((r) => r.row), outcomes: result.outcomes });
      for (const o of result.outcomes) {
        let byQuestion = nextDiff.get(o.memberNo);
        if (!byQuestion) nextDiff.set(o.memberNo, (byQuestion = new Map()));
        byQuestion.set(question.id, { outcome: o.outcome, value: o.value });
      }
      questions.push({ questionId: question.id, counts: result.counts, ...(values ? { values } : {}) });
    }
    perQuestion = nextPer;
    diff = nextDiff;
    rowOf = new Map(matched.map(({ memberNo, row }) => [memberNo, row.sheetRow]));
    plan = null;
    post({ type: "mapped", id: req.id, questions } satisfies MappedReply);
  };

  const runSkippedRows = (req: Extract<Request, { type: "skippedRows" }>) => {
    const q = perQuestion.get(req.questionId);
    if (!q) throw new RequestError("bad_request", "The question has not been mapped.");
    const rows: SkippedReply["rows"] = [];
    q.outcomes.forEach((o, i) => {
      if (o.outcome !== "skipEmpty" && o.outcome !== "skipUnmapped" && o.outcome !== "skipInvalid") return;
      const row = q.rows[i]!;
      rows.push({ sheetRow: row.sheetRow, value: row.cells[q.col]?.text ?? "", reason: o.outcome });
    });
    post({ type: "skipped", id: req.id, rows } satisfies SkippedReply);
  };

  const isWrite = (o: Outcome) => o === "set" || o === "overwrite" || o === "clear";
  const isSkip = (o: Outcome) => o === "skipEmpty" || o === "skipUnmapped" || o === "skipInvalid";

  const runWritePlan = (req: Extract<Request, { type: "writePlan" }>) => {
    if (!diff) throw new RequestError("bad_request", "No answers have been mapped.");
    if (!Number.isInteger(req.batchSize) || req.batchSize < 1) {
      throw new RequestError("bad_request", "The batch size must be a whole number of at least 1.");
    }
    const totals: PlanReply["totals"] = { participants: 0, set: 0, overwrite: 0, clear: 0, skipped: 0, unchanged: 0 };
    const planned: { memberNo: string; answers: number }[] = [];
    for (const [memberNo, byQuestion] of diff) {
      let answers = 0;
      for (const { outcome } of byQuestion.values()) {
        if (isWrite(outcome)) {
          totals[outcome as "set" | "overwrite" | "clear"]++;
          answers++;
        } else if (isSkip(outcome)) totals.skipped++;
        else totals.unchanged++;
      }
      if (answers > 0) planned.push({ memberNo, answers });
    }
    totals.participants = planned.length;
    planned.sort((a, b) => (rowOf.get(a.memberNo) ?? 0) - (rowOf.get(b.memberNo) ?? 0));
    const batches: PlanReply["batches"] = [];
    const members: string[][] = [];
    for (let i = 0; i < planned.length; i += req.batchSize) {
      const chunk = planned.slice(i, i + req.batchSize);
      members.push(chunk.map((c) => c.memberNo));
      batches.push({ members: members.at(-1)!, answers: chunk.reduce((n, c) => n + c.answers, 0) });
    }
    plan = members;
    post({ type: "plan", id: req.id, batches, totals } satisfies PlanReply);
  };

  const runBatchBody = (req: Extract<Request, { type: "batchBody" }>) => {
    if (!diff || !plan) throw new RequestError("bad_request", "No write plan has been made.");
    const batch = Number.isInteger(req.index) ? plan[req.index] : undefined;
    if (!batch) throw new RequestError("bad_request", "No such batch.");
    const answers: BodyReply["answers"] = {};
    for (const memberNo of batch) {
      const out: Record<string, string> = {};
      for (const [questionId, { outcome, value }] of diff.get(memberNo) ?? []) {
        if (isWrite(outcome) && value !== null) out[questionId] = value;
      }
      answers[memberNo] = out;
    }
    post({ type: "body", id: req.id, index: req.index, answers } satisfies BodyReply);
  };

  const runReviewList = (req: Extract<Request, { type: "reviewList" }>) => {
    if (!diff) throw new RequestError("bad_request", "No answers have been mapped.");
    const { offset, limit } = req;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > maxReviewLimit) {
      throw new RequestError("bad_request", `The limit must be between 1 and ${maxReviewLimit}.`);
    }
    const wanted = (o: Outcome) => req.filter === "all" || isWrite(o);
    // matched rows with their position, so the order is sheet row, then question order
    const hits: { sheetRow: number; q: number; memberNo: string; questionId: string; outcome: Outcome; value: string | null }[] = [];
    let q = 0;
    for (const [questionId, entry] of perQuestion) {
      entry.outcomes.forEach((o, i) => {
        if (!wanted(o.outcome)) return;
        hits.push({ sheetRow: entry.rows[i]!.sheetRow, q, memberNo: o.memberNo, questionId, outcome: o.outcome, value: o.value });
      });
      q++;
    }
    hits.sort((a, b) => a.sheetRow - b.sheetRow || a.q - b.q);
    const byNo = membersByNo?.map;
    // headers and hits in one flat list; a member's hits are contiguous, so one pass finds each run
    type Head = { head: true; memberNo: string; sheetRow: number; answers: number; writes: number };
    const flat: (Head | (typeof hits)[number])[] = [];
    let head: Head | null = null;
    for (const h of hits) {
      if (!head || head.memberNo !== h.memberNo || head.sheetRow !== h.sheetRow) {
        head = { head: true, memberNo: h.memberNo, sheetRow: h.sheetRow, answers: 0, writes: 0 };
        flat.push(head);
      }
      head.answers++;
      if (isWrite(h.outcome)) head.writes++;
      flat.push(h);
    }
    const nameOf = (memberNo: string) => {
      const person = byNo?.get(memberNo);
      return [person?.firstName, person?.lastName].filter(Boolean).join(" ");
    };
    const rows: ReviewItem[] = flat.slice(offset, offset + limit).map((h): ReviewItem => {
      if ("head" in h) {
        return { kind: "member", memberNo: h.memberNo, name: nameOf(h.memberNo), sheetRow: h.sheetRow, answers: h.answers, writes: h.writes };
      }
      return {
        kind: "answer",
        sheetRow: h.sheetRow,
        memberNo: h.memberNo,
        name: nameOf(h.memberNo),
        questionId: h.questionId,
        current: byNo?.get(h.memberNo)?.answers[h.questionId] ?? null,
        next: h.value,
        outcome: h.outcome,
      };
    });
    post({ type: "rows", id: req.id, total: flat.length, rows } satisfies RowsReply);
  };

  const runNotImported = (req: Extract<Request, { type: "notImported" }>) => {
    const table = current?.table;
    if (!table || !lastMatch || !diff) throw new RequestError("bad_request", "No answers have been mapped.");
    const written = new Map<string, Map<string, AnswerOutcome>>();
    for (const [member, question, outcome] of req.outcomes) {
      let inner = written.get(member);
      if (!inner) written.set(member, (inner = new Map()));
      inner.set(question, outcome);
    }
    const labels = new Map(req.questionLabels);
    const order = [...perQuestion.keys()];
    const included: { row: Row; reason: string }[] = [];
    lastMatch.outcomes.forEach((o, i) => {
      let answers: AnswerInput[] = [];
      if (o.status === "matched") {
        const byQuestion = diff!.get(o.memberNo);
        const outcomes = written.get(o.memberNo);
        answers = order.flatMap((questionId) => {
          const entry = byQuestion?.get(questionId);
          return entry ? [{ questionId, diff: entry.outcome, write: outcomes?.get(questionId) ?? null }] : [];
        });
      }
      const reason = rowReason({ match: o.status, answers, questionLabels: labels });
      if (reason !== null) included.push({ row: table.rows[i]!, reason });
    });
    const base = (loadedFile?.name ?? "spreadsheet").replace(/\.[^./\\]*$/, "");
    const name = `${base}-not-imported.xlsx`;
    if (req.countOnly) {
      post({ type: "file", id: req.id, name, bytes: null, rows: included.length } satisfies FileReply);
      return;
    }

    const header = current!.rows.find((r) => r.sheetRow === current!.headerRow);
    const timed: [number, number][] = [];
    const aoa: (string | number | boolean | Date | null)[][] = [
      [...table.columns.map((c) => (header ? cellValue(header.cells[c.index]) : null)), "Reason"],
    ];
    included.forEach(({ row, reason }, r) => {
      aoa.push([
        ...row.cells.map((cell, c) => {
          if (cell.date !== undefined && cell.date.length > 10) timed.push([r + 1, c]);
          return cellValue(cell);
        }),
        reason,
      ]);
    });
    const sheet = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, dense: true });
    // aoa_to_sheet shows every date as a plain date, which would hide a time part
    const grid = gridOf(sheet);
    for (const [r, c] of timed) {
      const cell = grid[r]?.[c];
      if (cell) cell.z = "yyyy-mm-dd hh:mm:ss";
    }
    const book = XLSX.utils.book_new();
    const sheetName = loadedFile?.csv ? "Not imported" : current!.name.slice(0, 31);
    XLSX.utils.book_append_sheet(book, sheet, sheetName || "Not imported");
    const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    post({ type: "file", id: req.id, name, bytes, rows: included.length } satisfies FileReply);
  };

  const runWrittenValues = (req: Extract<Request, { type: "writtenValues" }>) => {
    if (!diff) throw new RequestError("bad_request", "No answers have been mapped.");
    const values: WrittenReply["values"] = {};
    for (const [member, question] of req.answers) {
      const value = diff.get(member)?.get(question)?.value;
      if (value === undefined || value === null) continue;
      (values[member] ??= {})[question] = value;
    }
    post({ type: "written", id: req.id, values } satisfies WrittenReply);
  };

  const run = async (req: Request) => {
    try {
      if (req.type === "load") await load(req.id, req.file);
      else if (req.type === "selectSheet") selectSheet(req.id, req.sheet);
      else if (req.type === "selectHeader") selectHeader(req.id, req.headerRow);
      else if (req.type === "setParticipants") setParticipants(req.id, req.version, req.participants);
      else if (req.type === "match") runMatch(req);
      else if (req.type === "mapAnswers") runMapAnswers(req);
      else if (req.type === "skippedRows") runSkippedRows(req);
      else if (req.type === "writePlan") runWritePlan(req);
      else if (req.type === "batchBody") runBatchBody(req);
      else if (req.type === "notImported") runNotImported(req);
      else if (req.type === "writtenValues") runWrittenValues(req);
      else runReviewList(req);
    } catch (e) {
      const code = e instanceof RequestError ? e.code : "unreadable";
      const message = e instanceof RequestError ? e.message : "The spreadsheet could not be read.";
      post({ type: "error", id: req.id, code, message });
    }
  };

  const handle = (req: Request): Promise<void> => {
    if (req.type === "load") latestLoad = Math.max(latestLoad, req.id);
    queue = queue.then(() => run(req));
    return queue;
  };
  // lastMatch and lastDiff are for step 5 and tests; nothing else is exposed
  return Object.assign(handle, {
    lastMatch: (): MatchResult | null => lastMatch,
    lastDiff: (): LastDiff | null => diff,
  });
};

// Only wire up inside a real worker, so tests can import createHandler in Node.
// `self` is declared narrowly because the web tsconfig uses the DOM lib, not WebWorker.
type WorkerScope = {
  onmessage: ((event: { data: Request }) => void) | null;
  postMessage: (message: Reply, transfer?: Transferable[]) => void;
};

const scope = globalThis as unknown as WorkerScope;
if ("onmessage" in scope) {
  const handle = createHandler((reply) =>
    // the export is moved, not copied
    reply.type === "file" && reply.bytes ? scope.postMessage(reply, [reply.bytes]) : scope.postMessage(reply),
  );
  scope.onmessage = (event) => void handle(event.data);
}

