import { describe, expect, it } from "vitest";
import { classify } from "./questions.ts";

const q = (type: string | null) => ({ id: "7", type });
const p = (answer: string | string[] | null) => ({ answers: { "7": answer } });

describe("classify", () => {
  it("maps text, number and boolean", () => {
    expect(classify(q("text"), [])).toEqual({ kind: "text" });
    expect(classify(q("number"), [])).toEqual({ kind: "number" });
    expect(classify(q("boolean"), [])).toEqual({ kind: "yesNo" });
  });
  it("treats choice as single choice and flags it when nobody has answered", () => {
    expect(classify(q("choice"), [p("80922"), p(null)])).toEqual({ kind: "choice", unanswered: false });
    expect(classify(q("choice"), [p(null), { answers: {} }, p("")])).toEqual({ kind: "choice", unanswered: true });
    expect(classify(q("choice"), [])).toEqual({ kind: "choice", unanswered: true });
  });
  it("treats choice with a list answer as unsupported multiple choice", () => {
    const c = classify(q("choice"), [p("80922"), p(["80925", "80926"])]);
    expect(c).toMatchObject({ kind: "unsupported" });
    expect(c.kind === "unsupported" && c.reason).toMatch(/multiple choice/i);
  });
  it("treats date/time and unknown types as unsupported", () => {
    expect(classify(q("other_unsupported_by_api"), [])).toMatchObject({ kind: "unsupported", reason: expect.stringMatching(/date/i) });
    expect(classify(q("mystery"), [])).toMatchObject({ kind: "unsupported" });
    expect(classify(q(null), [])).toMatchObject({ kind: "unsupported" });
  });
});
