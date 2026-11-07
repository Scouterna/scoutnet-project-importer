import type { Question, TrimmedParticipant } from "../../shared/api-types.ts";

export type Classification =
  | { kind: "text" | "number" | "yesNo"; unanswered?: false }
  // unanswered: nobody has answered yet, so it might be multiple choice after all
  | { kind: "choice"; unanswered: boolean }
  | { kind: "unsupported"; reason: string };

const answered = (answer: string | string[] | null | undefined): boolean =>
  answer !== null && answer !== undefined && answer !== "" && !(Array.isArray(answer) && answer.length === 0);

export const classify = (
  question: Pick<Question, "id" | "type">,
  participants: Pick<TrimmedParticipant, "answers">[],
): Classification => {
  switch (question.type) {
    case "text":
      return { kind: "text" };
    case "number":
      return { kind: "number" };
    case "boolean":
      return { kind: "yesNo" };
    case "choice": {
      let any = false;
      for (const p of participants) {
        const a = p.answers[question.id];
        if (Array.isArray(a)) {
          return { kind: "unsupported", reason: "Multiple choice questions cannot be written to Scoutnet" };
        }
        if (answered(a)) any = true;
      }
      return { kind: "choice", unanswered: !any };
    }
    case "other_unsupported_by_api":
      return { kind: "unsupported", reason: "Date and time questions cannot be written to Scoutnet" };
    default:
      return { kind: "unsupported", reason: "Unknown question type" };
  }
};
