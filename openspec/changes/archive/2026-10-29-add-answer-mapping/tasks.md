# Tasks

## 1. Answer type

- [x] 1.1 Widen `TrimmedParticipant.answers` to `string | string[] | null` in `shared/api-types.ts`, make `trimParticipant` keep string arrays (turning items into strings), and fix any type errors; verify with a participants test for a multiple-choice answer and `pnpm typecheck`

## 2. Mapping core (pure, tested)

- [x] 2.1 Add `web/mapping/questions.ts` (`classify`, including multiple-choice detection from answers and the "no answers yet" flag) with tests for every type in the design table
- [x] 2.2 Add `web/mapping/values.ts` (`groupKey`, `parseNumber`, `parseYesNo`, `resembles`) with tests for the spec scenarios, including "2,5", "1 234,5", "några", "JA" and "kanske"
- [x] 2.3 Add `web/mapping/suggest.ts` (`suggestPairings`) with tests: equal header, containment, one column per question, no match
- [x] 2.4 Add `web/mapping/table.ts` (`buildValueTable` with grouping, variants, counts, `auto` and `suggestion`) with tests including the "Vegetarisk / veg / Vego" scenario
- [x] 2.5 Add `web/mapping/diff.ts` (`diffQuestion` with decisions, rules, encodings and the seven outcomes) with tests for each rule and for counts adding up to the matched rows, plus a 20,000-row timing test under 1 s for ten questions

## 3. Worker

- [x] 3.1 Add `mapAnswers` and `skippedRows` to `web/spreadsheet/protocol.ts`, `worker.ts` (value-table cache per column and question, last diff kept and cleared when the match result changes) and `client.ts` (supersession like `match`); extend the worker and client tests, including one that checks answers aren't sent to the page

## 4. Wizard wiring and UI

- [x] 4.1 Add in-memory `mapping` state to `web/wizard-store.ts` (not persisted; dropped when the file changes) and step 4 completion in `web/steps.ts`; update the tests, including the one asserting what is written to storage
- [x] 4.2 Add `web/pages/map-answers.tsx` (the hint, the column rows with the grouped question select and suggestions, rule selects, preview counts, the virtualised value table with search and bulk actions, skipped rows on demand, Back/Continue) and route `/map` to it; verify with `pnpm build:web`
- [x] 4.3 Verify manually in `pnpm dev` against project 92877, with a spreadsheet that has columns for Mat (values "Vego", "vego.", "veg", "Kött"), Gillar du gifflar? ("Ja", "x", "kanske", empty), Favoritfilm, a number column with "2,5" and "några", and a column for the multiple-choice question

## 5. Checks

- [x] 5.1 Run `pnpm typecheck`, `pnpm test`, `pnpm build:web` and `openspec validate --strict`

## Workflow follow-up

- Archive the change after the manual check passes, syncing `answer-mapping` into the main specs.
