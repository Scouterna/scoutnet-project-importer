import type { Form, QuestionChoice, TrimmedParticipant } from "../../shared/api-types.ts";
import { classify } from "./questions.ts";
import type { Kind } from "./diff.ts";

export type QuestionInfo = {
  id: string;
  label: string;
  // form › tab › section
  group: string;
  choices: QuestionChoice[];
  // null: not importable
  kind: Kind | null;
  reason: string | null;
  // a choice question nobody has answered: might be multiple choice
  unanswered: boolean;
};

/** Every question of every form, in Scoutnet's order, with its group and classification. */
export const buildCatalog = (
  forms: Form[],
  participants: Pick<TrimmedParticipant, "answers">[],
): QuestionInfo[] =>
  forms.flatMap((form) =>
    form.questions.map((q): QuestionInfo => {
      const tab = form.tabs.find((t) => t.id === q.tabId)?.title;
      const section = form.sections.find((s) => s.id === q.sectionId)?.title;
      const c = classify(q, participants);
      const base = {
        id: q.id,
        label: q.label,
        group: [form.title, tab, section].filter(Boolean).join(" › "),
        choices: q.choices,
      };
      return c.kind === "unsupported"
        ? { ...base, kind: null, reason: c.reason, unanswered: false }
        : { ...base, kind: c.kind, reason: null, unanswered: c.kind === "choice" && c.unanswered };
    }),
  );
