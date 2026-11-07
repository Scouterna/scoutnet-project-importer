import { describe, expect, it } from "vitest";
import { readsBack } from "./readback.ts";

describe("readsBack", () => {
  it("compares text after normalising line breaks and trimming", () => {
    expect(readsBack("text", "a\nb", "a\r\nb")).toBe(true);
    expect(readsBack("text", "a\nb", "a\rb")).toBe(true);
    expect(readsBack("text", "a", "  a \n")).toBe(true);
    expect(readsBack("text", "a", "b")).toBe(false);
    expect(readsBack("text", "a", null)).toBe(false);
    expect(readsBack("text", "a", ["a"])).toBe(false);
  });
  it("treats a cleared text as null, empty or an empty array", () => {
    for (const now of [null, "", []]) expect(readsBack("text", "", now)).toBe(true);
    expect(readsBack("text", "", "x")).toBe(false);
    expect(readsBack("text", "", ["x"])).toBe(false);
  });
  it("compares numbers numerically", () => {
    expect(readsBack("number", "2.5", "2.5")).toBe(true);
    expect(readsBack("number", "2.5", "2,5")).toBe(true);
    expect(readsBack("number", "2", "2.0")).toBe(true);
    expect(readsBack("number", "2.5", "2.6")).toBe(false);
    expect(readsBack("number", "2", "abc")).toBe(false);
    expect(readsBack("number", "2", null)).toBe(false);
    expect(readsBack("number", "2", ["2"])).toBe(false);
  });
  it("treats a cleared number as null or empty", () => {
    for (const now of [null, "", []]) expect(readsBack("number", "", now)).toBe(true);
    expect(readsBack("number", "", "0")).toBe(false);
  });
  it("compares yes/no and choices as strings, and arrays never match", () => {
    expect(readsBack("yesNo", "1", "1")).toBe(true);
    expect(readsBack("yesNo", "1", "0")).toBe(false);
    expect(readsBack("choice", "80922", "80922")).toBe(true);
    expect(readsBack("choice", "80922", "80923")).toBe(false);
    expect(readsBack("choice", "80922", ["80922"])).toBe(false);
    expect(readsBack("choice", "80922", null)).toBe(false);
    expect(readsBack("yesNo", "0", null)).toBe(false);
  });
});
