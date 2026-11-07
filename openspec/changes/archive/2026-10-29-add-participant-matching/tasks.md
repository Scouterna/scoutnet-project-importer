# Tasks

## 1. Matching core (pure, tested)

- [x] 1.1 Add `web/matching/normalise.ts` (member number, personnummer with the century and `+` rules and an injectable `today`, email, names in three layouts) with tests covering every spec scenario
- [x] 1.2 Add `web/matching/suggest.ts`, which suggests sources from header names, with tests
- [x] 1.3 Add `web/matching/matcher.ts` (`buildIndex`, `match` with ranked chain, pool and excluded, resolutions, conflicts and winners, per-source and chain counts) with tests for each spec scenario and a 20,000 × 20,000 timing test under 1 s

## 2. Worker

- [x] 2.1 Add `setParticipants` and `match` to `web/spreadsheet/protocol.ts`, `worker.ts` (index cache per participant version, last result kept, cleared on load, sheet or header change) and `client.ts` (supersession like `selectHeader`); extend worker and client tests

## 3. Wizard wiring and UI

- [x] 3.1 Add `@tanstack/react-virtual`
- [x] 3.2 Add in-memory `matching` state to `web/wizard-store.ts` (not persisted; dropped when the file changes) and step 3 completion in `web/steps.ts`; update tests
- [x] 3.3 Add `web/pages/match-rows.tsx` (source list with ranking, counts table, virtualised Ambiguous/Conflicts/Unmatched/Excluded tabs with pickers, Back/Continue) and route `/match` to it; send participants to the worker when entering the step or when they or the pool flags change
- [x] 3.4 Verify manually in `pnpm dev` against the test project, with a spreadsheet that has a duplicate row, a shared parent email, a cancelled participant, a "Last, First" name column and an empty member number

## 4. Checks

- [x] 4.1 Run `pnpm typecheck`, `pnpm test`, `pnpm build:web` and `openspec validate --strict`
