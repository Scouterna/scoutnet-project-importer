# Design

## Decisions

### Computed in `runMatch`
The worker already has `pool`, `byNo` and the match `outcomes`. After matching it collects the member numbers of `matched` outcomes, and lists every pool member not among them, in participant-list order. `MatchedReply` gains `withoutRow: (MemberInfo & { pending: "ambiguous" | "conflict" | null })[]`. `pending` is `"ambiguous"` when the member is a candidate of an ambiguous row, otherwise `"conflict"` when it is the member of a conflict group without a matched winner, otherwise null. This is one pass over the outcomes and one over the participants, so it stays linear at 20,000.

`matcher.ts` is unchanged: the list depends on the pool and outcomes only, and the worker owns turning member numbers into `MemberInfo`.

### Page
A fifth tab, "Without a row (N)", after Excluded, using the existing `VirtualList` and `memberLabel`, with a small chip for `pending`. No change to step completion.
