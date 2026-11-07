# import-wizard Specification

## Purpose

Guides the user through an import as an ordered series of steps, so nothing is skipped and earlier choices can be revisited.

## Requirements

### Requirement: Wizard step order
The app SHALL present the import as six ordered steps: load project, load spreadsheet, match rows, map answers, review and write, report. A step SHALL be reachable only after the steps before it are complete, and the user SHALL be able to go back to any earlier step.

#### Scenario: Skipping ahead
- **WHEN** no project is loaded and the user opens the URL of step 3
- **THEN** the app takes the user to step 1

#### Scenario: Going back
- **WHEN** the user is on step 2 and goes back to step 1
- **THEN** the loaded project, its summary and the entered keys are still shown
