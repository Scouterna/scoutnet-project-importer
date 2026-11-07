import { describe, expect, it } from "vitest";
import { displayCurrent, displayNext } from "./display.ts";

const choices = [{ id: "a", label: "Vegetarian" }, { id: "b", label: "Vegan" }];

describe("display", () => {
  it("shows choice labels, falling back to the id", () => {
    expect(displayCurrent("choice", choices, "a")).toBe("Vegetarian");
    expect(displayCurrent("choice", choices, "zz")).toBe("zz");
    expect(displayNext("choice", choices, "b")).toBe("Vegan");
  });
  it("joins arrays", () => {
    expect(displayCurrent("choice", choices, ["a", "b"])).toBe("Vegetarian, Vegan");
    expect(displayCurrent("text", [], ["x", "y"])).toBe("x, y");
  });
  it("shows yes/no as Ja/Nej", () => {
    expect(displayCurrent("yesNo", [], "1")).toBe("Ja");
    expect(displayNext("yesNo", [], "0")).toBe("Nej");
  });
  it("shows empty and cleared", () => {
    expect(displayCurrent("text", [], null)).toBe("—");
    expect(displayCurrent("text", [], [])).toBe("—");
    expect(displayNext("number", [], "")).toBe("(cleared)");
    expect(displayNext("text", [], null)).toBe("—");
  });
});
