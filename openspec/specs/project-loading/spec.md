# project-loading Specification

## Purpose

Step 1 of the importer wizard. The user identifies a Scoutnet project and gives its API keys, and the app loads the project's questions and participants into browser memory for the later steps.

## Requirements

### Requirement: Project ID from ID or URL
The project field SHALL accept a plain numeric ID, or any text containing `/activities/view/<id>`, with or without scheme, host or fragment. The extracted ID SHALL be shown back to the user as "Project <id>", together with the server it will be loaded from.

#### Scenario: Plain ID
- **WHEN** the user enters `1234567`
- **THEN** the app uses project ID 1234567 and shows "Project 1234567 on production"

#### Scenario: Pasted URL without scheme
- **WHEN** the user pastes `scoutnet.se/activities/view/1234567`
- **THEN** the app uses project ID 1234567 and shows "Project 1234567 on production"

#### Scenario: Full URL with fragment
- **WHEN** the user pastes `https://scoutnet.se/activities/view/1234567#project_tabmenu_tab_api_pane`
- **THEN** the app uses project ID 1234567

#### Scenario: No recognisable ID
- **WHEN** the user enters `scoutnet.se/activities` or `abc`
- **THEN** the app shows an error and does not allow loading

### Requirement: Link to the project's API page
Once a project ID is known, the app SHALL show a link to that project's API page in Scoutnet, on the server taken from the project field, so the user can find the keys.

#### Scenario: Link shown for production
- **WHEN** the user enters `1234567`
- **THEN** the app links to `https://scoutnet.se/activities/view/1234567#project_tabmenu_tab_api_pane`

#### Scenario: Link shown for the test server
- **WHEN** the user pastes `https://s1.test.custard.no/activities/view/1234`
- **THEN** the app links to `https://s1.test.custard.no/activities/view/1234#project_tabmenu_tab_api_pane`

### Requirement: One API key per endpoint
The app SHALL collect a separate key for each endpoint it uses, listed with the endpoint names and in the order shown on the project's API page in Scoutnet: members, check-in, questions. Each request SHALL be sent with its own endpoint's key.

#### Scenario: Separate keys
- **WHEN** the user enters different keys for questions and participants
- **THEN** each request is sent with its own endpoint's key

#### Scenario: Field order
- **WHEN** the user opens step 1
- **THEN** the key fields are labelled "Get a list of members who are registered on the project", "Update the check-in state of participant(s) on the project" and "Get questions and accepted values for questionnaire or group questions", in that order

### Requirement: Keys held for the tab only
Key inputs SHALL be masked. Keys SHALL be kept only in memory or session storage for the current tab and never saved beyond it. A "forget keys" action SHALL clear them everywhere the app holds them.

#### Scenario: Forget keys
- **WHEN** the user clicks "forget keys"
- **THEN** all key fields are empty, no key remains in session storage, and a reload shows empty key fields

#### Scenario: New tab
- **WHEN** the user opens the app in a new tab
- **THEN** no previously entered key is filled in

### Requirement: Server taken from the project URL
The app SHALL load from the Scoutnet server named by the host of a pasted project URL: `s1.test.custard.no` means the test server, and `scoutnet.se` or `www.scoutnet.se` means production. A plain ID, or a URL without a host, SHALL use production. A URL with any other host SHALL be rejected. The app SHALL NOT offer a separate server switch.

#### Scenario: Test server URL
- **WHEN** the user pastes `s1.test.custard.no/activities/view/1234` and loads
- **THEN** questions and participants are loaded from the test server, and the app shows "Project 1234 on the test server"

#### Scenario: Plain ID falls back to production
- **WHEN** the user enters `1234567` and loads
- **THEN** questions and participants are loaded from production

#### Scenario: Unknown host
- **WHEN** the user pastes `https://example.com/activities/view/1234567`
- **THEN** the app shows an error saying the address is not a Scoutnet server and does not allow loading

#### Scenario: Changing the server clears the loaded project
- **WHEN** project 1234 is loaded from the test server and the user replaces the field with `1234`
- **THEN** the loaded summary is cleared and the user must load again

### Requirement: Loading questions and participants
Loading SHALL fetch the project's questions and participants and keep them in browser memory for the rest of the session, without refetching unless the user asks or a later step requires it. Participant data SHALL NOT be written to browser storage.

#### Scenario: Successful load
- **WHEN** the user loads project 1234567 with valid keys
- **THEN** the app shows the number of participants, forms and questions, and lets the user continue to step 2

#### Scenario: Reload of the page
- **WHEN** the user reloads the page after a successful load
- **THEN** no participant data is restored from browser storage

### Requirement: Distinct load errors
Load errors SHALL say whether a key was rejected, and for which endpoint, or whether Scoutnet could not be reached.

#### Scenario: Rejected participants key
- **WHEN** the questions request succeeds and the participants request is rejected with 401
- **THEN** the app says the participants key was rejected and does not continue to step 2

#### Scenario: Scoutnet unreachable
- **WHEN** the server reports that Scoutnet could not be reached
- **THEN** the app says Scoutnet is unreachable and offers to try again

### Requirement: Cancelled and unconfirmed participants excluded by default
Cancelled participants and unconfirmed participants SHALL be excluded from the set used for matching by default, each with its own option to include them. The summary SHALL show how many are cancelled and how many are unconfirmed. A participant who is both is excluded unless both options allow it.

#### Scenario: Default exclusion
- **WHEN** a project has 500 participants of whom 20 are cancelled and 10 are unconfirmed, with no overlap
- **THEN** the summary shows 500 participants with 20 cancelled and 10 unconfirmed, and 470 are available for matching

#### Scenario: Including cancelled
- **WHEN** the user turns on "include cancelled participants"
- **THEN** the 20 cancelled participants become available for matching, and the 10 unconfirmed stay excluded

#### Scenario: Including unconfirmed
- **WHEN** the user turns on "include unconfirmed participants"
- **THEN** the 10 unconfirmed participants become available for matching, and the 20 cancelled stay excluded

#### Scenario: Cancelled and unconfirmed
- **WHEN** a participant is both cancelled and unconfirmed and only "include cancelled participants" is on
- **THEN** that participant is not available for matching
