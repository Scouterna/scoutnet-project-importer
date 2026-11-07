# Spec Delta

## ADDED Requirements

### Requirement: Participants without a row
Step 3 SHALL list the participants in the pool that no row is matched to, with name, member number and email, and show how many there are. A participant that is a candidate of an ambiguous row, or that rows point to in an unresolved or skipped conflict, SHALL be marked as such. Participants left out of the pool in step 1 SHALL NOT be listed. The list SHALL update with the match and be computed in the spreadsheet worker.

#### Scenario: Participant missing from the file
- **WHEN** the event has 30 participants in the pool and the spreadsheet's rows match 28 of them
- **THEN** the list shows the other 2

#### Scenario: Unresolved ambiguous row
- **WHEN** two siblings share an email and the only row for them is ambiguous
- **THEN** both are listed, each marked as a candidate of an ambiguous row, and picking one in the ambiguous list removes that sibling from this list

#### Scenario: Cancelled participant
- **WHEN** a cancelled participant has no row and cancelled participants are left out in step 1
- **THEN** that participant is not listed
