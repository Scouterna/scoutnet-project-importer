# Proposal

## Why

Step 3 of the wizard is a placeholder. Before any answer can be mapped or written, each spreadsheet row has to be tied to exactly one registered participant. A wrong match writes one person's data into another person's registration, so matching must be conservative, explainable through counts, and leave every doubtful row out unless the user resolves it.

## What Changes

- Step 3, Match rows: the user picks one or more match sources (member number, personnummer, email, name) with their columns, and ranks them. Columns with common header names are suggested.
- Each row is matched on the highest-ranked source that gives exactly one participant; lower sources only fill gaps.
- Values are normalised per source: member number as trimmed text; personnummer in the common Swedish formats; email trimmed and case-insensitive; name trimmed, spaces collapsed, case-insensitive, keeping å, ä, ö and accents, from one column, two columns, or "Last, First".
- Counts per source (unique, ambiguous, no match, empty) and for the whole chain, including rows that only match a cancelled or unconfirmed participant excluded in step 1.
- Ambiguous rows are skipped unless the user picks the right participant from the candidates.
- Rows that match the same participant are flagged as conflicts; the user picks which row wins or skips them all.
- No fuzzy matching. Near-match suggestions are left for a later change.
- Matching runs in the spreadsheet worker over maps built once, so 20,000 rows match near instantly. The final row-to-participant result stays in the worker for steps 4 and 5.
- Step 3 completes when at least one row is matched.

## Capabilities

### New Capabilities

- `participant-matching`: tying spreadsheet rows to participants: sources and ranking, normalisation, counts, ambiguity and conflict resolution.

### Modified Capabilities

None.

## Impact

- New code: `web/matching/` (normalisers, matcher), worker commands in `web/spreadsheet/`, `web/pages/match-rows.tsx`; `web/steps.ts`, `web/wizard-store.ts` and `web/router.tsx` wire up step 3.
- New dependency: `@tanstack/react-virtual` for the row lists that can reach 20,000 entries.
- No server changes.
