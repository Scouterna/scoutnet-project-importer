import type { ParticipantsResponse, QuestionsResponse } from "../shared/api-types.ts";

export type Inclusion = { includeCancelled: boolean; includeUnconfirmed: boolean };

export const summarise = (
  questions: QuestionsResponse,
  participants: ParticipantsResponse,
  inclusion: Inclusion,
) => {
  const all = participants.participants;
  return {
    total: all.length,
    cancelled: all.filter((p) => p.cancelled).length,
    unconfirmed: all.filter((p) => !p.confirmed).length,
    forms: questions.forms.length,
    questions: questions.forms.reduce((sum, form) => sum + form.questions.length, 0),
    available: all.filter(
      (p) =>
        (inclusion.includeCancelled || !p.cancelled) &&
        (inclusion.includeUnconfirmed || p.confirmed),
    ).length,
    fetchedAt: participants.fetchedAt,
  };
};
