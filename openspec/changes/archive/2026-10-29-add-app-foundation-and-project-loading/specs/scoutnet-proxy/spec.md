# Spec Delta

## Purpose

Lets the browser reach the Scoutnet API despite its CORS handling. The server forwards each request with the caller's credentials and keeps no data between requests.

## ADDED Requirements

### Requirement: Stateless forwarding
The server SHALL handle each API request using only what that request carries: project ID, API key and target environment. It SHALL NOT keep sessions, caches, databases or files between requests, so any replica can serve any request.

#### Scenario: Requests served by different replicas
- **WHEN** two consecutive requests from the same browser tab reach different server replicas
- **THEN** both succeed with the same result as if one replica had served them

### Requirement: Credentials in headers only
The server SHALL accept the project ID and API key only from request headers, never from the URL or query string. It SHALL forward them to Scoutnet as HTTP Basic authentication, with the project ID as username and the key as password.

#### Scenario: Credentials forwarded as Basic auth
- **WHEN** the browser calls `GET /api/questions` with project ID 1234567 and a key in the request headers
- **THEN** the server calls Scoutnet's `GET /project/get/questions` with a Basic `Authorization` header built from `1234567` and that key

#### Scenario: Missing credentials
- **WHEN** a request to an `/api` route lacks the project ID or the key
- **THEN** the server responds 400 without calling Scoutnet

### Requirement: Allowlisted Scoutnet environments
The server SHALL forward only to the production API (`https://scoutnet.se/api`) or the test API (`https://s1.test.custard.no/api`). The request names the environment, never a URL.

#### Scenario: Test environment selected
- **WHEN** a request names the test environment
- **THEN** the server forwards it to `https://s1.test.custard.no/api`

#### Scenario: Unknown environment
- **WHEN** a request names an environment other than production or test
- **THEN** the server responds 400 without calling any upstream

### Requirement: Questions route
`GET /api/questions` SHALL return the project's forms, and for each form its questions, tabs, sections and answer choices, as read from Scoutnet's `GET /project/get/questions`.

#### Scenario: Project with two forms
- **WHEN** the project has two forms with questions
- **THEN** the response contains both forms, each with its questions grouped by tab and section, and each question's type and choices

### Requirement: Trimmed participants route
`GET /api/participants` SHALL return, per participant, only member number, first name, last name, personnummer, primary email, cancelled state, confirmed state and current question answers. All other fields Scoutnet returns SHALL be dropped.

#### Scenario: Contact info dropped
- **WHEN** Scoutnet returns participants with contact info, membership info and course data
- **THEN** the response contains none of those fields, only the listed ones

### Requirement: Normalised empty shapes
The server SHALL treat Scoutnet's `[]` in place of an empty object, and `null` or an array for the participant collection, as empty. Responses to the browser SHALL always use the same shape.

#### Scenario: Project with no participants
- **WHEN** Scoutnet returns `participants: []` or `participants: null`
- **THEN** `GET /api/participants` returns an empty participant list in its normal shape

#### Scenario: Participant with no answers
- **WHEN** a participant's `questions` is `[]`
- **THEN** that participant is returned with an empty set of answers

### Requirement: Upstream errors passed through distinctly
The server SHALL tell the browser whether Scoutnet rejected the credentials or could not be reached.

#### Scenario: Rejected key
- **WHEN** Scoutnet responds 401
- **THEN** the server responds 401 with an error code meaning the credentials were rejected

#### Scenario: Scoutnet unreachable
- **WHEN** the upstream request fails to connect, times out, or Scoutnet responds 5xx
- **THEN** the server responds 502 with an error code meaning Scoutnet could not be reached

### Requirement: No sensitive logging
The server SHALL NOT log `Authorization` headers, API keys, request or response bodies, or participant data. Error logs SHALL contain only status code, route and project ID.

#### Scenario: Failed upstream call is logged
- **WHEN** a forwarded request fails
- **THEN** the log line contains the status code, route and project ID, and no key, header value or body content

### Requirement: Serves the frontend
The server SHALL serve the built frontend. Any non-API `GET` path that is not a static file SHALL return `index.html`, so client-side routes load directly.

#### Scenario: Deep link to a wizard step
- **WHEN** a browser requests `/match` directly
- **THEN** the server returns `index.html` with status 200

#### Scenario: Unknown API route
- **WHEN** a browser requests `/api/does-not-exist`
- **THEN** the server responds 404, not `index.html`

### Requirement: Health endpoint
The server SHALL respond to `GET /healthz` with 200 without calling Scoutnet.

#### Scenario: Probe while Scoutnet is down
- **WHEN** Scoutnet is unreachable and a probe calls `/healthz`
- **THEN** the server responds 200
