import { describe, expect, it } from "vitest";
import type { Cell } from "../spreadsheet/protocol.ts";
import { diffQuestion, type DiffInput, type Outcome } from "./diff.ts";

const c = (text: string, value: Cell["value"] = text === "" ? null : text): Cell => ({ text, value });
const rules = { emptyCells: "skip", existing: "overwrite", decisions: [] } as DiffInput["rules"];

const run = (
  kind: DiffInput["kind"],
  cells: Cell[],
  current: (string | string[] | null)[] = [],
  over: Partial<DiffInput> = {},
) => {
  const rows = cells.map((cell, i) => ({ memberNo: String(i), cell }));
  const cur = new Map(current.map((v, i) => [String(i), v]));
  const input: DiffInput = { rows, kind, choices: [], rules, auto: new Map(), current: cur, ...over };
  const r = diffQuestion(input);
  expect(Object.values(r.counts).reduce((a, b) => a + b, 0)).toBe(cells.length);
  return r.outcomes.map((o) => [o.outcome, o.value]);
};

describe("diffQuestion text", () => {
  it("sets, overwrites and leaves unchanged", () => {
    expect(run("text", [c(" Inception "), c("Heat"), c("Alien")], [null, "Se7en", "Alien"])).toEqual([
      ["set", "Inception"],
      ["overwrite", "Heat"],
      ["unchanged", "Alien"],
    ]);
  });
  it("treats empty-string current as empty", () => {
    expect(run("text", [c("a")], [""])).toEqual([["set", "a"]]);
  });
  it("ignores the kind of line break", () => {
    expect(run("text", [c("a\nb")], ["a\r\nb"])).toEqual([["unchanged", "a\nb"]]);
  });
  it("skips or clears empty cells", () => {
    expect(run("text", [c(""), c("  ", null)], ["x", "x"])).toEqual([["skipEmpty", null], ["skipEmpty", null]]);
    const clear = { ...rules, emptyCells: "clear" } as DiffInput["rules"];
    expect(run("text", [c(""), c(""), c("")], ["Inception", null, ""], { rules: clear })).toEqual([
      ["clear", ""],
      ["unchanged", null],
      ["unchanged", null],
    ]);
  });
  it("keeps existing answers under fillEmpty", () => {
    const fill = { ...rules, existing: "fillEmpty" } as DiffInput["rules"];
    expect(run("text", [c("Vego"), c("Vego"), c("")], ["Kött", null, "Kött"], { rules: { ...fill, emptyCells: "clear" } })).toEqual([
      ["unchanged", "Vego"],
      ["set", "Vego"],
      ["unchanged", null],
    ]);
  });
});

describe("diffQuestion number", () => {
  it("encodes with a point and compares numerically", () => {
    expect(run("number", [c("2,5"), c("1 234,5"), c("3", 3), c("4"), c("5")], [null, "1234.50", "3.0", "4", "x"])).toEqual([
      ["set", "2.5"],
      ["unchanged", "1234.5"],
      ["unchanged", "3"],
      ["unchanged", "4"],
      ["overwrite", "5"],
    ]);
  });
  it("skips invalid values", () => {
    expect(run("number", [c("några"), c("1,2,3")], ["1", null])).toEqual([["skipInvalid", null], ["skipInvalid", null]]);
  });
  it("clears with an empty string", () => {
    const clear = { ...rules, emptyCells: "clear" } as DiffInput["rules"];
    expect(run("number", [c("")], ["3"], { rules: clear })).toEqual([["clear", ""]]);
  });
});

describe("diffQuestion yesNo", () => {
  it("parses variants without confirmation", () => {
    expect(run("yesNo", [c("JA"), c("nej"), c("x")], [null, "1", "1"])).toEqual([
      ["set", "1"],
      ["overwrite", "0"],
      ["unchanged", "1"],
    ]);
  });
  it("leaves unrecognised values unmapped until decided; auto and decisions apply", () => {
    expect(run("yesNo", [c("kanske")], [null])).toEqual([["skipUnmapped", null]]);
    const decided = { ...rules, decisions: [["kanske", "0"], ["vet ej", "skip"]] } as DiffInput["rules"];
    expect(run("yesNo", [c("Kanske"), c("vet ej")], [null, null], { rules: decided })).toEqual([
      ["set", "0"],
      ["skipUnmapped", null],
    ]);
    expect(run("yesNo", [c("jepp")], [null], { auto: new Map([["jepp", "1"]]) })).toEqual([["set", "1"]]);
  });
  it("sets No for empty cells under the clear rule", () => {
    const clear = { ...rules, emptyCells: "clear" } as DiffInput["rules"];
    expect(run("yesNo", [c(""), c(""), c("")], [null, "1", "0"], { rules: clear })).toEqual([
      ["set", "0"],
      ["overwrite", "0"],
      ["unchanged", "0"],
    ]);
  });
});

describe("diffQuestion choice", () => {
  const choices = [{ id: "1" }, { id: "2" }];
  const auto = new Map([["vegetarisk", "1"]]);
  it("writes only decisions and auto, never suggestions", () => {
    const decided = { ...rules, decisions: [["veg", "1"], ["kött", "2"], ["annat", "skip"]] } as DiffInput["rules"];
    expect(
      run("choice", [c("Vegetarisk"), c("veg"), c("Vego"), c("Kött."), c("annat")], [], { choices, auto, rules: decided }),
    ).toEqual([
      ["set", "1"],
      ["set", "1"],
      ["skipUnmapped", null],
      ["set", "2"],
      ["skipUnmapped", null],
    ]);
  });
  it("overwrites, and fillEmpty keeps existing", () => {
    expect(run("choice", [c("vegetarisk"), c("vegetarisk")], ["2", "1"], { choices, auto })).toEqual([
      ["overwrite", "1"],
      ["unchanged", "1"],
    ]);
    const fill = { ...rules, existing: "fillEmpty" } as DiffInput["rules"];
    expect(run("choice", [c("vegetarisk")], ["2"], { choices, auto, rules: fill })).toEqual([["unchanged", "1"]]);
  });
  it("ignores a decision for an option that no longer exists", () => {
    const decided = { ...rules, decisions: [["x", "99"]] } as DiffInput["rules"];
    expect(run("choice", [c("x")], [null], { choices, rules: decided })).toEqual([["skipUnmapped", null]]);
  });
  it("only skips empty cells, even under clear", () => {
    const clear = { ...rules, emptyCells: "clear" } as DiffInput["rules"];
    expect(run("choice", [c("")], ["1"], { choices, rules: clear })).toEqual([["skipEmpty", null]]);
  });
});

describe("diffQuestion counts and speed", () => {
  it("counts every outcome", () => {
    const r = diffQuestion({
      rows: [c("a"), c(""), c("b")].map((cell, i) => ({ memberNo: String(i), cell })),
      kind: "text",
      choices: [],
      rules,
      auto: new Map(),
      current: new Map([["2", "b"]]),
    });
    const expected: Partial<Record<Outcome, number>> = { set: 1, skipEmpty: 1, unchanged: 1 };
    expect(r.counts).toMatchObject(expected);
  });
  it("handles 20,000 rows x 10 questions in under a second", () => {
    const choices = [{ id: "1" }, { id: "2" }, { id: "3" }];
    const words = ["Vegetarisk", "Kött", "veg", "Vego.", "kanske", "", "Ja", "2,5", "text", "nej"];
    const rows = Array.from({ length: 20000 }, (_, i) => ({ memberNo: String(i), cell: c(words[i % words.length]!) }));
    const current = new Map<string, string | string[] | null>(rows.map((r, i) => [r.memberNo, i % 3 ? "1" : null]));
    const auto = new Map([["vegetarisk", "1"], ["kött", "2"]]);
    const kinds = ["text", "number", "yesNo", "choice"] as const;
    const start = performance.now();
    for (let q = 0; q < 10; q++) {
      diffQuestion({ rows, kind: kinds[q % 4]!, choices, rules: { ...rules, decisions: [["veg", "1"]] }, auto, current });
    }
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
