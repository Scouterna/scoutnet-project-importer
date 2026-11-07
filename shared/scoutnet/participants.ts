import type { TrimmedParticipant } from "../api-types.ts";
import { asRecord } from "./normalise.ts";

export type RawParticipant = {
  member_no?: number | null;
  first_name?: string | null;
  last_name?: string | null;
  ssno?: string | null;
  primary_email?: string | null;
  cancelled?: boolean | null;
  confirmed?: boolean | null;
  questions?: unknown;
};

const answer = (value: unknown): string | string[] | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
};

const answers = (questions: unknown): TrimmedParticipant["answers"] =>
  Object.fromEntries(
    Object.entries(asRecord<unknown>(questions)).map(([id, value]) => [id, answer(value)]),
  );

/** `key` is the member id Scoutnet keys the collection by; used if `member_no` is missing. */
export const trimParticipant = (
  raw: RawParticipant,
  key = "",
): TrimmedParticipant => ({
  memberNo: String(raw.member_no ?? key),
  firstName: raw.first_name ?? null,
  lastName: raw.last_name ?? null,
  ssno: raw.ssno ?? null,
  email: raw.primary_email ?? null,
  cancelled: raw.cancelled === true,
  // Only an explicit false counts as unconfirmed, so a missing field never hides everyone.
  confirmed: raw.confirmed !== false,
  answers: answers(raw.questions),
});

export const trimParticipants = (collection: unknown): TrimmedParticipant[] =>
  Object.entries(asRecord<RawParticipant>(collection)).map(([key, raw]) =>
    trimParticipant(raw, key),
  );
