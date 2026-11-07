# answer-writing Specification

## Purpose

Shows the user exactly what an import will change, and after explicit confirmation writes only those changes to Scoutnet, reliably and with a record of every answer's outcome.

## Requirements

### Requirement: Fresh data before review
On entering step 5 the app SHALL refetch the participants and recompute the changes against their current answers. It SHALL show when the list was fetched and offer a refresh that does the same.

#### Scenario: Answer edited meanwhile
- **WHEN** a participant changed their answer in Scoutnet after step 1 to the value the spreadsheet holds
- **THEN** step 5 counts that answer as unchanged

### Requirement: Change summary
Step 5 SHALL show how many participants will change, and how many answers will be set, overwritten, cleared and skipped. It SHALL show a list of answers with participant, question, current value and new value, with choice answers shown by option label. By default the list SHALL show only answers that will be set, overwritten or cleared, with a switch to show all, including skipped and unchanged answers. The switch SHALL NOT affect what is written.

#### Scenario: Default filter
- **WHEN** 900 answers are unchanged and 300 change
- **THEN** the list shows the 300 changes until the user turns off hiding answers that won't be updated

### Requirement: Check-in key
Writing SHALL use the check-in key. If step 1 left it empty, step 5 SHALL ask for it before anything can be written.

#### Scenario: Key missing
- **WHEN** the check-in key is empty
- **THEN** the write and test buttons are disabled and a key field is shown

### Requirement: Explicit confirmation
Nothing SHALL be written until the user confirms a dialog that states the number of answers and participants, for example "Update 1,240 answers for 812 participants".

#### Scenario: Cancel the dialog
- **WHEN** the user closes the confirmation dialog
- **THEN** no request is sent to Scoutnet

### Requirement: Single-participant test
The user SHALL be able to write one chosen participant's changes first. The write SHALL need confirmation, as a full write does. After it, the app SHALL refetch and report for each answer whether it now reads back as written.

#### Scenario: Number written as expected
- **WHEN** the test writes "2.5" to a number question and Scoutnet then returns "2.5"
- **THEN** that answer is reported as confirmed

#### Scenario: Value reads back differently
- **WHEN** an answer reads back different from what was written
- **THEN** that answer is reported as not confirmed, with both values

### Requirement: Only changed answers are sent
Only answers that will be set, overwritten or cleared SHALL be sent, and only participants with at least one such answer. Request bodies SHALL carry question answers only.

#### Scenario: Unchanged participant
- **WHEN** all of a participant's mapped answers are unchanged
- **THEN** that participant is not part of any request

### Requirement: Sequential batches
Changed participants SHALL be written in batches of a configurable size, 100 by default and with no upper limit, one request at a time. A progress bar SHALL show batches and answers done. While writing, closing or reloading the tab SHALL prompt a warning.

#### Scenario: Progress
- **WHEN** 812 participants are written with batch size 250
- **THEN** four requests are sent one after another and progress advances after each

### Requirement: Cancel
The user SHALL be able to cancel a run. The current batch SHALL finish and no further batch SHALL start. Answers not sent SHALL be recorded as not attempted.

#### Scenario: Cancel mid-run
- **WHEN** the user cancels during batch 2 of 4
- **THEN** batch 2 completes, batches 3 and 4 are not sent, and their answers are recorded as not attempted

### Requirement: Rejected answers isolated
When Scoutnet rejects a batch and names the answers at fault, the app SHALL record those answers as failed with Scoutnet's message and resend the rest of the batch once.

#### Scenario: Multiple-choice question in a batch
- **WHEN** a batch of 250 is rejected because one member's answer to a multiple-choice question is unsupported
- **THEN** that answer is recorded as failed, and the batch is resent without it

### Requirement: Failed batches
A batch that fails for any other reason SHALL be recorded as failed and the run SHALL continue with the next batch. At the end the user SHALL be able to retry the failed batches. If Scoutnet rejects the check-in key, the run SHALL stop and say so.

#### Scenario: Scoutnet unreachable for one batch
- **WHEN** batch 3 of 4 fails because Scoutnet cannot be reached
- **THEN** batch 4 is still sent, and afterwards "Retry failed batches" resends batch 3

#### Scenario: Wrong key
- **WHEN** the first batch is answered with rejected credentials
- **THEN** the run stops and asks the user to check the check-in key

### Requirement: Answer outcomes
After a run the app SHALL know, for every answer it intended to write, whether it was updated, left unchanged, failed (with the reason), not attempted, or belonged to a member Scoutnet reports as not a participant or no such member. These outcomes SHALL be kept in memory only.

#### Scenario: Member not on the project
- **WHEN** Scoutnet reports member 3000616 as not found
- **THEN** each of that member's answers is recorded as "not a participant"

### Requirement: Rerun is the recovery path
Running the import again SHALL write only what still differs, because the review always starts from freshly fetched answers.

#### Scenario: Tab closed halfway
- **WHEN** the user closes the tab after 30 of 80 batches and later runs the same import again
- **THEN** the review shows only the participants from the remaining 50 batches as changed

### Requirement: Step completion
Step 5 SHALL be complete when a run has ended, whether finished, cancelled or stopped, and at least one batch was sent. The report step SHALL then be reachable.

#### Scenario: Run finished
- **WHEN** the last batch has been answered
- **THEN** Continue to the report is enabled
