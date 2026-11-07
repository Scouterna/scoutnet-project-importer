# Tasks

## 1. Server

- [x] 1.1 Add the answer write types and the `answers_rejected` error code to `shared/api-types.ts`, and `PUT /api/answers` to `server/app.ts` with validation, the Scoutnet body built from scratch, results normalised from `updated_questions`, `not_found` and `no_member`, and 400 errors passed through; verify with `server/app.test.ts` tests for every spec scenario, including the exact upstream body, extra fields, more than 1,000 members, an unchanged answer, the per-answer rejection and the log line having no body content

## 2. Worker and API client

- [x] 2.1 Add `writePlan`, `batchBody` and `reviewList` to `web/spreadsheet/protocol.ts`, `worker.ts` and `client.ts`; verify with worker tests for grouping by member, row order, chunking, that only set, overwrite and clear are planned, and paging and filtering of the review list
- [x] 2.2 Add `writeAnswers` to `web/api.ts`, keeping the structured `answers_rejected` errors; verify with an `api.test.ts` case

## 3. Runner

- [x] 3.1 Add `web/writing/runner.ts` (`runBatches`, sequential with cancel, rejected-answer isolation with one resend, failed batches kept for retry, a stop on a rejected key, outcomes per answer) and the in-memory outcome store; verify with tests for each spec scenario under Cancel, Rejected answers isolated, Failed batches and Answer outcomes
- [x] 3.2 Add the read-back comparison for the single-participant test (text line breaks, numbers numerically, otherwise strings); verify with unit tests

## 4. Wizard wiring and UI

- [x] 4.1 Add `write` state to `web/wizard-store.ts` (not persisted; reset when the file, match or mapping changes) and step 5 completion in `web/steps.ts`; verify with updated store and steps tests
- [x] 4.2 Add `web/pages/review-write.tsx` (refetch and recompute on entry and on Refresh, summary, paged virtualised change list with filter, check-in key field, batch size under Advanced, single-participant test with the read-back table, confirmation dialog, progress, cancel, beforeunload, retry, Continue) and route `/review` to it; verify with `pnpm build:web`
- [x] 4.3 Verify manually in `pnpm dev` against project 92877. First run the single-participant test with answers for Mat, Gillar du gifflar?, Favoritfilm and Gafflar, including a cleared number. Then run a full write with batch size 1 over three participants, cancel after the first batch, and rerun to check that only the remaining participants are shown. Finally, add a new multiple-choice question with "Inkludera svar i API" ticked that nobody has answered (so step 4 treats it as single choice), map a column to it, and confirm that its rejection is isolated while the other answers in the batch are written

## 5. Checks

- [x] 5.1 Run `pnpm typecheck`, `pnpm test`, `pnpm build:web` and `openspec validate --strict`

## Workflow follow-up

- Archive the change after the manual check passes, syncing `answer-writing` and `scoutnet-proxy` into the main specs.
- Update the memory note on Scoutnet answers with what the single-participant test shows about number, yes/no and single-choice writes.
