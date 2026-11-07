# Scoutnet Project Importer

A web app that lets event organisers add or update participants' form answers in a Scoutnet project from an Excel or CSV file. It matches each spreadsheet row to a registered participant, maps columns to form questions, previews every change, and writes the answers back through the Scoutnet API.

## How it works

1. **Load project:** enter the Scoutnet project ID or URL and the project's API keys (one per endpoint, found on the project's API page in Scoutnet).
2. **Load spreadsheet:** pick an Excel or CSV file.
3. **Match rows:** each row is matched to a registered participant.
4. **Map answers:** map spreadsheet columns to the project's form questions.
5. **Review and write:** preview every change, then write the answers back through the Scoutnet API.
6. **Report:** see what was written.

Behaviour is specified in [`openspec/specs`](openspec/specs).

## Requirements

- Node 26 (for example `fnm install 26 && fnm use 26`)
- pnpm 12.3.4 (pinned by `packageManager` in `package.json`). Node 25+ no longer ships Corepack, so install it with `npm i -g pnpm@12.3.4`.

## Dependencies

`xlsx` (SheetJS) is installed from the SheetJS CDN tarball instead of npm. The npm package stopped at 0.18.5 and has known vulnerabilities fixed in later releases, which are published only on `cdn.sheetjs.com`. The lockfile pins the tarball's integrity hash.

## Commands

```sh
pnpm install        # install dependencies
pnpm dev            # API on http://localhost:3000 and UI on http://localhost:5173 (/api is proxied to :3000)
pnpm test           # run unit tests (Vitest)
pnpm typecheck      # type-check server, shared and web
pnpm build:web      # build the frontend into dist/web
pnpm start          # run the server (serves dist/web, so run build:web first)
```

The server runs directly on Node's type stripping, so there is no server build step. `PORT` sets the listen port (default 3000).

## Docker

```sh
docker build -t scoutnet-project-importer .
docker run -p 3000:3000 scoutnet-project-importer
```

Images are published to `ghcr.io/<owner>/scoutnet-project-importer` on every push to `main` and on releases.

The image runs as the non-root `node` user, listens on port 3000 and has no state.

## Deployment notes

- **Probes:** use `/healthz` for both liveness and readiness. It returns `200 ok`.
- **Replicas:** the server is stateless, so several replicas work without sticky sessions. Rolling back means redeploying the previous image.
- **Ingress:** the read timeout must be longer than the 30 s upstream timeout used for Scoutnet calls. Participant lists for large projects can take a while. The request body size limit must fit the largest batch.
- **Egress:** the server only calls `scoutnet.se` (production) and `s1.test.custard.no` (test). Allow outbound HTTPS to those hosts only.

## Privacy

The server keeps no state. It stores and logs no credentials (API keys) and no participant data. In the browser, API keys are kept in `sessionStorage` until the user chooses "forget keys", and participant data stays in memory only.
