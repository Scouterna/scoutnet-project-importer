import { describe, expect, it } from "vitest";
import { verify } from "./verify.ts";
import type { ReadbackKind } from "../writing/readback.ts";

const kinds = new Map<string, ReadbackKind>([
  ["t", "text"],
  ["n", "number"],
  ["c", "choice"],
  ["y", "yesNo"],
]);
const person = (memberNo: string, answers: Record<string, string | string[] | null>) => ({ memberNo, answers });

describe("verify", () => {
  it("confirms answers that read back as written", () => {
    const r = verify(
      [
        { memberNo: "1", questionId: "t", value: "hej" },
        { memberNo: "1", questionId: "c", value: "80922" },
        { memberNo: "2", questionId: "y", value: "1" },
      ],
      [person("1", { t: "hej", c: "80922" }), person("2", { y: "1" })],
      kinds,
    );
    expect(r).toEqual({ confirmed: 3, notConfirmed: [] });
  });
  it("lists an answer changed afterwards with both values", () => {
    const r = verify(
      [{ memberNo: "1", questionId: "t", value: "hej" }],
      [person("1", { t: "ändrad" })],
      kinds,
    );
    expect(r.confirmed).toBe(0);
    expect(r.notConfirmed).toEqual([{ memberNo: "1", questionId: "t", written: "hej", now: "ändrad" }]);
  });
  it("ignores line-break style in text", () => {
    const r = verify([{ memberNo: "1", questionId: "t", value: "a\nb" }], [person("1", { t: "a\r\nb" })], kinds);
    expect(r.confirmed).toBe(1);
  });
  it("compares numbers numerically", () => {
    const r = verify(
      [
        { memberNo: "1", questionId: "n", value: "2.5" },
        { memberNo: "2", questionId: "n", value: "2" },
        { memberNo: "3", questionId: "n", value: "2" },
      ],
      [person("1", { n: "2,5" }), person("2", { n: "2.0" }), person("3", { n: "3" })],
      kinds,
    );
    expect(r.confirmed).toBe(2);
    expect(r.notConfirmed.map((x) => x.memberNo)).toEqual(["3"]);
  });
  it("does not confirm a participant that is gone or has no answer", () => {
    const r = verify(
      [
        { memberNo: "1", questionId: "t", value: "x" },
        { memberNo: "2", questionId: "t", value: "x" },
      ],
      [person("2", {})],
      kinds,
    );
    expect(r.notConfirmed).toEqual([
      { memberNo: "1", questionId: "t", written: "x", now: null },
      { memberNo: "2", questionId: "t", written: "x", now: null },
    ]);
  });
  it("confirms a cleared answer that is now empty", () => {
    const r = verify([{ memberNo: "1", questionId: "t", value: "" }], [person("1", { t: null })], kinds);
    expect(r.confirmed).toBe(1);
  });
  it("reads an unknown question as text", () => {
    expect(verify([{ memberNo: "1", questionId: "zz", value: "a" }], [person("1", { zz: "a" })], kinds).confirmed).toBe(1);
  });
});
