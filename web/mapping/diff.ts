import type { Cell } from "../spreadsheet/protocol.ts";
import { groupKey, parseNumber, parseYesNo } from "./values.ts";

export type Outcome =
  | "set"
  | "overwrite"
  | "clear"
  | "unchanged"
  | "skipEmpty"
  | "skipUnmapped"
  | "skipInvalid";

export type Kind = "text" | "number" | "yesNo" | "choice";

export type DiffInput = {
  rows: { memberNo: string; cell: Cell }[];
  kind: Kind;
  choices: { id: string }[];
  rules: {
    emptyCells: "skip" | "clear";
    existing: "overwrite" | "fillEmpty";
    // groupKey → option id (or "1"/"0" for yes/no) or "skip"
    decisions: [string, string][];
  };
  // groupKey → option id for values equal to an option label
  auto: ReadonlyMap<string, string>;
  current: ReadonlyMap<string, string | string[] | null>;
};

export type RowOutcome = { memberNo: string; outcome: Outcome; value: string | null };
export type DiffResult = { outcomes: RowOutcome[]; counts: Record<Outcome, number> };

const outcomeNames: Outcome[] = ["set", "overwrite", "clear", "unchanged", "skipEmpty", "skipUnmapped", "skipInvalid"];

const lines = (s: string): string => s.replace(/\r\n?/g, "\n");

const isEmpty = (a: string | string[] | null | undefined): boolean =>
  a === null || a === undefined || a === "" || (Array.isArray(a) && a.length === 0);

const same = (kind: Kind, next: string, current: string | string[]): boolean => {
  if (Array.isArray(current)) return false;
  if (kind === "text") return lines(current).trim() === lines(next);
  if (kind === "number") return parseNumber({ text: current, value: null }) === Number(next);
  return current === next;
};

export const diffQuestion = ({ rows, kind, choices, rules, auto, current }: DiffInput): DiffResult => {
  const decisions = new Map(rules.decisions);
  const optionIds = new Set(choices.map((c) => c.id));
  const counts = Object.fromEntries(outcomeNames.map((o) => [o, 0])) as Record<Outcome, number>;

  const mapped = (cell: Cell): string | "invalid" | "unmapped" => {
    if (kind === "text") return cell.text.trim();
    if (kind === "number") {
      const n = parseNumber(cell);
      return n === null ? "invalid" : String(n);
    }
    const key = groupKey(cell.text);
    const decision = decisions.get(key);
    if (decision === "skip") return "unmapped";
    if (kind === "yesNo") {
      const target = decision ?? parseYesNo(cell.text) ?? auto.get(key);
      return target === "1" || target === "0" ? target : "unmapped";
    }
    const target = decision ?? auto.get(key);
    return target !== undefined && optionIds.has(target) ? target : "unmapped";
  };

  const outcomes = rows.map(({ memberNo, cell }): RowOutcome => {
    const done = (outcome: Outcome, value: string | null = null): RowOutcome => {
      counts[outcome]++;
      return { memberNo, outcome, value };
    };
    const now = current.get(memberNo) ?? null;
    let value: string;
    if (cell.text.trim() === "" && (cell.value === null || cell.value === "")) {
      if (rules.emptyCells === "skip" || kind === "choice") return done("skipEmpty");
      if (kind === "yesNo") value = "0";
      else if (isEmpty(now) || rules.existing === "fillEmpty") return done("unchanged");
      else return done("clear", "");
    } else {
      const m = mapped(cell);
      if (m === "invalid") return done("skipInvalid");
      if (m === "unmapped") return done("skipUnmapped");
      value = m;
    }
    if (isEmpty(now)) return done("set", value);
    if (same(kind, value, now!) || rules.existing === "fillEmpty") return done("unchanged", value);
    return done("overwrite", value);
  });
  return { outcomes, counts };
};
