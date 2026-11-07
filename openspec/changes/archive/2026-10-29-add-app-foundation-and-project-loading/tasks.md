# Tasks

Suggested model per group in brackets, following the apply guidance in `openspec/config.yaml`.

## 1. Scaffold [haiku]

- [x] 1.1 Create `package.json` (type module, `engines.node >=26`, pnpm pinned via `packageManager`), with scripts `dev`, `build:web`, `start`, `typecheck` and `test`, and verify `pnpm install` succeeds under `fnm use 26`
- [x] 1.2 Add the dependencies listed in proposal.md (Impact) and verify they appear in `pnpm-lock.yaml`
- [x] 1.3 Add the root `tsconfig.json` (server + shared: `erasableSyntaxOnly`, `allowImportingTsExtensions`, `noEmit`, `module: nodenext`, `verbatimModuleSyntax`, `strict`) and `web/tsconfig.json` (DOM, `react-jsx`, bundler resolution), and verify `pnpm typecheck` passes on placeholder files
- [x] 1.4 Add `vite.config.ts` (root `web/`, output `dist/web`, `/api` proxy to port 3000), `vitest.config.ts`, `.gitignore` and `.dockerignore`, and verify `pnpm build:web` writes `dist/web/index.html`

## 2. Shared logic [sonnet]

- [x] 2.1 Implement `shared/project-id.ts` (`parseProjectId`, `apiPageUrl(env, id)`) and verify unit tests cover every scenario in the project-loading spec (Project ID from ID or URL, Link to the project's API page)
- [x] 2.2 Implement `shared/scoutnet/normalise.ts` (`asRecord`) and `shared/scoutnet/participants.ts` (`trimParticipant`, member number as string), and verify unit tests cover `[]`, `null`, an array participant collection, `questions: []`, and that dropped fields are absent
- [x] 2.3 Define `shared/api-types.ts` (normalised questions response, `TrimmedParticipant`, participants response with `fetchedAt`, `ErrorCode` union and error body), and verify `pnpm typecheck` passes

## 3. Server [sonnet]

- [x] 3.1 Create `server/app.ts` (Hono app, exported `AppType`) and `server/index.ts` (`@hono/node-server`, `PORT` default 3000), with `/healthz` returning 200, and verify with a test that `/healthz` responds 200 without any upstream call
- [x] 3.2 Add the `/api/*` middleware that validates `X-Scoutnet-Project`, `X-Scoutnet-Key` and `X-Scoutnet-Env`, picks the base URL from the fixed env map, and creates a per-request client with an injectable `fetch`; verify tests for missing headers (400), an unknown env (400, no upstream call) and the Basic header sent upstream
- [x] 3.3 Check against the Scoutnet test server whether `GET /project/get/questions` without `form_id` includes questions, using a test project ID and key from the user, and record the answer in design.md; if no credentials are available, ask the user before continuing with 3.4
- [x] 3.4 Implement `GET /api/questions` (form list, then per-form fetch if 3.3 requires it, merged into the normalised shape), and verify a test with a stubbed two-form Scoutnet response matches the questions-route scenario
- [x] 3.5 Implement `GET /api/participants` using `trimParticipant`, and verify tests for the trimmed fields and for `participants: []` and `null`
- [x] 3.6 Implement upstream error mapping (401 → `credentials_rejected`; network error, 30 s timeout or 5xx → 502 `upstream_unreachable`) and the error-only log middleware (`method route status projectId`), and verify tests that no captured log line contains the key, the Basic header value or a participant name
- [x] 3.7 Add static serving of `dist/web`, the `index.html` fallback for non-API `GET` paths, JSON 404 for unknown `/api` paths, and a `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'` header; verify tests for `/match` (200 HTML) and `/api/does-not-exist` (404 JSON)

## 4. Frontend shell [sonnet]

- [x] 4.1 Create `web/main.tsx` with the MUI `ThemeProvider` and `CssBaseline`, a `QueryClient` with `staleTime` and `gcTime` set to `Infinity`, and the router, and verify `pnpm dev` renders the app at port 5173
- [x] 4.2 Implement the wizard store (`useSyncExternalStore`: project ID, env, keys, use-one-key flag, include-cancelled flag, loaded flag) that mirrors only keys and env to one `sessionStorage` entry, with `forgetKeys()`; verify unit tests that participant data is never written to storage and that `forgetKeys` removes the entry
- [x] 4.3 Implement `web/api.ts` over `hc<AppType>` (type-only import), adding the three headers with the right endpoint key per call and turning error bodies into typed errors that name the endpoint; verify `tsc -p web` passes and a unit test with a stubbed `fetch` checks the headers
- [x] 4.4 Define the six routes with an MUI `Stepper` layout, placeholder pages for steps 2–6, and `beforeLoad` guards that redirect to the first incomplete step; verify unit tests for the import-wizard scenarios (opening step 3 with no project redirects to `/`, going back keeps the store)

## 5. Step 1: Load project [sonnet]

- [x] 5.1 Build the project field with live parsing, "Project <id>" confirmation, an error for unrecognisable input, and the API-page link for the selected env; verify manually in `pnpm dev` with the three example inputs from the spec
- [x] 5.2 Build the masked key fields (questions, participants, check-in), a show/hide button per key, "forget keys", and the env switch (shown when `import.meta.env.DEV` or `VITE_ENABLE_ENV_SWITCH=true`); verify manually that a reload keeps keys, "forget keys" clears them, and a new tab starts empty
- [x] 5.3 Implement "Load", which fetches questions and participants in parallel through TanStack Query, shows the summary (participants, cancelled, forms, questions, fetch time), the include-cancelled and include-unconfirmed toggles with the available-for-matching count, and "Continue" to step 2; verify manually against the test server or a stubbed server
- [x] 5.4 Show distinct errors for a rejected key per endpoint and for Scoutnet unreachable, with "Try again"; verify manually by entering a wrong participants key and by stopping the upstream (or stubbing 502)

## 6. Container and docs [haiku]

- [x] 6.1 Write the two-stage `Dockerfile` described in design.md (Container), and verify `docker build` succeeds, the container runs as a non-root user, and `curl localhost:3000/healthz` returns 200
- [x] 6.2 Write `README.md` covering `fnm use 26`, `pnpm dev`, the env switch, `docker build`/`run`, the `/healthz` probes and the ingress timeout note, and verify the documented commands run as written

## 7. Integration [orchestrator]

- [x] 7.1 Run `pnpm typecheck`, `pnpm test` and `pnpm build:web`, then load a real test-server project end to end in the built container, and verify the summary counts match the project in Scoutnet
- [x] 7.2 Draft an issue for scoutnet-api about removing the `console.log` in the client's `onResponse` hook and about OPTIONS returning 401, and verify the user has reviewed it before it is filed
