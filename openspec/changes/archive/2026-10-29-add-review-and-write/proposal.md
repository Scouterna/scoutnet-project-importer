# Proposal

## Why

Step 5 is a placeholder, and the app cannot write anything to Scoutnet yet. This is the step that changes real registrations, so the user must see exactly what will change and confirm it first. Writing must survive partial failures: Scoutnet rejects a whole request over one bad answer, and with 20,000 participants a run takes many requests.

## What Changes

- New server route `PUT /api/answers`. It forwards answers to Scoutnet's `PUT /project/checkin` with the check-in key. The server builds the Scoutnet body itself, so the body can never carry `checked_in` or `attended`. Scoutnet's per-answer results and rejection errors are passed back in a normalised shape.
- Step 5, Review and write:
  - On entry the participants are refetched and the diff is recomputed against current answers. The time of the fetch is shown, with a refresh button.
  - Summary counts and a virtualised change list (participant, question, current value, new value), filtered to changes and problems by default.
  - The check-in key is asked for here if step 1 left it empty.
  - "Test with one participant" writes one participant's answers, refetches, and confirms each answer reads back as written. Rerunning is safe.
  - Confirmation states exactly what will happen ("Update 1,240 answers for 812 participants").
  - Only participants with at least one changed answer are sent, in sequential batches (default 250, configurable), with a progress bar, a beforeunload warning and cancel-after-current-batch.
  - When Scoutnet rejects a batch over specific answers, those answers are marked failed with Scoutnet's message and the rest of the batch is resent. Other failed batches are recorded and can be retried at the end. A rejected key stops the run.
- The outcome of every answer (updated, unchanged, not a participant, no such member, failed) is kept in memory for step 6.
- Rerunning the whole import is the recovery path: the fresh refetch and diff skip everyone already updated.

## Capabilities

### New Capabilities

- `answer-writing`: the review before writing, confirmation, the single-participant test, batched writing with progress, cancel and failure handling, and the per-answer outcome.

### Modified Capabilities

- `scoutnet-proxy`: adds the answers route that forwards answer-only writes.

## Impact

- Server: `server/app.ts` gets the route and its validation. `shared/api-types.ts` gets the request and response types and the `answers_rejected` error code. The route is tested in `server/app.test.ts`.
- Web: a `writeAnswers` call in `web/api.ts`, a batch builder in the worker, a write runner in `web/writing/`, `web/pages/review-write.tsx`, and write state in the store and steps.
- No new dependencies.
