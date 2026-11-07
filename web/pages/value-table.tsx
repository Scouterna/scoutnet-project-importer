import { Box, Button, Chip, Menu, MenuItem, Select, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { SpreadsheetError, spreadsheet } from "../spreadsheet/client.ts";
import type { MappedReply, SkippedReply } from "../spreadsheet/protocol.ts";
import type { ValueEntry } from "../mapping/table.ts";
import { VirtualList } from "./virtual-list.tsx";

export type Option = { id: string; label: string };
type Decisions = [string, string][];

export const statusOf = (
  entry: ValueEntry,
  decision: string | undefined,
): "Certain" | "Suggested" | "Mapped" | "Skipped" | "Unmapped" => {
  if (decision === "skip") return "Skipped";
  if (decision !== undefined) return "Mapped";
  if (entry.auto !== null) return "Certain";
  return entry.suggestion !== null ? "Suggested" : "Unmapped";
};

const statusColor = {
  Certain: "success",
  Suggested: "warning",
  Mapped: "primary",
  Skipped: "default",
  Unmapped: "error",
} as const;

const withDecisions = (decisions: Decisions, add: Decisions): Decisions => {
  const keys = new Set(add.map(([k]) => k));
  return [...decisions.filter(([k]) => !keys.has(k)), ...add];
};

// Values without a decision and without an exact label match
const remaining = (entries: ValueEntry[], decisions: Decisions): ValueEntry[] => {
  const decided = new Set(decisions.map(([k]) => k));
  return entries.filter((e) => !decided.has(e.key) && e.auto === null);
};

export const ValueTable = (props: {
  entries: ValueEntry[];
  options: Option[];
  decisions: Decisions;
  onChange: (decisions: Decisions) => void;
}) => {
  const { entries, options, decisions, onChange } = props;
  const [search, setSearch] = useState("");
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const decided = useMemo(() => new Map(decisions), [decisions]);
  const label = (id: string) => options.find((o) => o.id === id)?.label ?? id;

  const shown = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("sv");
    if (q === "") return entries;
    return entries.filter((e) => [e.value, ...e.variants].some((v) => v.toLocaleLowerCase("sv").includes(q)));
  }, [entries, search]);

  const rest = remaining(entries, decisions);
  const suggested = rest.filter((e) => e.suggestion !== null);
  const set = (key: string, value: string) => onChange(withDecisions(decisions, [[key, value]]));

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
        <TextField
          size="small"
          placeholder="Search values"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{ htmlInput: { "aria-label": "Search values" } }}
        />
        <Button
          size="small"
          disabled={suggested.length === 0}
          onClick={() => onChange(withDecisions(decisions, suggested.map((e) => [e.key, e.suggestion!])))}
        >
          Confirm all suggestions ({suggested.length})
        </Button>
        <Button size="small" disabled={rest.length === 0} onClick={(e) => setMenu(e.currentTarget)}>
          Map all remaining to… ({rest.length})
        </Button>
        <Menu anchorEl={menu} open={menu !== null} onClose={() => setMenu(null)}>
          {options.map((o) => (
            <MenuItem
              key={o.id}
              onClick={() => {
                setMenu(null);
                onChange(withDecisions(decisions, rest.map((e) => [e.key, o.id])));
              }}
            >
              {o.label}
            </MenuItem>
          ))}
        </Menu>
        <Button
          size="small"
          disabled={rest.length === 0}
          onClick={() => onChange(withDecisions(decisions, rest.map((e) => [e.key, "skip"])))}
        >
          Skip all remaining ({rest.length})
        </Button>
      </Stack>
      <VirtualList
        items={shown}
        rowHeight={64}
        empty={entries.length === 0 ? "No values." : "No values match the search."}
        render={(e) => {
          const decision = decided.get(e.key);
          const status = statusOf(e, decision);
          const current = decision ?? e.auto ?? e.suggestion ?? "";
          return (
            <>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap title={e.value}>
                  {e.value}{" "}
                  <Typography component="span" variant="body2" color="text.secondary">
                    {e.rows} {e.rows === 1 ? "row" : "rows"}
                  </Typography>
                </Typography>
                {e.variants.length > 0 && (
                  <Typography noWrap variant="caption" color="text.secondary" title={e.variants.join(", ")}>
                    Also: {e.variants.join(", ")}
                  </Typography>
                )}
              </Box>
              <Chip size="small" color={statusColor[status]} variant="outlined" label={status} sx={{ width: 88 }} />
              <Select
                size="small"
                displayEmpty
                value={current}
                onChange={(ev) => set(e.key, ev.target.value)}
                inputProps={{ "aria-label": `Option for ${e.value}` }}
                sx={{ width: 220, flexShrink: 0 }}
              >
                <MenuItem value="" disabled>
                  <em>Choose…</em>
                </MenuItem>
                {options.map((o) => (
                  <MenuItem key={o.id} value={o.id}>
                    {o.label}
                  </MenuItem>
                ))}
                <MenuItem value="skip">Skip</MenuItem>
              </Select>
              <Box sx={{ width: 84, flexShrink: 0 }}>
                {status === "Suggested" && (
                  <Button size="small" onClick={() => set(e.key, e.suggestion!)} title={`Confirm ${label(e.suggestion!)}`}>
                    Confirm
                  </Button>
                )}
              </Box>
            </>
          );
        }}
      />
    </Stack>
  );
};

const reasonLabels = {
  skipEmpty: "empty cell",
  skipUnmapped: "value not mapped",
  skipInvalid: "invalid value",
} as const;

// Loads the skipped rows from the worker when shown, and again when the preview changes.
export const SkippedRows = (props: { questionId: string; reply: MappedReply }) => {
  const [rows, setRows] = useState<SkippedReply["rows"] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    spreadsheet
      .skippedRows(props.questionId)
      .then((r) => live && setRows(r.rows))
      .catch((e: unknown) => {
        if (e instanceof SpreadsheetError && e.code === "superseded") return;
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [props.questionId, props.reply]);
  if (failed) return <Typography color="error">The skipped rows could not be listed.</Typography>;
  if (!rows) return <Typography color="text.secondary">Loading…</Typography>;
  return (
    <VirtualList
      items={rows}
      empty="No rows are skipped."
      rowHeight={44}
      render={(r) => (
        <>
          <Typography sx={{ width: 72, flexShrink: 0 }}>Row {r.sheetRow}</Typography>
          <Typography noWrap sx={{ flex: 1, minWidth: 0 }} title={r.value}>
            {r.value || "(empty)"}
          </Typography>
          <Typography color="text.secondary" sx={{ flexShrink: 0 }}>
            {reasonLabels[r.reason]}
          </Typography>
        </>
      )}
    />
  );
};
