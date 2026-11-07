# Tasks

## 1. Worker

- [x] 1.1 Add `withoutRow` to `MatchedReply` in `web/spreadsheet/protocol.ts` and compute it in `runMatch` in `worker.ts`; verify with worker tests: a pool member with no row is listed, a matched member is not, an excluded (cancelled) member is not, an ambiguous candidate is marked "ambiguous" and leaves the list once resolved to them, a conflict member is marked "conflict"

## 2. Page

- [x] 2.1 Add the "Without a row (N)" tab to `web/pages/match-rows.tsx` with name, member number, email and the pending chip; verify with `pnpm build:web`
- [ ] 2.2 Verify manually in `pnpm dev` against project 92877 with a spreadsheet that leaves out a participant

## 3. Checks

- [x] 3.1 Run `pnpm typecheck`, `pnpm test`, `pnpm build:web` and `openspec validate --strict`
