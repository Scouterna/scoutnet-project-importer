import { Container, Step, StepButton, Stepper, Typography } from "@mui/material";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { steps } from "./steps.ts";
import { useWizardState } from "./wizard-store.ts";

export const Layout = () => {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  // The wizard cannot be left while answers are being written.
  const writing = useWizardState().write?.status === "running";
  const active = Math.max(
    0,
    steps.findIndex((step) => step.path === pathname),
  );

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Scoutnet Project Importer
      </Typography>
      <Stepper nonLinear activeStep={active} alternativeLabel sx={{ mb: 4 }}>
        {steps.map((step, index) => (
          <Step key={step.path} completed={index < active}>
            <StepButton
              disabled={index >= active || writing}
              onClick={() => void navigate({ to: step.path })}
            >
              {step.label}
            </StepButton>
          </Step>
        ))}
      </Stepper>
      <Outlet />
    </Container>
  );
};
