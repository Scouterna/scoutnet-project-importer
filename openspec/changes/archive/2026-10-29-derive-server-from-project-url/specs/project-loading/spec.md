# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Environment choice
**Reason**: The project URL already names the server, so a separate switch is redundant and can contradict it.
**Migration**: Paste the project's URL from the test server to use the test server. Builds no longer need `VITE_ENABLE_ENV_SWITCH`.
