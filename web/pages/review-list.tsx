import { Box, Button, Chip, Paper, Typography } from "@mui/material";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";
import type { QuestionInfo } from "../mapping/catalog.ts";
import type { Outcome } from "../mapping/diff.ts";
import { SpreadsheetError, spreadsheet } from "../spreadsheet/client.ts";
import type { ReviewFilter, ReviewItem, ReviewRow } from "../spreadsheet/protocol.ts";
import { displayCurrent, displayNext } from "../writing/display.ts";
import type { OutcomeMap } from "../writing/outcomes.ts";

export const pageSize = 100;
const rowHeight = 48;
const headerHeight = 32;
const columns = "minmax(140px, 1.2fr) minmax(100px, 1fr) minmax(100px, 1fr) 160px";

const diffLabels: Record<Outcome, string> = {
  set: "Set",
  overwrite: "Overwrite",
  clear: "Clear",
  unchanged: "Unchanged",
  skipEmpty: "Skipped (empty)",
  skipUnmapped: "Skipped (unmapped)",
  skipInvalid: "Skipped (invalid)",
};

const outcomeText = (row: ReviewRow, outcomes: OutcomeMap): { text: string; color: "default" | "success" | "error" | "warning" } => {
  const o = outcomes.get(row.memberNo)?.get(row.questionId);
  switch (o?.status) {
    case "updated":
      return { text: "Updated", color: "success" };
    case "unchanged":
      return { text: "Already as written", color: "default" };
    case "failed":
      return { text: "Failed", color: "error" };
    case "notAttempted":
      return { text: "Not attempted", color: "warning" };
    case "notFound":
    case "noMember":
      return { text: "Not a participant", color: "warning" };
    default:
      return { text: diffLabels[row.outcome], color: "default" };
  }
};

// The change list, paged from the worker as the user scrolls. Mount it with a key that changes with the filter
// and the plan so that it starts afresh.
export const ReviewList = (props: {
  filter: ReviewFilter;
  questions: Map<string, QuestionInfo>;
  outcomes: OutcomeMap;
  // bumped when `outcomes` changed, to redraw the rows
  outcomesVersion: number;
  canWrite: boolean;
  onWriteOne: (member: { memberNo: string; name: string }) => void;
}) => {
  const [total, setTotal] = useState<number | null>(null);
  const [pages, setPages] = useState<Map<number, ReviewItem[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: total ?? 0,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (pages.get(Math.floor(i / pageSize))?.[i % pageSize]?.kind === "member" ? headerHeight : rowHeight),
  });
  // Sizes depend on the loaded items, so re-measure when a page arrives.
  useEffect(() => virtualizer.measure(), [pages, virtualizer]);
  const items = virtualizer.getVirtualItems();

  // The worker answers one list request at a time (a new one replaces the old), so fetch one page at a time.
  const wanted = total === null ? [0] : [...new Set(items.map((i) => Math.floor(i.index / pageSize)))];
  const missing = wanted.find((p) => !pages.has(p));
  useEffect(() => {
    if (missing === undefined || loading || failed) return;
    setLoading(true);
    spreadsheet
      .reviewList(props.filter, missing * pageSize, pageSize)
      .then((r) => {
        setTotal(r.total);
        setPages((m) => new Map(m).set(missing, r.rows));
      })
      .catch((e: unknown) => {
        if (!(e instanceof SpreadsheetError && e.code === "superseded")) setFailed(true);
      })
      .finally(() => setLoading(false));
  }, [missing, loading, failed, props.filter]);

  if (failed) return <Typography color="error">The list could not be read.</Typography>;
  if (total === 0) {
    return (
      <Typography color="text.secondary">
        {props.filter === "writes" ? "Nothing will be updated." : "No answers."}
      </Typography>
    );
  }

  return (
    <Paper variant="outlined">
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: columns,
          gap: 2,
          px: 2,
          py: 1,
          borderBottom: 1,
          borderColor: "divider",
          minWidth: 640,
        }}
      >
        {["Question", "Current", "New", "Outcome"].map((h) => (
          <Typography key={h} variant="caption" color="text.secondary" sx={{ fontWeight: 600, ...(h === "Question" && { pl: 2 }) }}>
            {h}
          </Typography>
        ))}
      </Box>
      <Box ref={scroller} sx={{ maxHeight: 480, overflow: "auto" }}>
        <Box sx={{ height: virtualizer.getTotalSize(), minWidth: 640, position: "relative" }} data-outcomes={props.outcomesVersion}>
          {items.map((v) => {
            const item = pages.get(Math.floor(v.index / pageSize))?.[v.index % pageSize];
            const frame = {
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: item?.kind === "member" ? headerHeight : rowHeight,
              transform: `translateY(${v.start}px)`,
              alignItems: "center",
              px: 2,
              borderBottom: 1,
              borderColor: "divider",
              boxSizing: "border-box",
            } as const;
            if (!item) {
              return (
                <Box key={v.key} sx={{ ...frame, display: "flex" }}>
                  <Typography color="text.secondary">Loading…</Typography>
                </Box>
              );
            }
            if (item.kind === "member") {
              return (
                <Box key={v.key} sx={{ ...frame, display: "flex", gap: 1.5, bgcolor: "action.hover", fontWeight: 600 }}>
                  <Typography variant="body2" noWrap title={item.name} sx={{ fontWeight: 600, minWidth: 0 }}>
                    {item.name || "(no name)"}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ flexShrink: 0 }}>
                    {item.memberNo} · row {item.sheetRow} · {item.answers} {item.answers === 1 ? "answer" : "answers"}
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  {item.writes > 0 && (
                    <Button
                      size="small"
                      sx={{ py: 0, minHeight: 0 }}
                      disabled={!props.canWrite}
                      onClick={() => props.onWriteOne({ memberNo: item.memberNo, name: item.name })}
                    >
                      Write only this participant
                    </Button>
                  )}
                </Box>
              );
            }
            const q = props.questions.get(item.questionId);
            const outcome = outcomeText(item, props.outcomes);
            const current = displayCurrent(q?.kind ?? null, q?.choices ?? [], item.current);
            const next = displayNext(q?.kind ?? null, q?.choices ?? [], item.next);
            return (
              <Box key={v.key} sx={{ ...frame, display: "grid", gridTemplateColumns: columns, gap: 2 }}>
                <Typography noWrap title={q?.label ?? item.questionId} sx={{ pl: 2 }}>
                  {q?.label ?? item.questionId}
                </Typography>
                <Typography noWrap title={current}>
                  {current}
                </Typography>
                <Typography noWrap title={next}>
                  {next}
                </Typography>
                <Box sx={{ minWidth: 0 }}>
                  <Chip size="small" color={outcome.color} label={outcome.text} />
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Paper>
  );
};
