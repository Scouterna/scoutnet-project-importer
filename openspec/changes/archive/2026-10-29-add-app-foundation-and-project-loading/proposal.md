# Proposal

## Why

Event organisers hold participant data in spreadsheets that has to be typed into Scoutnet by hand. Every later step of the importer (spreadsheet import, matching, mapping, write-back) needs two things first: a way to reach the Scoutnet API from the browser, and the project's questions and participants loaded into memory. Scoutnet answers CORS preflight requests with 401, so the browser cannot call it directly. This change builds that base.

## What Changes

- New repository scaffold: a single pnpm package holding a Hono server (`server/`) and a Vite + React single-page app (`web/`), on Node 26 with native type stripping for the server.
- A stateless server that forwards read requests to Scoutnet with the caller's credentials as Basic auth. It stores nothing and never logs credentials, bodies or participant data.
- Server routes `GET /api/questions` and `GET /api/participants`. The participants route trims Scoutnet's response down to the fields the importer needs.
- The server also serves the built frontend, falls back to `index.html` for client routes, and exposes `/healthz`.
- A wizard shell with the six steps as routes. Only step 1 is functional; steps 2–6 are placeholders filled by later changes.
- Step 1, Load project: project ID or URL input, an API key per endpoint, named and ordered as in Scoutnet, a choice of production or test server, loading with clear error messages, and a summary of what was loaded.
- A container image built in two stages from `node:26-slim`, running as a non-root user.

Out of scope here: the write route (`PUT /api/answers`) and steps 2–6, which come in later changes.

## Capabilities

### New Capabilities

- `scoutnet-proxy`: The server's contract. It forwards requests to Scoutnet without keeping state, trims participant data, handles credentials and logging safely, and serves the app and its health endpoint.
- `import-wizard`: The six ordered steps, the rule that a step opens only after the ones before it, and going back without losing earlier work.
- `project-loading`: Step 1 of the wizard. It identifies the project, collects and holds credentials for the tab, picks the environment, loads questions and participants, and reports the result or the error.

### Modified Capabilities

None. This is the first change in the project.

## Impact

- New code: `server/`, `web/`, `shared/`, `package.json`, `tsconfig.json`, `vite.config.ts`, `Dockerfile`.
- New dependencies: `hono`, `@hono/node-server`, `@scouterna/scoutnet`, `react`, `react-dom`, `@tanstack/react-router`, `@tanstack/react-query`, `@mui/material`, `@emotion/react`, `@emotion/styled`, `vite`, `@vitejs/plugin-react`, `vitest`, `typescript`.
- External system: Scoutnet API (`https://scoutnet.se/api`) and its test server (`https://s1.test.custard.no/api`). Read endpoints only.
