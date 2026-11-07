# spreadsheet-import Specification

## Purpose

Reads the organiser's spreadsheet in the browser and turns the chosen sheet into named columns and rows with reliable cell values, for matching and mapping in the later steps.

## Requirements

### Requirement: File read in the browser
The app SHALL read the chosen file entirely in the browser. The file and its contents SHALL NOT be sent to the server or written to browser storage.

#### Scenario: Loading a file
- **WHEN** the user picks a spreadsheet file
- **THEN** no request containing the file or its contents is made, and nothing from it is stored in localStorage, sessionStorage or IndexedDB

### Requirement: Supported formats
The app SHALL accept `.xlsx` and `.csv` files, and SHOULD accept `.xls` and `.ods`. CSV files separated by comma or semicolon SHALL both be read correctly, in UTF-8 (with or without BOM) or Windows-1252. A file that cannot be read SHALL produce an error naming the file, and the previous spreadsheet, if any, SHALL stay loaded.

#### Scenario: Semicolon CSV from Swedish Excel
- **WHEN** the user picks a Windows-1252 CSV separated by semicolons containing "Åsa Öberg"
- **THEN** the columns are split on semicolons and the name reads "Åsa Öberg"

#### Scenario: Unreadable file
- **WHEN** the user picks a corrupt or password-protected file
- **THEN** the app shows that the file could not be read, and nothing else changes

### Requirement: Parsing off the main thread
Parsing SHALL run in a Web Worker, and the page SHALL show a progress indicator while it runs. Only the data the page displays SHALL be sent from the worker to the page.

#### Scenario: Large file
- **WHEN** the user picks a 20,000-row file
- **THEN** a progress indicator is shown, and the page stays responsive until the preview appears

### Requirement: Sheet choice
When the file has more than one sheet, the app SHALL let the user choose the sheet, starting with the first non-empty one. When it has one sheet, no choice SHALL be shown.

#### Scenario: Workbook with several sheets
- **WHEN** the file has sheets "Info" (empty) and "Anmälda"
- **THEN** "Anmälda" is selected, and the user can switch to "Info"

### Requirement: Header row guessed and selectable
The app SHALL guess the header row as the first row near the top whose non-empty cells cover most of the table's width and are all text. The user SHALL be able to choose another row, seeing the top rows of the sheet with their row numbers.

#### Scenario: Title above the table
- **WHEN** rows 1–2 hold a title and a note, and row 3 holds "Medlemsnummer", "Förnamn", "Efternamn", "Kost"
- **THEN** row 3 is selected as the header row

#### Scenario: User overrides the guess
- **WHEN** the user selects row 4 as the header row
- **THEN** row 4's values become the column names and the data starts at row 5

### Requirement: Empty rows and columns ignored
Rows and columns with no value in any cell SHALL be ignored, both below and inside the table.

#### Scenario: Blank spacer row and column
- **WHEN** the sheet has an empty row between data rows and an empty column between two filled columns
- **THEN** neither appears in the preview or the counts

### Requirement: Unique column names
A header cell that is empty SHALL get the name "Column <letter>", using the sheet's column letter. When several header cells have the same name, each SHALL be named "<name> (Column <letter>)". Names SHALL be trimmed.

#### Scenario: Empty and duplicate headers
- **WHEN** the header row holds "Namn" in A, nothing in B, and "Namn" in C
- **THEN** the columns are named "Namn (Column A)", "Column B" and "Namn (Column C)"

### Requirement: Cell values
Each cell SHALL keep both its raw value and its displayed text as shown in the spreadsheet. Number-like identifiers SHALL be kept as text: a cell whose displayed text is `0123` or `20100101-1234` SHALL keep exactly that text. Cells formatted as dates in the spreadsheet SHALL be recognised as dates.

#### Scenario: Member number with leading zero
- **WHEN** a member-number cell displays `0012345`
- **THEN** its text value is `0012345`, not `12345`

#### Scenario: Excel date
- **WHEN** a cell holds the serial number 45292 formatted as a date
- **THEN** it is recognised as the date 2024-01-01 and its displayed text is kept as shown

### Requirement: Preview
The app SHALL show the first 10 data rows under the chosen column names, with the total number of data rows and columns, and the file and sheet names.

#### Scenario: Preview after choosing the header row
- **WHEN** the header row is chosen on a sheet with 250 data rows and 6 columns
- **THEN** the preview shows 10 rows under the 6 column names and says "250 rows, 6 columns"

### Requirement: Step completion
Step 2 SHALL be complete once a sheet and header row are chosen and the sheet has at least one data row. The spreadsheet SHALL stay loaded when the user goes back to step 1, and a reload SHALL require the file to be picked again.

#### Scenario: Header row with no data below it
- **WHEN** the chosen header row is the last non-empty row
- **THEN** the app says there are no data rows and the user cannot continue

#### Scenario: Going back to step 1
- **WHEN** the user goes from step 2 back to step 1 and returns
- **THEN** the same file, sheet and header row are still selected
