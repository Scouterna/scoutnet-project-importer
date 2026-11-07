import {
  Alert,
  Box,
  Button,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { SpreadsheetError, spreadsheet } from "../spreadsheet/client.ts";
import { columnLetter } from "../spreadsheet/headers.ts";
import type { Stage } from "../spreadsheet/protocol.ts";
import { useWizardState, wizardStore } from "../wizard-store.ts";
import type { SpreadsheetState } from "../wizard-store.ts";

const stageLabels: Record<Stage, string> = {
  reading: "Reading file…",
  parsing: "Parsing…",
  indexing: "Preparing…",
};

const accept = ".xlsx,.xls,.ods,.csv";

const cellSx = { maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

export const LoadSpreadsheetPage = () => {
  const { spreadsheet: current } = useWizardState();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<Stage>("reading");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const run = useRef(0);

  useEffect(() => spreadsheet.onProgress(setStage), []);

  // Runs a request chain; a newer chain makes this one's results and errors irrelevant.
  const track = async (work: (isCurrent: () => boolean) => Promise<void>, label: string, isLoad: boolean) => {
    const mine = ++run.current;
    setBusy(true);
    setLoading(isLoad);
    setError(null);
    if (isLoad) setStage("reading");
    try {
      await work(() => run.current === mine);
    } catch (e) {
      if (e instanceof SpreadsheetError && e.code === "superseded") return;
      if (run.current === mine) {
        setError(`${label}: ${e instanceof Error ? e.message : "The spreadsheet could not be read."}`);
      }
    } finally {
      if (run.current === mine) {
        setBusy(false);
        setLoading(false);
      }
    }
  };

  const openFile = (file: File) =>
    track(
      async (isCurrent) => {
        const loaded = await spreadsheet.load(file);
        try {
          const sheet = await spreadsheet.selectSheet(loaded.sheet);
          const table = await spreadsheet.selectHeader(sheet.headerRow);
          if (!isCurrent()) return;
          wizardStore.setSpreadsheet({
            fileName: loaded.fileName,
            sheets: loaded.sheets,
            sheet: sheet.sheet,
            headerRow: sheet.headerRow,
            guessedHeaderRow: sheet.headerRow,
            topRows: sheet.topRows,
            columns: table.columns,
            rowCount: table.rowCount,
            preview: table.preview,
          });
        } catch (e) {
          // The worker already swapped to the new workbook, so the old view no longer matches it.
          if (!(e instanceof SpreadsheetError && e.code === "superseded")) {
            wizardStore.setSpreadsheet(null);
          }
          throw e;
        }
      },
      `Could not open "${file.name}"`,
      true,
    );

  const changeSheet = (current: SpreadsheetState, name: string) =>
    track(
      async (isCurrent) => {
        const sheet = await spreadsheet.selectSheet(name);
        const table = await spreadsheet.selectHeader(sheet.headerRow);
        if (!isCurrent()) return;
        wizardStore.setSpreadsheet({
          ...current,
          sheet: sheet.sheet,
          headerRow: sheet.headerRow,
          guessedHeaderRow: sheet.headerRow,
          topRows: sheet.topRows,
          columns: table.columns,
          rowCount: table.rowCount,
          preview: table.preview,
        });
      },
      `Could not open sheet "${name}"`,
      false,
    );

  const changeHeader = (current: SpreadsheetState, row: number) =>
    track(
      async (isCurrent) => {
        const table = await spreadsheet.selectHeader(row);
        if (!isCurrent()) return;
        wizardStore.setSpreadsheet({
          ...current,
          headerRow: row,
          columns: table.columns,
          rowCount: table.rowCount,
          preview: table.preview,
        });
      },
      `Could not use row ${row} as the header`,
      false,
    );

  const pick = (files: FileList | null | undefined) => {
    const file = files?.[0];
    if (file) void openFile(file);
    if (input.current) input.current.value = "";
  };

  const width = current ? Math.max(0, ...current.topRows.map((r) => r.cells.length)) : 0;
  const sheetInfo = current?.sheets.find((s) => s.name === current.sheet);

  return (
    <Stack spacing={3}>
      <Box
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) pick(e.dataTransfer.files);
        }}
        sx={{
          border: 2,
          borderStyle: "dashed",
          borderColor: dragging ? "primary.main" : "divider",
          bgcolor: dragging ? "action.hover" : undefined,
          borderRadius: 1,
          p: 3,
          textAlign: "center",
        }}
      >
        <Stack spacing={1} sx={{ alignItems: "center" }}>
          <Typography>Drop a spreadsheet here, or</Typography>
          <input
            ref={input}
            type="file"
            accept={accept}
            hidden
            onChange={(e) => pick(e.target.files)}
          />
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            Choose file
          </Button>
          <Typography variant="body2" color="text.secondary">
            Excel (.xlsx, .xls), OpenDocument (.ods) or CSV. The file stays in your browser.
          </Typography>
        </Stack>
      </Box>

      {loading && (
        <Box>
          <Typography variant="body2" gutterBottom>
            {stageLabels[stage]}
          </Typography>
          <LinearProgress />
        </Box>
      )}

      {error && <Alert severity="error">{error}</Alert>}

      {current && (
        <Stack spacing={3} sx={{ opacity: busy ? 0.6 : 1 }} aria-busy={busy}>
          {current.sheets.length > 1 && (
            <Stack spacing={1}>
              <Typography variant="subtitle2" id="sheet-label">
                Sheet
              </Typography>
              <Select
                size="small"
                value={current.sheet}
                disabled={busy}
                onChange={(e) => void changeSheet(current, e.target.value)}
                slotProps={{ input: { "aria-labelledby": "sheet-label" } }}
                sx={{ maxWidth: 400 }}
              >
                {current.sheets.map((s) => (
                  <MenuItem key={s.name} value={s.name}>
                    {s.name} ({s.rows} rows{s.empty ? ", empty" : ""})
                  </MenuItem>
                ))}
              </Select>
            </Stack>
          )}

          <Stack spacing={1}>
            <Typography variant="h6" component="h2">
              Header row
            </Typography>
            <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Typography variant="body2" id="header-label">
                Header is on row
              </Typography>
              <Select
                size="small"
                value={current.topRows.some((r) => r.sheetRow === current.headerRow) ? current.headerRow : ""}
                disabled={busy}
                onChange={(e) => void changeHeader(current, Number(e.target.value))}
                slotProps={{ input: { "aria-labelledby": "header-label" } }}
              >
                {current.topRows.map((r) => (
                  <MenuItem key={r.sheetRow} value={r.sheetRow}>
                    {r.sheetRow}
                    {r.sheetRow === current.guessedHeaderRow ? " (guessed)" : ""}
                  </MenuItem>
                ))}
              </Select>
            </Stack>
            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 320 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Row</TableCell>
                    {Array.from({ length: width }, (_, i) => (
                      <TableCell key={i}>{columnLetter(i)}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {current.topRows.map((r) => (
                    <TableRow
                      key={r.sheetRow}
                      selected={r.sheetRow === current.headerRow}
                    >
                      <TableCell>{r.sheetRow}</TableCell>
                      {Array.from({ length: width }, (_, i) => (
                        <TableCell key={i} sx={cellSx}>
                          {r.cells[i]?.text ?? ""}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Stack>

          <Stack spacing={1}>
            <Typography variant="h6" component="h2">
              Preview
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    {current.columns.map((c) => (
                      <TableCell key={c.index} sx={cellSx}>
                        {c.name}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {current.preview.map((r) => (
                    <TableRow key={r.sheetRow}>
                      {current.columns.map((c, i) => (
                        <TableCell key={c.index} sx={cellSx}>
                          {r.cells[i]?.text ?? ""}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {current.rowCount === 0 ? (
              <Alert severity="warning">
                There are no data rows below the header row. Choose another header row
                {current.sheets.length > 1 ? " or sheet" : ""}.
              </Alert>
            ) : (
              <Typography>
                {current.rowCount} rows, {current.columns.length} columns
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary">
              {current.fileName}
              {current.sheets.length > 1 || sheetInfo ? `, sheet "${current.sheet}"` : ""}
            </Typography>
          </Stack>
        </Stack>
      )}

      <Stack direction="row" spacing={2}>
        <Button variant="outlined" onClick={() => void navigate({ to: "/" })}>
          Back
        </Button>
        <Button
          variant="contained"
          disabled={!current || current.rowCount === 0 || busy}
          onClick={() => void navigate({ to: "/match" })}
        >
          Continue
        </Button>
      </Stack>
    </Stack>
  );
};
