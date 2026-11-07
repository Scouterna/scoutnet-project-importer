# answer-mapping Specification

## Purpose

Turns the matched spreadsheet rows into answers Scoutnet accepts, per question, so that only valid, confirmed values are ever written.

## Requirements

### Requirement: Importable question types
The app SHALL treat questions of type text, number, yes/no (`boolean`) and single choice as importable. A choice question SHALL count as multiple choice when any participant's current answer to it is a list of options. Multiple-choice, date and time questions (`other_unsupported_by_api`) and any unknown type SHALL be listed as not importable, with the reason, and SHALL NOT be selectable.

#### Scenario: Multiple-choice question
- **WHEN** a choice question has a participant whose current answer is a list of two option ids
- **THEN** the question is listed as not importable because Scoutnet cannot write multiple-choice answers

#### Scenario: Date question
- **WHEN** a question has type `other_unsupported_by_api`
- **THEN** it is listed as not importable and cannot be paired with a column

#### Scenario: Choice question nobody has answered
- **WHEN** a choice question has no answers yet
- **THEN** it is importable as single choice, with a note that Scoutnet rejects the write if the question is in fact multiple choice

### Requirement: Questions hidden from the API
The step SHALL tell the user that a question missing from the list must have "Inkludera svar i API" ticked in Scoutnet's form editor, and that the project must then be loaded again.

#### Scenario: Missing question
- **WHEN** the user opens step 4
- **THEN** a hint explains how to make a missing question appear

### Requirement: Pairing columns with questions
The user SHALL pair spreadsheet columns with importable questions, or leave a column unmapped. A column SHALL map to at most one question and a question SHALL take at most one column. Questions SHALL be shown grouped by form, tab and section, in Scoutnet's order.

#### Scenario: Question already taken
- **WHEN** column "Kost" is paired with question "Mat"
- **THEN** "Mat" cannot be chosen for another column until it is unpaired

#### Scenario: Columns used for matching
- **WHEN** a column is used as a match source in step 3
- **THEN** it can still be paired with a question

### Requirement: Suggested pairings
On first entry the app SHALL suggest a question for each column whose header equals a question label, or contains it or is contained in it, after ignoring case, surrounding spaces and punctuation. A question SHALL be suggested for at most one column. Suggestions SHALL be shown as such until the user keeps or changes them.

#### Scenario: Header equals label
- **WHEN** the spreadsheet has a column "mat" and the project a question "Mat"
- **THEN** the column is suggested for that question

#### Scenario: No similar label
- **WHEN** no question label resembles a column header
- **THEN** the column starts unmapped

### Requirement: Free-text values
For a text question the answer SHALL be the cell's text, trimmed, with line breaks kept. A value equal to the current answer, ignoring the kind of line break, SHALL count as unchanged.

#### Scenario: Line breaks
- **WHEN** a cell holds two lines and the current answer holds the same two lines separated by `\r\n`
- **THEN** the answer counts as unchanged

### Requirement: Number values
For a number question the app SHALL accept whole and decimal numbers written with a comma or a point as decimal separator, with optional spaces as thousands separators, and numeric cells as they are. Any other value SHALL be invalid and never written.

#### Scenario: Swedish decimal
- **WHEN** a cell holds "2,5"
- **THEN** the answer is the number 2.5

#### Scenario: Not a number
- **WHEN** a cell holds "några"
- **THEN** the row is skipped for that question as invalid

### Requirement: Yes/no values
For a yes/no question the app SHALL map Ja, Yes, x, 1, TRUE and true cell values to checked and Nej, No, 0, FALSE and false to unchecked, ignoring case and surrounding spaces. Other values SHALL go to the distinct-value table with Yes and No as the options.

#### Scenario: Recognised variant
- **WHEN** a cell holds "JA"
- **THEN** the answer is checked without needing confirmation

#### Scenario: Unrecognised value
- **WHEN** a cell holds "kanske"
- **THEN** "kanske" appears in the value table and is not written until mapped

### Requirement: Distinct-value table
Single-choice questions and unrecognised yes/no values SHALL be mapped through a table with one row per distinct value, not per spreadsheet row. Values that differ only in case, surrounding spaces or punctuation SHALL be grouped, with their variants listed. Each row SHALL show the value, its number of rows, the chosen option and a status. The table SHALL be sorted by row count, most common first, and SHALL be searchable.

#### Scenario: Variants grouped
- **WHEN** a column holds "Vego" in 10 rows and "vego." in 2 rows
- **THEN** the table has one row "Vego" with 12 rows and lists "vego." as a variant

### Requirement: Automatic and suggested options
A value equal to an option label after the same grouping SHALL be mapped to it as certain. A value that only resembles one option, by one being a prefix of the other or by a small spelling difference, SHALL get that option pre-selected as an unconfirmed suggestion. The user SHALL be able to confirm a suggestion, all suggestions at once, or choose another option. Many values MAY map to the same option.

#### Scenario: Spelling variants
- **WHEN** a diet column holds "Vegetarisk" (412 rows), "veg" (37) and "Vego" (19), and an option is labelled "Vegetarisk"
- **THEN** "Vegetarisk" is mapped as certain, "veg" and "Vego" are suggested for the same option, and none of the 56 suggested rows is written until the user confirms

### Requirement: Bulk value actions
The value table SHALL offer to map all remaining unmapped values to one chosen option, and to skip all remaining values.

#### Scenario: Skip the rest
- **WHEN** the user picks "skip all remaining" with three values unmapped
- **THEN** all three are marked skipped and their rows are counted as skipped

### Requirement: Only confirmed values are written
Unmapped, unconfirmed, skipped and invalid values SHALL never become answers. Their rows SHALL be counted per question in the preview and listed with their reason.

#### Scenario: Unconfirmed suggestion
- **WHEN** "veg" has an unconfirmed suggestion
- **THEN** its 37 rows are counted as skipped because the value is unmapped

### Requirement: Empty cells
Each mapped column SHALL have an empty-cell rule. The default SHALL be to skip, leaving the current answer as it is. For text and number questions the user MAY choose to clear the answer instead, and for yes/no questions to set it to No. Single-choice questions SHALL only skip.

#### Scenario: Clear text
- **WHEN** a text column's rule is "clear" and a matched row's cell is empty while the current answer is "Inception"
- **THEN** that answer is counted as cleared

### Requirement: Existing answers
Each mapped column SHALL have an existing-answer rule: overwrite (default), or only fill answers that are currently empty. Under "only fill empty", a participant with a current answer SHALL be counted as unchanged for that question.

#### Scenario: Fill empty only
- **WHEN** the rule is "only fill empty" and the participant's current answer is "Kött"
- **THEN** the answer is not changed even though the cell says "Vego"

### Requirement: Preview per question
For each mapped question the step SHALL show how many answers will be newly set, overwritten, cleared and left unchanged, and how many rows are skipped because the cell is empty, or because the value is unmapped or invalid. Only rows matched in step 3 SHALL count. The figures SHALL update when a mapping or rule changes.

#### Scenario: Counts add up
- **WHEN** 800 rows are matched and a question's preview is shown
- **THEN** its counts add up to 800

### Requirement: Fast mapping off the main thread
Value tables and previews SHALL be computed off the main thread, without sending the spreadsheet rows or participants' answers to the page beyond what is displayed. With 20,000 matched rows, a change SHALL update the preview in under a second.

#### Scenario: Large file
- **WHEN** 20,000 rows are matched and the user maps a value
- **THEN** the preview updates within a second and the page stays responsive

### Requirement: Step completion
Step 4 SHALL be complete when at least one answer would be set, overwritten or cleared. Mappings SHALL be kept in memory when the user goes back and returns with the same file, and SHALL never be written to browser storage.

#### Scenario: Nothing to change
- **WHEN** every mapped answer is unchanged or skipped
- **THEN** Continue is disabled and the step says that nothing would change
