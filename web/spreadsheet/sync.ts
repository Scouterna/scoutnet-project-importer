import type { TrimmedParticipant } from "../../shared/api-types.ts";
import { spreadsheet } from "./client.ts";

// The version of the participant list last sent to the worker. The worker keeps it between visits and steps.
let sentVersion: string | null = null;
spreadsheet.onReset(() => {
  sentVersion = null;
});

export const participantsSent = (version: string): boolean => sentVersion === version;

export const sendParticipants = async (version: string, participants: TrimmedParticipant[]): Promise<void> => {
  if (sentVersion === version) return;
  await spreadsheet.setParticipants(version, participants);
  sentVersion = version;
};
