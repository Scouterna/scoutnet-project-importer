# Design

## Context

After step 5:
- The spreadsheet worker holds the table (all rows with `Cell { text, value, date? }`), `lastMatch` (one outcome per row: matched, ambiguous, excluded, unmatched, conflict) and `lastDiff` (member → question → `{ outcome, value }`).
- The write outcomes are in `web/writing/outcomes.ts` on the page (`getOutcomes()`, member → question → `AnswerOutcome`).
- The store's `write` holds the status and the number of batches sent. The runner's result (`failedBatches`, `stopped`) lives in the review page.
- `readsBack(kind, written, now)` exists in `web/writing/readback.ts`.

## Goals / Non-Goals

**Goals:** report totals, the .xlsx of rows not imported, and read-back verification.

**Non-Goals:** keeping reports across reloads, CSV output, and re-importing the downloaded file automatically.

## Decisions

### Run summary kept alongside the outcomes
`web/writing/outcomes.ts` gains `lastRun: { stopped: "cancelled" | "key rejected" | null; failedBatches: number; participants: number } | null`. The review page sets it when a run or retry ends, and it is cleared together with the outcomes. Totals come from `countOutcomes(getOutcomes())`.

### Reasons as a pure function
`web/report/reasons.ts` has `rowReason({ match, answers, questionLabels })`, which returns a string, or null when the row is fully imported. The inputs:
- `match` is the row's `lastMatch` outcome.
- `answers` holds, per mapped question in step 4's order, the diff outcome and the write outcome, if any.

The rules follow the spec. A diff entry of set, overwrite or clear with no write outcome counts as "not attempted (not written)". This covers a run that never reached that member. `notFound` and `noMember` both read "not a participant". The function has no worker or DOM dependencies, so it is tested directly.

### Export in the worker
New request `notImported { outcomes: [member, question, AnswerOutcome][], questionLabels: [id, label][] }` returns `file { name, bytes: ArrayBuffer, rows }`. The ArrayBuffer is transferred, not copied. The page sends the outcomes because they live on the page, and they are small: one entry per written answer.

The worker builds an array of arrays:
1. the header row, which is the original header cells' values, plus "Reason";
2. for each included row, each original cell's `value` as it is (a `Date` for date cells, built from `Cell.date`), plus the reason.

It then calls `XLSX.utils.aoa_to_sheet` with `cellDates: true` and `XLSX.write(…, { type: "array", bookType: "xlsx" })`. The sheet name is the original sheet name, cut to 31 characters.

Columns beyond the header width and rows above the header row (titles) are not included. The file starts with the header row, so it loads straight back into step 2.

`rows` is the count, used for the page's label. A request with no match result returns `bad_request`.

### Download on the page
The page turns the buffer into a `Blob`, creates an object URL, clicks a temporary `<a download>`, and revokes the URL. Nothing is stored.

### Verification
`web/report/verify.ts` has `verify(written, participants, kinds)`. It returns `{ confirmed, notConfirmed: { memberNo, questionId, written, now }[] }`, and is pure and tested.

`written` is built from the outcomes marked `updated`, with their values. The values come from a new worker request, `writtenValues { members? }`, that returns member → question → value from `lastDiff` for the updated answers the page names.

The page refetches the participants with `staleTime: 0` to run it. The refetched participants are not sent to the worker, because that would clear `lastDiff` and with it the export. The not-confirmed list is virtualised and shows both values through `web/writing/display.ts`.

### Page `web/pages/report.tsx`
The page shows:
- **Status:** a banner when the run was cancelled or stopped.
- **Totals:** tiles for each outcome, plus participants written and failed batches.
- **Download:** a "Download rows not imported (N)" button. N comes from a cheap `notImported` dry run that returns the count only (`countOnly: true`). When N is 0, the button is disabled with "Every row was imported".
- **Verification:** a "Verify in Scoutnet" button with its result.
- **Navigation:** Back to Review and write.

## Risks / Trade-offs

- [The outcomes and diff are cleared by a new match or mapping, for example if the user goes back to step 3 and changes something] → The report shows a notice that it no longer matches the current settings and disables the download. The page checks this with a `bad_request` from the worker, or with empty outcomes.
- [Date cells came from text in CSV files] → `Cell.value` is written as it is, so text stays text. Only cells that SheetJS parsed as dates become dates.
