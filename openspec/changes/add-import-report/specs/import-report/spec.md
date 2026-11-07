# Spec Delta

## Purpose

Tells the user what an import actually did in Scoutnet, and gives them back the rows that weren't imported, with reasons, so they can fix them and run again.

## ADDED Requirements

### Requirement: Outcome totals
Step 6 SHALL show, from Scoutnet's responses, how many answers were updated, left unchanged, failed, not attempted, and belonged to members Scoutnet reports as not a participant or as no such member. It SHALL also show how many participants were written and how many batches failed. A run that was cancelled or stopped SHALL be shown as such.

#### Scenario: Cancelled run
- **WHEN** the user cancelled after 2 of 4 batches
- **THEN** the report says the run was cancelled and counts the answers of batches 3 and 4 as not attempted

### Requirement: Rows not imported
The user SHALL be able to download an .xlsx file with every spreadsheet row that has something not imported. A row SHALL be included when it was not matched, was ambiguous, excluded, or lost or skipped a conflict, or when any of its mapped answers was skipped as unmapped or invalid, failed, was not attempted, or belonged to a member Scoutnet doesn't know as a participant. Rows whose answers were all updated, unchanged or skipped because the cell was empty SHALL NOT be included.

#### Scenario: Partly imported row
- **WHEN** a row's Mat answer was updated and its Gafflar value "några" was invalid
- **THEN** the row is in the file, with a reason naming Gafflar only

#### Scenario: Fully imported row
- **WHEN** all of a row's mapped answers were updated or unchanged
- **THEN** the row is not in the file

### Requirement: Original columns kept
The file SHALL keep the original header row and every original column in order, with the original cell values. Numbers and dates SHALL stay numbers and dates. A last column "Reason" SHALL be added.

#### Scenario: Reload the file
- **WHEN** the user loads the downloaded file in step 2
- **THEN** its header row is found and its columns have the original names, plus "Reason"

### Requirement: Reason column
For a row-level problem the reason SHALL be "No match", "Ambiguous", "Excluded (cancelled or unconfirmed)" or "Conflict". For answer problems it SHALL list each affected question with "unmapped value", "invalid value", "write failed" with Scoutnet's message, "not attempted" with the cause, or "not a participant", separated by semicolons.

#### Scenario: Write failed
- **WHEN** a row's answer to "Vilka efterrätter…" failed with "Question type (28) not yet supported!"
- **THEN** its reason reads `Vilka efterrätter…: write failed (Question type (28) not yet supported!)`

### Requirement: File stays in the browser
The file SHALL be built in the browser and saved through the browser's download. It SHALL NOT be sent to the server or written to browser storage. Its name SHALL be the original file name with "-not-imported" added before the extension.

#### Scenario: File name
- **WHEN** the spreadsheet was "anmalningar.xlsx"
- **THEN** the download is named "anmalningar-not-imported.xlsx"

### Requirement: Fast export
Building the file SHALL happen off the main thread. With 20,000 rows it SHALL finish within a few seconds, and the page SHALL stay responsive.

#### Scenario: Large file
- **WHEN** 20,000 rows were not imported
- **THEN** the download starts within a few seconds

### Requirement: Read-back verification
Step 6 SHALL offer to verify the write. Verification SHALL refetch the participants and check that every answer reported as updated now reads back as written, comparing text regardless of line-break style and numbers numerically. It SHALL report how many answers were confirmed and list those that were not, with the written and the current value.

#### Scenario: Answer changed afterwards
- **WHEN** a participant changed an answer in Scoutnet after it was written
- **THEN** verification lists that answer as not confirmed, with both values

### Requirement: Starting again
Step 6 SHALL offer a way back to step 5 to review again against fresh data. Outcomes SHALL add up across runs with the same file, matching and mapping, and a later outcome for the same answer SHALL replace the earlier one. A change to the file, matching or mapping SHALL discard them.

#### Scenario: Rerun after a cancel
- **WHEN** the user cancelled after batch 2 of 4, went back to step 5 and wrote the remaining participants
- **THEN** the report counts the answers of all four batches as updated, and none as not attempted

#### Scenario: Mapping changed
- **WHEN** the user changes a mapping in step 4 after a run
- **THEN** the earlier outcomes are discarded
