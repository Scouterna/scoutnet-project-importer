import type { WriteAnswersRequest, WriteAnswersResponse } from "../../shared/api-types.ts";
import { mergeOutcomes, setOutcome } from "./outcomes.ts";
import type { AnswerOutcome, NotAttemptedReason, OutcomeMap } from "./outcomes.ts";

export type Answers = WriteAnswersRequest["answers"];
export type Batch = { members: string[]; answers: number };

export type Progress = {
  batchesDone: number;
  batchesTotal: number;
  answersDone: number;
  answersTotal: number;
};

export type RunResult = {
  outcomes: OutcomeMap;
  // Batches that failed as a whole; "Retry failed batches" resends these.
  failedBatches: number[];
  // Batches never sent because the run was cancelled or the key was rejected (the latter includes the batch
  // the key was rejected on).
  unsent: number[];
  // Batches Scoutnet accepted (including the resend after isolating rejected answers).
  sent: number;
  stopped: NotAttemptedReason | null;
};

export type RunOptions = {
  batches: Batch[];
  // Batch indexes to run, in order. Default: all. Used for "Retry failed batches".
  indexes?: number[];
  // Called just before each batch is sent, so only one batch's values are held at a time.
  getBody: (index: number) => Promise<Answers>;
  send: (answers: Answers) => Promise<WriteAnswersResponse>;
  onProgress?: (progress: Progress) => void;
  signal?: AbortSignal;
  // Record batches that were not sent as notAttempted (default true). A retry leaves them as they were.
  markUnsent?: boolean;
};

// What the runner needs of an ApiError; read structurally so this module stays free of the network layer.
type SendError = { code: string | undefined; message: string; errors: Record<string, Record<string, string>> | undefined };

const describe = (e: unknown): SendError => {
  const o = (e ?? {}) as { code?: unknown; message?: unknown; errors?: unknown };
  return {
    code: typeof o.code === "string" ? o.code : undefined,
    message: typeof o.message === "string" && o.message !== "" ? o.message : "The request failed.",
    errors: typeof o.errors === "object" && o.errors !== null ? (o.errors as SendError["errors"]) : undefined,
  };
};

const each = (answers: Answers, fn: (member: string, question: string, value: string) => void): void => {
  for (const [member, byQuestion] of Object.entries(answers)) {
    for (const [question, value] of Object.entries(byQuestion)) fn(member, question, value);
  }
};

const markAll = (out: OutcomeMap, answers: Answers, outcome: AnswerOutcome): void =>
  each(answers, (m, q) => setOutcome(out, m, q, outcome));

export const runBatches = async (options: RunOptions): Promise<RunResult> => {
  const { batches, getBody, send, signal } = options;
  const order = options.indexes ?? batches.map((_, i) => i);
  const outcomes: OutcomeMap = new Map();
  const failedBatches: number[] = [];
  const unsent: number[] = [];
  let sent = 0;
  let stopped = null as NotAttemptedReason | null;
  const progress: Progress = {
    batchesDone: 0,
    batchesTotal: order.length,
    answersDone: 0,
    answersTotal: order.reduce((n, i) => n + (batches[i]?.answers ?? 0), 0),
  };
  const report = () => options.onProgress?.({ ...progress });
  report();

  const attempt = async (body: Answers): Promise<{ response: WriteAnswersResponse } | { error: SendError }> => {
    try {
      return { response: await send(body) };
    } catch (e) {
      return { error: describe(e) };
    }
  };

  const record = (body: Answers, response: WriteAnswersResponse) => {
    const notFound = new Set(response.notFound);
    const noMember = new Set(response.noMember);
    each(body, (member, question) => {
      if (notFound.has(member)) setOutcome(outcomes, member, question, { status: "notFound" });
      else if (noMember.has(member)) setOutcome(outcomes, member, question, { status: "noMember" });
      else {
        // A question Scoutnet doesn't mention counts as unchanged, as on the server.
        const result = response.results[member]?.[question] ?? "unchanged";
        setOutcome(outcomes, member, question, { status: result });
      }
    });
  };

  const runOne = async (index: number) => {
    let body: Answers;
    try {
      body = await getBody(index);
    } catch {
      // The plan is gone or the worker failed; the batch can be retried once the page has a new plan.
      failedBatches.push(index);
      return;
    }
    const first = await attempt(body);
    if ("response" in first) {
      record(body, first.response);
      sent++;
      return;
    }
    const error = first.error;
    if (error.code === "credentials_rejected") {
      stopped = "key rejected";
      unsent.push(index);
      return;
    }
    const failedAll = () => {
      markAll(outcomes, body, { status: "failed", message: error.message });
      failedBatches.push(index);
    };
    if (error.code !== "answers_rejected" || !error.errors) return failedAll();

    // Scoutnet named the answers at fault: fail those, resend the rest once.
    const remainder: Answers = {};
    let named = 0;
    each(body, (member, question, value) => {
      const message = error.errors?.[member]?.[question];
      if (message !== undefined) {
        named++;
        setOutcome(outcomes, member, question, { status: "failed", message });
      } else {
        (remainder[member] ??= {})[question] = value;
      }
    });
    // Nothing in this batch is named: a resend would be the same request.
    if (named === 0) return failedAll();
    if (Object.keys(remainder).length === 0) return;
    if (signal?.aborted) {
      stopped = "cancelled";
      markAll(outcomes, remainder, { status: "notAttempted", reason: "cancelled" });
      return;
    }
    const second = await attempt(remainder);
    if ("response" in second) {
      record(remainder, second.response);
      sent++;
    } else if (second.error.code === "credentials_rejected") {
      stopped = "key rejected";
      markAll(outcomes, remainder, { status: "notAttempted", reason: "key rejected" });
    } else {
      markAll(outcomes, remainder, { status: "failed", message: second.error.message });
      // A rejected resend is final (a retry would be rejected the same way); anything else may be transient.
      if (second.error.code !== "answers_rejected") failedBatches.push(index);
    }
  };

  for (const index of order) {
    if (!stopped && signal?.aborted) stopped = "cancelled";
    if (stopped) {
      unsent.push(index);
      continue;
    }
    await runOne(index);
    progress.batchesDone++;
    progress.answersDone += batches[index]?.answers ?? 0;
    report();
  }

  if (stopped && options.markUnsent !== false) {
    const reason: NotAttemptedReason = stopped;
    const later: OutcomeMap = new Map();
    for (const index of unsent) {
      try {
        markAll(later, await getBody(index), { status: "notAttempted", reason });
      } catch {
        // No body to name the answers; the batch stays in `unsent`.
      }
    }
    mergeOutcomes(outcomes, later);
  }

  return { outcomes, failedBatches, unsent, sent, stopped };
};
