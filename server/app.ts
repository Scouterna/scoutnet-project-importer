import { readFile } from "node:fs/promises";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { createAuthorizationHeader, createClient } from "@scouterna/scoutnet";
import type { ScoutnetClient } from "@scouterna/scoutnet";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { apiBaseUrls, isScoutnetEnv } from "../shared/env.ts";
import type { ScoutnetEnv } from "../shared/env.ts";
import type { ErrorBody, ErrorCode } from "../shared/api-types.ts";
import type {
  AnswerErrors,
  AnswerResult,
  ParticipantsResponse,
  QuestionsResponse,
  WriteAnswersResponse,
} from "../shared/api-types.ts";
import { normaliseForm } from "../shared/scoutnet/questions.ts";
import { asRecord } from "../shared/scoutnet/normalise.ts";
import { trimParticipants } from "../shared/scoutnet/participants.ts";

export type AppOptions = {
  fetch?: typeof globalThis.fetch;
  log?: (line: string) => void;
  staticRoot?: string;
};

type Vars = {
  projectId: string;
  scoutnet: ScoutnetClient;
  authorization: string;
  env: ScoutnetEnv;
  upstreamStatus?: number;
};

const upstreamTimeoutMs = 30_000;
const csp = "default-src 'self'; style-src 'self' 'unsafe-inline'";

class UpstreamError extends Error {
  status: number;
  constructor(status: number) {
    super(`Scoutnet responded ${status}`);
    this.status = status;
  }
}

const errorBody = (code: ErrorCode, message: string): ErrorBody => ({
  error: { code, message },
});

// Bounds the answers request body now that batch size is uncapped.
const maxAnswersBodyBytes = 10 * 1024 * 1024;
const maxAnswerLength = 10_000;
const digits = /^\d+$/;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// Validates by hand and returns the answers rebuilt from scratch, or null.
const parseAnswers = (body: unknown): Record<string, Record<string, string>> | null => {
  if (!isPlainObject(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "answers") return null;
  const answers = body.answers;
  if (!isPlainObject(answers)) return null;
  const members = Object.entries(answers);
  if (members.length === 0) return null;
  const clean: Record<string, Record<string, string>> = {};
  for (const [member, questions] of members) {
    if (!digits.test(member) || !isPlainObject(questions)) return null;
    const entries = Object.entries(questions);
    if (entries.length === 0) return null;
    const out: Record<string, string> = {};
    for (const [question, value] of entries) {
      if (!digits.test(question) || typeof value !== "string") return null;
      if (value.length > maxAnswerLength) return null;
      out[question] = value;
    }
    clean[member] = out;
  }
  return clean;
};

const readJson = async (res: Response): Promise<unknown> => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

const idStrings = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x) => typeof x === "number" || typeof x === "string").map(String)
    : [];

const rejectionErrors = (v: unknown): AnswerErrors | undefined => {
  if (!isPlainObject(v)) return undefined;
  const out: AnswerErrors = {};
  for (const [member, questions] of Object.entries(v)) {
    if (!digits.test(member) || !isPlainObject(questions)) continue;
    for (const [question, message] of Object.entries(questions)) {
      if (!digits.test(question) || typeof message !== "string") continue;
      (out[member] ??= {})[question] = message;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

const defaultStaticRoot = path.resolve(import.meta.dirname, "../dist/web");

export const createApp = (options: AppOptions = {}) => {
  const log = options.log ?? ((line: string) => console.error(line));
  const staticRoot = options.staticRoot ?? defaultStaticRoot;

  const requireCredentials = createMiddleware<{ Variables: Vars }>(
    async (c, next) => {
      const project = c.req.header("X-Scoutnet-Project")?.trim();
      const key = c.req.header("X-Scoutnet-Key")?.trim();
      const env = c.req.header("X-Scoutnet-Env")?.trim();
      if (!project || !/^\d+$/.test(project)) {
        return c.json(
          errorBody("bad_request", "X-Scoutnet-Project must be a numeric project ID"),
          400,
        );
      }
      c.set("projectId", project);
      if (!key) {
        return c.json(errorBody("bad_request", "X-Scoutnet-Key is required"), 400);
      }
      if (!isScoutnetEnv(env)) {
        return c.json(
          errorBody("bad_request", "X-Scoutnet-Env must be production or test"),
          400,
        );
      }
      c.set("env", env);
      c.set("authorization", createAuthorizationHeader({ resourceId: project, key }));
      c.set(
        "scoutnet",
        createClient({ baseUrl: apiBaseUrls[env], fetch: options.fetch }),
      );
      await next();
    },
  );

  const errorLog = createMiddleware<{ Variables: Vars }>(async (c, next) => {
    await next();
    if (c.res.status >= 400) {
      const upstream = c.get("upstreamStatus");
      log(
        `${c.req.method} ${c.req.path} ${c.res.status} ${c.get("projectId") ?? "-"}` +
          (upstream ? ` upstream=${upstream}` : ""),
      );
    }
  });

  const check = (response: Response) => {
    if (!response.ok) throw new UpstreamError(response.status);
  };

  const api = new Hono<{ Variables: Vars }>()
    .use("/questions", requireCredentials)
    .use("/participants", requireCredentials)
    .use("/answers", requireCredentials)
    .use(
      "/answers",
      bodyLimit({
        maxSize: maxAnswersBodyBytes,
        onError: (c) =>
          c.json(errorBody("bad_request", "The request is too large; use a smaller batch size"), 413),
      }),
    )
    .get("/questions", async (c) => {
      const client = c.get("scoutnet");
      const init = () => ({
        headers: { Authorization: c.get("authorization") },
        signal: AbortSignal.timeout(upstreamTimeoutMs),
      });
      const list = await client.GET("/project/get/questions", init());
      check(list.response);
      const entries = Object.entries(asRecord<{ title?: string | null }>(list.data?.forms));
      const forms = await Promise.all(
        entries.map(async ([id, form]) => {
          const detail = await client.GET("/project/get/questions", {
            ...init(),
            params: { query: { form_id: Number(id) } },
          });
          check(detail.response);
          return normaliseForm(id, form.title, detail.data ?? {});
        }),
      );
      return c.json<QuestionsResponse>({ forms }, 200);
    })
    .get("/participants", async (c) => {
      const res = await c.get("scoutnet").GET("/project/get/participants", {
        headers: { Authorization: c.get("authorization") },
        signal: AbortSignal.timeout(upstreamTimeoutMs),
      });
      check(res.response);
      return c.json<ParticipantsResponse>(
        {
          participants: trimParticipants(res.data?.participants),
          fetchedAt: new Date().toISOString(),
        },
        200,
      );
    })
    .put("/answers", async (c) => {
      let raw: unknown = null;
      try {
        raw = await c.req.json();
      } catch {
        raw = null;
      }
      const answers = parseAnswers(raw);
      if (!answers) {
        return c.json(
          errorBody(
            "bad_request",
            "Body must be { answers: { <memberNo>: { <questionId>: <string> } } }",
          ),
          400,
        );
      }
      // The Scoutnet body is built from scratch: question answers only.
      const body: Record<string, { questions: Record<string, { value: string }> }> = {};
      for (const [member, questions] of Object.entries(answers)) {
        const built: Record<string, { value: string }> = {};
        for (const [question, value] of Object.entries(questions)) {
          built[question] = { value };
        }
        body[member] = { questions: built };
      }
      // The typed client's updateCheckin body requires `attended`, so it can't
      // express an answers-only body; call the allowlisted base URL directly.
      const res = await (options.fetch ?? fetch)(
        `${apiBaseUrls[c.get("env")]}/project/checkin`,
        {
          method: "PUT",
          headers: {
            Authorization: c.get("authorization"),
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(upstreamTimeoutMs),
        },
      );
      if (res.status === 400) {
        c.set("upstreamStatus", 400);
        const data = await readJson(res);
        const rec = isPlainObject(data) ? data : {};
        const message =
          typeof rec.message === "string" && rec.message
            ? rec.message
            : typeof rec.error === "string" && rec.error
              ? rec.error
              : "Scoutnet rejected the answers";
        const errors = rejectionErrors(rec.errors);
        return c.json<ErrorBody>(
          { error: { code: "answers_rejected", message, ...(errors ? { errors } : {}) } },
          400,
        );
      }
      check(res);
      const data = await readJson(res);
      const rec = isPlainObject(data) ? data : {};
      const notFound = idStrings(rec.not_found);
      const noMember = idStrings(rec.no_member);
      const skipped = new Set([...notFound, ...noMember]);
      const updated = isPlainObject(rec.updated_questions) ? rec.updated_questions : {};
      const results: Record<string, Record<string, AnswerResult>> = {};
      for (const [member, questions] of Object.entries(answers)) {
        if (skipped.has(member)) continue;
        const reported = isPlainObject(updated[member]) ? updated[member] : {};
        const memberResults: Record<string, AnswerResult> = {};
        for (const question of Object.keys(questions)) {
          const entry = reported[question];
          memberResults[question] =
            isPlainObject(entry) && entry.action !== "unchanged" ? "updated" : "unchanged";
        }
        results[member] = memberResults;
      }
      return c.json<WriteAnswersResponse>({ results, notFound, noMember }, 200);
    });

  const app = new Hono<{ Variables: Vars }>()
    .use(async (c, next) => {
      await next();
      c.res.headers.set("Content-Security-Policy", csp);
    })
    .use(errorLog)
    .get("/healthz", (c) => c.text("ok"))
    .route("/api", api);

  app.onError((err, c) => {
    if (err instanceof UpstreamError) {
      c.set("upstreamStatus", err.status);
      if (err.status === 401) {
        return c.json(
          errorBody("credentials_rejected", "Scoutnet rejected the credentials"),
          401,
        );
      }
    } else {
      // Network failures, timeouts and bugs: keep the cause, or a 502 is undiagnosable.
      const cause = err.cause instanceof Error ? ` (cause: ${err.cause.name}: ${err.cause.message})` : "";
      log(`${c.req.method} ${c.req.path} error: ${err.name}: ${err.message}${cause}`);
    }
    return c.json(errorBody("upstream_unreachable", "Scoutnet could not be reached"), 502);
  });

  const staticRelative = path.relative(process.cwd(), staticRoot) || ".";
  app.get("/api/*", (c) => c.json(errorBody("not_found", "Unknown API route"), 404));
  app.get("*", serveStatic({ root: staticRelative }));
  app.get("*", async (c) => {
    try {
      return c.html(await readFile(path.join(staticRoot, "index.html"), "utf8"));
    } catch {
      return c.json(errorBody("not_found", "Frontend not built"), 404);
    }
  });

  return app;
};

export type AppType = ReturnType<typeof createApp>;
