# Design

## Context

Step 1 stored `env` in the wizard store, showed a production/test toggle when `envSwitchEnabled` was true, and persisted `env` to sessionStorage. The server already allowlists the two environments by name via `X-Scoutnet-Env`; nothing about that changes.

## Decisions

### Parse ID and server together
`shared/project-id.ts` exports `parseProject(input)`, returning `{ ok: true, id, env }` or `{ ok: false, reason: "no_id" | "unknown_host" }`, and replaces `parseProjectId`. Host matching is on the lowercased hostname, with or without scheme, with userinfo and port stripped:

| Host | env |
|---|---|
| none (plain ID, or path only) | `production` |
| `scoutnet.se`, `www.scoutnet.se` | `production` |
| `s1.test.custard.no` | `test` |
| anything else | `unknown_host` |

The hosts come from `hostEnvs` in `shared/env.ts`, built from `siteOrigins` plus the `www` alias, so there is one list. The ID is checked first, so input with no ID reports `no_id` whatever its host.

Rejecting unknown hosts, instead of falling back, avoids a user pasting a URL from some other site and unknowingly loading from production. It also keeps the frontend in line with the server's allowlist: a new test server is added to `shared/env.ts`, which both sides read.

### Env derived, not stored
`env` leaves `WizardState` and the persisted entry; `setEnv` goes away. The page derives it from `projectInput` with `parseProject`. `loaded` keeps `{ projectId, env }`, and the store clears it when the input no longer parses, or its ID or env differs. An old saved entry that still has `env` loads with that field ignored.

### Removed build flag
`envSwitchEnabled`, `VITE_ENABLE_ENV_SWITCH` (in `vite-env.d.ts`, Dockerfile `ARG`, README) and the toggle UI are deleted.

## Risks / Trade-offs

- A test-server user who typed only the ID now gets production. The helper text names the server ("Project 1234567 on production" vs "… on the test server") so this is visible before loading, and a wrong-server load fails with rejected keys rather than touching data.
- Any other test server must be added to `shared/env.ts` before it can be used. This is deliberate: the server must not forward to arbitrary hosts.
