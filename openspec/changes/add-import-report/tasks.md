# Tasks

## 1. Report core (pure, tested)

- [x] 1.1 Add `web/report/reasons.ts` (`rowReason`) with tests for every reason in the spec, a partly imported row, a fully imported row, and an answer with no write outcome
- [x] 1.2 Add `web/report/verify.ts` (`verify`) with tests for confirmed answers, an answer that changed afterwards, line-break differences and numbers
- [x] 1.3 Add `lastRun` to `web/writing/outcomes.ts`, cleared with the outcomes and set by the review page when a run or retry ends; verify with an outcomes test and `pnpm typecheck`

## 2. Worker

- [x] 2.1 Add `notImported` (with `countOnly`) and `writtenValues` to `web/spreadsheet/protocol.ts`, `worker.ts` and `client.ts`; verify with worker tests that read the produced .xlsx back with SheetJS: header plus "Reason", original values with numbers and dates kept, only the included rows, a sheet name over 31 characters cut, the count-only reply, and a 20,000-row export timed under 3 s

## 3. Page

- [x] 3.1 Add `web/pages/report.tsx` (status banner, totals, download with the right file name via an object URL, verification with the not-confirmed list, the notice when the report no longer matches the settings, Back) and route `/report` to it; verify with `pnpm build:web`
- [ ] 3.2 Verify manually in `pnpm dev` against project 92877, after a run that includes an unmatched row, an invalid number, a cancelled batch and the unanswered multiple-choice question: check the totals, open the download in Excel or LibreOffice to check the columns and reasons, load it back into step 2, and run the verification

## 4. Checks

- [x] 4.1 Run `pnpm typecheck`, `pnpm test`, `pnpm build:web` and `openspec validate --strict`

## Workflow follow-up

- Archive the change after the manual check passes, syncing `import-report` into the main specs.
