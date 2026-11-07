import { describe, expect, it } from "vitest";
import { buildValueTable } from "./table.ts";

const rep = (s: string, n: number) => Array<string>(n).fill(s);
const options = [
  { id: "1", label: "Vegetarisk" },
  { id: "2", label: "Kött" },
];

describe("buildValueTable", () => {
  it("maps equal labels as certain and resembling values as suggestions", () => {
    const t = buildValueTable([...rep("Vego", 19), ...rep("Vegetarisk", 412), ...rep("veg", 37)], options);
    expect(t.map((e) => [e.value, e.rows, e.auto, e.suggestion])).toEqual([
      ["Vegetarisk", 412, "1", null],
      ["veg", 37, null, "1"],
      ["Vego", 19, null, "1"],
    ]);
  });
  it("groups spellings and lists variants", () => {
    const t = buildValueTable([...rep("Vego", 10), ...rep("vego.", 2), " Vego "], [{ id: "1", label: "Kött" }]);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ key: "vego", value: "Vego", variants: ["vego."], rows: 13, auto: null, suggestion: null });
  });
  it("gives no suggestion when several options resemble, or when auto is set", () => {
    const t = buildValueTable(["veg", "kött"], [
      { id: "1", label: "Vegetarisk" },
      { id: "2", label: "Vegansk" },
      { id: "3", label: "Kött" },
    ]);
    expect(t.find((e) => e.key === "veg")).toMatchObject({ auto: null, suggestion: null });
    expect(t.find((e) => e.key === "kött")).toMatchObject({ auto: "3", suggestion: null });
  });
  it("limits variants to five and ignores blank texts", () => {
    const t = buildValueTable(["", "  ", ...["A", "a", "a.", "A.", "a ?", "A!", "a,"]], []);
    expect(t).toHaveLength(1);
    expect(t[0]!.rows).toBe(7);
    expect(t[0]!.variants).toHaveLength(5);
  });
});
