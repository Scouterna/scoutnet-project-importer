# Proposal

## Why

Step 2 of the wizard is a placeholder. Matching and mapping (steps 3 and 4) need the organiser's spreadsheet read into memory with known headers and reliable cell values, and the brief requires this to happen entirely in the browser, off the main thread, and without turning member numbers or personnummer into numbers.

## What Changes

- Step 2, Load spreadsheet: the user picks an `.xlsx`, `.csv`, `.xls` or `.ods` file. It is read in the browser and never sent to the server.
- Parsing runs in a Web Worker, with a progress indicator while it runs. The parsed workbook stays in the worker for the later steps; the page only receives what it shows.
- The user picks the sheet (when there is more than one) and the header row. The app guesses the header row, so a title or notes above the table are skipped.
- A preview shows the first 10 data rows under the chosen headers, with the row and column counts.
- Fully empty rows and columns are ignored. Empty header cells get a generated name such as "Column F"; duplicate names are made unique with the column letter.
- Each cell keeps its raw value and its displayed text. Excel dates are recognised, and number-like identifiers are kept as text.
- Step 2 completes once a sheet and header row with at least one data row are chosen, which opens step 3 (still a placeholder).

Out of scope: matching, mapping, saved mappings, and remembering the file across a reload (the file is never stored).

## Capabilities

### New Capabilities

- `spreadsheet-import`: reading the user's file in the browser, choosing sheet and header row, and producing the row and column model the later steps use.

### Modified Capabilities

None. The wizard's step order rule already covers step 2 becoming reachable.

## Impact

- New code: `web/spreadsheet/` (worker, message types, header logic, cell model) and `web/pages/load-spreadsheet.tsx`; `web/steps.ts` and `web/router.tsx` wire up step 2.
- New dependency: SheetJS (`xlsx`), from the SheetJS CDN tarball, pinned (the npm registry copy is outdated).
- No server changes. The container image only grows by the frontend bundle.
