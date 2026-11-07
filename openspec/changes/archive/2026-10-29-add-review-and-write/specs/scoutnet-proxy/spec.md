# Spec Delta

## ADDED Requirements

### Requirement: Answers route
`PUT /api/answers` SHALL accept answers as member number → question ID → value, with numeric member numbers and question IDs and string values. It SHALL forward them to Scoutnet's `PUT /project/checkin`. The server SHALL build the Scoutnet body itself from those answers alone, so it never carries `checked_in`, `attended` or any other field.

#### Scenario: Answers forwarded
- **WHEN** the browser sends answer "80922" for question 120787 of member 3320347
- **THEN** Scoutnet receives exactly `{"3320347":{"questions":{"120787":{"value":"80922"}}}}`

#### Scenario: Extra fields rejected
- **WHEN** the request body also contains `checked_in` for a member
- **THEN** the server responds 400 without calling Scoutnet

#### Scenario: Too many members
- **WHEN** a request carries more than 1,000 members
- **THEN** the server responds 400 without calling Scoutnet

### Requirement: Answer results passed back
On success the answers route SHALL return, per member and question, whether Scoutnet updated the answer or left it unchanged, together with the member numbers Scoutnet reports as not a participant and as no such member.

#### Scenario: Unchanged answer
- **WHEN** Scoutnet reports `null` for a question under `updated_questions`
- **THEN** that answer is returned as unchanged

### Requirement: Rejected answers passed back
When Scoutnet rejects a write with 400, the answers route SHALL respond 400 with the error code `answers_rejected`. It SHALL include Scoutnet's messages per member and question when Scoutnet gives them, and otherwise Scoutnet's general message.

#### Scenario: Unsupported question type
- **WHEN** Scoutnet answers `{"errors":{"3320347":{"120794":"Question type (28) not yet supported!"}}}`
- **THEN** the server responds 400 with `answers_rejected` and that message for member 3320347, question 120794
