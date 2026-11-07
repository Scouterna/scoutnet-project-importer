# Proposal

## Why

Step 3 lists the spreadsheet rows that didn't match, but not the other direction: participants in the event that no row matched. Seeing them helps the user spot rows matched to the wrong person or missing from the file before anything is written.

## What Changes

- Step 3 gets a list "Without a row (N)" of the participants in the pool (after step 1's cancelled and unconfirmed choices) that no row is matched to, with name, member number and email.
- A participant that is a candidate of an ambiguous row or in an unresolved conflict is marked as such, since resolving that may give them a row.
- The list is computed in the spreadsheet worker as part of the match reply and updates with it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `participant-matching`: adds the list of participants without a row.

## Impact

- `web/spreadsheet/protocol.ts` and `worker.ts`: `MatchedReply` gains `withoutRow`.
- `web/pages/match-rows.tsx`: a fifth tab.
- No server changes, no new dependencies.
