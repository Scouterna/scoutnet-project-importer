# Spec Delta

## Purpose

Ties each spreadsheet row to exactly one registered participant, or leaves it out, so answers are never written to the wrong person.

## ADDED Requirements

### Requirement: Match sources and ranking
The user SHALL choose one or more match sources from member number, personnummer, email and name, set the column or columns each source reads, and rank them. Each source SHALL be usable at most once. When a column's header is a common name for a source (for example "Medlemsnummer", "Personnummer", "E-post", "Förnamn" and "Efternamn"), the app SHALL suggest that source and column, ranked member number, personnummer, email, name.

#### Scenario: Suggested sources
- **WHEN** the spreadsheet has columns "Medlemsnummer", "Förnamn", "Efternamn" and "E-post"
- **THEN** step 3 starts with member number, email and name (from two columns) selected, in that order

#### Scenario: Reordering
- **WHEN** the user moves email above member number
- **THEN** rows are matched on email first, and the counts update

### Requirement: Identifier normalisation
Member numbers, personnummer and emails SHALL be compared after normalising both the spreadsheet and the participant value. Member numbers are trimmed text compared exactly, and emails are trimmed and compared ignoring case. Personnummer are accepted as `YYYYMMDD-XXXX`, `YYYYMMDDXXXX`, `YYMMDD-XXXX`, `YYMMDDXXXX` or `YYMMDD+XXXX`, and a 9-digit value is read as `YYMMDDXXXX` that lost its leading zero; any other form does not match. An empty value SHALL count as empty, never as a match.

#### Scenario: Personnummer formats
- **WHEN** a participant's personnummer is `20100101-1234` and the row holds `1001011234`
- **THEN** the row matches that participant

#### Scenario: Two-digit year with plus
- **WHEN** a row holds `200101+1234` in 2026
- **THEN** it is read as born 1920-01-01, since `+` means 100 years or older, while `200101-1234` is read as 2020-01-01

#### Scenario: Email case
- **WHEN** a participant's email is `Anna@Example.se` and the row holds ` anna@example.se `
- **THEN** the row matches

#### Scenario: Leading zero lost in Excel
- **WHEN** a participant's personnummer is `20050101-1234` and the row holds `501011234`
- **THEN** the row matches that participant

### Requirement: Name normalisation
Names SHALL be trimmed, have inner spaces collapsed, and be compared ignoring case, keeping letters such as å, ä, ö and é distinct from a, o and e. A name SHALL come from one column holding "First Last", one column holding "Last, First", or separate first- and last-name columns, and SHALL be compared with the participant's first and last name.

#### Scenario: Name with diacritics
- **WHEN** a participant is "Åsa Öberg" and the row holds "  åsa   ÖBERG "
- **THEN** the row matches, while a row holding "Asa Oberg" does not

#### Scenario: Last, First
- **WHEN** the name source reads one column as "Last, First" and the row holds "Öberg, Åsa"
- **THEN** the row matches "Åsa Öberg"

### Requirement: Ranked matching
Each row SHALL be matched on the highest-ranked source whose value gives exactly one participant. A source that gives no participant, several participants, or has an empty value SHALL pass the row to the next source. A row SHALL be ambiguous when no source gives exactly one participant and at least one gives several, and unmatched otherwise. No fuzzy or partial matching SHALL be applied.

#### Scenario: Shared parent email
- **WHEN** a row's email matches three participants and no higher-ranked source gives a unique match
- **THEN** the row is counted as ambiguous and is not matched unless the user resolves it

#### Scenario: Lower source fills a gap
- **WHEN** a row's member number cell is empty and its personnummer matches one participant
- **THEN** the row is matched on personnummer

### Requirement: Participant pool
Rows SHALL be matched only against the participants available after step 1's cancelled and unconfirmed choices. A row that would match only excluded participants SHALL be counted separately as matching an excluded participant, and left out. When a source's value identifies exactly one participant and that participant is excluded, the row SHALL be left out as excluded without trying lower sources, so it is never matched to a different person.

#### Scenario: Cancelled participant
- **WHEN** cancelled participants are excluded and a row's member number belongs to a cancelled participant
- **THEN** the row is not matched and is counted under "matches a cancelled or unconfirmed participant"

#### Scenario: Excluded member number with a matching name
- **WHEN** a row's member number belongs to a cancelled participant, and its name matches a different, available participant
- **THEN** the row is left out as excluded, not matched to the other participant

### Requirement: Counts
The app SHALL show, for each source on its own, how many rows give a unique match, an ambiguous match, no match, and an empty value. It SHALL also show totals for the whole chain: matched (split by the source that matched), ambiguous, unmatched, matching an excluded participant, and rows in conflicts. Counts SHALL update when sources, columns, ranking or resolutions change.

#### Scenario: Totals add up
- **WHEN** the spreadsheet has 250 data rows
- **THEN** matched, ambiguous, unmatched and excluded-participant rows add up to 250

### Requirement: Resolving ambiguous rows
For each ambiguous row the app SHALL list the candidate participants (name, member number and email), and the user SHALL be able to pick one or leave the row out. A pick SHALL be dropped if a later change of sources means that participant is no longer a candidate for the row.

#### Scenario: Picking a sibling
- **WHEN** a row is ambiguous between two siblings and the user picks one
- **THEN** the row counts as matched to that participant

### Requirement: Conflicts
When two or more rows are matched to the same participant, by any source or resolution, those rows SHALL be in conflict and none of them SHALL count as matched until the user picks the row that wins. The user SHALL also be able to skip them all.

#### Scenario: Duplicate row
- **WHEN** rows 12 and 40 both match member 3001234
- **THEN** both are listed as a conflict, and only the row the user picks is matched

### Requirement: Fast matching off the main thread
Matching SHALL run in the spreadsheet worker using lookups built once per participant list and source, never by searching the participant list for each row. Only counts and the rows the page lists SHALL be sent to the page.

#### Scenario: Large import
- **WHEN** a 20,000-row spreadsheet is matched against 20,000 participants
- **THEN** the counts appear without the page freezing, and changing the ranking updates them within about a second

### Requirement: Step completion
Step 3 SHALL be complete when at least one row is matched. Sources, ranking and resolutions SHALL be kept when the user goes back to an earlier step, and re-applied where the columns they use still exist by name.

#### Scenario: Nothing matched
- **WHEN** no row matches
- **THEN** the app says so and the user cannot continue

#### Scenario: Back to step 2 and a new header row
- **WHEN** the user goes back, picks a different header row in which "Medlemsnummer" still exists, and returns
- **THEN** the member-number source still reads "Medlemsnummer", and the counts are recomputed
