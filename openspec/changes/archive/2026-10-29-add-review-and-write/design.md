# Design

## Context

After step 4, the spreadsheet worker holds `lastDiff`, a map of member → question → `{ outcome, value }` covering all seven outcomes. The server has read-only routes behind `requireCredentials`, which builds a Basic auth header and a `@scouterna/scoutnet` client for the allowlisted environment. Any non-401 upstream error is mapped to 502. Scoutnet write facts are in `api.pdf` and come from test writes on project 92877:
- Answer-only bodies are allowed.
- Any invalid answer aborts the whole request with a 400 `{"message", "errors": {member: {question: text}}}`.
- A success returns `updated_questions[member][question]`, which is `null` when unchanged, or `{action: "updated", original_values, new_values}`. It also returns `not_found` and `no_member`, while `total` is 0 for answer-only writes.

## Goals / Non-Goals

**Goals:** the answers route, the review page, the single-participant test, the batched runner with cancel, isolation of rejected answers and retries, outcomes kept in memory for step 6.

**Non-Goals:**
- the report UI and the download of rows that weren't imported (step 6);
- the optional verification refetch after a full run (step 6);
- running several requests in parallel;
- remembering progress across tab reloads (a rerun covers that).

## Decisions

### Server route
`PUT /api/answers`, behind `requireCredentials` with the check-in key:
- **Request:** `{ answers: { [memberNo]: { [questionId]: string } } }`. It is validated by hand: only the `answers` key is allowed, member and question keys must match `^\d+$`, values must be strings of at most 10,000 characters, and there can be at most 1,000 members. Anything else gets a 400 `bad_request` before Scoutnet is called. The Scoutnet body is built from scratch as `{ m: { questions: { q: { value } } } }`.
- **Success response:** `{ results: { [memberNo]: { [questionId]: "updated" | "unchanged" } }, notFound: string[], noMember: string[] }`, taken from `updated_questions`. A question Scoutnet doesn't mention counts as unchanged. Members in `not_found` or `no_member` get no per-question results.
- **Scoutnet 400:** we respond 400 with `{ error: { code: "answers_rejected", message, errors?: { [memberNo]: { [questionId]: string } } } }`. Only Scoutnet's `message` and `errors` strings are passed through, and they are never logged. A 401 becomes `credentials_rejected`, and other failures become 502, as on the other routes.
- **Typed client:** the route uses the typed client's `PUT("/project/checkin")` when the generated types allow an answer-only body. Otherwise it falls back to `options.fetch` against the same allowlisted base URL. Either way, `server/app.test.ts` asserts the exact upstream body.

The existing error log line (method, path, status, project ID) is unchanged and contains no body.

### Batches built in the worker
New worker request `writePlan { batchSize }` → `plan { batches: { members: string[], answers: number }[], totals }`. The worker takes the set, overwrite and clear entries from `lastDiff`, groups them by member, keeps the sheet's row order, and chunks them by `batchSize`.

New worker request `batchBody { index }` → `body { answers }`. It returns the body for a single batch, on demand, so the page only ever holds one batch's values at a time.

New worker request `reviewList { filter, offset, limit }` → `rows: { sheetRow, memberNo, name, questionId, current, next, outcome }[]`. The page renders the change list from it, paged and virtualised. `current` and `next` are display strings, with choice option ids turned into labels by the page.

### Runner in `web/writing/runner.ts`
A pure async function, `runBatches({ batches, getBody, send, onProgress, signal })`, with `send` injected so it can be tested without a network:
1. Batches are sent one after another. After each one the runner checks `signal`. When it is cancelled, the remaining answers are marked `notAttempted`.
2. On `answers_rejected` with `errors`, the answers it names are marked `failed` with Scoutnet's message. The remainder of the batch is resent once. If the resend is rejected too, the whole remainder is marked failed with that message.
3. Without an `errors` field, or on 502, the whole batch is marked failed and kept for "Retry failed batches".
4. On `credentials_rejected` the run stops, and the rest is marked `notAttempted` with reason "key rejected".
5. On success, each answer is recorded as `updated` or `unchanged` from `results`, or as `notFound` or `noMember` for the members listed there.

The outcomes live in a `Map<member, Map<question, Outcome>>` in a page-level module. They stay in memory, are never persisted, and are cleared when the file, the match or the mapping changes. The wizard store keeps only `write: { status: "idle" | "running" | "done", sent: number, fileName }`, which is enough for step completion. `beforeunload` is registered while the status is running.

### Single-participant test
- **Choosing the participant:** the user picks one from the change list, defaulting to the participant with the most kinds of question changed.
- **Writing:** it goes through the same confirmation dialog and `send`.
- **Checking:** after the write, the participants are refetched with `staleTime: 0` and re-sent to the worker. Each written answer is then compared with the value that comes back. Text is compared after normalising line breaks, numbers numerically, and everything else as strings.
- **Result:** a table of answers marked confirmed or not confirmed, each with both values. The test's outcomes are recorded like any other write.

Writing number, yes/no and single-choice answers, and clearing a number, haven't been verified against Scoutnet yet. This test is how the manual check (task 4.3) verifies them.

### Review page `web/pages/review-write.tsx`
1. **On entry:** refetch the participants, send them to the worker, rerun the match and the mapping from the store's state (reusing step 4's entry helper), then ask for the plan and the summary. A Refresh button does the same.
2. **Check-in key:** if it is empty, a key field (the same component as in step 1) is shown above the buttons.
3. **Summary:** the summary counts, then the change list with a filter (changes and skipped / all).
4. **Batch size:** a "Batch size" number field (1 to 1,000) sits under an "Advanced" disclosure.
5. **Running:** while running, the page shows a progress bar (batches and answers) and a Cancel button that waits for the current batch.
6. **Afterwards:** it shows totals of the outcomes, "Retry failed batches" when any failed, and Continue to `/report`.

## Risks / Trade-offs

- **[Scoutnet's `errors` doesn't name every failing answer]** → The resend is tried once. If it is rejected too, the whole remainder is marked failed. A rerun then picks up the rest.
- **[A network failure after Scoutnet has saved a batch]** → Answer writes are idempotent, so retrying is safe. The rerun's diff shows the true state.
- **[1,000 members × several answers per request is a large body]** → The default is 250. The 1,000 limit is a server-side guard, not a recommendation.
- **[The review list for 20,000 rows]** → It is paged from the worker, so the page never holds all values.

## Open Questions

- Which batch size works best against production Scoutnet? Tune it after the first real import. It only changes the default.
