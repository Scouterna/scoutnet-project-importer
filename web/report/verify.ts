import type { TrimmedParticipant } from "../../shared/api-types.ts";
import { readsBack } from "../writing/readback.ts";
import type { ReadbackKind } from "../writing/readback.ts";

export type Written = { memberNo: string; questionId: string; value: string };

export type NotConfirmed = {
  memberNo: string;
  questionId: string;
  written: string;
  now: string | string[] | null;
};

export type Verification = { confirmed: number; notConfirmed: NotConfirmed[] };

/**
 * Checks that every written answer reads back from the participants as written. A participant that is no longer
 * in the list, or a question of unknown kind (read as text), counts like any other answer.
 */
export const verify = (
  written: readonly Written[],
  participants: readonly Pick<TrimmedParticipant, "memberNo" | "answers">[],
  kinds: ReadonlyMap<string, ReadbackKind>,
): Verification => {
  const byNo = new Map(participants.map((p) => [p.memberNo, p]));
  const notConfirmed: NotConfirmed[] = [];
  let confirmed = 0;
  for (const w of written) {
    const now = byNo.get(w.memberNo)?.answers[w.questionId] ?? null;
    if (readsBack(kinds.get(w.questionId) ?? "text", w.value, now)) confirmed++;
    else notConfirmed.push({ memberNo: w.memberNo, questionId: w.questionId, written: w.value, now });
  }
  return { confirmed, notConfirmed };
};
