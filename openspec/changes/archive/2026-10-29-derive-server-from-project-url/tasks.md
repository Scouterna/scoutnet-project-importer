# Tasks

## 1. Parsing

- [x] 1.1 Add `parseProject(input)` to `shared/project-id.ts` returning the ID and env, or a `no_id` / `unknown_host` reason, using the hosts from `siteOrigins`; cover plain ID, path-only URL, `scoutnet.se`, `www.scoutnet.se`, `s1.test.custard.no` with and without scheme, upper-case host, unknown host, and no ID in `shared/project-id.test.ts`

## 2. Store

- [x] 2.1 Remove `env`, `setEnv`, `envSwitchEnabled` and `allowEnvSwitch` from `web/wizard-store.ts`; persist only keys and project input; clear `loaded` when the parsed ID or env changes; ignore a stale `env` in an old saved entry; update `web/wizard-store.test.ts`

## 3. Step 1 UI

- [x] 3.1 In `web/pages/load-project.tsx`, remove the toggle, derive env from the project field, show "Project <id> on production" / "… on the test server", and show distinct errors for no ID and unknown host; the API-page link follows the derived env
- [x] 3.2 Verify manually in `pnpm dev`: `1234567`, `https://s1.test.custard.no/activities/view/<id>`, and `https://example.com/activities/view/1` behave as the spec says, and switching between a test URL and the bare ID clears the summary

## 4. Build and docs

- [x] 4.1 Remove `VITE_ENABLE_ENV_SWITCH` from `web/vite-env.d.ts`, the Dockerfile and the README
- [x] 4.2 Run `pnpm typecheck`, `pnpm test`, `pnpm build:web` and `openspec validate --strict`, and grep that no `envSwitch`/`VITE_ENABLE_ENV_SWITCH` references remain
