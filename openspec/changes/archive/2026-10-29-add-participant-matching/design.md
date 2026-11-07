# Design

## Context

Step 2 left the chosen table (`columns`, all `rows` with `Cell.text`) inside the spreadsheet worker (`web/spreadsheet/worker.ts`). Participants (`TrimmedParticipant[]`) sit in the TanStack Query cache on the page, and step 1's switches decide which are available (`web/summary.ts`). Steps 4 and 5 will need the final row → participant result, again in the worker.

## Goals / Non-Goals

**Goals:** sources and ranking, normalisation, ranked matching, counts, ambiguity and conflict resolution, all in the worker; step 3 UI.

**Non-Goals:** fuzzy suggestions, saved mappings (a later change exports this configuration), writing anything.

## Decisions

### Pure matcher in `web/matching/`
- `normalise.ts`: `memberNo`, `personnummer` (→ 12 digits `YYYYMMDDXXXX` or null; takes `today` for the century rule), `email`, `name(first, last)` and `splitName(text, layout)`. Names use `.normalize("NFC").toLocaleLowerCase("sv")`, trim and collapse whitespace; no accent folding.
- `matcher.ts`: `buildIndex(participants, source)` → `Map<key, memberNo[]>`; `match(table, sources, indexes, pool, resolutions, winners)` → a `MatchResult`. No DOM, no worker globals, so it is unit-tested directly.

Source configuration (also what saved mappings will store later; columns by name):

```ts
type Source =
  | { kind: "memberNo" | "ssno" | "email"; column: string }
  | { kind: "name"; layout: "firstLast" | "lastFirst"; column: string }
  | { kind: "name"; layout: "split"; first: string; last: string };
```

### Algorithm
Indexes are built over **all** participants, keyed by normalised value, once per participant list and source kind, and cached in the worker. For each row, for each source in rank order: normalise; empty → next; look up candidates; split them into pool and excluded (pool = step 1's include flags). One pooled candidate → matched on that source, stop. Several pooled → remember as ambiguous candidates, next. None pooled but some excluded → remember "excluded", next. After all sources: matched; else ambiguous (if any source gave several); else excluded (if any gave only excluded); else unmatched. This keeps "lower sources only fill gaps" while never matching an excluded participant.

Resolutions (`Map<sheetRow, memberNo>`) apply to ambiguous rows only and are kept only while the picked member is still among that row's candidates. Then conflicts: group matched rows by memberNo; any group with more than one row is a conflict, and its rows are unmatched unless `winners.get(memberNo)` names one of them (`"skip"` leaves them all out). Per-source counts are computed in the same pass by evaluating each source alone.

Cost is one map lookup per row per source, so 20,000 × 4 is far under a second.

### Worker protocol additions
| Page → worker | Worker → page |
|---|---|
| `setParticipants { version, participants }` (sent when `fetchedAt` or the pool flags change) | `participantsSet { version }` |
| `match { sources, includeCancelled, includeUnconfirmed, resolutions, winners }` | `matched { counts, ambiguous[], conflicts[], unmatched[], excluded[] }` |

List entries carry only what the page shows: `sheetRow`, the source cells' text, and for ambiguous and conflict rows the candidates' name, member number and email. The worker keeps the last `MatchResult` for steps 4–5. A new `load`/`selectSheet`/`selectHeader` clears it. `match` is superseded like `selectHeader`.

Personnummer are needed for matching, so they are part of what is sent to the worker; they are not sent back to the page in lists.

### State on the page
The wizard store gains in-memory `matching: { sources, resolutions, winners, counts } | null`, never persisted. On returning to step 3, sources whose columns no longer exist by name are dropped (and reported); the rest are re-sent to the worker. Step completion: step 3 needs `counts.matched > 0`. Resolutions and winners are keyed by sheet row and memberNo; they are dropped when the spreadsheet file changes.

### Suggested sources
On first entry, header names are matched case-insensitively against short lists (e.g. `medlemsnummer|medlemsnr|member number|member_no`, `personnummer|pnr|ssn`, `e-post|epost|email|e-mail`, `förnamn|first name`, `efternamn|last name`, `namn|name`). Pure function, tested.

### UI
`web/pages/match-rows.tsx` (MUI):
- A source list. Each source has a kind, a column `Select` (or two for split names, plus a layout `Select` for one-column names), up/down buttons and remove. "Add source" lists the unused kinds.
- A counts table, with a row per source and the chain totals.
- Tabs for Ambiguous, Conflicts, Unmatched and Excluded. Each tab is a list virtualised with `@tanstack/react-virtual`. Ambiguous and conflict rows each have a `Select` to pick a candidate, a winning row, or "Skip".
- Back and Continue. Continue is disabled at 0 matched.

## Risks / Trade-offs

- **Cloning 20,000 participants to the worker** (~2–4 MB) happens once per fetch, not per match.
- **Two-digit-year personnummer** close to 100 years old: handled by the `+` rule. A sheet writing `-` for a centenarian will be read as a child and simply not match.
- **"First Last" in one column with multi-part names** ("Anna Maria Lind"): compared as the full string against "first last", so it matches when Scoutnet has first name "Anna Maria"; otherwise it is unmatched, which is the safe side.
