import type { TrimmedParticipant } from "../../shared/api-types.ts";
import type { QuestionInfo } from "../mapping/catalog.ts";
import type { ColumnMapping } from "../mapping/types.ts";
import { wizardStore } from "../wizard-store.ts";
import { spreadsheet } from "./client.ts";
import type { MappedReply, MappingInput } from "./protocol.ts";
import { participantsSent, sendParticipants } from "./sync.ts";

/**
 * Makes sure the worker holds these participants and a match made from step 3's settings in the store.
 * Returns false when there is no matching to run. Rejects with a SpreadsheetError ("superseded" when replaced).
 */
export const ensureMatched = async (version: string, participants: TrimmedParticipant[]): Promise<boolean> => {
  if (!participantsSent(version)) await sendParticipants(version, participants);
  const { matching, includeCancelled, includeUnconfirmed } = wizardStore.getState();
  if (!matching) return false;
  await spreadsheet.match({
    sources: matching.sources,
    includeCancelled,
    includeUnconfirmed,
    resolutions: matching.resolutions,
    winners: matching.winners,
  });
  return true;
};

// The mappings the worker can use: those whose question is in the catalog and importable, with its definition.
export const mappingInputs = (mappings: ColumnMapping[], catalog: QuestionInfo[]): MappingInput[] =>
  mappings.flatMap((m) => {
    const q = catalog.find((c) => c.id === m.questionId);
    if (!q || q.kind === null) return [];
    return [{ ...m, question: { id: q.id, kind: q.kind, choices: q.choices } }];
  });

/**
 * Recomputes the diff from the store's state against these participants: send them, match, map the answers.
 * The worker's write plan is gone afterwards, so ask for a new one.
 */
export const recomputeDiff = async (
  version: string,
  participants: TrimmedParticipant[],
  catalog: QuestionInfo[],
): Promise<MappedReply> => {
  if (!(await ensureMatched(version, participants))) throw new Error("There is no matching to recompute from.");
  return spreadsheet.mapAnswers(mappingInputs(wizardStore.getState().mapping?.mappings ?? [], catalog));
};
