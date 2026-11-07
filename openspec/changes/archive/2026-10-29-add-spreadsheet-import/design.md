# Design

## Context

Step 1 is done: the wizard store (`web/wizard-store.ts`) holds keys and the project field, the query cache holds questions and participants, and `web/steps.ts` decides which steps are reachable. Step 2 is a placeholder route. The brief requires parsing, matching and diffing in a Web Worker, 20,000-row files on a low-end laptop, and that the spreadsheet never leaves the browser or reaches browser storage.

## Goals / Non-Goals

**Goals:** read the file in a worker; choose sheet and header row; build a column/row model with raw and displayed values; preview; complete step 2.

**Non-Goals:** matching, mapping, saved mappings, persisting the file across reloads, editing cells.

## Decisions

### SheetJS from its CDN tarball
`xlsx` is installed from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, pinned in `package.json`. The npm registry's `xlsx` stopped at 0.18.5 and has known advisories. It is imported only inside the worker, so it never lands in the main bundle.

### The workbook lives in the worker
One long-lived module worker (`new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })`) owns the parsed workbook and the chosen sheet's table. The page sends commands and gets back only what it renders:

| Page → worker | Worker → page |
|---|---|
| `load { file: File }` | `progress { stage }`, then `loaded { fileName, sheets: { name, rows, empty }[], sheet }` or `error { message }` |
| `selectSheet { sheet }` | `sheet { topRows: Cell[][] (first 20, with row numbers), headerRow (guess) }` |
| `selectHeader { headerRow }` | `table { columns: Column[], rowCount, preview: Row[] (first 10) }` |

Every request carries an `id`, and the reply echoes it; replies to a superseded request are dropped by the page, so picking a new file mid-parse is safe. Steps 3–5 will add commands to the same worker (match, diff) and read the table there, so 20,000 rows are never cloned to the page. The message types live in `web/spreadsheet/protocol.ts`, imported by both sides.

A failed `load` leaves the worker's previous workbook in place, so the previous spreadsheet stays loaded.

### Parsing options
`XLSX.read(buffer, { type: "array", cellDates: true, cellNF: true, raw: false, dense: true })`. For `.csv`, the bytes are decoded first: UTF-8 when valid (BOM stripped), otherwise Windows-1252 via `TextDecoder("windows-1252")`. The text is then read with `{ type: "string", raw: true }` so CSV values are never coerced to numbers or dates. SheetJS sniffs comma vs semicolon. `dense: true` keeps 20,000-row sheets compact.

### Cell model
```ts
type Cell = { text: string; value: string | number | boolean | null; date?: string /* ISO yyyy-mm-dd or full ISO */ };
type Column = { index: number; letter: string; name: string };
type Row = { sheetRow: number /* 1-based, as in Excel */; cells: Cell[] /* aligned to columns */ };
```
`text` is SheetJS's formatted text (`w`), trimmed, falling back to `String(v)`. So a member number stored as the number 12345 with format `0000000` reads `0012345`, and a text cell `20100101-1234` stays text. Later steps match and map on `text`; `value` and `date` exist for the date and number question types in step 4.

### Header guess
Over the first 20 non-empty rows: the widest row's non-empty count is `w`. The guess is the first row with at least `max(2, ceil(w * 0.6))` non-empty cells, all of which are text (not numbers, booleans or dates). If none qualifies, row 1 of the table. Pure function in `web/spreadsheet/headers.ts`, tested on its own.

### Empty rows and columns, and names
After the header row, rows whose cells are all empty text are dropped; columns empty in the header and every data row are dropped. Names follow the spec: trimmed; empty → `Column F`; duplicates → `Namn (Column A)`. `letter` uses the sheet column, so names stay stable when a spacer column is removed.

### State on the page
The wizard store gains `spreadsheet: { fileName, sheet, headerRow, rowCount, columns } | null`, kept in memory only and **not** added to the persisted sessionStorage entry. Step completion (`web/steps.ts`) becomes: step 1 needs `loaded`; step 2 needs `spreadsheet` with `rowCount > 0`. After a reload the store is empty and the worker has no workbook, so step 2 must be redone, which matches the spec.

### UI
`web/pages/load-spreadsheet.tsx` with MUI: a file button (`accept=".xlsx,.xls,.ods,.csv"`) plus drag-and-drop; a `LinearProgress` while parsing, labelled with the stage; a sheet `Select` when there is more than one; a compact table of the top rows with row numbers, with the current header row highlighted, and a row `Select` that sets the header row; then the preview table and "N rows, M columns". The preview is 10 rows, so plain MUI `Table` is enough; virtualisation comes with the larger tables in later steps.

## Risks / Trade-offs

- **SheetJS bundle size (~1 MB):** it loads in the worker chunk only, on first use.
- **Header heuristic misses:** the user can always pick the row; the top 20 rows are shown with numbers.
- **Worker crash or out of memory on a huge file:** the worker's `error` event is turned into the "could not be read" error and the worker is restarted.
- **Encrypted files:** SheetJS throws; reported as unreadable, per the spec.
