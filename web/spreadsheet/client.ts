import type { TrimmedParticipant } from "../../shared/api-types.ts";
import type { AnswerOutcome } from "../writing/outcomes.ts";
import type {
  ErrorCode,
  FileReply,
  LoadedReply,
  MappedReply,
  MappingInput,
  MatchParams,
  MatchedReply,
  ParticipantsSetReply,
  PlanReply,
  BodyReply,
  ReviewFilter,
  RowsReply,
  Reply,
  Request,
  SheetReply,
  SkippedReply,
  Stage,
  TableReply,
  WrittenReply,
} from "./protocol.ts";

export class SpreadsheetError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type WorkerLike = {
  postMessage: (message: Request) => void;
  terminate: () => void;
  onmessage: ((event: { data: Reply }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

type Kind = Request["type"];

type Pending = {
  kind: Kind;
  resolve: (reply: never) => void;
  reject: (error: SpreadsheetError) => void;
};

const defaultWorker = (): WorkerLike =>
  new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;

// Requests that depend on the last mapAnswers result.
const planned: Kind[] = ["writePlan", "batchBody", "reviewList"];

// Requests that depend on the last match and diff, for step 6. They do not supersede each other: the page counts
// and downloads from the same report, and a download must survive a newer count.
const reported: Kind[] = ["notImported", "writtenValues"];

// A new request of a kind makes older ones of that kind (and any that depend on them) stale.
const supersedes: Record<Kind, Kind[]> = {
  load: ["load", "selectSheet", "selectHeader", "match", "mapAnswers", "skippedRows", ...planned, ...reported],
  selectSheet: ["selectSheet", "selectHeader", "match", "mapAnswers", "skippedRows", ...planned, ...reported],
  selectHeader: ["selectHeader", "match", "mapAnswers", "skippedRows", ...planned, ...reported],
  setParticipants: ["setParticipants", ...planned, ...reported],
  match: ["match", "mapAnswers", "skippedRows", ...planned, ...reported],
  mapAnswers: ["mapAnswers", "skippedRows", ...planned, ...reported],
  skippedRows: ["skippedRows"],
  // the runner asks for bodies one after another while the page pages the list, so neither supersedes the other
  writePlan: ["writePlan", "batchBody"],
  batchBody: [],
  reviewList: ["reviewList"],
  notImported: [],
  writtenValues: ["writtenValues"],
};

const allKinds: Kind[] = [
  "load",
  "selectSheet",
  "selectHeader",
  "setParticipants",
  "match",
  "mapAnswers",
  "skippedRows",
  "writePlan",
  "batchBody",
  "reviewList",
  "notImported",
  "writtenValues",
];

export const createSpreadsheetClient = (makeWorker: () => WorkerLike = defaultWorker) => {
  let worker: WorkerLike | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();
  const listeners = new Set<(stage: Stage) => void>();
  const resetListeners = new Set<() => void>();

  const drop = (kinds: Kind[], error: SpreadsheetError) => {
    for (const [id, p] of pending) {
      if (!kinds.includes(p.kind)) continue;
      pending.delete(id);
      p.reject(error);
    }
  };

  const onReply = (reply: Reply) => {
    const p = pending.get(reply.id);
    if (!p) return;
    if (reply.type === "progress") {
      for (const listener of listeners) listener(reply.stage);
    } else if (reply.type === "error") {
      pending.delete(reply.id);
      p.reject(new SpreadsheetError(reply.code, reply.message));
    } else {
      pending.delete(reply.id);
      p.resolve(reply as never);
    }
  };

  const crash = () => {
    worker?.terminate();
    worker = null;
    drop(
      allKinds,
      new SpreadsheetError("unreadable", "The spreadsheet could not be read."),
    );
    for (const listener of resetListeners) listener();
  };

  const getWorker = (): WorkerLike => {
    if (worker) return worker;
    const created = makeWorker();
    created.onmessage = (event) => onReply(event.data);
    created.onerror = crash;
    worker = created;
    return created;
  };

  const send = <R>(kind: Kind, build: (id: number) => Request): Promise<R> => {
    drop(supersedes[kind], new SpreadsheetError("superseded", "Replaced by a newer request."));
    const id = nextId++;
    return new Promise<R>((resolve, reject) => {
      pending.set(id, { kind, resolve: resolve as (reply: never) => void, reject });
      getWorker().postMessage(build(id));
    });
  };

  return {
    load: (file: Blob & { name: string }) =>
      send<LoadedReply>("load", (id) => ({ type: "load", id, file })),
    selectSheet: (sheet: string) =>
      send<SheetReply>("selectSheet", (id) => ({ type: "selectSheet", id, sheet })),
    selectHeader: (headerRow: number) =>
      send<TableReply>("selectHeader", (id) => ({ type: "selectHeader", id, headerRow })),
    setParticipants: (version: string, participants: TrimmedParticipant[]) =>
      send<ParticipantsSetReply>("setParticipants", (id) => ({ type: "setParticipants", id, version, participants })),
    match: (params: MatchParams) =>
      send<MatchedReply>("match", (id) => ({ type: "match", id, ...params })),
    mapAnswers: (mappings: MappingInput[]) =>
      send<MappedReply>("mapAnswers", (id) => ({ type: "mapAnswers", id, mappings })),
    skippedRows: (questionId: string) =>
      send<SkippedReply>("skippedRows", (id) => ({ type: "skippedRows", id, questionId })),
    writePlan: (batchSize: number) =>
      send<PlanReply>("writePlan", (id) => ({ type: "writePlan", id, batchSize })),
    batchBody: (index: number) =>
      send<BodyReply>("batchBody", (id) => ({ type: "batchBody", id, index })),
    reviewList: (filter: ReviewFilter, offset: number, limit: number) =>
      send<RowsReply>("reviewList", (id) => ({ type: "reviewList", id, filter, offset, limit })),
    notImported: (outcomes: [string, string, AnswerOutcome][], questionLabels: [string, string][], countOnly = false) =>
      send<FileReply>("notImported", (id) => ({ type: "notImported", id, outcomes, questionLabels, countOnly })),
    writtenValues: (answers: [string, string][]) =>
      send<WrittenReply>("writtenValues", (id) => ({ type: "writtenValues", id, answers })),
    // Progress of the latest load. Returns an unsubscribe function.
    onProgress: (listener: (stage: Stage) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    // Fired after a worker crash: the worker's workbook is gone, so the page must drop its spreadsheet.
    onReset: (listener: () => void) => {
      resetListeners.add(listener);
      return () => void resetListeners.delete(listener);
    },
  };
};

export const spreadsheet = createSpreadsheetClient();
