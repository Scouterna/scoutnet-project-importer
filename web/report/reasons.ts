import type { Outcome } from "../mapping/diff.ts";
import type { AnswerOutcome } from "../writing/outcomes.ts";

export type MatchStatus = "matched" | "ambiguous" | "excluded" | "unmatched" | "conflict";

export type AnswerInput = {
  questionId: string;
  // What step 4 decided for this answer.
  diff: Outcome;
  // What Scoutnet answered, when the answer was sent.
  write: AnswerOutcome | null;
};

export type ReasonInput = {
  match: MatchStatus;
  // The row's mapped answers, in step 4's order. Only used for a matched row.
  answers: readonly AnswerInput[];
  questionLabels: ReadonlyMap<string, string>;
};

const rowReasons: Record<Exclude<MatchStatus, "matched">, string> = {
  unmatched: "No match",
  ambiguous: "Ambiguous",
  excluded: "Excluded (cancelled or unconfirmed)",
  conflict: "Conflict",
};

const answerProblem = ({ diff, write }: AnswerInput): string | null => {
  if (write) {
    switch (write.status) {
      case "updated":
      case "unchanged":
        return null;
      case "failed":
        return `write failed (${write.message})`;
      case "notAttempted":
        return `not attempted (${write.reason})`;
      case "notFound":
      case "noMember":
        return "not a participant";
    }
  }
  if (diff === "skipUnmapped") return "unmapped value";
  if (diff === "skipInvalid") return "invalid value";
  if (diff === "set" || diff === "overwrite" || diff === "clear") return "not attempted (not written)";
  // unchanged and skipEmpty are not problems
  return null;
};

/** Why a spreadsheet row was not (fully) imported, or null when it was. */
export const rowReason = ({ match, answers, questionLabels }: ReasonInput): string | null => {
  if (match !== "matched") return rowReasons[match];
  const parts: string[] = [];
  for (const answer of answers) {
    const problem = answerProblem(answer);
    if (problem !== null) parts.push(`${questionLabels.get(answer.questionId) ?? answer.questionId}: ${problem}`);
  }
  return parts.length === 0 ? null : parts.join("; ");
};
