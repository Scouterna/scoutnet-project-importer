import { describe, expect, it } from "vitest";
import { completedSteps, firstIncompleteStep, redirectFor } from "./steps.ts";
import { createWizardStore } from "./wizard-store.ts";
import { clearOutcomes, getOutcomes, recordOutcomes } from "./writing/outcomes.ts";

const sheetState = (rowCount: number) => ({
  fileName: "a.xlsx",
  sheets: [{ name: "S", rows: rowCount, empty: rowCount === 0 }],
  sheet: "S",
  headerRow: 1,
  guessedHeaderRow: 1,
  topRows: [],
  columns: [],
  rowCount,
  preview: [],
});
const unloaded = { loaded: null, spreadsheet: null, matching: null, mapping: null };
const loaded = { loaded: { projectId: "1", env: "production" as const }, spreadsheet: null, matching: null, mapping: null };
const withSheet = { ...loaded, spreadsheet: sheetState(3) };
const matchingState = (matched: number) => ({
  fileName: "a.xlsx", sources: [], resolutions: [], winners: [], matched, dropped: [],
});
const mappingState = (changes: number) => ({ fileName: "a.xlsx", mappings: [], changes, dropped: [] });
const emptySheet = { ...loaded, spreadsheet: sheetState(0) };

clearOutcomes();

describe("route guard", () => {
  it("sends step 3 to step 1 when nothing is loaded", () => {
    expect(redirectFor("/match", unloaded)).toBe("/");
    expect(firstIncompleteStep(unloaded)).toBe("/");
  });
  it("sends step 3 to step 2 when a project is loaded", () => {
    expect(redirectFor("/match", loaded)).toBe("/spreadsheet");
    expect(redirectFor("/report", loaded)).toBe("/spreadsheet");
  });
  it("allows steps up to the first incomplete one", () => {
    expect(redirectFor("/", unloaded)).toBeNull();
    expect(redirectFor("/", loaded)).toBeNull();
    expect(redirectFor("/spreadsheet", loaded)).toBeNull();
    expect(redirectFor("/spreadsheet", unloaded)).toBe("/");
  });
  it("sends step 4 to step 3 when a spreadsheet with data rows is loaded", () => {
    expect(redirectFor("/match", withSheet)).toBeNull();
    expect(redirectFor("/map", withSheet)).toBe("/match");
  });
  it("sends step 4 to step 3 until a row is matched, then allows it", () => {
    expect(redirectFor("/map", { ...withSheet, matching: matchingState(0) })).toBe("/match");
    expect(redirectFor("/map", { ...withSheet, matching: matchingState(2) })).toBeNull();
    expect(redirectFor("/review", { ...withSheet, matching: matchingState(2) })).toBe("/map");
  });
  it("sends step 5 to step 4 until an answer would change, then allows it", () => {
    const matched = { ...withSheet, matching: matchingState(2) };
    expect(redirectFor("/review", { ...matched, mapping: mappingState(0) })).toBe("/map");
    expect(redirectFor("/review", { ...matched, mapping: mappingState(3) })).toBeNull();
    expect(redirectFor("/report", { ...matched, mapping: mappingState(3) })).toBe("/review");
  });
  it("needs step 3 even when the mapping has changes", () => {
    expect(redirectFor("/review", { ...withSheet, matching: matchingState(0), mapping: mappingState(3) })).toBe("/match");
  });
  it("drops mapping when the file changes but not when only the sheet does", () => {
    const store = createWizardStore({ getStorage: () => undefined });
    store.setSpreadsheet(sheetState(3));
    store.setMapping(mappingState(2));
    store.setSpreadsheet({ ...sheetState(5), sheet: "T", headerRow: 2 });
    expect(store.getState().mapping?.changes).toBe(2);
    store.setSpreadsheet({ ...sheetState(3), fileName: "b.xlsx" });
    expect(store.getState().mapping).toBeNull();
    store.setMapping({ ...mappingState(1), fileName: "b.xlsx" });
    store.setSpreadsheet(null);
    expect(store.getState().mapping).toBeNull();
  });
  it("keeps step 2 incomplete when the sheet has no data rows", () => {
    expect(redirectFor("/match", emptySheet)).toBe("/spreadsheet");
  });
  it("needs the project even when a spreadsheet is loaded", () => {
    expect(redirectFor("/match", { ...withSheet, loaded: null })).toBe("/");
  });
  it("keeps store state when going back to step 1", () => {
    const store = createWizardStore({ getStorage: () => undefined });
    store.setProjectInput("1234567");
    store.setKey("questions", "k");
    store.setLoaded({ projectId: "1234567", env: "production" });
    expect(redirectFor("/", store.getState())).toBeNull();
    expect(store.getState().loaded).toEqual({ projectId: "1234567", env: "production" });
    expect(store.getState().keys.questions).toBe("k");
  });
  it("keeps the spreadsheet when the project changes", () => {
    const store = createWizardStore({ getStorage: () => undefined });
    store.setSpreadsheet(sheetState(3));
    store.setProjectInput("999");
    expect(store.getState().spreadsheet?.rowCount).toBe(3);
  });
  it("drops matching when the file changes but not when only the sheet does", () => {
    const store = createWizardStore({ getStorage: () => undefined });
    store.setSpreadsheet(sheetState(3));
    store.setMatching(matchingState(2));
    store.setSpreadsheet({ ...sheetState(5), sheet: "T", headerRow: 2 });
    expect(store.getState().matching?.matched).toBe(2);
    store.setSpreadsheet({ ...sheetState(3), fileName: "b.xlsx" });
    expect(store.getState().matching).toBeNull();
    store.setMatching({ ...matchingState(1), fileName: "b.xlsx" });
    store.setSpreadsheet(null);
    expect(store.getState().matching).toBeNull();
  });
  it("completes step 5 only when a run is done and a batch was sent", () => {
    const ready = { ...withSheet, matching: matchingState(2), mapping: mappingState(3) };
    const write = (status: "idle" | "running" | "done", sent: number) => ({ fileName: "a.xlsx", status, sent });
    expect(completedSteps(ready)).toBe(4);
    expect(completedSteps({ ...ready, write: write("running", 2) })).toBe(4);
    expect(completedSteps({ ...ready, write: write("done", 0) })).toBe(4);
    expect(redirectFor("/report", { ...ready, write: write("done", 0) })).toBe("/review");
    expect(completedSteps({ ...ready, write: write("done", 1) })).toBe(5);
    expect(redirectFor("/report", { ...ready, write: write("done", 1) })).toBeNull();
    // after a write the preview shows no changes; the report must stay reachable
    expect(completedSteps({ ...ready, mapping: mappingState(0), write: write("done", 1) })).toBe(5);
  });
  it("drops the write state and outcomes when the file, matching or mapping really change", () => {
    const store = createWizardStore({ getStorage: () => undefined });
    const done = { fileName: "a.xlsx", status: "done" as const, sent: 2 };
    const arm = () => {
      store.setWrite(done);
      recordOutcomes(new Map([["1", new Map([["7", { status: "updated" as const }]])]]));
    };
    store.setSpreadsheet(sheetState(3));
    store.setMatching(matchingState(2));
    store.setMapping(mappingState(3));
    arm();
    // identical content, derived counts and notices: no reset
    store.setSpreadsheet(sheetState(3));
    store.setMatching({ ...matchingState(2), matched: 9, dropped: ["x"] });
    store.setMapping({ ...mappingState(3), changes: 0, dropped: ["y"] });
    expect(store.getState().write).toEqual(done);
    expect(getOutcomes().size).toBe(1);
    // a real change of the mapping, the matching, the sheet or the file
    store.setMapping({ ...mappingState(3), mappings: [{ column: "A", questionId: "7", emptyCells: "skip", existing: "overwrite", decisions: [] }] });
    expect(store.getState().write).toBeNull();
    expect(getOutcomes().size).toBe(0);
    arm();
    store.setMatching({ ...matchingState(2), resolutions: [[2, "1"]] });
    expect(store.getState().write).toBeNull();
    arm();
    store.setSpreadsheet({ ...sheetState(3), headerRow: 2 });
    expect(store.getState().write).toBeNull();
    arm();
    store.setSpreadsheet({ ...sheetState(3), fileName: "b.xlsx" });
    expect(store.getState().write).toBeNull();
    expect(getOutcomes().size).toBe(0);
  });
});
