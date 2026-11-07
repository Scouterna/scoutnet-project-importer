import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { Layout } from "./layout.tsx";
import { LoadSpreadsheetPage } from "./pages/load-spreadsheet.tsx";
import { MapAnswersPage } from "./pages/map-answers.tsx";
import { MatchRowsPage } from "./pages/match-rows.tsx";
import { LoadProjectPage } from "./pages/load-project.tsx";
import { ReviewWritePage } from "./pages/review-write.tsx";
import { ReportPage } from "./pages/report.tsx";
import { redirectFor } from "./steps.ts";
import type { StepPath } from "./steps.ts";
import { getState } from "./wizard-store.ts";

const rootRoute = createRootRoute({ component: Layout });

const stepRoute = (path: StepPath, component: () => React.ReactNode) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    component,
    beforeLoad: () => {
      const to = redirectFor(path, getState());
      if (to) throw redirect({ to });
    },
  });

const routeTree = rootRoute.addChildren([
  stepRoute("/", LoadProjectPage),
  stepRoute("/spreadsheet", LoadSpreadsheetPage),
  stepRoute("/match", MatchRowsPage),
  stepRoute("/map", MapAnswersPage),
  stepRoute("/review", ReviewWritePage),
  stepRoute("/report", ReportPage),
]);

export const router = createRouter({ routeTree });
