import type { Column } from "../spreadsheet/protocol.ts";
import { groupKey } from "./values.ts";

const contains = (a: string, b: string): boolean =>
  a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a));

/** Column name → question id. Equal keys first, then containment; one column per question, first column wins. */
export const suggestPairings = (
  columns: Column[],
  questions: { id: string; label: string }[],
): Map<string, string> => {
  const result = new Map<string, string>();
  const used = new Set<string>();
  const keys = columns.map((c) => groupKey(c.name));
  const labels = questions.map((q) => groupKey(q.label));
  const pass = (match: (column: string, label: string) => boolean) => {
    columns.forEach((c, i) => {
      if (result.has(c.name) || keys[i] === "") return;
      const j = questions.findIndex((q, k) => !used.has(q.id) && labels[k] !== "" && match(keys[i]!, labels[k]!));
      if (j < 0) return;
      result.set(c.name, questions[j]!.id);
      used.add(questions[j]!.id);
    });
  };
  pass((a, b) => a === b);
  pass(contains);
  return result;
};
