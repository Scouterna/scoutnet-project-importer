import { describe, expect, it } from "vitest";
import { createWizardStore, storageKey } from "./wizard-store.ts";

const fakeStorage = () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  } as unknown as Storage;
  return { data, storage };
};

const make = (s = fakeStorage()) => ({
  ...s,
  store: createWizardStore({ getStorage: () => s.storage }),
});

describe("wizard store", () => {
  it("starts with empty keys when storage has no entry", () => {
    const { store } = make();
    expect(store.getState().keys).toEqual({ questions: "", participants: "", checkin: "" });
  });

  it("restores keys from the storage entry", () => {
    const s = fakeStorage();
    make(s).store.setKey("participants", "abc");
    expect(make(s).store.getState().keys.participants).toBe("abc");
  });

  it("ignores a stale env in an old storage entry", () => {
    const s = fakeStorage();
    s.data.set(
      storageKey,
      JSON.stringify({ keys: { participants: "abc" }, env: "test", projectInput: "1234567" }),
    );
    const state = make(s).store.getState();
    expect(state.keys.participants).toBe("abc");
    expect(state.projectInput).toBe("1234567");
    expect("env" in state).toBe(false);
  });

  it("writes only keys and project input to storage", () => {
    const { store, data } = make();
    store.setProjectInput("1234567");
    store.setKey("questions", "k1");
    store.setIncludeCancelled(true);
    store.setLoaded({ projectId: "1234567", env: "production" });
    store.setSpreadsheet({
      fileName: "secret.xlsx",
      sheets: [],
      sheet: "S",
      headerRow: 1,
      guessedHeaderRow: 1,
      topRows: [],
      columns: [],
      rowCount: 1,
      preview: [{ sheetRow: 2, cells: [{ text: "Åsa", value: "Åsa" }] }],
    });
    expect([...data.keys()]).toEqual([storageKey]);
    expect(Object.keys(JSON.parse(data.get(storageKey)!)).sort()).toEqual([
      "keys",
      "projectInput",
    ]);
    // mapping holds group keys of cells, so it joins matching in staying out of storage
    store.setMapping({ fileName: "secret.xlsx", mappings: [], changes: 1, dropped: [] });
    expect(Object.keys(JSON.parse(data.get(storageKey)!)).sort()).toEqual(["keys", "projectInput"]);
    // the write state and the outcomes are in memory only too
    store.setWrite({ fileName: "secret.xlsx", status: "done", sent: 3 });
    expect(store.getState().write).toEqual({ fileName: "secret.xlsx", status: "done", sent: 3 });
    expect(Object.keys(JSON.parse(data.get(storageKey)!)).sort()).toEqual(["keys", "projectInput"]);
    expect(data.get(storageKey)).not.toContain("secret");
    expect(createWizardStore({ getStorage: () => ({ getItem: (k: string) => data.get(k) ?? null, setItem: () => {}, removeItem: () => {} }) as unknown as Storage }).getState().write).toBeNull();
  });

  it("keeps the spreadsheet out of storage and starts without one", () => {
    const { store, data } = make();
    expect(store.getState().spreadsheet).toBeNull();
    store.setSpreadsheet({
      fileName: "secret.xlsx", sheets: [], sheet: "S", headerRow: 1, guessedHeaderRow: 1,
      topRows: [], columns: [], rowCount: 1, preview: [],
    });
    store.setProjectInput("1");
    expect(data.get(storageKey)).not.toContain("secret");
    store.setSpreadsheet(null);
    expect(store.getState().spreadsheet).toBeNull();
  });

  it("never persists matching", () => {
    const { store, data } = make();
    store.setMatching({
      fileName: "f.xlsx", sources: [{ kind: "memberNo", column: "Secret" }], resolutions: [[2, "3001"]],
      winners: [], matched: 1, dropped: [],
    });
    store.setProjectInput("1");
    expect(data.get(storageKey)).not.toContain("Secret");
    expect(Object.keys(JSON.parse(data.get(storageKey)!)).sort()).toEqual(["keys", "projectInput"]);
  });

  it("never persists mapping", () => {
    const { store, data } = make();
    store.setMapping({
      fileName: "f.xlsx",
      mappings: [{ column: "SecretColumn", questionId: "7", emptyCells: "skip", existing: "overwrite", decisions: [["secretvalue", "1"]] }],
      changes: 2,
      dropped: [],
    });
    store.setProjectInput("1");
    expect(data.get(storageKey)).not.toContain("Secret");
    expect(data.get(storageKey)).not.toContain("secretvalue");
    expect(Object.keys(JSON.parse(data.get(storageKey)!)).sort()).toEqual(["keys", "projectInput"]);
  });

  it("restores the project input", () => {
    const s = fakeStorage();
    const first = make(s).store;
    first.setProjectInput("1234567");
    const again = make(s).store.getState();
    expect(again.projectInput).toBe("1234567");
  });

  it("forgetKeys clears memory and removes the entry", () => {
    const { store, data } = make();
    store.setKey("questions", "k1");
    store.forgetKeys();
    expect(data.has(storageKey)).toBe(false);
    expect(store.getState().keys.questions).toBe("");
  });

  it("clears loaded when the project or env changes", () => {
    const { store } = make();
    store.setProjectInput("1234567");
    store.setLoaded({ projectId: "1234567", env: "production" });
    store.setProjectInput("scoutnet.se/activities/view/1234567");
    expect(store.getState().loaded).not.toBeNull();
    store.setProjectInput("s1.test.custard.no/activities/view/1234567");
    expect(store.getState().loaded).toBeNull();
  });

  it("clears loaded when the project changes or becomes invalid", () => {
    const { store } = make();
    store.setProjectInput("1234567");
    store.setLoaded({ projectId: "1234567", env: "production" });
    store.setProjectInput("example.com/activities/view/1234567");
    expect(store.getState().loaded).toBeNull();
  });

  it("keeps working when storage throws", () => {
    const store = createWizardStore({
      getStorage: () => {
        throw new Error("blocked");
      },
    });
    store.setKey("questions", "k");
    expect(store.getState().keys.questions).toBe("k");
    store.forgetKeys();
    expect(store.getState().keys.questions).toBe("");
  });
});
