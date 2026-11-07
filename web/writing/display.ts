import type { Kind } from "../mapping/diff.ts";

type Choices = { id: string; label: string }[];

const label = (choices: Choices, id: string): string => choices.find((c) => c.id === id)?.label ?? id;

const one = (kind: Kind | null, choices: Choices, value: string): string => {
  if (kind === "yesNo") return value === "1" ? "Ja" : value === "0" ? "Nej" : value;
  if (kind === "choice") return label(choices, value);
  return value;
};

// A current answer as the review shows it: choice ids as option labels, yes/no as Ja/Nej, arrays joined.
export const displayCurrent = (kind: Kind | null, choices: Choices, value: string | string[] | null): string => {
  if (value === null || value === "" || (Array.isArray(value) && value.length === 0)) return "—";
  return Array.isArray(value) ? value.map((v) => one(kind, choices, v)).join(", ") : one(kind, choices, value);
};

// A value to be written: "" means the answer is cleared.
export const displayNext = (kind: Kind | null, choices: Choices, value: string | null): string => {
  if (value === null) return "—";
  if (value === "" && kind !== "yesNo") return "(cleared)";
  return one(kind, choices, value);
};
