import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from "@mui/material";
import ArrowDownward from "@mui/icons-material/ArrowDownward";
import ArrowUpward from "@mui/icons-material/ArrowUpward";
import Delete from "@mui/icons-material/Delete";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { participantsQuery } from "../api.ts";
import type { ApiContext } from "../api.ts";
import type { Source, SourceKind } from "../matching/matcher.ts";
import { suggestSources } from "../matching/suggest.ts";
import { SpreadsheetError, spreadsheet } from "../spreadsheet/client.ts";
import { participantsSent, sendParticipants } from "../spreadsheet/sync.ts";
import type { Column, MatchRow, MatchedReply, MemberInfo } from "../spreadsheet/protocol.ts";
import { useWizardState, wizardStore } from "../wizard-store.ts";
import type { MatchingState } from "../wizard-store.ts";
import { VirtualList } from "./virtual-list.tsx";

const kindLabels: Record<SourceKind, string> = {
  memberNo: "Member number",
  ssno: "Personnummer",
  email: "Email",
  name: "Name",
};
const allKinds: SourceKind[] = ["memberNo", "ssno", "email", "name"];

const layoutLabels = {
  firstLast: "First Last",
  lastFirst: "Last, First",
  split: "Separate columns",
} as const;
type Layout = keyof typeof layoutLabels;

const columnsOf = (source: Source): string[] =>
  source.kind === "name" && source.layout === "split" ? [source.first, source.last] : [source.column];

const isComplete = (source: Source): boolean => columnsOf(source).every((c) => c !== "");

const emptySource = (kind: SourceKind): Source =>
  kind === "name" ? { kind, layout: "firstLast", column: "" } : { kind, column: "" };

const describe = (source: Source): string => {
  const cols = columnsOf(source).filter((c) => c !== "");
  return cols.length ? `${kindLabels[source.kind]} (${cols.join(", ")})` : kindLabels[source.kind];
};

const memberLabel = (m: MemberInfo): string =>
  [[m.firstName, m.lastName].filter(Boolean).join(" "), m.memberNo, m.email].filter(Boolean).join(" · ");

const withLayout = (source: Source, layout: Layout): Source => {
  if (source.kind !== "name") return source;
  const first = source.layout === "split" ? source.first : source.column;
  if (layout === "split") return { kind: "name", layout, first, last: source.layout === "split" ? source.last : "" };
  return { kind: "name", layout, column: first };
};

const ColumnSelect = (props: {
  label: string;
  value: string;
  columns: Column[];
  onChange: (value: string) => void;
}) => (
  <Select
    size="small"
    displayEmpty
    value={props.columns.some((c) => c.name === props.value) ? props.value : ""}
    onChange={(e) => props.onChange(e.target.value)}
    inputProps={{ "aria-label": props.label }}
    sx={{ minWidth: 180, maxWidth: 260 }}
  >
    <MenuItem value="" disabled>
      <em>{props.label}</em>
    </MenuItem>
    {props.columns.map((c) => (
      <MenuItem key={c.index} value={c.name}>
        {c.name || `(column ${c.letter})`}
      </MenuItem>
    ))}
  </Select>
);

const SourceRow = (props: {
  source: Source;
  index: number;
  count: number;
  columns: Column[];
  onChange: (source: Source) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) => {
  const { source, columns } = props;
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
    >
      <Typography sx={{ minWidth: 120 }}>
        {props.index + 1}. {kindLabels[source.kind]}
      </Typography>
      {source.kind === "name" && (
        <Select
          size="small"
          value={source.layout}
          onChange={(e) => props.onChange(withLayout(source, e.target.value as Layout))}
          inputProps={{ "aria-label": "Name layout" }}
        >
          {(Object.keys(layoutLabels) as Layout[]).map((l) => (
            <MenuItem key={l} value={l}>
              {layoutLabels[l]}
            </MenuItem>
          ))}
        </Select>
      )}
      {source.kind === "name" && source.layout === "split" ? (
        <>
          <ColumnSelect
            label="First name column"
            value={source.first}
            columns={columns}
            onChange={(first) => props.onChange({ ...source, first })}
          />
          <ColumnSelect
            label="Last name column"
            value={source.last}
            columns={columns}
            onChange={(last) => props.onChange({ ...source, last })}
          />
        </>
      ) : (
        <ColumnSelect
          label="Column"
          value={(source as { column: string }).column}
          columns={columns}
          onChange={(column) => props.onChange({ ...source, column } as Source)}
        />
      )}
      <IconButton aria-label="Move up" disabled={props.index === 0} onClick={() => props.onMove(-1)}>
        <ArrowUpward />
      </IconButton>
      <IconButton
        aria-label="Move down"
        disabled={props.index === props.count - 1}
        onClick={() => props.onMove(1)}
      >
        <ArrowDownward />
      </IconButton>
      <IconButton aria-label="Remove source" onClick={props.onRemove}>
        <Delete />
      </IconButton>
    </Stack>
  );
};

const RowSummary = (props: { row: MatchRow; sources: Source[] }) => {
  const text = props.sources
    .map((s, i) => (props.row.cells[i] ? `${kindLabels[s.kind]}: ${props.row.cells[i]}` : null))
    .filter(Boolean)
    .join(" | ");
  return (
    <>
      <Typography sx={{ width: 64, flexShrink: 0 }}>Row {props.row.sheetRow}</Typography>
      <Typography noWrap sx={{ flex: 1, minWidth: 0 }} title={text}>
        {text || "(empty)"}
      </Typography>
    </>
  );
};

const pickerSx = { width: 300, flexShrink: 0 };

export const MatchRowsPage = () => {
  const state = useWizardState();
  const { spreadsheet: sheet, matching, loaded, keys, includeCancelled, includeUnconfirmed } = state;
  const navigate = useNavigate();
  const [reply, setReply] = useState<MatchedReply | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readyVersion, setReadyVersion] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [menu, setMenu] = useState<HTMLElement | null>(null);

  // Reads the cached participants of the last load; never fetches on its own.
  const ctx: ApiContext = { projectId: loaded?.projectId ?? "", env: loaded?.env ?? "production", keys };
  const participants = useQuery({
    ...participantsQuery(ctx),
    enabled: loaded !== null,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const fetchedAt = participants.data?.fetchedAt;
  const version = loaded && fetchedAt ? `${loaded.env}:${loaded.projectId}:${fetchedAt}` : null;

  // Starts with suggested sources, or checks the kept ones against the current columns by name.
  const columns = sheet?.columns;
  useEffect(() => {
    if (!sheet) return;
    if (!matching) {
      const suggested = suggestSources(sheet.columns);
      wizardStore.setMatching({
        fileName: sheet.fileName,
        sources: suggested.length ? suggested : [emptySource("memberNo")],
        resolutions: [],
        winners: [],
        matched: 0,
        dropped: [],
      });
      return;
    }
    const names = new Set(sheet.columns.map((c) => c.name));
    const kept = matching.sources.filter((s) => columnsOf(s).every((c) => c === "" || names.has(c)));
    if (kept.length !== matching.sources.length) {
      const dropped = matching.sources.filter((s) => !kept.includes(s)).map((s) => describe(s));
      wizardStore.setMatching({ ...matching, sources: kept, dropped: [...matching.dropped, ...dropped] });
    }
    // Only when the columns (or the file) change, or on first entry.
  }, [columns, sheet?.fileName, matching === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sends the participants to the worker when the list is new.
  useEffect(() => {
    if (!version || !participants.data) return;
    if (participantsSent(version)) {
      setReadyVersion(version);
      return;
    }
    let live = true;
    setReadyVersion(null);
    sendParticipants(version, participants.data.participants)
      .then(() => {
        if (live) setReadyVersion(version);
      })
      .catch((e: unknown) => {
        if (e instanceof SpreadsheetError && e.code === "superseded") return;
        if (live) setError("The participants could not be prepared for matching.");
      });
    return () => {
      live = false;
    };
  }, [version, participants.data]);

  const sources = matching?.sources;
  const resolutions = matching?.resolutions;
  const winners = matching?.winners;
  const ready = readyVersion !== null && readyVersion === version;
  const complete = !!sources && sources.length > 0 && sources.every(isComplete);

  useEffect(() => {
    const current = wizardStore.getState().matching;
    if (!current || !sources || !resolutions || !winners) return;
    if (!complete || !ready || !sheet) {
      setReply(null);
      if (current.matched !== 0) wizardStore.setMatching({ ...current, matched: 0 });
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      spreadsheet
        .match({ sources, includeCancelled, includeUnconfirmed, resolutions, winners })
        .then((r) => {
          if (!live) return;
          setError(null);
          setReply(r);
          const now = wizardStore.getState().matching;
          if (now && now.matched !== r.totals.matched) {
            wizardStore.setMatching({ ...now, matched: r.totals.matched });
          }
        })
        .catch((e: unknown) => {
          if (e instanceof SpreadsheetError && e.code === "superseded") return;
          if (live) setError("The rows could not be matched.");
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [sources, resolutions, winners, includeCancelled, includeUnconfirmed, complete, ready, sheet]);

  if (!sheet || !matching) return null;
  const cols = sheet.columns;

  const patch = (p: Partial<MatchingState>) => {
    const now = wizardStore.getState().matching;
    if (now) wizardStore.setMatching({ ...now, ...p });
  };
  const setSources = (next: Source[]) => patch({ sources: next });
  const unused = allKinds.filter((k) => !matching.sources.some((s) => s.kind === k));

  const pickResolution = (sheetRow: number, memberNo: string) =>
    patch({
      resolutions: [
        ...matching.resolutions.filter(([r]) => r !== sheetRow),
        ...(memberNo ? [[sheetRow, memberNo] as [number, string]] : []),
      ],
    });
  const pickWinner = (memberNo: string, value: string) =>
    patch({
      winners: [
        ...matching.winners.filter(([m]) => m !== memberNo),
        ...(value ? [[memberNo, value === "skip" ? "skip" : Number(value)] as [string, number | "skip"]] : []),
      ],
    });

  const t = reply?.totals;
  const missing = new Set(reply?.missingSources ?? []);
  const busyMatching = complete && !reply;
  const tabLabels = [
    `Ambiguous (${reply?.ambiguous.length ?? 0})`,
    `Conflicts (${reply?.conflicts.length ?? 0})`,
    `Unmatched (${reply?.unmatched.length ?? 0})`,
    `Excluded (${reply?.excluded.length ?? 0})`,
    `Without a row (${reply?.withoutRow.length ?? 0})`,
  ];

  return (
    <Stack spacing={3}>
      {matching.dropped.length > 0 && (
        <Alert severity="info" onClose={() => patch({ dropped: [] })}>
          Removed because their columns are not in the spreadsheet any more: {matching.dropped.join(", ")}.
        </Alert>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {participants.isError && <Alert severity="error">The participants are not available. Go back to step 1.</Alert>}

      <Stack spacing={2}>
        <Typography variant="h6" component="h2">
          Match sources
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Each row is matched on the first source that gives exactly one participant. Order them by how reliable they
          are.
        </Typography>
        {matching.sources.map((source, i) => (
          <SourceRow
            key={source.kind}
            source={source}
            index={i}
            count={matching.sources.length}
            columns={cols}
            onChange={(next) => setSources(matching.sources.map((s, j) => (j === i ? next : s)))}
            onMove={(delta) => {
              const next = [...matching.sources];
              [next[i], next[i + delta]] = [next[i + delta], next[i]];
              setSources(next);
            }}
            onRemove={() => setSources(matching.sources.filter((_, j) => j !== i))}
          />
        ))}
        <Box>
          <Button variant="outlined" disabled={unused.length === 0} onClick={(e) => setMenu(e.currentTarget)}>
            Add source
          </Button>
          <Menu anchorEl={menu} open={menu !== null} onClose={() => setMenu(null)}>
            {unused.map((k) => (
              <MenuItem
                key={k}
                onClick={() => {
                  setMenu(null);
                  setSources([...matching.sources, emptySource(k)]);
                }}
              >
                {kindLabels[k]}
              </MenuItem>
            ))}
          </Menu>
        </Box>
      </Stack>

      {(!ready || busyMatching) && complete && !error && <LinearProgress />}
      {!complete && (
        <Alert severity="info">Choose the columns of every source to match the rows.</Alert>
      )}
      {complete && matching.matched === 0 && reply && (
        <Alert severity="warning">No rows match yet. Check the sources and columns above.</Alert>
      )}

      {reply && t && (
        <Stack spacing={2}>
          <Typography variant="h6" component="h2">
            Counts
          </Typography>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Source</TableCell>
                  <TableCell align="right">Unique</TableCell>
                  <TableCell align="right">Ambiguous</TableCell>
                  <TableCell align="right">No match</TableCell>
                  <TableCell align="right">Empty</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {matching.sources.map((s, i) => {
                  const c = reply.sourceCounts[i];
                  return (
                    <TableRow key={s.kind}>
                      <TableCell sx={{ whiteSpace: "nowrap" }}>
                        {describe(s)}{" "}
                        {missing.has(i) && <Chip size="small" color="warning" label="Column missing" />}
                      </TableCell>
                      <TableCell align="right">{c?.unique ?? 0}</TableCell>
                      <TableCell align="right">{c?.ambiguous ?? 0}</TableCell>
                      <TableCell align="right">{c?.none ?? 0}</TableCell>
                      <TableCell align="right">{c?.empty ?? 0}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell>Matched</TableCell>
                  <TableCell align="right">{t.matched}</TableCell>
                  <TableCell>
                    {[
                      ...matching.sources.map((s, i) => `${kindLabels[s.kind]} ${t.matchedBySource[i] ?? 0}`),
                      `picked by you ${t.matchedByResolution}`,
                    ].join(", ")}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Ambiguous</TableCell>
                  <TableCell align="right">{t.ambiguous}</TableCell>
                  <TableCell />
                </TableRow>
                <TableRow>
                  <TableCell>Unmatched</TableCell>
                  <TableCell align="right">{t.unmatched}</TableCell>
                  <TableCell />
                </TableRow>
                <TableRow>
                  <TableCell>Excluded</TableCell>
                  <TableCell align="right">{t.excluded}</TableCell>
                  <TableCell>matches a cancelled or unconfirmed participant</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>In conflict</TableCell>
                  <TableCell align="right">{t.conflictRows}</TableCell>
                  <TableCell>rows pointing to the same participant, not picked as the winner</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
          <Typography variant="body2" color="text.secondary">
            {t.matched} + {t.ambiguous} + {t.unmatched} + {t.excluded} + {t.conflictRows} ={" "}
            {t.matched + t.ambiguous + t.unmatched + t.excluded + t.conflictRows} of {sheet.rowCount} rows
          </Typography>

          <Box>
            <Tabs value={tab} onChange={(_, v: number) => setTab(v)} variant="scrollable" scrollButtons="auto">
              {tabLabels.map((label) => (
                <Tab key={label} label={label} />
              ))}
            </Tabs>
          </Box>

          {tab === 0 && (
            <Stack spacing={1}>
              {matching.resolutions.length > 0 && (
                <Box>
                  <Button size="small" onClick={() => patch({ resolutions: [] })}>
                    Clear the {matching.resolutions.length} rows you picked
                  </Button>
                </Box>
              )}
              <VirtualList
                items={reply.ambiguous}
                empty="No ambiguous rows."
                render={(row) => (
                  <>
                    <RowSummary row={row} sources={matching.sources} />
                    <Select
                      size="small"
                      displayEmpty
                      value=""
                      onChange={(e) => pickResolution(row.sheetRow, e.target.value)}
                      inputProps={{ "aria-label": `Participant for row ${row.sheetRow}` }}
                      sx={pickerSx}
                    >
                      <MenuItem value="">Leave out</MenuItem>
                      {row.candidates.map((m) => (
                        <MenuItem key={m.memberNo} value={m.memberNo}>
                          {memberLabel(m)}
                        </MenuItem>
                      ))}
                    </Select>
                  </>
                )}
              />
            </Stack>
          )}
          {tab === 1 && (
            <VirtualList
              items={reply.conflicts}
              empty="No conflicts."
              render={(c) => (
                <>
                  <Typography noWrap sx={{ flex: 1, minWidth: 0 }} title={memberLabel(c.member)}>
                    {memberLabel(c.member)}
                  </Typography>
                  <Select
                    size="small"
                    displayEmpty
                    value={c.winner === null ? "" : String(c.winner)}
                    onChange={(e) => pickWinner(c.member.memberNo, e.target.value)}
                    inputProps={{ "aria-label": `Winning row for ${c.member.memberNo}` }}
                    sx={pickerSx}
                  >
                    <MenuItem value="">Choose a row</MenuItem>
                    {c.rows.map((r) => (
                      <MenuItem key={r.sheetRow} value={String(r.sheetRow)}>
                        Row {r.sheetRow}
                        {Object.values(r.cells).length ? `: ${Object.values(r.cells).join(" | ")}` : ""}
                      </MenuItem>
                    ))}
                    <MenuItem value="skip">Skip all</MenuItem>
                  </Select>
                </>
              )}
            />
          )}
          {tab === 2 && (
            <VirtualList
              items={reply.unmatched}
              empty="No unmatched rows."
              render={(row) => <RowSummary row={row} sources={matching.sources} />}
            />
          )}
          {tab === 3 && (
            <VirtualList
              items={reply.excluded}
              empty="No rows match a cancelled or unconfirmed participant."
              render={(row) => <RowSummary row={row} sources={matching.sources} />}
            />
          )}
          {tab === 4 && (
            <VirtualList
              items={reply.withoutRow}
              empty="Every participant has a row."
              render={(m) => (
                <>
                  <Typography noWrap sx={{ flex: 1, minWidth: 0 }} title={memberLabel(m)}>
                    {memberLabel(m)}
                  </Typography>
                  {m.pending && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={m.pending === "ambiguous" ? "In an ambiguous row" : "In a conflict"}
                    />
                  )}
                </>
              )}
            />
          )}
        </Stack>
      )}

      <Stack direction="row" spacing={2}>
        <Button variant="outlined" onClick={() => void navigate({ to: "/spreadsheet" })}>
          Back
        </Button>
        <Button
          variant="contained"
          disabled={matching.matched === 0}
          onClick={() => void navigate({ to: "/map" })}
        >
          Continue
        </Button>
      </Stack>
    </Stack>
  );
};
