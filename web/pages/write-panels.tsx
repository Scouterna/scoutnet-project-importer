import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import type { OutcomeMap } from "../writing/outcomes.ts";
import { countOutcomes } from "../writing/outcomes.ts";
import type { Progress } from "../writing/runner.ts";

export const fmt = (n: number): string => n.toLocaleString("en-US");
export const plural = (n: number, one: string, many: string): string => `${fmt(n)} ${n === 1 ? one : many}`;

// Nothing is written until this is confirmed.
export const ConfirmDialog = (props: {
  title: string;
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) => (
  <Dialog open onClose={props.onClose}>
    <DialogTitle>{props.title}</DialogTitle>
    <DialogContent>
      <DialogContentText>{props.text}</DialogContentText>
    </DialogContent>
    <DialogActions>
      <Button onClick={props.onClose}>Cancel</Button>
      <Button variant="contained" color="warning" onClick={props.onConfirm}>
        {props.confirmLabel}
      </Button>
    </DialogActions>
  </Dialog>
);

export const ProgressPanel = (props: { progress: Progress; cancelling: boolean; onCancel: () => void }) => {
  const p = props.progress;
  return (
    <Stack spacing={1}>
      <LinearProgress variant="determinate" value={p.answersTotal === 0 ? 0 : (p.answersDone / p.answersTotal) * 100} />
      <Typography variant="body2">
        Batch {fmt(Math.min(p.batchesDone + 1, p.batchesTotal))} of {fmt(p.batchesTotal)} · {fmt(p.answersDone)} of{" "}
        {fmt(p.answersTotal)} answers
      </Typography>
      <Button
        sx={{ alignSelf: "flex-start" }}
        variant="outlined"
        disabled={props.cancelling}
        onClick={props.onCancel}
      >
        {props.cancelling ? "Cancelling after this batch…" : "Cancel"}
      </Button>
    </Stack>
  );
};

export type RunSummary = {
  outcomes: OutcomeMap;
  // Batches "Retry failed batches" resends: the failed ones, and after a rejected key those not sent.
  retry: number[];
  // Batches that failed as a whole and are still not sent successfully.
  failed: number[];
  stopped: "cancelled" | "key rejected" | null;
};

export const RunResultPanel = (props: {
  summary: RunSummary;
  canRetry: boolean;
  onRetry: () => void;
}) => {
  const c = countOutcomes(props.summary.outcomes);
  const { stopped, retry } = props.summary;
  return (
    <Stack spacing={1.5}>
      {stopped === "key rejected" && (
        <Alert severity="error">
          Scoutnet rejected the check-in key, so the run stopped. Check the key and run the import again.
        </Alert>
      )}
      {stopped === "cancelled" && <Alert severity="warning">The run was cancelled.</Alert>}
      <Typography>
        {fmt(c.updated)} updated · {fmt(c.unchanged)} already as written · {fmt(c.failed)} failed ·{" "}
        {fmt(c.notAttempted)} not attempted · {fmt(c.notFound + c.noMember)} for members that are not participants
      </Typography>
      {retry.length > 0 && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" disabled={!props.canRetry} onClick={props.onRetry}>
              Retry failed batches
            </Button>
          }
        >
          {plural(retry.length, "batch", "batches")} can be retried.
        </Alert>
      )}
      {c.failed > 0 && retry.length === 0 && (
        <Alert severity="warning">
          Some answers were rejected by Scoutnet. They are marked Failed in the list; the rest were written.
        </Alert>
      )}
      {retry.length === 0 && c.failed === 0 && stopped === null && (
        <Typography color="text.secondary" variant="body2">
          Run the review again to see what still differs.
        </Typography>
      )}
    </Stack>
  );
};

export type TestRow = {
  questionId: string;
  label: string;
  written: string;
  now: string;
  // null: the answer was not written, so there is nothing to confirm
  confirmed: boolean | null;
  note?: string;
};

export type TestResult = { memberNo: string; name: string; rows: TestRow[] };

export const TestTable = (props: { result: TestResult }) => {
  const { result } = props;
  const confirmed = result.rows.filter((r) => r.confirmed === true).length;
  const bad = result.rows.filter((r) => r.confirmed === false).length;
  return (
    <Stack spacing={1}>
      <Alert severity={bad === 0 && confirmed === result.rows.length ? "success" : "warning"}>
        Test for {result.name || "(no name)"} ({result.memberNo}): {confirmed} of {result.rows.length} confirmed
        {bad > 0 ? `, ${bad} not confirmed` : ""}.
      </Alert>
      <Box sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Question</TableCell>
              <TableCell>Written</TableCell>
              <TableCell>Read back</TableCell>
              <TableCell>Result</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {result.rows.map((r) => (
              <TableRow key={r.questionId}>
                <TableCell>{r.label}</TableCell>
                <TableCell>{r.written}</TableCell>
                <TableCell>{r.now}</TableCell>
                <TableCell>
                  {r.confirmed === null ? (r.note ?? "Not written") : r.confirmed ? "Confirmed" : "Not confirmed"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Stack>
  );
};
