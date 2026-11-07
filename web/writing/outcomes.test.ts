import { afterEach, describe, expect, it } from "vitest";
import { clearOutcomes, getLastRun, getOutcomes, recordOutcomes, setLastRun } from "./outcomes.ts";

afterEach(clearOutcomes);

describe("lastRun", () => {
  it("is null until set and cleared together with the outcomes", () => {
    expect(getLastRun()).toBeNull();
    recordOutcomes(new Map([["1", new Map([["7", { status: "updated" as const }]])]]));
    setLastRun({ stopped: "cancelled", failedBatches: 1, participants: 3 });
    expect(getLastRun()).toEqual({ stopped: "cancelled", failedBatches: 1, participants: 3 });
    expect(getOutcomes().size).toBe(1);
    clearOutcomes();
    expect(getLastRun()).toBeNull();
    expect(getOutcomes().size).toBe(0);
  });
  it("is replaced by the next run", () => {
    setLastRun({ stopped: null, failedBatches: 0, participants: 1 });
    setLastRun({ stopped: "key rejected", failedBatches: 2, participants: 5 });
    expect(getLastRun()).toEqual({ stopped: "key rejected", failedBatches: 2, participants: 5 });
  });
});
