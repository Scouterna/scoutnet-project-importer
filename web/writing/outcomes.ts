export type NotAttemptedReason = "cancelled" | "key rejected";

// What became of one answer the app intended to write.
export type AnswerOutcome =
  | { status: "updated" }
  | { status: "unchanged" }
  | { status: "failed"; message: string }
  | { status: "notAttempted"; reason: NotAttemptedReason }
  | { status: "notFound" }
  | { status: "noMember" };

export type OutcomeStatus = AnswerOutcome["status"];

// member number -> question id -> outcome
export type OutcomeMap = Map<string, Map<string, AnswerOutcome>>;

export const setOutcome = (map: OutcomeMap, member: string, question: string, outcome: AnswerOutcome): void => {
  let inner = map.get(member);
  if (!inner) {
    inner = new Map();
    map.set(member, inner);
  }
  inner.set(question, outcome);
};

// Copies `from` into `into`, replacing answers that are in both.
export const mergeOutcomes = (into: OutcomeMap, from: OutcomeMap): void => {
  for (const [member, answers] of from) {
    for (const [question, outcome] of answers) setOutcome(into, member, question, outcome);
  }
};

export const countOutcomes = (map: ReadonlyMap<string, ReadonlyMap<string, AnswerOutcome>>): Record<OutcomeStatus, number> => {
  const counts: Record<OutcomeStatus, number> = {
    updated: 0,
    unchanged: 0,
    failed: 0,
    notAttempted: 0,
    notFound: 0,
    noMember: 0,
  };
  for (const answers of map.values()) for (const o of answers.values()) counts[o.status]++;
  return counts;
};

// The outcomes of this session, for step 6. In memory only: they name members and questions, so they are never
// stored or logged. The wizard store clears them when the file, the matching or the mapping changes.
const kept: OutcomeMap = new Map();

export const recordOutcomes = (outcomes: OutcomeMap): void => mergeOutcomes(kept, outcomes);
export const getOutcomes = (): ReadonlyMap<string, ReadonlyMap<string, AnswerOutcome>> => kept;

// How the last run (or retry) ended, for step 6. Cleared together with the outcomes.
export type LastRun = {
  stopped: NotAttemptedReason | null;
  // batches that failed as a whole and have not been retried successfully
  failedBatches: number;
  // participants with at least one answer Scoutnet reported as updated
  participants: number;
};

let lastRun: LastRun | null = null;

export const setLastRun = (run: LastRun): void => {
  lastRun = run;
};
export const getLastRun = (): LastRun | null => lastRun;

export const clearOutcomes = (): void => {
  kept.clear();
  lastRun = null;
};
