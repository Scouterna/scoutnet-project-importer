# Design

## Context

After step 3 the spreadsheet worker (`web/spreadsheet/worker.ts`) holds the table, the participant list from `setParticipants` (with current answers) and `lastMatch`, the final row → member result with conflicts settled. Questions (`Form[]`) sit in the TanStack Query cache on the page. Verified Scoutnet behaviour (test writes on project 92877, 2026-10-29) is listed below. The proposal's Why gives the motivation.

| Type | Reads as | Writes as | Writable |
|---|---|---|---|
| `text` | string, line breaks `\r\n` | string; `""` clears | yes (tested) |
| `number` | `"3"` | string | documented, not tested |
| `boolean` | `"1"` / `"0"` (choices 1=checked, 0=unchecked) | `"1"` / `"0"` | documented, not tested |
| `choice`, single | option id `"80922"` | option id | documented, not tested |
| `choice`, multiple | array `["80925","80926"]` | — | no: "Question type (28) not yet supported" |
| `other_unsupported_by_api` | date `2026-10-23`, time `5:1` | — | no: types 16 and 24 |

## Goals / Non-Goals

**Goals:** classification of questions, column pairing with suggestions, value handling per type, distinct-value tables, rules, the preview and the result kept in the worker for step 5; the step 4 UI.

**Non-Goals:** writing (step 5), multiple choice, date and time, clearing a single-choice answer, saved mappings, fuzzy matching beyond the simple resemblance rule below.

## Decisions

### Pure modules in `web/mapping/`
These modules have no DOM and no worker globals, and are unit-tested directly.
- `questions.ts`: `classify(question, participants)` returns `{ kind: "text" | "number" | "yesNo" | "choice" }` or `{ kind: "unsupported", reason }`. A `choice` question whose answers include an array is `unsupported` (multiple choice). Also flags `choice` questions with no answers, for the "might be multiple choice" note.
- `suggest.ts`: `suggestPairings(columns, questions)`. It compares the column header with the question label via `groupKey`, matching on equality first, then containment either way. Each question is suggested at most once, the first column winning. The function is pure and tested.
- `values.ts`:
  - `groupKey(text)`: NFC, `toLocaleLowerCase("sv")`, trim, punctuation stripped, spaces collapsed.
  - `parseNumber(cell)` returns a number or null. A numeric `Cell.value` is used directly. Otherwise the text is accepted if it is `-?digits` with optional space or NBSP thousands separators, and an optional `,` or `.` decimal part.
  - `parseYesNo(text)` returns `"1" | "0" | null`.
  - `resembles(a, b)` compares group keys: one is a prefix of the other with at least 3 characters, or the Levenshtein distance is ≤ 1 for keys up to 5 characters and ≤ 2 for longer ones.
- `table.ts`: `buildValueTable(cells, options)` groups the cells of matched rows by `groupKey`. Each group's display value is its most common original spelling. Groups are sorted by count. Each entry carries `auto` (the option whose label has the same key) or `suggestion` (the single option that `resembles` the value; none when several do).
- `diff.ts`: `diffQuestion(rows, mapping, currentAnswers)` produces one outcome per matched row, `set | overwrite | clear | unchanged | skipEmpty | skipUnmapped | skipInvalid`, plus the new value. Answers are compared after normalising line breaks (text), parsing (number) or as strings (yes/no, choice).

### Encoding of answers
- **Text:** the trimmed cell text.
- **Number:** `String(n)` with a point as decimal separator.
- **Yes/no:** `"1"` / `"0"`.
- **Choice:** the option id.
- **Clear:** `""` for text and number. For yes/no, the "set to No" rule sends `"0"`.

### Mapping state: only user decisions are stored
```ts
type ColumnMapping = {
  column: string;          // by name, like step 3's sources
  questionId: string;
  emptyCells: "skip" | "clear";
  existing: "overwrite" | "fillEmpty";
  // groupKey → option id or "skip"; every entry is confirmed
  decisions: [string, string][];
};
```
How a value resolves: an entry in `decisions` wins; otherwise `auto`; otherwise the value is unmapped (a `suggestion` alone is not enough). "Confirm all suggestions" adds a decision for every suggested key. "Map all remaining to X" and "Skip all remaining" add decisions for every key with no decision and no `auto`. This keeps the state small and makes "unconfirmed is never written" structural rather than a flag to remember.

The wizard store gains in-memory `mapping: { fileName, mappings, changes } | null`, which is never persisted because group keys are cell data. It is kept for the same file and dropped when the file changes. On return, mappings whose column or question no longer exists are dropped and reported once, as in step 3. `changes` is the total of set, overwrite and clear. Step 4 is complete when it is above 0.

### Worker protocol additions
| Page → worker | Worker → page |
|---|---|
| `mapAnswers { mappings: (ColumnMapping & { question: { id, kind, choices } })[] }` | `mapped { questions: { questionId, counts, values?: ValueEntry[] }[] }` |
| `skippedRows { questionId }` | `skipped { rows: { sheetRow, value, reason }[] }` |

`ValueEntry = { key, value, variants: string[] (max 5), rows, auto, suggestion }` is sent only for choice and yes/no questions. The page sends the question definition with each mapping, so the worker needs no separate question list. Value tables are cached per column and question, and rebuilt when the match result changes. Decisions and rules only re-run `diffQuestion`. `mapAnswers` is superseded like `match`.

The worker keeps the last diff, as member → question → new value, for step 5. It is cleared when `lastMatch` changes. Participants' answers never go back to the page, apart from what the counts imply.

### UI (`web/pages/map-answers.tsx`)
- At the top, the hint about "Inkludera svar i API" and reloading in step 1.
- One row per spreadsheet column:
  - the header and up to three sample values;
  - a question `Select` grouped by form, tab and section with `ListSubheader`. Questions that aren't importable are shown disabled with the reason; questions already taken are disabled with "used by column X". Suggested pairings carry a "suggested" chip until the user changes the select;
  - for mapped columns, the two rule selects (only the choices the type allows) and the preview counts.
- A mapped choice or yes/no column expands to show its value table:
  - a list virtualised with `@tanstack/react-virtual`;
  - a search box;
  - per value: an option `Select` (plus "Skip"), a status chip (Certain / Suggested / Mapped / Unmapped / Skipped) and the variants;
  - buttons for "Confirm all suggestions", "Map all remaining to…" and "Skip all remaining".
- "Show skipped rows" per question loads the list from the worker on demand.
- Back and Continue. Continue is disabled at 0 changes, with "Nothing would change".
- A `mapAnswers` request is debounced on edits, as matching is.

### Answer type fix
`TrimmedParticipant.answers` becomes `Record<string, string | string[] | null>`. `trimParticipant` keeps arrays, turning their items into strings, and turns any other non-string value into a string or null. Proxy tests cover the array case.

## Risks / Trade-offs

- [A multiple-choice question nobody has answered looks like single choice, and writing to it fails the whole batch] → The question shows a note. Step 5 must isolate failing questions when a batch fails.
- [Number and yes/no writes and `""` clearing a number are untested] → Step 5 starts with a confirmed single-participant write. The encodings are confined to one function, so a correction stays small.
- [A column with thousands of distinct values mapped to a choice question] → The table is virtualised and entries are small. "Skip all remaining" covers the long tail.
- [The resemblance rule suggests a wrong option] → Suggestions are never written until confirmed, and the status chip shows them.

## Open Questions

- Does Scoutnet accept `"2.5"` for a number question, and does `""` clear one? This is checked in step 5's first test write. Only the encoding function would change.
