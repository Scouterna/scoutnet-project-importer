# Tasks

## 1. Dependency and model

- [x] 1.1 Add SheetJS from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` to `package.json` and install; confirm it is not imported from main-thread code
- [x] 1.2 Add `web/spreadsheet/protocol.ts` with the `Cell`, `Column`, `Row` types and the request/reply message types from the design

## 2. Table logic (pure, tested)

- [x] 2.1 Add `web/spreadsheet/headers.ts`: header-row guess, unique column names ("Column F", "Namn (Column A)"), and dropping empty rows and columns; unit-test each spec scenario
- [x] 2.2 Add `web/spreadsheet/cells.ts`: build `Cell` from a SheetJS cell (text from `w`, trimmed; `value`; ISO `date` for date cells) and CSV decoding (UTF-8 with BOM, Windows-1252 fallback); unit-test leading-zero member numbers, personnummer text, an Excel date serial, and a Windows-1252 semicolon CSV with "Åsa Öberg"

## 3. Worker

- [x] 3.1 Add `web/spreadsheet/worker.ts` handling `load`, `selectSheet` and `selectHeader` with request ids, progress messages, and errors that keep the previous workbook; test it by calling its handler directly with small `.xlsx` and `.csv` fixtures built with SheetJS in the test
- [x] 3.2 Add `web/spreadsheet/client.ts`: one worker instance, promise-based calls, dropping replies to superseded requests, and restarting the worker after a crash

## 4. Wizard wiring and UI

- [x] 4.1 Add in-memory `spreadsheet` state to `web/wizard-store.ts` (not persisted) and make step 2 completion depend on it in `web/steps.ts`; update `wizard-store.test.ts` (persisted key set unchanged) and `steps.test.ts`
- [x] 4.2 Add `web/pages/load-spreadsheet.tsx` (file picker and drop zone, progress, sheet select, header-row picker over the top 20 rows, preview of 10 rows, counts, errors, Continue) and route `/spreadsheet` to it in `web/router.tsx`
- [x] 4.3 Verify manually in `pnpm dev`: an `.xlsx` with a title above the header, a semicolon CSV with å/ä/ö, a multi-sheet workbook, a corrupt file, and going back to step 1 and returning; and in the browser devtools that no request carries the file and storage holds nothing new

## 5. Checks

- [x] 5.1 Run `pnpm typecheck`, `pnpm test`, `pnpm build:web` and `openspec validate --strict`; check that the SheetJS code is in the worker chunk and not the main bundle
- [x] 5.2 Time a generated 20,000-row `.xlsx` in the built app: the page stays responsive and the preview appears
