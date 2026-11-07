# Proposal

## Why

Step 1 has a production/test switch that only shows in development builds or when the frontend is built with `VITE_ENABLE_ENV_SWITCH=true`. The project URL the user pastes already names the server, so the switch is an extra choice that can contradict the URL, and it needs a special build to reach the test server.

## What Changes

- The server is taken from the project field. A URL on `s1.test.custard.no` uses the test server; a URL on `scoutnet.se` uses production. A plain project ID, or a URL without a host, falls back to production.
- A URL on any other host is rejected with an error, instead of silently loading from production.
- The helper text under the project field names the server, for example "Project 1234567 on the test server".
- **BREAKING (build):** the env switch and the `VITE_ENABLE_ENV_SWITCH` build flag are removed, along with the Dockerfile build arg and the README section.
- The environment is no longer saved for the tab on its own; it follows from the saved project field.

The server is unchanged: it still takes the environment name in `X-Scoutnet-Env` and forwards only to the two allowlisted APIs.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `project-loading`: the project field also picks the server, the API-page link follows it, and the environment switch is removed.

## Impact

- Code: `shared/env.ts`, `shared/project-id.ts` (and its tests), `web/wizard-store.ts`, `web/pages/load-project.tsx`, `web/vite-env.d.ts`.
- Build: `Dockerfile` drops `ARG VITE_ENABLE_ENV_SWITCH`; `README.md` drops the env-switch section.
- No server or dependency changes.
