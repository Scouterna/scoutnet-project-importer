# Proposal

## Why

Step 4 of the wizard is a placeholder. Once rows are matched, the user has to say which column fills which question and turn spreadsheet values ("veg", "Ja", "2,5") into answers Scoutnet accepts. Scoutnet barely validates writes and rejects a whole batch on one bad value, so the app must produce only valid, confirmed answers. Test writes on project 92877 also showed which question types can be written at all.

## What Changes

- Step 4, Map answers: the user pairs spreadsheet columns with questions, starting from suggestions that compare headers with question labels. A column maps to at most one question and a question takes at most one column. Questions are grouped by form, tab and section.
- Importable types are free text, number, yes/no (`boolean`) and single choice. Multiple choice, date and time are listed as not importable, because Scoutnet rejects writes to them ("Question type … not yet supported").
- A hint explains that questions only appear when "Inkludera svar i API" is ticked on them in Scoutnet.
- Values are handled per type: text is trimmed; numbers are parsed with Swedish or English decimals; yes/no recognises common variants; single choice goes through a distinct-value table.
- The distinct-value table has one row per distinct value, with variants differing only in case, spaces or punctuation grouped together. Exact label matches are mapped as certain. Values that merely resemble an option get an unconfirmed suggestion, with "confirm all suggestions". The table can be searched, is sorted by count, and has bulk actions. Unmapped and unconfirmed values are never written.
- Rules per mapped column: an empty cell either skips (default) or clears the answer; an existing answer is either overwritten (default) or kept, with only empty answers filled.
- A preview per question counts answers that will be newly set, overwritten, cleared or left unchanged, and rows skipped because the cell is empty or the value is unmapped or invalid.
- Value tables and the preview are computed in the spreadsheet worker. The result stays there for step 5.
- **Fix:** a participant's current answer to a multiple-choice question is a list of option ids, not a string. The participant answer type allows this.
- Nothing is written to Scoutnet in this step.

## Capabilities

### New Capabilities

- `answer-mapping`: pairing columns with questions, turning cell values into valid answers per question type, rules for empty cells and existing answers, and the per-question preview.

### Modified Capabilities

None. The proxy spec already says current answers are returned as Scoutnet gives them; only the TypeScript type was too narrow.

## Impact

- New code: `web/mapping/` (question classification, header suggestions, value normalisation and parsing, value tables, diff), worker commands in `web/spreadsheet/`, `web/pages/map-answers.tsx`. `web/steps.ts`, `web/wizard-store.ts` and `web/router.tsx` wire up step 4.
- `shared/api-types.ts` and `shared/scoutnet/participants.ts`: answers become `string | string[] | null`.
- No server changes and no new dependencies.
