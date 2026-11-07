import {
  Alert,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Link,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { apiPageUrl, parseProject } from "../../shared/project-id.ts";
import { ApiError, participantsQuery, questionsQuery } from "../api.ts";
import type { ApiContext, Endpoint } from "../api.ts";
import { queryClient } from "../query-client.ts";
import { summarise } from "../summary.ts";
import { useWizardState, wizardStore } from "../wizard-store.ts";
import type { Keys } from "../wizard-store.ts";

// Names and order as on the project's "Webbkoppling" tab in Scoutnet.
const endpointNames: Record<Endpoint, string> = {
  participants: "Get a list of members who are registered on the project",
  checkin: "Update the check-in state of participant(s) on the project",
  questions: "Get questions and accepted values for questionnaire or group questions",
};

const keyFields: { name: keyof Keys; helper?: string }[] = [
  { name: "participants" },
  { name: "checkin", helper: "Used when writing answers back, not when loading." },
  { name: "questions" },
];

export const KeyField = (props: {
  label: string;
  helper?: string;
  value: string;
  onChange: (value: string) => void;
}) => {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      type={visible ? "text" : "password"}
      label={props.label}
      helperText={props.helper}
      autoComplete="off"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      slotProps={{
        htmlInput: {
          spellCheck: false,
          autoCapitalize: "off",
          autoCorrect: "off",
          // Opt-outs read by 1Password, LastPass, Bitwarden and Dashlane
          "data-1p-ignore": "",
          "data-lpignore": "true",
          "data-bwignore": "",
          "data-form-type": "other",
        },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                edge="end"
                aria-label={visible ? "Hide key" : "Show key"}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <VisibilityOff /> : <Visibility />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
};

const errorText = (error: ApiError): string => {
  switch (error.code) {
    case "credentials_rejected":
      return `Scoutnet rejected the key for "${endpointNames[error.endpoint]}".`;
    case "upstream_unreachable":
      return "Scoutnet could not be reached.";
    default:
      return error.message;
  }
};

export const LoadProjectPage = () => {
  const state = useWizardState();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const parsed = parseProject(state.projectInput);
  const projectId = parsed.ok ? parsed.id : null;
  const env = parsed.ok ? parsed.env : "production";
  const inputError =
    state.projectInput.trim() === "" || parsed.ok
      ? null
      : parsed.reason === "unknown_host"
        ? "That address is not a Scoutnet server."
        : "Enter a project ID or a Scoutnet project URL.";
  // The check-in key is only needed when writing, in a later step.
  const needed: Endpoint[] = ["questions", "participants"];
  const hasKeys = needed.every((endpoint) => state.keys[endpoint].trim() !== "");

  const ctx: ApiContext | null = projectId
    ? { projectId, env, keys: state.keys }
    : null;

  const load = async () => {
    if (!ctx) return;
    setLoading(true);
    setError(null);
    wizardStore.setLoaded(null);
    // Clicking Load always refetches, even when the cache already has this project.
    const results = await Promise.allSettled([
      queryClient.fetchQuery({ ...questionsQuery(ctx), staleTime: 0 }),
      queryClient.fetchQuery({ ...participantsQuery(ctx), staleTime: 0 }),
    ]);
    setLoading(false);
    const failed = results.find((r) => r.status === "rejected");
    if (failed) {
      const reason = failed.reason;
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError("upstream_unreachable", "questions", 0, String(reason)),
      );
      return;
    }
    wizardStore.setLoaded({ projectId: ctx.projectId, env });
  };

  // Reads the cached data of the last load; never fetches on its own.
  const cacheCtx: ApiContext = {
    projectId: state.loaded?.projectId ?? "",
    env: state.loaded?.env ?? env,
    keys: state.keys,
  };
  const enabled = state.loaded !== null;
  const cachedQuestions = useQuery({ ...questionsQuery(cacheCtx), enabled });
  const cachedParticipants = useQuery({ ...participantsQuery(cacheCtx), enabled });
  const summary =
    cachedQuestions.data && cachedParticipants.data
      ? summarise(cachedQuestions.data, cachedParticipants.data, state)
      : null;

  return (
    <Stack spacing={3}>
      <Stack spacing={1}>
        <TextField
          label="Project ID or URL"
          value={state.projectInput}
          onChange={(e) => wizardStore.setProjectInput(e.target.value)}
          error={inputError !== null}
          helperText={
            inputError ??
            (projectId
              ? `Project ${projectId} on ${env === "test" ? "the test server" : "production"}`
              : "Paste the project's ID or its Scoutnet URL.")
          }
        />
        {projectId && (
          <Link href={apiPageUrl(env, projectId)} target="_blank" rel="noopener noreferrer">
            Open the project's API page in Scoutnet to find the keys
          </Link>
        )}
      </Stack>

      <Stack spacing={2}>
        {keyFields.map((field) => (
          <KeyField
            key={field.name}
            label={endpointNames[field.name]}
            helper={field.helper}
            value={state.keys[field.name]}
            onChange={(value) => wizardStore.setKey(field.name, value)}
          />
        ))}
        <Button sx={{ alignSelf: "flex-start" }} onClick={wizardStore.forgetKeys}>
          Forget keys
        </Button>
      </Stack>

      <Button
        variant="contained"
        sx={{ alignSelf: "flex-start" }}
        disabled={!projectId || !hasKeys || loading}
        startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
        onClick={() => void load()}
      >
        {loading ? "Loading…" : "Load"}
      </Button>

      {error && (
        <Alert
          severity="error"
          action={
            error.code === "upstream_unreachable" ? (
              <Button color="inherit" size="small" onClick={() => void load()}>
                Try again
              </Button>
            ) : undefined
          }
        >
          {errorText(error)}
        </Alert>
      )}

      {summary && state.loaded && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={1}>
              <Typography variant="h6">Project {state.loaded.projectId}</Typography>
              <Typography>
                {summary.total} participants, of which {summary.cancelled} cancelled and{" "}
                {summary.unconfirmed} unconfirmed
              </Typography>
              <Typography>
                {summary.forms} forms, {summary.questions} questions
              </Typography>
              <Typography color="text.secondary" variant="body2">
                Fetched {new Date(summary.fetchedAt).toLocaleString()}
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={state.includeCancelled}
                    onChange={(e) => wizardStore.setIncludeCancelled(e.target.checked)}
                  />
                }
                label="Include cancelled participants"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={state.includeUnconfirmed}
                    onChange={(e) => wizardStore.setIncludeUnconfirmed(e.target.checked)}
                  />
                }
                label="Include unconfirmed participants"
              />
              <Typography>{summary.available} available for matching</Typography>
              <Button
                variant="contained"
                sx={{ alignSelf: "flex-start" }}
                onClick={() => void navigate({ to: "/spreadsheet" })}
              >
                Continue
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
};
