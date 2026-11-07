import { describe, expect, it } from "vitest";
import type { AnswerInput } from "./reasons.ts";
import { rowReason } from "./reasons.ts";

const labels = new Map([
  ["1", "Mat"],
  ["2", "Gafflar"],
  ["3", "Vilka efterrätter…"],
]);
const a = (questionId: string, diff: AnswerInput["diff"], write: AnswerInput["write"] = null): AnswerInput => ({
  questionId,
  diff,
  write,
});
const reason = (match: Parameters<typeof rowReason>[0]["match"], answers: AnswerInput[] = []) =>
  rowReason({ match, answers, questionLabels: labels });

describe("rowReason", () => {
  it("names row-level problems", () => {
    expect(reason("unmatched")).toBe("No match");
    expect(reason("ambiguous")).toBe("Ambiguous");
    expect(reason("excluded")).toBe("Excluded (cancelled or unconfirmed)");
    expect(reason("conflict")).toBe("Conflict");
  });
  it("ignores answers of a row that was not matched", () => {
    expect(reason("unmatched", [a("1", "skipInvalid")])).toBe("No match");
  });
  it("is null for a fully imported row", () => {
    expect(reason("matched")).toBeNull();
    expect(
      reason("matched", [a("1", "set", { status: "updated" }), a("2", "unchanged"), a("3", "overwrite", { status: "unchanged" })]),
    ).toBeNull();
  });
  it("is null when the only problems are empty cells", () => {
    expect(reason("matched", [a("1", "skipEmpty"), a("2", "skipEmpty")])).toBeNull();
  });
  it("names an unmapped and an invalid value", () => {
    expect(reason("matched", [a("1", "skipUnmapped")])).toBe("Mat: unmapped value");
    expect(reason("matched", [a("2", "skipInvalid")])).toBe("Gafflar: invalid value");
  });
  it("names a partly imported row by the failing answer only", () => {
    expect(reason("matched", [a("1", "set", { status: "updated" }), a("2", "skipInvalid")])).toBe("Gafflar: invalid value");
  });
  it("includes Scoutnet's message for a failed write", () => {
    expect(
      reason("matched", [a("3", "set", { status: "failed", message: "Question type (28) not yet supported!" })]),
    ).toBe("Vilka efterrätter…: write failed (Question type (28) not yet supported!)");
  });
  it("names the cause of a not attempted answer", () => {
    expect(reason("matched", [a("1", "set", { status: "notAttempted", reason: "cancelled" })])).toBe(
      "Mat: not attempted (cancelled)",
    );
    expect(reason("matched", [a("1", "set", { status: "notAttempted", reason: "key rejected" })])).toBe(
      "Mat: not attempted (key rejected)",
    );
  });
  it("counts a write with no outcome as not written", () => {
    for (const diff of ["set", "overwrite", "clear"] as const) {
      expect(reason("matched", [a("1", diff)])).toBe("Mat: not attempted (not written)");
    }
  });
  it("reads notFound and noMember as not a participant", () => {
    expect(reason("matched", [a("1", "set", { status: "notFound" })])).toBe("Mat: not a participant");
    expect(reason("matched", [a("1", "set", { status: "noMember" })])).toBe("Mat: not a participant");
  });
  it("joins several problems with semicolons, in the given order", () => {
    expect(
      reason("matched", [a("2", "skipInvalid"), a("1", "skipUnmapped"), a("3", "set", { status: "failed", message: "no" })]),
    ).toBe("Gafflar: invalid value; Mat: unmapped value; Vilka efterrätter…: write failed (no)");
  });
  it("falls back to the question id without a label", () => {
    expect(reason("matched", [a("9", "skipInvalid")])).toBe("9: invalid value");
  });
});
