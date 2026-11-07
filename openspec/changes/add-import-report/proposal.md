# Proposal

## Why

Step 6 is a placeholder. After a write the user needs to know what actually happened in Scoutnet. They also need a way to deal with the rows that didn't make it, without working out by hand which ones they were.

## What Changes

- Step 6, Report:
  - Totals per answer, taken from Scoutnet's responses: updated, unchanged, failed, not attempted, not a participant and no such member. The number of failed batches is shown too.
  - A download (.xlsx) of every spreadsheet row with something that wasn't imported. It keeps the original columns and values and adds a "Reason" column, for example "No match", "Ambiguous", "Conflict", "Mat: unmapped value", "Gafflar: invalid value", "Favoritfilm: write failed (…)" or "Not attempted (cancelled)". The user can fix the file and run it again.
  - An optional verification: refetch the participants and confirm that every answer reported as updated now reads back as written. Any answer that doesn't is listed.
- The file is built in the browser, in the spreadsheet worker, and handed to the user as a download. It never reaches the server.

## Capabilities

### New Capabilities

- `import-report`: the totals after a write, the download of rows not imported with reasons, and the read-back verification.

### Modified Capabilities

None.

## Impact

- Worker: a `notImported` request in `web/spreadsheet/` that builds the .xlsx from the table, the match result, the last diff and the write outcomes. Supporting code goes in `web/report/` (pure reason builder and verification).
- `web/pages/report.tsx`, routed at `/report`.
- No server changes and no new dependencies, since SheetJS is already in the worker.
