import type { TrimmedParticipant } from "../../shared/api-types.ts";
import type { Source } from "../matching/matcher.ts";
import type { SourceCounts } from "../matching/matcher.ts";
import type { Kind as AnswerKind, Outcome } from "../mapping/diff.ts";
import type { ValueEntry } from "../mapping/table.ts";
import type { ColumnMapping } from "../mapping/types.ts";
import type { AnswerOutcome } from "../writing/outcomes.ts";

export type Cell = {
  text: string;
  value: string | number | boolean | null;
  // ISO yyyy-mm-dd, or yyyy-mm-ddThh:mm:ss when the cell has a time part
  date?: string;
};

export type Column = { index: number; letter: string; name: string };

export type Row = {
  // 1-based, as in Excel
  sheetRow: number;
  // aligned to the columns
  cells: Cell[];
};

export type Stage = "reading" | "parsing" | "indexing";

export type SheetInfo = { name: string; rows: number; empty: boolean };

export type ErrorCode = "unreadable" | "bad_request" | "superseded";

export type Request =
  | { type: "load"; id: number; file: Blob & { name: string } }
  | { type: "selectSheet"; id: number; sheet: string }
  | { type: "selectHeader"; id: number; headerRow: number }
  | { type: "setParticipants"; id: number; version: string; participants: TrimmedParticipant[] }
  | {
      type: "match";
      id: number;
      sources: Source[];
      includeCancelled: boolean;
      includeUnconfirmed: boolean;
      // [sheetRow, memberNo]
      resolutions: [number, string][];
      // [memberNo, sheetRow | "skip"]
      winners: [string, number | "skip"][];
    }
  | { type: "mapAnswers"; id: number; mappings: MappingInput[] }
  | { type: "skippedRows"; id: number; questionId: string }
  | { type: "writePlan"; id: number; batchSize: number }
  | { type: "batchBody"; id: number; index: number }
  | { type: "reviewList"; id: number; filter: ReviewFilter; offset: number; limit: number }
  // Builds the .xlsx of rows not imported from the last match and diff plus these write outcomes.
  | {
      type: "notImported";
      id: number;
      // [memberNo, questionId, outcome]
      outcomes: [string, string, AnswerOutcome][];
      // [questionId, label]
      questionLabels: [string, string][];
      // Reply with the count only, without building the file.
      countOnly?: boolean;
    }
  // The values the last diff wanted to write for these answers.
  | { type: "writtenValues"; id: number; answers: [string, string][] };

// "writes": only answers that will be set, overwritten or cleared
export type ReviewFilter = "writes" | "all";
export const maxReviewLimit = 500;

// A mapping together with the definition of its question, so the worker needs no question list.
export type MappingInput = ColumnMapping & {
  question: { id: string; kind: AnswerKind; choices: { id: string; label: string }[] };
};

export type MatchParams = Omit<Extract<Request, { type: "match" }>, "type" | "id">;

export type ProgressReply = { type: "progress"; id: number; stage: Stage };
export type LoadedReply = {
  type: "loaded";
  id: number;
  fileName: string;
  sheets: SheetInfo[];
  sheet: string;
};
export type SheetReply = {
  type: "sheet";
  id: number;
  sheet: string;
  // first 20 non-empty rows, cells aligned to sheet columns A, B, ...
  topRows: Row[];
  headerRow: number;
};
export type TableReply = {
  type: "table";
  id: number;
  columns: Column[];
  rowCount: number;
  preview: Row[];
};
export type ParticipantsSetReply = { type: "participantsSet"; id: number; version: string };

// Never carries ssno.
export type MemberInfo = { memberNo: string; firstName: string | null; lastName: string | null; email: string | null };

// A row as the page lists it: only the columns the sources use. Keys are source indexes; a split name
// source gives "first last". Sources with a missing column have no entry.
export type MatchRow = { sheetRow: number; cells: Record<number, string> };

export type MatchedReply = {
  type: "matched";
  id: number;
  sourceCounts: SourceCounts[];
  missingSources: number[];
  totals: {
    matched: number;
    matchedBySource: number[];
    matchedByResolution: number;
    ambiguous: number;
    unmatched: number;
    excluded: number;
    conflictRows: number;
  };
  ambiguous: (MatchRow & { candidates: MemberInfo[] })[];
  conflicts: { member: MemberInfo; rows: MatchRow[]; winner: number | "skip" | null }[];
  unmatched: MatchRow[];
  excluded: MatchRow[];
  // pool members no row is matched to, in participant order
  withoutRow: (MemberInfo & { pending: "ambiguous" | "conflict" | null })[];
};
export type SkipReason = "skipEmpty" | "skipUnmapped" | "skipInvalid";

export type MappedReply = {
  type: "mapped";
  id: number;
  // Counts and value tables only; never participants' answers.
  questions: { questionId: string; counts: Record<Outcome, number>; values?: ValueEntry[] }[];
};
// value is the cell's text
export type SkippedReply = {
  type: "skipped";
  id: number;
  rows: { sheetRow: number; value: string; reason: SkipReason }[];
};
export type PlanReply = {
  type: "plan";
  id: number;
  // Member numbers only; the answers stay in the worker until batchBody asks for them.
  batches: { members: string[]; answers: number }[];
  totals: { participants: number; set: number; overwrite: number; clear: number; skipped: number; unchanged: number };
};
export type BodyReply = {
  type: "body";
  id: number;
  index: number;
  answers: Record<string, Record<string, string>>;
};
export type ReviewRow = {
  sheetRow: number;
  memberNo: string;
  name: string;
  questionId: string;
  current: string | string[] | null;
  next: string | null;
  outcome: Outcome;
};
// A participant header, then that participant's listed answers. `answers` counts the answer rows listed for them
// under the current filter, `writes` those that set, overwrite or clear.
export type ReviewItem =
  | { kind: "member"; memberNo: string; name: string; sheetRow: number; answers: number; writes: number }
  | ({ kind: "answer" } & ReviewRow);
// `total` and the paging count items (headers and answers together)
export type RowsReply = { type: "rows"; id: number; total: number; rows: ReviewItem[] };
export type FileReply = {
  type: "file";
  id: number;
  name: string;
  // Transferred, not copied. null when only the count was asked for.
  bytes: ArrayBuffer | null;
  rows: number;
};
// member → question → value; answers the last diff has no value for are left out
export type WrittenReply = { type: "written"; id: number; values: Record<string, Record<string, string>> };
export type ErrorReply = { type: "error"; id: number; code: ErrorCode; message: string };

export type Reply =
  | ProgressReply
  | LoadedReply
  | SheetReply
  | TableReply
  | ParticipantsSetReply
  | MatchedReply
  | MappedReply
  | SkippedReply
  | PlanReply
  | BodyReply
  | RowsReply
  | FileReply
  | WrittenReply
  | ErrorReply;

export const topRowCount = 20;
export const previewRowCount = 10;
