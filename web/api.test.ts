import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchParticipants, fetchQuestions, writeAnswers } from "./api.ts";
import type { ApiContext } from "./api.ts";

const ctx = (over: Partial<ApiContext> = {}): ApiContext => ({
  projectId: "1234567",
  env: "test",
  keys: { questions: "qk", participants: "pk", checkin: "ck" },
  ...over,
});

const stubFetch = (res: () => Response | Promise<Response>) => {
  const fn = vi.fn(async (_input: unknown, _init?: unknown) => res());
  vi.stubGlobal("fetch", fn);
  return fn;
};

const sentHeaders = (fn: ReturnType<typeof stubFetch>) => {
  const [input, init] = fn.mock.calls[0]!;
  const headers = input instanceof Request ? input.headers : new Headers((init as RequestInit).headers);
  return Object.fromEntries(headers.entries());
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.unstubAllGlobals());

describe("api headers", () => {
  it("sends the questions key to questions", async () => {
    const fn = stubFetch(() => json({ forms: [] }));
    await fetchQuestions(ctx());
    expect(sentHeaders(fn)).toMatchObject({
      "x-scoutnet-project": "1234567",
      "x-scoutnet-key": "qk",
      "x-scoutnet-env": "test",
    });
  });
  it("sends the participants key to participants", async () => {
    const fn = stubFetch(() => json({ participants: [], fetchedAt: "x" }));
    await fetchParticipants(ctx());
    expect(sentHeaders(fn)["x-scoutnet-key"]).toBe("pk");
  });
});

describe("api errors", () => {
  it("maps an error body to a typed error naming the endpoint", async () => {
    stubFetch(() =>
      json({ error: { code: "credentials_rejected", message: "no" } }, 401),
    );
    const err = await fetchParticipants(ctx()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "credentials_rejected", endpoint: "participants", status: 401 });
  });
  it("maps a network failure to upstream_unreachable", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const err = await fetchQuestions(ctx()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "upstream_unreachable", endpoint: "questions" });
  });
  it("maps an unparseable error body to upstream_unreachable", async () => {
    stubFetch(() => new Response("<html>", { status: 502 }));
    const err = await fetchQuestions(ctx()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "upstream_unreachable", status: 502 });
  });
});

describe("writeAnswers", () => {
  it("puts the answers with the check-in key and returns the results", async () => {
    const fn = stubFetch(() => json({ results: { "1": { "2": "updated" } }, notFound: [], noMember: [] }));
    const out = await writeAnswers(ctx(), { "1": { "2": "x" } });
    expect(out.results["1"]!["2"]).toBe("updated");
    const [input, init] = fn.mock.calls[0]!;
    const req = input instanceof Request ? input : new Request(new URL(String(input), "http://localhost"), init as RequestInit);
    expect(req.method).toBe("PUT");
    expect(new URL(req.url).pathname).toBe("/api/answers");
    expect(req.headers.get("x-scoutnet-key")).toBe("ck");
    expect(await req.json()).toEqual({ answers: { "1": { "2": "x" } } });
  });
  it("carries the per-answer errors of answers_rejected", async () => {
    stubFetch(() =>
      json(
        { error: { code: "answers_rejected", message: "failed", errors: { "1": { "2": "bad" } } } },
        400,
      ),
    );
    const err = await writeAnswers(ctx(), { "1": { "2": "x" } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      code: "answers_rejected",
      endpoint: "checkin",
      status: 400,
      errors: { "1": { "2": "bad" } },
    });
  });
});
