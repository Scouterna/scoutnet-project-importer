import { Button, Stack, Typography } from "@mui/material";
import { useNavigate } from "@tanstack/react-router";
import type { StepPath } from "../steps.ts";

export const Placeholder = ({ title, back }: { title: string; back: StepPath }) => {
  const navigate = useNavigate();
  return (
    <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
      <Typography variant="h5" component="h2">
        {title}
      </Typography>
      <Typography>Coming soon</Typography>
      <Button variant="outlined" onClick={() => void navigate({ to: back })}>
        Back
      </Button>
    </Stack>
  );
};
