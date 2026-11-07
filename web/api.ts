import { hc } from "hono/client";
import { queryOptions } from "@tanstack/react-query";
import type { AppType } from "../server/app.ts";
import type {
  AnswerErrors,
  ErrorBody,
  ErrorCode,
  ParticipantsResponse,
  QuestionsResponse,
  WriteAnswersRequest,
  WriteAnswersResponse,
} from "../shared/api-types.ts";
import type { ScoutnetEnv } from "../shared/env.ts";

export type Endpoint = "questions" | "participants" | "checkin";

export type ApiContext = {
  projectId: string;
  env: ScoutnetEnv;
  keys: Record<Endpoint, string>;
};

export class ApiError extends Error {
  code: ErrorCode;
  endpoint: Endpoint;
  status: number;
  errors?: AnswerErrors;
  constructor(
    code: ErrorCode,
    endpoint: Endpoint,
    status: number,
    message: string,
    errors?: AnswerErrors,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.endpoint = endpoint;
    this.status = status;
    if (errors) this.errors = errors;
  }
}

const client = hc<AppType>("/", {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
});

const headersFor = (ctx: ApiContext, endpoint: Endpoint) => ({
  "X-Scoutnet-Project": ctx.projectId,
  "X-Scoutnet-Key": ctx.keys[endpoint],
  "X-Scoutnet-Env": ctx.env,
});

const call = async <T>(
  endpoint: Endpoint,
  request: () => Promise<Response>,
): Promise<T> => {
  let res: Response;
  try {
    res = await request();
  } catch {
    throw new ApiError("upstream_unreachable", endpoint, 0, "The server could not be reached");
  }
  if (!res.ok) {
    let body: Partial<ErrorBody> | null = null;
    try {
      body = (await res.json()) as Partial<ErrorBody>;
    } catch {
      body = null;
    }
    throw new ApiError(
      body?.error?.code ?? "upstream_unreachable",
      endpoint,
      res.status,
      body?.error?.message ?? `Request failed with status ${res.status}`,
      body?.error?.errors,
    );
  }
  return (await res.json()) as T;
};

export const fetchQuestions = (ctx: ApiContext) =>
  call<QuestionsResponse>("questions", () =>
    client.api.questions.$get({}, { headers: headersFor(ctx, "questions") }),
  );

export const fetchParticipants = (ctx: ApiContext) =>
  call<ParticipantsResponse>("participants", () =>
    client.api.participants.$get({}, { headers: headersFor(ctx, "participants") }),
  );

export const writeAnswers = (ctx: ApiContext, answers: WriteAnswersRequest["answers"]) =>
  call<WriteAnswersResponse>("checkin", () =>
    client.api.answers.$put({ json: { answers } }, { headers: headersFor(ctx, "checkin") }),
  );

export const questionsQuery = (ctx: ApiContext) =>
  queryOptions({
    queryKey: [ctx.env, ctx.projectId, "questions"] as const,
    queryFn: () => fetchQuestions(ctx),
  });

export const participantsQuery = (ctx: ApiContext) =>
  queryOptions({
    queryKey: [ctx.env, ctx.projectId, "participants"] as const,
    queryFn: () => fetchParticipants(ctx),
  });
