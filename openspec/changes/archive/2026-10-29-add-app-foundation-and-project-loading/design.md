# Design

## Context

The repository is empty apart from OpenSpec. See proposal.md (Why) for motivation and the three specs for required behaviour. Fixed constraints: Node 26 with native type stripping on the server (erasable syntax only, `.ts` import extensions, no build step), a stateless server, and React with the TanStack libraries on the frontend.

Facts found in `@scouterna/scoutnet` 0.3.26 that shape the approach:

- The client wraps `openapi-fetch` and exposes `createClient({ baseUrl })` and `createAuthorizationHeader({ resourceId, key })`. Its README states each endpoint has its own key.
- `GET /project/get/questions` without `form_id` returns `forms`. The OpenAPI description says the details of a form (questions, tabs, sections) are included only when `form_id` is given.
- Its `onResponse` hook calls `console.log('res', ok, content-length)`. It logs no secrets, but adds a line per request.

## Goals / Non-Goals

**Goals:**
- A layout that later changes (worker, matching, write-back) extend without restructuring.
- End-to-end types from Hono routes to the frontend.
- Pure, unit-tested functions for everything with rules: ID parsing, Scoutnet shape normalisation, participant trimming, error mapping.

**Non-Goals:**
- Web Worker, SheetJS, TanStack Table/Virtual. They arrive with the spreadsheet and matching changes.
- `PUT /api/answers`. The check-in key is collected now but not used or validated until the write-back change.
- Kubernetes manifests. This change ships the image and `/healthz` only.

## Decisions

### Single package, three source folders
`server/` (Hono, run as `node server/index.ts`), `web/` (Vite root), `shared/` (types and pure functions used by both, such as response shapes and error codes). One `package.json` and one pnpm lockfile.
*Alternative:* a pnpm workspace with `apps/*` and `packages/*`. Rejected for now: one deployable and one team, and the split costs config with no payoff. Moving to a workspace later is mechanical.

### Two tsconfigs
`tsconfig.json` at the root covers `server/` and `shared/` with `erasableSyntaxOnly`, `allowImportingTsExtensions`, `noEmit`, `module: nodenext`, and `verbatimModuleSyntax`. `web/tsconfig.json` adds DOM libs and `jsx: react-jsx`, using bundler resolution. Both are checked by `pnpm typecheck` (`tsc -p . && tsc -p web`).
`shared/` follows the strictest rules (erasable syntax, `.ts` imports) so both sides can import it.

### Credential and environment headers
Each API call carries `X-Scoutnet-Project` (numeric ID), `X-Scoutnet-Key` (the key for that endpoint), and `X-Scoutnet-Env` (`production` | `test`). The server validates all three with one middleware, which returns 400 with error code `bad_request`. Each Scoutnet-backed route registers it explicitly instead of `/api/*` as a whole, so unknown API paths still get 404. It then builds the Basic header with `createAuthorizationHeader` and picks the base URL from a fixed map.
*Alternative:* the browser sends a ready-made `Authorization` header. Rejected: the server would have to parse it back to log the project ID, and passing it through as-is invites logging middleware to capture it.

### One Scoutnet client per request
`createClient({ baseUrl })` is called per request from the env map. It is cheap and keeps the server free of shared state. The client's `fetch` is injectable, which lets tests stub Scoutnet without the network.

### Questions route fans out per form
`/api/questions` first fetches the form list, then fetches each form with `form_id` in parallel, and merges the results into one normalised response: `{ forms: [{ id, title, tabs, sections, questions: [{ id, label, description, type, tabId, sectionId, choices: [{ id, label }] }] }] }`. All of this uses the questions key.
Confirmed by the user (2026-10-29): questions are only returned per form, so the fan-out is required.

### Normalisation and trimming in `shared/scoutnet/`
`asRecord(value)` maps `[]`, `null` and `undefined` to `{}` and passes objects through. `trimParticipant` keeps `memberNo` (as a string), `firstName`, `lastName`, `ssno`, `email`, `cancelled`, `confirmed` (only an explicit `false` from Scoutnet counts as unconfirmed, so a missing field never hides everyone) and `answers` (`Record<questionId, string | null>`). `/api/participants` returns `{ participants: TrimmedParticipant[], fetchedAt }`. An array is easier for the frontend to count and index than Scoutnet's keyed object.

### Error codes
A shared union: `bad_request` (400), `credentials_rejected` (401), `upstream_unreachable` (502), `not_found` (404). The server maps a Scoutnet 401 to `credentials_rejected`, and a network error, timeout (30 s via `AbortSignal.timeout`) or 5xx to `upstream_unreachable`. Other 4xx responses become `upstream_unreachable` with the status logged. The frontend names the endpoint from which call failed, since each call uses one key.

### Logging
Hono's `logger()` middleware is not used. A small middleware logs only `method route status projectId` on error responses. A unit test asserts that no log line contains the key, the Basic header or participant names. The upstream `console.log` is reported to scoutnet-api (task 7.2) instead of being patched locally.

### Static serving
`serveStatic` from `@hono/node-server` serves `dist/web`. A catch-all `GET *` returns `dist/web/index.html`, registered after `/api/*` and `/healthz`. `/api/*` has its own `notFound` that returns JSON 404, so unknown API paths never get the HTML.

### Development flow
`pnpm dev` runs `node --watch server/index.ts` (port 3000) and `vite` (port 5173) side by side. Vite proxies `/api` to 3000. The env switch shows when `import.meta.env.DEV` is true or `VITE_ENABLE_ENV_SWITCH=true` was set at build time.

### Frontend structure
- **Router:** TanStack Router with code-based routes. Routes `/` (step 1), `/spreadsheet`, `/match`, `/map`, `/review`, `/report`. Code-based keeps the build free of a route codegen plugin for six fixed routes. Each later step's `beforeLoad` redirects to the first incomplete step (import-wizard spec).
- **Wizard state:** a small module store (`useSyncExternalStore`) holds project input, env, keys and the include-cancelled and include-unconfirmed flags. It is not React context, so `beforeLoad` can read it outside components. Only `keys`, `env` and the project input are mirrored to `sessionStorage`, under one key that "forget keys" removes.
- **Data:** TanStack Query with `staleTime: Infinity` and `gcTime: Infinity`, keyed by `[env, projectId, 'questions' | 'participants']`. Step 1 "Load" calls `fetchQuery` for both in parallel. Query data lives in memory only; no persister is configured.
- **API module:** `web/api.ts` is the only place that calls the server. It wraps Hono's `hc<AppType>` (type import from `server/app.ts`), adds the three headers, and turns error bodies into typed errors.
- **UI:** MUI (`@mui/material` with Emotion). It covers forms, steppers, alerts and dialogs out of the box, which is most of what this wizard needs. *Alternative:* `@scouterna/ui-react`, Scouterna's design system. Not chosen: MUI is simpler for a form-heavy internal tool. Large tables still use TanStack Table/Virtual, styled with MUI.

### Project ID parsing
`parseProjectId(input)` in `shared/` trims the input, accepts `^\d+$`, or else finds `/activities/view/(\d+)` anywhere in the string. It returns the ID as a string, or `null`. The API-page link is `<origin>/activities/view/<id>#project_tabmenu_tab_api_pane`. The origin is `https://scoutnet.se` for production and `https://s1.test.custard.no` for test.

### Testing
Vitest for `shared/` and the server. Server routes are tested with `app.request()` and a stubbed `fetch` given to the client factory. Frontend logic (the store, the route guard) is tested as plain functions. Component tests are left out of this change.

### Container
Two stages from `node:26-slim`. The build stage runs `npm i -g pnpm@<pinned>` (Corepack is gone from Node 25+), `pnpm install --frozen-lockfile` and `pnpm build:web`. The runtime stage installs production dependencies only, copies `server/`, `shared/` and `dist/web`, runs as the `node` user, and starts with `node server/index.ts`. `PORT` defaults to 3000.

## Risks / Trade-offs

- [One request per form] → Forms are fetched in parallel; projects have few forms, so the extra requests are cheap.
- [Participants fetch is slow for 20,000 participants] → 30 s upstream timeout, tuned when measured. Ingress timeout noted in the README.
- [Keys in sessionStorage are readable by any script on the page] → No third-party scripts, a CSP header from the server (`default-src 'self'; style-src 'self' 'unsafe-inline'`, since Emotion/MUI inject styles at runtime), and "forget keys". Memory-only would lose keys on every reload, which organisers would find painful.
- [Type import from `server/` into `web/`] → Type-only (`import type`), so no server code reaches the bundle. Checked by `tsc -p web`.

## Migration Plan

New service, nothing to migrate. Deploy the image, point liveness and readiness probes at `/healthz`. Rollback is redeploying the previous image, since there is no state.

## Open Questions

- Pinned versions of pnpm and MUI are chosen at install time.
