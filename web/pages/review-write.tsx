import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Button,
  FormControlLabel,
  LinearProgress,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import ExpandMore from "@mui/icons-material/ExpandMore";
import { useQuery } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ParticipantsResponse } from "../../shared/api-types.ts";
import { ApiError, participantsQuery, questionsQuery, writeAnswers } from "../api.ts";
import type { ApiContext } from "../api.ts";
import { buildCatalog } from "../mapping/catalog.ts";
import { queryClient } from "../query-client.ts";
import { SpreadsheetError, spreadsheet } from "../spreadsheet/client.ts";
import { recomputeDiff } from "../spreadsheet/recompute.ts";
import type { PlanReply, ReviewFilter } from "../spreadsheet/protocol.ts";
import { completedSteps } from "../steps.ts";
import { useWizardState, wizardStore } from "../wizard-store.ts";
import { displayCurrent, displayNext } from "../writing/display.ts";
import { mergeOutcomes, recordOutcomes, setLastRun } from "../writing/outcomes.ts";
import type { OutcomeMap } from "../writing/outcomes.ts";
import { readsBack } from "../writing/readback.ts";
import { runBatches } from "../writing/runner.ts";
import type { Answers, Progress } from "../writing/runner.ts";
import { KeyField } from "./load-project.tsx";
import { ReviewList } from "./review-list.tsx";
import { ConfirmDialog, ProgressPanel, RunResultPanel, TestTable, fmt, plural } from "./write-panels.tsx";
import type { RunSummary, TestResult } from "./write-panels.tsx";

const defaultBatchSize = 100;

const errorText = (e: unknown): string => {
  if (e instanceof ApiError) {
    if (e.code === "credentials_rejected") return "Scoutnet rejected the check-in key. Check it and try again.";
    if (e.code === "upstream_unreachable") return "Scoutnet could not be reached.";
    return e.message;
  }
  if (e instanceof SpreadsheetError) return e.message;
  return "Something went wrong.";
};

type Pending =
  | { kind: "full" }
  | { kind: "retry"; indexes: number[]; answers: number }
  | { kind: "test"; member: string; name: string; body: Answers; answers: number };

export const ReviewWritePage = () => {
  const state = useWizardState();
  const { spreadsheet: sheet, matching, mapping, loaded, keys, write } = state;
  const navigate = useNavigate();

  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanReply | null>(null);
  const [planId, setPlanId] = useState(0);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReviewFilter>("writes");
  const [pending, setPending] = useState<Pending | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [batchText, setBatchText] = useState(String(defaultBatchSize));
  const [batchSize, setBatchSize] = useState(defaultBatchSize);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  // This review's outcomes, for the list and the totals. The session-wide ones for step 6 are in writing/outcomes.ts.
  const [outcomes, setOutcomes] = useState<OutcomeMap>(new Map());
  const [outcomesVersion, setOutcomesVersion] = useState(0);
  // Shown for the whole visit once the page found the key empty, so the field does not vanish while typing.
  const [askKey] = useState(() => wizardStore.getState().keys.checkin.trim() === "");

  const running = write?.status === "running";
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const batchSizeRef = useRef(batchSize);
  batchSizeRef.current = batchSize;

  const ctx: ApiContext = { projectId: loaded?.projectId ?? "", env: loaded?.env ?? "production", keys };
  const cacheOnly = {
    enabled: loaded !== null,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  } as const;
  const questions = useQuery({ ...questionsQuery(ctx), ...cacheOnly });
  const participants = useQuery({ ...participantsQuery(ctx), ...cacheOnly });
  const catalog = useMemo(
    () => (questions.data && participants.data ? buildCatalog(questions.data.forms, participants.data.participants) : null),
    [questions.data, participants.data],
  );
  const byId = useMemo(() => new Map((catalog ?? []).map((q) => [q.id, q])), [catalog]);

  // Leaving or reloading while a request is in flight would lose track of what was written.
  const busy = running || testing;
  useEffect(() => {
    if (!busy) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [busy]);
  // Also blocks in-app navigation (browser back) while writing; the stepper and Back are disabled too.
  useBlocker({ shouldBlockFn: () => busy, enableBeforeUnload: false, disabled: !busy });

  useEffect(() => {
    if (!sheet || !matching || !mapping || !loaded) void navigate({ to: "/spreadsheet" });
  }, [sheet, matching, mapping, loaded, navigate]);

  // Refetches the participants (unless given), recomputes the diff and asks the worker for a plan and a first
  // look at the list. Nothing here may run while writing: it would clear the plan the run reads from.
  const startReview = async (given?: ParticipantsResponse) => {
    if (!loaded || wizardStore.getState().write?.status === "running") return;
    const gen = ++generation.current;
    setPhase("loading");
    setError(null);
    try {
      const data = given ?? (await queryClient.fetchQuery({ ...participantsQuery(ctx), staleTime: 0 }));
      const forms = queryClient.getQueryData(questionsQuery(ctx).queryKey);
      if (!forms) throw new Error("The questions are not available. Go back to step 1.");
      const cat = buildCatalog(forms.forms, data.participants);
      await recomputeDiff(`${ctx.env}:${ctx.projectId}:${data.fetchedAt}`, data.participants, cat);
      const next = await spreadsheet.writePlan(batchSizeRef.current);
      if (gen !== generation.current) return;
      setPlan(next);
      setFetchedAt(data.fetchedAt);
      setPlanId((n) => n + 1);
      setPhase("ready");
    } catch (e) {
      if (e instanceof SpreadsheetError && e.code === "superseded") return;
      if (gen !== generation.current) return;
      setError(e instanceof Error && !(e instanceof ApiError) && !(e instanceof SpreadsheetError) ? e.message : errorText(e));
      setPhase("ready");
    }
  };

  useEffect(() => {
    if (loaded && sheet && matching && mapping) void startReview();
    return () => {
      generation.current++;
    };
    // Once per visit; Refresh and the batch size run it again.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Changing the batch size re-plans (after a pause, and never while writing).
  const planned = useRef(batchSize);
  useEffect(() => {
    if (batchSize === planned.current || !plan) return;
    const timer = setTimeout(() => {
      if (wizardStore.getState().write?.status === "running") return;
      planned.current = batchSize;
      spreadsheet
        .writePlan(batchSize)
        .then((p) => {
          setPlan(p);
          setSummary(null);
        })
        .catch((e: unknown) => {
          if (!(e instanceof SpreadsheetError && e.code === "superseded")) setError(errorText(e));
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [batchSize]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sheet || !matching || !mapping || !loaded) return null;

  const checkinSet = keys.checkin.trim() !== "";
  const writesPlanned = plan ? plan.totals.set + plan.totals.overwrite + plan.totals.clear : 0;
  const idle = phase === "ready" && !busy && plan !== null;
  const canWrite = idle && checkinSet && writesPlanned > 0;

  const record = (result: OutcomeMap) => {
    recordOutcomes(result);
    setOutcomes((prev) => {
      const next = new Map(prev);
      mergeOutcomes(next, result);
      return next;
    });
    setOutcomesVersion((n) => n + 1);
  };

  const refresh = () => {
    setSummary(null);
    setTestResult(null);
    setOutcomes(new Map());
    setProgress(null);
    void startReview();
  };

  const finishRun = (r: Awaited<ReturnType<typeof runBatches>>, previous: RunSummary | null, retried: number[] | null) => {
    record(r.outcomes);
    const retry = [...r.failedBatches, ...(r.stopped === "key rejected" || retried ? r.unsent : [])];
    const left = retried && previous ? previous.retry.filter((i) => !retried.includes(i)) : [];
    const all: OutcomeMap = new Map(previous?.outcomes ?? []);
    mergeOutcomes(all, r.outcomes);
    const failed = [
      ...new Set([...(retried && previous ? previous.failed.filter((i) => !retried.includes(i)) : []), ...r.failedBatches]),
    ].sort((a, b) => a - b);
    setSummary({
      outcomes: all,
      retry: [...new Set([...left, ...retry])].sort((a, b) => a - b),
      failed,
      stopped: r.stopped,
    });
    let participants = 0;
    for (const answers of all.values()) {
      if ([...answers.values()].some((o) => o.status === "updated")) participants++;
    }
    setLastRun({ stopped: r.stopped, failedBatches: failed.length, participants });
    return r;
  };

  const runFull = async (indexes: number[] | null) => {
    if (!plan) return;
    const previous = indexes ? summary : null;
    const controller = new AbortController();
    abort.current = controller;
    setCancelling(false);
    setError(null);
    if (!indexes) {
      setSummary(null);
      setTestResult(null);
    }
    const priorSent = indexes ? (wizardStore.getState().write?.sent ?? 0) : 0;
    wizardStore.setWrite({ fileName: sheet.fileName, status: "running", sent: priorSent });
    try {
      const r = await runBatches({
        batches: plan.batches,
        ...(indexes ? { indexes, markUnsent: false } : {}),
        getBody: async (i) => (await spreadsheet.batchBody(i)).answers,
        send: (answers) => writeAnswers(ctx, answers),
        onProgress: setProgress,
        signal: controller.signal,
      });
      finishRun(r, previous, indexes);
      wizardStore.setWrite({ fileName: sheet.fileName, status: "done", sent: priorSent + r.sent });
    } catch (e) {
      setError(errorText(e));
      wizardStore.setWrite({ fileName: sheet.fileName, status: "done", sent: priorSent });
    } finally {
      abort.current = null;
    }
  };

  // Finds the member's planned answers: the batch that holds them, filtered client-side.
  const startTest = async (member: { memberNo: string; name: string }) => {
    if (!plan) return;
    setError(null);
    try {
      const index = plan.batches.findIndex((b) => b.members.includes(member.memberNo));
      if (index < 0) throw new Error("That participant has nothing to write.");
      const body = (await spreadsheet.batchBody(index)).answers[member.memberNo] ?? {};
      const answers = Object.keys(body).length;
      if (answers === 0) throw new Error("That participant has nothing to write.");
      setPending({ kind: "test", member: member.memberNo, name: member.name, body: { [member.memberNo]: body }, answers });
    } catch (e) {
      setError(errorText(e));
    }
  };

  const runTest = async (p: Extract<Pending, { kind: "test" }>) => {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const r = await runBatches({
        batches: [{ members: [p.member], answers: p.answers }],
        getBody: async () => p.body,
        send: (answers) => writeAnswers(ctx, answers),
      });
      record(r.outcomes);
      if (r.stopped === "key rejected") {
        setError("Scoutnet rejected the check-in key. Check it and try again.");
        return;
      }
      const fresh = await queryClient.fetchQuery({ ...participantsQuery(ctx), staleTime: 0 });
      const person = fresh.participants.find((x) => x.memberNo === p.member);
      const rows = Object.entries(p.body[p.member] ?? {}).map(([questionId, written]) => {
        const q = byId.get(questionId);
        const kind = q?.kind ?? "text";
        const now = person?.answers[questionId] ?? null;
        const outcome = r.outcomes.get(p.member)?.get(questionId);
        const base = {
          questionId,
          label: q?.label ?? questionId,
          written: displayNext(kind, q?.choices ?? [], written),
          now: displayCurrent(kind, q?.choices ?? [], now),
        };
        if (outcome?.status === "failed") return { ...base, confirmed: null, note: `Failed: ${outcome.message}` };
        if (outcome?.status === "notAttempted") return { ...base, confirmed: null, note: "Not written" };
        if (outcome?.status === "notFound" || outcome?.status === "noMember")
          return { ...base, confirmed: null, note: "Not a participant" };
        return { ...base, confirmed: readsBack(kind, written, now) };
      });
      setTestResult({ memberNo: p.member, name: p.name, rows });
      // The diff changes after a write, so recompute from the participants just read.
      await startReview(fresh);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setTesting(false);
    }
  };

  const confirm = () => {
    const p = pending;
    setPending(null);
    if (!p) return;
    if (p.kind === "full") void runFull(null);
    else if (p.kind === "retry") void runFull(p.indexes);
    else void runTest(p);
  };

  const canContinue = completedSteps(state) >= 5;

  return (
    <Stack spacing={3}>
      {error && <Alert severity="error">{error}</Alert>}

      <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
        <Typography color="text.secondary" variant="body2">
          {fetchedAt ? `Participants fetched ${new Date(fetchedAt).toLocaleString()}` : "Fetching participants…"}
        </Typography>
        <Button size="small" variant="outlined" disabled={busy || phase === "loading"} onClick={refresh}>
          Refresh
        </Button>
      </Stack>

      {phase === "loading" && <LinearProgress />}

      {plan && (
        <Stack spacing={0.5}>
          <Typography variant="h6">
            {plural(plan.totals.participants, "participant", "participants")} will change
          </Typography>
          <Typography>
            {fmt(plan.totals.set)} to set · {fmt(plan.totals.overwrite)} to overwrite · {fmt(plan.totals.clear)} to
            clear · {fmt(plan.totals.skipped)} skipped · {fmt(plan.totals.unchanged)} already up to date
          </Typography>
        </Stack>
      )}

      {plan && writesPlanned === 0 && <Alert severity="info">Nothing to write: every mapped answer is already up to date or skipped.</Alert>}

      {plan && (
        <Stack spacing={1}>
          <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
            <Typography variant="subtitle1">Answers</Typography>
            <FormControlLabel
              control={<Switch checked={filter === "writes"} onChange={(e) => setFilter(e.target.checked ? "writes" : "all")} />}
              label="Hide answers that won't be updated"
            />
          </Stack>
          <ReviewList
            key={`${filter}:${planId}`}
            filter={filter}
            questions={byId}
            outcomes={outcomes}
            outcomesVersion={outcomesVersion}
            canWrite={canWrite}
            onWriteOne={(member) => void startTest(member)}
          />
        </Stack>
      )}

      {askKey && (
        <Stack spacing={1}>
          <KeyField
            label="Update the check-in state of participant(s) on the project (check-in key)"
            helper="Needed to write answers. Writing is disabled until it is set."
            value={keys.checkin}
            onChange={(v) => wizardStore.setKey("checkin", v)}
          />
        </Stack>
      )}

      {plan && writesPlanned > 0 && (
        <Stack spacing={1.5}>
          <Typography variant="subtitle1">Test with one participant</Typography>
          <Typography variant="body2" color="text.secondary">
            {testing
              ? "Writing one participant and reading the answers back…"
              : "To try it first, use \"Write only this participant\" on a participant in the list below. Their answers are read back from Scoutnet afterwards."}
          </Typography>
          {testResult && <TestTable result={testResult} />}
        </Stack>
      )}

      {plan && (
        <Accordion disableGutters variant="outlined">
          <AccordionSummary expandIcon={<ExpandMore />}>Advanced</AccordionSummary>
          <AccordionDetails>
            <TextField
              type="number"
              label="Batch size"
              helperText="Participants per request. Values above 100 may make Scoutnet fail to process the request. Changing it makes a new plan."
              value={batchText}
              disabled={busy}
              slotProps={{ htmlInput: { min: 1 } }}
              onChange={(e) => {
                setBatchText(e.target.value);
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 1) setBatchSize(n);
              }}
              error={!(Number.isInteger(Number(batchText)) && Number(batchText) >= 1)}
              sx={{ maxWidth: 240 }}
            />
          </AccordionDetails>
        </Accordion>
      )}

      {running && progress && (
        <ProgressPanel
          progress={progress}
          cancelling={cancelling}
          onCancel={() => {
            setCancelling(true);
            abort.current?.abort();
          }}
        />
      )}

      {summary && !running && (
        <RunResultPanel
          summary={summary}
          canRetry={idle && checkinSet}
          onRetry={() =>
            plan &&
            setPending({
              kind: "retry",
              indexes: summary.retry,
              answers: summary.retry.reduce((n, i) => n + (plan.batches[i]?.answers ?? 0), 0),
            })
          }
        />
      )}

      <Stack direction="row" spacing={2}>
        <Button variant="outlined" disabled={busy} onClick={() => void navigate({ to: "/map" })}>
          Back
        </Button>
        <Button variant="contained" color="warning" disabled={!canWrite} onClick={() => setPending({ kind: "full" })}>
          Write answers
        </Button>
        <Button variant="contained" disabled={busy || !canContinue} onClick={() => void navigate({ to: "/report" })}>
          Continue
        </Button>
      </Stack>

      {pending?.kind === "full" && plan && (
        <ConfirmDialog
          title="Write to Scoutnet?"
          text={`Update ${plural(writesPlanned, "answer", "answers")} for ${plural(plan.totals.participants, "participant", "participants")}. This changes the registrations in Scoutnet.`}
          confirmLabel="Update"
          onConfirm={confirm}
          onClose={() => setPending(null)}
        />
      )}
      {pending?.kind === "retry" && (
        <ConfirmDialog
          title="Retry failed batches?"
          text={`Send ${plural(pending.indexes.length, "batch", "batches")} again, ${plural(pending.answers, "answer", "answers")} in all. This changes the registrations in Scoutnet.`}
          confirmLabel="Retry"
          onConfirm={confirm}
          onClose={() => setPending(null)}
        />
      )}
      {pending?.kind === "test" && (
        <ConfirmDialog
          title="Write only this participant?"
          text={`Update ${plural(pending.answers, "answer", "answers")} for ${pending.name || "(no name)"} (${pending.member}) only. This changes their registration in Scoutnet. The answers are read back afterwards to check them.`}
          confirmLabel="Update"
          onConfirm={confirm}
          onClose={() => setPending(null)}
        />
      )}
    </Stack>
  );
};
