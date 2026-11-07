import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  ListSubheader,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { participantsQuery, questionsQuery } from "../api.ts";
import type { ApiContext } from "../api.ts";
import { buildCatalog } from "../mapping/catalog.ts";
import type { QuestionInfo } from "../mapping/catalog.ts";
import type { Kind } from "../mapping/diff.ts";
import { suggestPairings } from "../mapping/suggest.ts";
import type { ColumnMapping } from "../mapping/types.ts";
import { SpreadsheetError, spreadsheet } from "../spreadsheet/client.ts";
import type { Column, MappedReply, Row } from "../spreadsheet/protocol.ts";
import { ensureMatched, mappingInputs } from "../spreadsheet/recompute.ts";
import { useWizardState, wizardStore } from "../wizard-store.ts";
import type { MappingState } from "../wizard-store.ts";
import { SkippedRows, ValueTable, statusOf } from "./value-table.tsx";
import type { Option } from "./value-table.tsx";

const yesNoOptions: Option[] = [
  { id: "1", label: "Yes" },
  { id: "0", label: "No" },
];

const emptyCellLabels: Record<Kind, { value: ColumnMapping["emptyCells"]; label: string }[]> = {
  text: [{ value: "skip", label: "Skip" }, { value: "clear", label: "Clear the answer" }],
  number: [{ value: "skip", label: "Skip" }, { value: "clear", label: "Clear the answer" }],
  yesNo: [{ value: "skip", label: "Skip" }, { value: "clear", label: "Set to No" }],
  choice: [{ value: "skip", label: "Skip" }],
};

// Spreadsheet column → arrow → Scoutnet question; stacked on narrow screens.
const rowGrid = {
  display: "grid",
  gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 2fr) 40px minmax(0, 3fr)" },
  columnGap: 2,
  rowGap: 1,
  alignItems: "start",
} as const;

const newMapping = (column: string, questionId: string): ColumnMapping => ({
  column,
  questionId,
  emptyCells: "skip",
  existing: "overwrite",
  decisions: [],
});

const changesOf = (reply: MappedReply): number =>
  reply.questions.reduce((n, q) => n + q.counts.set + q.counts.overwrite + q.counts.clear, 0);

// Up to five distinct non-empty values from the preview rows
const samples = (preview: Row[], position: number): string[] => {
  const out: string[] = [];
  for (const row of preview) {
    const text = row.cells[position]?.text.trim() ?? "";
    if (text !== "" && !out.includes(text)) out.push(text);
    if (out.length === 5) break;
  }
  return out;
};

const QuestionSelect = (props: {
  column: string;
  value: string;
  catalog: QuestionInfo[];
  // question id → column using it
  taken: Map<string, string>;
  onChange: (questionId: string) => void;
}) => {
  const items: ReactNode[] = [
    <MenuItem key="none" value="">
      <em>Not mapped</em>
    </MenuItem>,
  ];
  let group: string | null = null;
  for (const q of props.catalog) {
    if (q.group !== group) {
      group = q.group;
      items.push(<ListSubheader key={`g:${q.group}`}>{q.group}</ListSubheader>);
    }
    const user = props.taken.get(q.id);
    const note = q.kind === null ? q.reason : user !== undefined && user !== props.column ? `used by column ${user}` : null;
    items.push(
      <MenuItem key={q.id} value={q.id} disabled={note !== null}>
        {q.label}
        {note && (
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            {note}
          </Typography>
        )}
      </MenuItem>,
    );
  }
  return (
    <Select
      size="small"
      displayEmpty
      value={props.catalog.some((q) => q.id === props.value) ? props.value : ""}
      onChange={(e) => props.onChange(e.target.value)}
      renderValue={(v) =>
        v === "" ? <em>Not mapped</em> : (props.catalog.find((q) => q.id === v)?.label ?? v)
      }
      inputProps={{ "aria-label": `Question for ${props.column}` }}
      sx={{ flex: 1, minWidth: 0, maxWidth: 480 }}
    >
      {items}
    </Select>
  );
};

const Counts = (props: { counts: MappedReply["questions"][number]["counts"] }) => {
  const c = props.counts;
  return (
    <Typography variant="body2" color="text.secondary">
      Set {c.set} · overwritten {c.overwrite} · cleared {c.clear} · unchanged {c.unchanged} · skipped: empty{" "}
      {c.skipEmpty}, unmapped {c.skipUnmapped}, invalid {c.skipInvalid}
    </Typography>
  );
};

const ColumnRow = (props: {
  column: Column;
  sample: string[];
  mapping: ColumnMapping | undefined;
  suggested: boolean;
  catalog: QuestionInfo[];
  taken: Map<string, string>;
  result: MappedReply["questions"][number] | undefined;
  reply: MappedReply | null;
  onQuestion: (questionId: string) => void;
  onChange: (mapping: ColumnMapping) => void;
}) => {
  const { column, mapping, result } = props;
  const question = mapping ? props.catalog.find((q) => q.id === mapping.questionId) : undefined;
  const kind = question?.kind ?? null;
  const [showTable, setShowTable] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const name = column.name;
  const options = kind === "yesNo" ? yesNoOptions : (question?.choices ?? []);
  const entries = result?.values;
  const unmapped =
    entries && mapping
      ? entries.filter((e) => {
          const s = statusOf(e, new Map(mapping.decisions).get(e.key));
          return s === "Unmapped" || s === "Suggested";
        }).length
      : 0;
  const skipped = result ? result.counts.skipEmpty + result.counts.skipUnmapped + result.counts.skipInvalid : 0;

  const mapped = Boolean(mapping && question);

  return (
    <Paper variant="outlined" sx={{ p: 2, borderColor: mapped ? "primary.light" : undefined }}>
      <Box sx={rowGrid}>
        <Box sx={{ minWidth: 0 }}>
          <Typography noWrap title={name} sx={{ fontWeight: 500 }}>
            {name}
          </Typography>
          {props.sample.length ? (
            <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: "wrap", rowGap: 0.5 }}>
              {props.sample.map((v) => (
                <Chip key={v} size="small" variant="outlined" label={v} title={v} sx={{ maxWidth: 220 }} />
              ))}
            </Stack>
          ) : (
            <Typography variant="caption" color="text.secondary">
              (no values)
            </Typography>
          )}
        </Box>

        <Box sx={{ display: "flex", justifyContent: "center", color: mapped ? "primary.main" : "action.disabled" }}>
          <ArrowForwardIcon sx={{ display: { xs: "none", md: "block" } }} />
          <ArrowDownwardIcon sx={{ display: { xs: "block", md: "none" } }} />
        </Box>

        <Stack spacing={1.5} sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <QuestionSelect
              column={name}
              value={mapping?.questionId ?? ""}
              catalog={props.catalog}
              taken={props.taken}
              onChange={props.onQuestion}
            />
            {props.suggested && mapping && <Chip size="small" color="info" label="Suggested" />}
          </Stack>

          {mapping && question && kind && (
            <>
              {question.unanswered && (
                <Typography variant="caption" color="warning.main">
                  Nobody has answered this question yet. It might be multiple choice; Scoutnet rejects the write if so.
                </Typography>
              )}
              <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", rowGap: 1 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Typography variant="body2">Empty cell</Typography>
                  <Select
                    size="small"
                    value={mapping.emptyCells}
                    onChange={(e) => props.onChange({ ...mapping, emptyCells: e.target.value })}
                    inputProps={{ "aria-label": `Empty cells in ${name}` }}
                  >
                    {emptyCellLabels[kind].map((o) => (
                      <MenuItem key={o.value} value={o.value}>
                        {o.label}
                      </MenuItem>
                    ))}
                  </Select>
                </Stack>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Typography variant="body2">Existing answer</Typography>
                  <Select
                    size="small"
                    value={mapping.existing}
                    onChange={(e) => props.onChange({ ...mapping, existing: e.target.value })}
                    inputProps={{ "aria-label": `Existing answers for ${name}` }}
                  >
                    <MenuItem value="overwrite">Overwrite</MenuItem>
                    <MenuItem value="fillEmpty">Only fill empty answers</MenuItem>
                  </Select>
                </Stack>
              </Stack>

              {result ? <Counts counts={result.counts} /> : <LinearProgress />}

              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
                {entries && (
                  <Button size="small" onClick={() => setShowTable(!showTable)}>
                    {showTable ? "Hide" : "Show"} value table ({entries.length} values
                    {unmapped > 0 ? `, ${unmapped} to decide` : ""})
                  </Button>
                )}
                {result && (
                  <Button size="small" disabled={skipped === 0} onClick={() => setShowSkipped(!showSkipped)}>
                    {showSkipped ? "Hide" : "Show"} skipped rows ({skipped})
                  </Button>
                )}
              </Stack>
            </>
          )}
        </Stack>
      </Box>

      {mapping && question && kind && entries && showTable && (
        <Box sx={{ mt: 2 }}>
          <ValueTable
            entries={entries}
            options={options}
            decisions={mapping.decisions}
            onChange={(decisions) => props.onChange({ ...mapping, decisions })}
          />
        </Box>
      )}
      {mapping && result && props.reply && showSkipped && skipped > 0 && (
        <Box sx={{ mt: 2 }}>
          <SkippedRows questionId={mapping.questionId} reply={props.reply} />
        </Box>
      )}
    </Paper>
  );
};

export const MapAnswersPage = () => {
  const state = useWizardState();
  const { spreadsheet: sheet, matching, mapping, loaded, keys } = state;
  const navigate = useNavigate();
  const [reply, setReply] = useState<MappedReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [matchedVersion, setMatchedVersion] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<Set<string>>(new Set());

  // Reads the cached questions and participants of the last load; never fetches on its own.
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
  const fetchedAt = participants.data?.fetchedAt;
  const version = loaded && fetchedAt ? `${loaded.env}:${loaded.projectId}:${fetchedAt}` : null;

  const catalog = useMemo(
    () =>
      questions.data && participants.data ? buildCatalog(questions.data.forms, participants.data.participants) : null,
    [questions.data, participants.data],
  );

  // Without a spreadsheet or matching (e.g. after a worker reset) there is nothing to map: go back.
  useEffect(() => {
    if (!sheet || !matching) void navigate({ to: "/spreadsheet" });
  }, [sheet, matching, navigate]);

  // The worker may have lost its participants or match result (worker reset), so make sure it has both:
  // send the participants if needed, then run the match again from step 3's settings.
  useEffect(() => {
    if (!version || !participants.data) return;
    let live = true;
    setMatchedVersion(null);
    const ensure = async () => {
      if (!(await ensureMatched(version, participants.data.participants))) return;
      if (live) setMatchedVersion(version);
    };
    ensure().catch((e: unknown) => {
      if (e instanceof SpreadsheetError && e.code === "superseded") return;
      if (live) setError("The rows could not be matched again. Go back to step 3.");
    });
    return () => {
      live = false;
    };
    // Once per visit and participant list; the step 3 settings cannot change while this page is shown.
  }, [version, participants.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Starts with suggested pairings, or checks the kept mappings against the columns and questions.
  const columns = sheet?.columns;
  useEffect(() => {
    if (!sheet || !catalog) return;
    const named = sheet.columns.filter((c, i) => c.name !== "" && sheet.columns.findIndex((d) => d.name === c.name) === i);
    const current = wizardStore.getState().mapping;
    if (!current) {
      const pairs = suggestPairings(
        named,
        catalog.filter((q) => q.kind !== null),
      );
      setSuggested(new Set(pairs.keys()));
      wizardStore.setMapping({
        fileName: sheet.fileName,
        mappings: [...pairs].map(([column, questionId]) => newMapping(column, questionId)),
        changes: 0,
        dropped: [],
      });
      return;
    }
    const names = new Set(named.map((c) => c.name));
    const usable = new Set(catalog.filter((q) => q.kind !== null).map((q) => q.id));
    const kept = current.mappings.filter((m) => names.has(m.column) && usable.has(m.questionId));
    if (kept.length !== current.mappings.length) {
      const dropped = current.mappings.filter((m) => !kept.includes(m)).map((m) => m.column);
      wizardStore.setMapping({ ...current, mappings: kept, dropped: [...current.dropped, ...dropped] });
    }
    // Only when the columns, the file or the questions change, or on first entry.
  }, [columns, sheet?.fileName, catalog, mapping === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const mappings = mapping?.mappings;
  const ready = matchedVersion !== null && matchedVersion === version;

  useEffect(() => {
    const current = wizardStore.getState().mapping;
    if (!current || !mappings || !catalog) return;
    if (!ready) return;
    const inputs = mappingInputs(mappings, catalog);
    const store = (changes: number) => {
      const now = wizardStore.getState().mapping;
      if (now && now.changes !== changes) wizardStore.setMapping({ ...now, changes });
    };
    if (inputs.length === 0) {
      setReply({ type: "mapped", id: 0, questions: [] });
      store(0);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      spreadsheet
        .mapAnswers(inputs)
        .then((r) => {
          if (!live) return;
          setError(null);
          setReply(r);
          store(changesOf(r));
        })
        .catch((e: unknown) => {
          if (e instanceof SpreadsheetError && e.code === "superseded") return;
          if (live) setError("The answers could not be previewed.");
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [mappings, catalog, ready]);

  if (!sheet || !matching || !mapping) return null;

  const patch = (p: Partial<MappingState>) => {
    const now = wizardStore.getState().mapping;
    if (now) wizardStore.setMapping({ ...now, ...p });
  };
  const named = sheet.columns.filter((c, i) => c.name !== "" && sheet.columns.findIndex((d) => d.name === c.name) === i);
  const taken = new Map(mapping.mappings.map((m) => [m.questionId, m.column]));
  const byColumn = new Map(mapping.mappings.map((m) => [m.column, m]));
  const results = new Map(reply?.questions.map((q) => [q.questionId, q]));

  const setQuestion = (column: string, questionId: string) => {
    setSuggested((s) => {
      const next = new Set(s);
      next.delete(column);
      return next;
    });
    patch({
      mappings: [
        ...mapping.mappings.filter((m) => m.column !== column),
        ...(questionId ? [newMapping(column, questionId)] : []),
      ],
    });
  };
  const change = (next: ColumnMapping) => {
    setSuggested((s) => {
      const copy = new Set(s);
      copy.delete(next.column);
      return copy;
    });
    patch({ mappings: mapping.mappings.map((m) => (m.column === next.column ? next : m)) });
  };

  const pending = mapping.mappings.length > 0 && (!ready || !reply) && !error;
  const nothing = mapping.mappings.length > 0 && !!reply && mapping.changes === 0;

  return (
    <Stack spacing={3}>
      {mapping.dropped.length > 0 && (
        <Alert severity="info" onClose={() => patch({ dropped: [] })}>
          Removed because their column or question is not available any more: {mapping.dropped.join(", ")}.
        </Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {(questions.isError || participants.isError) && (
        <Alert severity="error">The questions or participants are not available. Go back to step 1.</Alert>
      )}
      <Alert severity="info">
        A question that is missing from the lists needs "Inkludera svar i API" ticked in its form in Scoutnet's form
        editor. Then load the project again in step 1.
      </Alert>
      <Typography variant="body2" color="text.secondary">
        Pair each column with the question it should fill. Only the {matching.matched} matched rows are used. Values
        that are not mapped or not confirmed are never written.
      </Typography>

      {(!catalog || pending) && !error && <LinearProgress />}

      <Stack spacing={2}>
        {catalog && (
          <Box sx={{ ...rowGrid, display: { xs: "none", md: "grid" }, px: 2 }}>
            <Typography variant="overline" color="text.secondary">
              Spreadsheet column
            </Typography>
            <Box />
            <Typography variant="overline" color="text.secondary">
              Scoutnet question
            </Typography>
          </Box>
        )}
        {catalog &&
          named.map((c) => (
            <ColumnRow
              key={c.index}
              column={c}
              sample={samples(sheet.preview, sheet.columns.indexOf(c))}
              mapping={byColumn.get(c.name)}
              suggested={suggested.has(c.name)}
              catalog={catalog}
              taken={taken}
              result={byColumn.has(c.name) ? results.get(byColumn.get(c.name)!.questionId) : undefined}
              reply={reply}
              onQuestion={(q) => setQuestion(c.name, q)}
              onChange={change}
            />
          ))}
      </Stack>

      {mapping.mappings.length === 0 && catalog && <Alert severity="info">Choose a question for at least one column.</Alert>}
      {nothing && <Alert severity="warning">Nothing would change.</Alert>}
      {reply && mapping.changes > 0 && (
        <Typography>
          {mapping.changes} {mapping.changes === 1 ? "answer" : "answers"} would be set, overwritten or cleared.
        </Typography>
      )}

      <Stack direction="row" spacing={2}>
        <Button variant="outlined" onClick={() => void navigate({ to: "/match" })}>
          Back
        </Button>
        <Button variant="contained" disabled={mapping.changes === 0} onClick={() => void navigate({ to: "/review" })}>
          Continue
        </Button>
      </Stack>
    </Stack>
  );
};
