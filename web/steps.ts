import type { WizardState } from "./wizard-store.ts";

export const steps = [
  { path: "/", label: "Load project" },
  { path: "/spreadsheet", label: "Load spreadsheet" },
  { path: "/match", label: "Match rows" },
  { path: "/map", label: "Map answers" },
  { path: "/review", label: "Review and write" },
  { path: "/report", label: "Report" },
] as const;

export type StepPath = (typeof steps)[number]["path"];

type StepState = Pick<WizardState, "loaded" | "spreadsheet" | "matching" | "mapping"> & {
  write?: WizardState["write"];
};

// Steps 1 to 5 can be completed so far; the report adds no condition of its own.
export const completedSteps = (state: StepState): number => {
  if (!state.loaded) return 0;
  if (!(state.spreadsheet && state.spreadsheet.rowCount > 0)) return 1;
  if (!(state.matching && state.matching.matched > 0)) return 2;
  // A run has ended (finished, cancelled or stopped) and at least one batch was sent.
  const written = state.write?.status === "done" && state.write.sent > 0;
  // After a write the preview shows no changes, which must not lock the report.
  if (!(state.mapping && (state.mapping.changes > 0 || written))) return 3;
  return written ? 5 : 4;
};

export const firstIncompleteStep = (state: StepState): StepPath =>
  steps[Math.min(completedSteps(state), steps.length - 1)].path;

// Returns the path to redirect to, or null when the step may be shown.
export const redirectFor = (
  path: StepPath,
  state: StepState,
): StepPath | null => {
  const index = steps.findIndex((step) => step.path === path);
  return index > completedSteps(state) ? firstIncompleteStep(state) : null;
};
