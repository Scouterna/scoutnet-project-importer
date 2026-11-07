import { Alert, Button, LinearProgress, Paper, Stack, Typography } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, participantsQuery, questionsQuery } from "../api.ts";
import type { ApiContext } from "../api.ts";
import { buildCatalog } from "../mapping/catalog.ts";
import { queryClient } from "../query-client.ts";
import { verify } from "../report/verify.ts";
import type { NotConfirmed } from "../report/verify.ts";
import { SpreadsheetError, spreadsheet } from "../spreadsheet/client.ts";
import { useWizardState } from "../wizard-store.ts";
import { displayCurrent, displayNext } from "../writing/display.ts";
import { countOutcomes, getLastRun, getOutcomes } from "../writing/outcomes.ts";
import type { AnswerOutcome } from "../writing/outcomes.ts";
import { VirtualList } from "./virtual-list.tsx";
import { fmt, plural } from "./write-panels.tsx";

const xlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const errorText = (e: unknown): string => {
  if (e instanceof ApiError) {
    if (e.code === "credentials_rejected") return "Scoutnet rejected the participants key. Check it in step 1.";
    if (e.code === "upstream_unreachable") return "Scoutnet could not be reached.";
    return e.message;
  }
  if (e instanceof SpreadsheetError) return e.message;
  return "Something went wrong.";
};

// Saves the bytes through the browser's download. Nothing is stored and nothing is sent anywhere.
const saveFile = (bytes: ArrayBuffer, name: string): void => {
  const url = URL.createObjectURL(new Blob([bytes], { type: xlsxType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const Tile = (props: { label: string; value: number }) => (
  <Paper variant="outlined" sx={{ px: 2, py: 1.5, minWidth: 150 }}>
    <Typography variant="h5" component="p">
      {fmt(props.value)}
    </Typography>
    <Typography variant="body2" color="text.secondary">
      {props.label}
    </Typography>
  </Paper>
);

type Verified = {
  confirmed: number;
  // updated answers the worker had no value for, so they could not be checked
  unchecked: number;
  notConfirmed: NotConfirmed[];
  names: Map<string, string>;
};

export const ReportPage = () => {
  const { loaded, keys } = useWizardState();
  const navigate = useNavigate();
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

  // Read once per visit: the outcomes are in memory and only change when a run ends, which is on the other page.
  const outcomes = getOutcomes();
  const tuples = useMemo(() => {
    const list: [string, string, AnswerOutcome][] = [];
    for (const [member, answers] of outcomes) for (const [question, o] of answers) list.push([member, question, o]);
    return list;
  }, [outcomes]);
  const counts = countOutcomes(outcomes);
  const run = getLastRun();
  const participantsWritten = (() => {
    if (run) return run.participants;
    let n = 0;
    for (const answers of outcomes.values()) if ([...answers.values()].some((o) => o.status === "updated")) n++;
    return n;
  })();
  const empty = tuples.length === 0;

  const labels = useMemo((): [string, string][] => (catalog ?? []).map((q) => [q.id, q.label]), [catalog]);

  const [stale, setStale] = useState(empty);
  const [rows, setRows] = useState<{ count: number; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<Verified | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // The row count for the button, from a dry run that builds no file.
  useEffect(() => {
    if (empty) return;
    let current = true;
    spreadsheet
      .notImported(tuples, labels, true)
      .then((r) => {
        if (current) setRows({ count: r.rows, name: r.name });
      })
      .catch((e: unknown) => {
        if (!current || (e instanceof SpreadsheetError && e.code === "superseded")) return;
        if (e instanceof SpreadsheetError && e.code === "bad_request") setStale(true);
        else setError(errorText(e));
      });
    return () => {
      current = false;
    };
  }, [empty, tuples, labels]);

  const download = async () => {
    setExporting(true);
    setError(null);
    try {
      const r = await spreadsheet.notImported(tuples, labels);
      if (r.bytes) saveFile(r.bytes, r.name);
    } catch (e) {
      if (e instanceof SpreadsheetError && e.code === "bad_request") setStale(true);
      else if (!(e instanceof SpreadsheetError && e.code === "superseded")) setError(errorText(e));
    } finally {
      if (alive.current) setExporting(false);
    }
  };

  const runVerify = async () => {
    if (!catalog) return;
    setVerifying(true);
    setError(null);
    try {
      const updated: [string, string][] = tuples.filter(([, , o]) => o.status === "updated").map(([m, q]) => [m, q]);
      const { values } = await spreadsheet.writtenValues(updated);
      // The fresh participants stay here: sending them to the worker would clear the diff the export is made from.
      const fresh = await queryClient.fetchQuery({ ...participantsQuery(ctx), staleTime: 0 });
      const written = updated.flatMap(([memberNo, questionId]) => {
        const value = values[memberNo]?.[questionId];
        return value === undefined ? [] : [{ memberNo, questionId, value }];
      });
      const kinds = new Map(catalog.flatMap((q) => (q.kind ? [[q.id, q.kind] as const] : [])));
      const result = verify(written, fresh.participants, kinds);
      const wanted = new Set(result.notConfirmed.map((n) => n.memberNo));
      const names = new Map<string, string>();
      for (const p of fresh.participants) {
        if (wanted.has(p.memberNo)) names.set(p.memberNo, [p.firstName, p.lastName].filter(Boolean).join(" "));
      }
      if (alive.current) setVerified({ ...result, unchecked: updated.length - written.length, names });
    } catch (e) {
      if (e instanceof SpreadsheetError && e.code === "bad_request") setStale(true);
      else if (!(e instanceof SpreadsheetError && e.code === "superseded")) setError(errorText(e));
    } finally {
      if (alive.current) setVerifying(false);
    }
  };

  const failedBatches = run?.failedBatches ?? 0;
  const noRows = rows !== null && rows.count === 0;

  return (
    <Stack spacing={3}>
      {error && <Alert severity="error">{error}</Alert>}

      {stale && (
        <Alert severity="warning">
          This report no longer matches the current settings, or there is nothing to report. Go back to Review and
          write to run the review again.
        </Alert>
      )}

      {!stale && run?.stopped === "cancelled" && (
        <Alert severity="warning">The run was cancelled. The answers that were not sent are counted as not attempted.</Alert>
      )}
      {!stale && run?.stopped === "key rejected" && (
        <Alert severity="error">
          Scoutnet rejected the check-in key, so the run stopped. The answers that were not sent are counted as not
          attempted.
        </Alert>
      )}

      {!stale && (
        <Stack spacing={1}>
          <Typography variant="h6">What happened in Scoutnet</Typography>
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1.5 }}>
            <Tile label="Updated" value={counts.updated} />
            <Tile label="Already as written" value={counts.unchanged} />
            <Tile label="Failed" value={counts.failed} />
            <Tile label="Not attempted" value={counts.notAttempted} />
            <Tile label="Not a participant" value={counts.notFound} />
            <Tile label="No such member" value={counts.noMember} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {plural(participantsWritten, "participant", "participants")} written · {plural(failedBatches, "batch", "batches")}{" "}
            failed
          </Typography>
        </Stack>
      )}

      <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
        <Typography variant="h6">Rows not imported</Typography>
        <Typography variant="body2" color="text.secondary">
          A copy of the spreadsheet rows with something not imported, with a Reason column. It is made in your browser
          and never sent anywhere.
        </Typography>
        <Button
          variant="contained"
          disabled={stale || exporting || rows === null || noRows}
          onClick={() => void download()}
        >
          {noRows
            ? "Every row was imported"
            : exporting
              ? "Preparing…"
              : `Download rows not imported${rows ? ` (${fmt(rows.count)})` : ""}`}
        </Button>
        {exporting && <LinearProgress sx={{ alignSelf: "stretch" }} />}
      </Stack>

      <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
        <Typography variant="h6">Verify in Scoutnet</Typography>
        <Typography variant="body2" color="text.secondary">
          Fetches the participants again and checks that every answer reported as updated reads back as written.
        </Typography>
        <Button variant="outlined" disabled={stale || verifying || !catalog || counts.updated === 0} onClick={() => void runVerify()}>
          {verifying ? "Verifying…" : "Verify in Scoutnet"}
        </Button>
        {verifying && <LinearProgress sx={{ alignSelf: "stretch" }} />}
        {verified && (
          <Stack spacing={1} sx={{ alignSelf: "stretch" }}>
            <Alert severity={verified.notConfirmed.length === 0 ? "success" : "warning"}>
              {fmt(verified.confirmed)} of {plural(verified.confirmed + verified.notConfirmed.length, "answer", "answers")}{" "}
              confirmed
              {verified.notConfirmed.length > 0 ? `, ${fmt(verified.notConfirmed.length)} not confirmed` : ""}.
              {verified.unchecked > 0 ? ` ${plural(verified.unchecked, "answer", "answers")} could not be checked.` : ""}
            </Alert>
            {verified.notConfirmed.length > 0 && (
              <VirtualList
                items={verified.notConfirmed}
                empty=""
                rowHeight={64}
                render={(n) => {
                  const q = byId.get(n.questionId);
                  const kind = q?.kind ?? null;
                  const choices = q?.choices ?? [];
                  const name = verified.names.get(n.memberNo);
                  return (
                    <>
                      <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                        {name || "(no name)"} ({n.memberNo})
                        <br />
                        {q?.label ?? n.questionId}
                      </Typography>
                      <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap title={displayNext(kind, choices, n.written)}>
                        Written: {displayNext(kind, choices, n.written)}
                      </Typography>
                      <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap title={displayCurrent(kind, choices, n.now)}>
                        Now: {displayCurrent(kind, choices, n.now)}
                      </Typography>
                    </>
                  );
                }}
              />
            )}
          </Stack>
        )}
      </Stack>

      <Stack direction="row" spacing={2}>
        <Button variant="outlined" disabled={exporting || verifying} onClick={() => void navigate({ to: "/review" })}>
          Back to Review and write
        </Button>
      </Stack>
    </Stack>
  );
};
