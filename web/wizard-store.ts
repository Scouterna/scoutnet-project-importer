import { useSyncExternalStore } from "react";
import type { ScoutnetEnv } from "../shared/env.ts";
import { parseProject } from "../shared/project-id.ts";
import { spreadsheet as spreadsheetClient } from "./spreadsheet/client.ts";
import type { Source } from "./matching/matcher.ts";
import type { ColumnMapping } from "./mapping/types.ts";
import type { Column, Row, SheetInfo } from "./spreadsheet/protocol.ts";
import { clearOutcomes } from "./writing/outcomes.ts";

export type Keys = { questions: string; participants: string; checkin: string };

// What the spreadsheet page needs to re-render after going back to step 1.
// Held in memory only: it contains cell contents, so it is never written to storage.
export type SpreadsheetState = {
  fileName: string;
  sheets: SheetInfo[];
  sheet: string;
  headerRow: number;
  guessedHeaderRow: number;
  topRows: Row[];
  columns: Column[];
  rowCount: number;
  preview: Row[];
};

// Step 3's configuration. In memory only (it holds names of columns and member numbers); dropped when the file changes.
export type MatchingState = {
  fileName: string;
  sources: Source[];
  // [sheetRow, memberNo]
  resolutions: [number, string][];
  // [memberNo, sheetRow | "skip"]
  winners: [string, number | "skip"][];
  // totals.matched of the last match
  matched: number;
  // Sources dropped because their columns vanished, to report once
  dropped: string[];
};

// Step 4's configuration. In memory only (group keys are cell data); dropped when the file changes.
export type MappingState = {
  fileName: string;
  mappings: ColumnMapping[];
  // set + overwrite + clear in the last preview
  changes: number;
  // Mappings dropped because their column or question vanished, to report once
  dropped: string[];
};

// Step 5's run. In memory only; reset when the file, the matching or the mapping changes. The outcome of every
// answer lives in writing/outcomes.ts and is cleared at the same moments.
export type WriteState = {
  fileName: string;
  status: "idle" | "running" | "done";
  // batches Scoutnet accepted
  sent: number;
};

export type WizardState = {
  projectInput: string;
  keys: Keys;
  includeCancelled: boolean;
  includeUnconfirmed: boolean;
  // Which project/env was last loaded. The data itself lives in the query cache.
  loaded: { projectId: string; env: ScoutnetEnv } | null;
  spreadsheet: SpreadsheetState | null;
  matching: MatchingState | null;
  mapping: MappingState | null;
  write: WriteState | null;
};

export const storageKey = "scoutnet-importer.session";

const emptyKeys: Keys = { questions: "", participants: "", checkin: "" };

type StoreOptions = {
  getStorage?: () => Storage | undefined;
};

const browserStorage = (): Storage | undefined => {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
};

export const createWizardStore = (options: StoreOptions = {}) => {
  const getStorage = options.getStorage ?? browserStorage;

  type Saved = Pick<WizardState, "keys" | "projectInput">;

  const read = (): Saved | null => {
    try {
      const raw = getStorage()?.getItem(storageKey);
      if (!raw) return null;
      const data: unknown = JSON.parse(raw);
      if (typeof data !== "object" || data === null) return null;
      const { keys, projectInput } = data as Record<string, unknown>;
      const k = (keys ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === "string" ? v : "");
      return {
        keys: {
          questions: str(k.questions),
          participants: str(k.participants),
          checkin: str(k.checkin),
        },
        projectInput: str(projectInput),
      };
    } catch {
      return null;
    }
  };

  const write = (state: WizardState) => {
    try {
      getStorage()?.setItem(
        storageKey,
        JSON.stringify({
          keys: state.keys,
          projectInput: state.projectInput,
        }),
      );
    } catch {
      // Storage unavailable: keys stay in memory only.
    }
  };

  const saved = read();
  let state: WizardState = {
    projectInput: saved?.projectInput ?? "",
    keys: saved?.keys ?? emptyKeys,
    includeCancelled: false,
    includeUnconfirmed: false,
    loaded: null,
    spreadsheet: null,
    matching: null,
    mapping: null,
    write: null,
  };
  const listeners = new Set<() => void>();

  const update = (patch: Partial<WizardState>, persist = false) => {
    const next = { ...state, ...patch };
    if (next.loaded) {
      const parsed = parseProject(next.projectInput);
      if (
        !parsed.ok ||
        parsed.id !== next.loaded.projectId ||
        parsed.env !== next.loaded.env
      ) {
        next.loaded = null;
      }
    }
    state = next;
    if (persist) write(state);
    listeners.forEach((listener) => listener());
  };

  // The write outcomes refer to the file, matching and mapping they were made with. Called only when one of
  // those really changed.
  const dropWrite = (): Pick<WizardState, "write"> => {
    clearOutcomes();
    return { write: null };
  };

  // What of the spreadsheet decides the rows: pages may set identical content again on entry, which is no change.
  const sheetKey = (s: SpreadsheetState | null) => (s ? JSON.stringify([s.fileName, s.sheet, s.headerRow]) : null);
  // Only the user's choices, not the derived counts or the one-off notices, so re-previewing never resets a run.
  const matchingKey = (m: MatchingState | null) =>
    m ? JSON.stringify([m.fileName, m.sources, m.resolutions, m.winners]) : null;
  const mappingKey = (m: MappingState | null) => (m ? JSON.stringify([m.fileName, m.mappings]) : null);

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setProjectInput: (projectInput: string) => update({ projectInput }, true),
    setKey: (name: keyof Keys, value: string) =>
      update({ keys: { ...state.keys, [name]: value } }, true),
    setIncludeCancelled: (includeCancelled: boolean) => update({ includeCancelled }),
    setIncludeUnconfirmed: (includeUnconfirmed: boolean) => update({ includeUnconfirmed }),
    setLoaded: (loaded: WizardState["loaded"]) => update({ loaded }),
    setSpreadsheet: (spreadsheet: SpreadsheetState | null) =>
      update({
        spreadsheet,
        matching:
          spreadsheet && state.matching?.fileName === spreadsheet.fileName ? state.matching : null,
        mapping:
          spreadsheet && state.mapping?.fileName === spreadsheet.fileName ? state.mapping : null,
        ...(sheetKey(spreadsheet) !== sheetKey(state.spreadsheet) ? dropWrite() : {}),
      }),
    setMatching: (matching: MatchingState | null) =>
      update({ matching, ...(matchingKey(matching) !== matchingKey(state.matching) ? dropWrite() : {}) }),
    setMapping: (mapping: MappingState | null) =>
      update({ mapping, ...(mappingKey(mapping) !== mappingKey(state.mapping) ? dropWrite() : {}) }),
    setWrite: (write: WriteState | null) => update({ write }),
    forgetKeys: () => {
      try {
        getStorage()?.removeItem(storageKey);
      } catch {
        // Nothing to remove if storage is unavailable.
      }
      update({ keys: emptyKeys });
    },
  };
};

export const wizardStore = createWizardStore();

export const getState = wizardStore.getState;

export const useWizardState = (): WizardState =>
  useSyncExternalStore(wizardStore.subscribe, wizardStore.getState);

// The worker lost its workbook (crash), so the page's copy no longer matches it.
spreadsheetClient.onReset(() => wizardStore.setSpreadsheet(null));
