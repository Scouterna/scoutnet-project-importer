import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";

const KEY = "s3cret-key";
const headers = (extra: Record<string, string> = {}) => ({
  "X-Scoutnet-Project": "1234567",
  "X-Scoutnet-Key": KEY,
  "X-Scoutnet-Env": "production",
  ...extra,
});
const basic = `Basic ${btoa(`1234567:${KEY}`)}`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

type Handler = (url: URL, req: Request) => Response | Promise<Response>;

const setup = (handler: Handler = () => json({})) => {
  const calls: Request[] = [];
  const fetch = vi.fn(async (input: Request | string | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init);
    calls.push(req);
    return handler(new URL(req.url), req);
  }) as unknown as typeof globalThis.fetch;
  const logs: string[] = [];
  const dir = mkdtempSync(path.join(tmpdir(), "static-"));
  writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>app</title>");
  writeFileSync(path.join(dir, "asset.js"), "console.log(1)");
  const app = createApp({ fetch, log: (l) => logs.push(l), staticRoot: dir });
  return { app, calls, logs };
};

vi.spyOn(console, "log").mockImplementation(() => {});

const questionsHandler: Handler = (url) => {
  const formId = url.searchParams.get("form_id");
  if (!formId) {
    return json({ forms: { "1": { id: 1, title: "Form A" }, "2": { id: 2, title: "Form B" } } });
  }
  return json({
    form: { id: Number(formId), title: `Form ${formId === "1" ? "A" : "B"}` },
    tabs: { "10": { id: 10, title: "Tab" } },
    sections: { "20": { id: 20, title: "Section" } },
    questions: {
      [`${formId}01`]: {
        question: "Diet",
        description: null,
        type: "select",
        tab_id: 10,
        section_id: 20,
        choices: { "5": { value: 5, option: "Vegan" } },
      },
    },
  });
};

describe("/healthz", () => {
  it("returns 200 without calling upstream", async () => {
    const { app, calls } = setup();
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(0);
  });
});

describe("credential middleware", () => {
  it("returns 400 when project, key or env is missing", async () => {
    for (const drop of ["X-Scoutnet-Project", "X-Scoutnet-Key", "X-Scoutnet-Env"]) {
      const { app, calls } = setup();
      const h: Record<string, string> = headers();
      delete h[drop];
      const res = await app.request("/api/participants", { headers: h });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("bad_request");
      expect(calls).toHaveLength(0);
    }
  });

  it("returns 400 for an unknown env without calling upstream", async () => {
    const { app, calls } = setup();
    const res = await app.request("/api/questions", {
      headers: headers({ "X-Scoutnet-Env": "staging" }),
    });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("ignores credentials in the query string", async () => {
    const { app, calls } = setup();
    const res = await app.request("/api/participants?key=abc&project=1&env=test");
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("forwards Basic auth to production", async () => {
    const { app, calls } = setup(() => json({ participants: [] }));
    await app.request("/api/participants", { headers: headers() });
    expect(calls[0].headers.get("authorization")).toBe(basic);
    expect(calls[0].url).toBe("https://scoutnet.se/api/project/get/participants");
  });

  it("forwards to the test API when env is test", async () => {
    const { app, calls } = setup(() => json({ participants: [] }));
    await app.request("/api/participants", {
      headers: headers({ "X-Scoutnet-Env": "test" }),
    });
    expect(calls[0].url).toBe("https://s1.test.custard.no/api/project/get/participants");
  });
});

describe("GET /api/questions", () => {
  it("fans out per form and merges into the normalised shape", async () => {
    const { app, calls } = setup(questionsHandler);
    const res = await app.request("/api/questions", { headers: headers() });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(3);
    for (const c of calls) expect(c.headers.get("authorization")).toBe(basic);
    const body = await res.json();
    expect(body.forms).toHaveLength(2);
    expect(body.forms[0]).toEqual({
      id: "1",
      title: "Form A",
      tabs: [{ id: "10", title: "Tab" }],
      sections: [{ id: "20", title: "Section" }],
      questions: [
        {
          id: "101",
          label: "Diet",
          description: null,
          type: "select",
          tabId: "10",
          sectionId: "20",
          choices: [{ id: "5", label: "Vegan" }],
        },
      ],
    });
    expect(body.forms[1].id).toBe("2");
  });

  it("returns an empty list when forms is [] or missing", async () => {
    const { app } = setup(() => json({ forms: [] }));
    const res = await app.request("/api/questions", { headers: headers() });
    expect(await res.json()).toEqual({ forms: [] });
  });
});

describe("GET /api/participants", () => {
  const upstream = {
    participants: {
      "1234": {
        member_no: 1234,
        first_name: "Anna",
        last_name: "Ek",
        ssno: "20100101-1234",
        primary_email: "anna@example.com",
        cancelled: false,
        confirmed: false,
        questions: { "7": "yes" },
        contact_info: { mobile_phone: "0701234567" },
        primary_membership_info: { group_name: "Grp" },
        pc_courses: { "89": "2024-01-01" },
      },
    },
  };

  it("returns only the trimmed fields", async () => {
    const { app } = setup(() => json(upstream));
    const res = await app.request("/api/participants", { headers: headers() });
    const body = await res.json();
    expect(body.participants).toEqual([
      {
        memberNo: "1234",
        firstName: "Anna",
        lastName: "Ek",
        ssno: "20100101-1234",
        email: "anna@example.com",
        cancelled: false,
        confirmed: false,
        answers: { "7": "yes" },
      },
    ]);
    expect(new Date(body.fetchedAt).toISOString()).toBe(body.fetchedAt);
    const text = JSON.stringify(body);
    expect(text).not.toContain("0701234567");
    expect(text).not.toContain("Grp");
  });

  it("normalises [] and null collections", async () => {
    for (const participants of [[], null]) {
      const { app } = setup(() => json({ participants }));
      const res = await app.request("/api/participants", { headers: headers() });
      expect((await res.json()).participants).toEqual([]);
    }
  });

  it("returns empty answers when questions is []", async () => {
    const { app } = setup(() =>
      json({ participants: { "1": { member_no: 1, questions: [] } } }),
    );
    const res = await app.request("/api/participants", { headers: headers() });
    expect((await res.json()).participants[0].answers).toEqual({});
  });
});

describe("upstream errors and logging", () => {
  it("maps 401 to credentials_rejected", async () => {
    const { app } = setup(() => new Response(null, { status: 401, headers: { "content-length": "0" } }));
    const res = await app.request("/api/participants", { headers: headers() });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("credentials_rejected");
  });

  it("maps 5xx, network errors and timeouts to 502 upstream_unreachable", async () => {
    const cases: Handler[] = [
      () => json({}, 503),
      () => {
        throw new TypeError("fetch failed");
      },
      () => {
        throw new DOMException("timed out", "TimeoutError");
      },
    ];
    for (const handler of cases) {
      const { app } = setup(handler);
      const res = await app.request("/api/questions", { headers: headers() });
      expect(res.status).toBe(502);
      expect((await res.json()).error.code).toBe("upstream_unreachable");
    }
  });

  it("maps other 4xx to 502 and logs the upstream status", async () => {
    const { app, logs } = setup(() => json({}, 403));
    const res = await app.request("/api/participants", { headers: headers() });
    expect(res.status).toBe(502);
    expect(logs).toEqual(["GET /api/participants 502 1234567 upstream=403"]);
  });

  it("passes an abort signal with the upstream request", async () => {
    const { app, calls } = setup(() => json({ participants: [] }));
    await app.request("/api/participants", { headers: headers() });
    expect(calls[0].signal).toBeDefined();
  });

  it("logs method, route, status and project only, never secrets or names", async () => {
    const failing = setup(() => json({ participants: { "1": { first_name: "Anna", last_name: "Ek" } } }, 500));
    await failing.app.request("/api/participants", { headers: headers() });
    const rejected = setup(() => new Response("Anna Ek", { status: 401 }));
    await rejected.app.request("/api/questions", { headers: headers() });
    const missing = setup();
    await missing.app.request("/api/participants", {
      headers: headers({ "X-Scoutnet-Env": "bogus" }),
    });
    const logs = [...failing.logs, ...rejected.logs, ...missing.logs];
    expect(logs).toEqual([
      "GET /api/participants 502 1234567 upstream=500",
      "GET /api/questions 401 1234567 upstream=401",
      "GET /api/participants 400 1234567",
    ]);
    const all = logs.join("\n");
    for (const secret of [KEY, basic, btoa(`1234567:${KEY}`), "Anna", "Ek"]) {
      expect(all).not.toContain(secret);
    }
  });

  it("does not log successful requests", async () => {
    const { app, logs } = setup(() => json({ participants: [] }));
    await app.request("/api/participants", { headers: headers() });
    expect(logs).toEqual([]);
  });
});

describe("static serving", () => {
  it("returns index.html for a deep link", async () => {
    const { app } = setup();
    const res = await app.request("/match");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<title>app</title>");
  });

  it("serves static files", async () => {
    const { app } = setup();
    const res = await app.request("/asset.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("console.log(1)");
  });

  it("returns JSON 404 for unknown API routes, with or without headers", async () => {
    const { app, calls } = setup();
    for (const h of [undefined, headers()]) {
      const res = await app.request("/api/does-not-exist", { headers: h });
      expect(res.status).toBe(404);
      expect((await res.json()).error.code).toBe("not_found");
    }
    expect(calls).toHaveLength(0);
  });

  it("sets a Content-Security-Policy header", async () => {
    const { app } = setup();
    for (const p of ["/healthz", "/match", "/api/nope"]) {
      const res = await app.request(p);
      expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
    }
  });
});

describe("PUT /api/answers", () => {
  const put = (app: ReturnType<typeof setup>["app"], body: unknown, h = headers()) =>
    app.request("/api/answers", {
      method: "PUT",
      headers: { ...h, "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const ok = (extra: Record<string, unknown> = {}) =>
    json({ checked_in: [], unchanged: [], not_found: [], no_member: [], total: 0, ...extra });

  it("forwards exactly the answers-only body with Basic auth", async () => {
    const { app, calls } = setup(() => ok());
    const res = await put(app, { answers: { "3320347": { "120787": "80922" } } });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.url).toBe("https://scoutnet.se/api/project/checkin");
    expect(calls[0]!.headers.get("authorization")).toBe(basic);
    expect(await calls[0]!.text()).toBe('{"3320347":{"questions":{"120787":{"value":"80922"}}}}');
  });

  it("uses the test base URL for the test env", async () => {
    const { app, calls } = setup(() => ok());
    await put(app, { answers: { "1": { "2": "x" } } }, headers({ "X-Scoutnet-Env": "test" }));
    expect(calls[0]!.url).toBe("https://s1.test.custard.no/api/project/checkin");
  });

  it("requires credentials", async () => {
    const { app, calls } = setup();
    const res = await put(app, { answers: { "1": { "2": "x" } } }, {} as never);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  const bad: [string, unknown][] = [
    ["not JSON", "{nope"],
    ["extra top-level field", { answers: { "1": { "2": "x" } }, checked_in: true }],
    ["checked_in on a member", { answers: { "1": { "2": "x", checked_in: "1" } } }],
    ["extra per-member field", { answers: { "1": { questions: { "2": "x" }, attended: true } } }],
    ["non-digit member", { answers: { a1: { "2": "x" } } }],
    ["non-digit question", { answers: { "1": { "2a": "x" } } }],
    ["non-string value", { answers: { "1": { "2": 5 } } }],
    ["null value", { answers: { "1": { "2": null } } }],
    ["too long value", { answers: { "1": { "2": "a".repeat(10_001) } } }],
    ["no members", { answers: {} }],
    ["missing answers", {}],
  ];
  it.each(bad)("rejects %s without calling Scoutnet", async (_n, body) => {
    const { app, calls } = setup(() => ok());
    const res = await put(app, body);
    expect(res.status).toBe(400);
    expect((await res.json()) as unknown).toMatchObject({ error: { code: "bad_request" } });
    expect(calls).toHaveLength(0);
  });

  it("accepts 10,000 characters and over 1,000 members, rejects bodies over 10 MiB", async () => {
    const mk = (n: number, len: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i + 1), { "2": "a".repeat(len) }]));
    const a = setup(() => ok());
    expect((await put(a.app, { answers: mk(5000, 10) })).status).toBe(200);
    expect((await put(a.app, { answers: mk(1, 10_000) })).status).toBe(200);
    const b = setup(() => ok());
    const res = await put(b.app, { answers: mk(1100, 10_000) });
    expect(res.status).toBe(413);
    expect((await res.json()) as unknown).toMatchObject({ error: { code: "bad_request" } });
    expect(b.calls).toHaveLength(0);
  });

  it("maps updated, unchanged (null) and unmentioned answers", async () => {
    const { app } = setup(() =>
      ok({
        updated_questions: {
          "1": {
            "10": { id: 5, action: "updated", original_values: { value: "a" }, new_values: { value: "b" } },
            "11": null,
          },
        },
      }),
    );
    const res = await put(app, { answers: { "1": { "10": "b", "11": "c", "12": "d" } } });
    expect(await res.json()).toEqual({
      results: { "1": { "10": "updated", "11": "unchanged", "12": "unchanged" } },
      notFound: [],
      noMember: [],
    });
  });

  it("maps not_found and no_member to strings without per-question results", async () => {
    const { app } = setup(() => ok({ not_found: [2], no_member: [3], updated_questions: {} }));
    const res = await put(app, {
      answers: { "1": { "10": "a" }, "2": { "10": "a" }, "3": { "10": "a" } },
    });
    expect(await res.json()).toEqual({
      results: { "1": { "10": "unchanged" } },
      notFound: ["2"],
      noMember: ["3"],
    });
  });

  it("passes a rejection with an errors map through as answers_rejected", async () => {
    const { app } = setup(() =>
      json(
        {
          message: "Saving answers failed - all transactions aborted",
          errors: { "3320347": { "120794": "Question type (28) not yet supported!", "x": { "1": "no" } }, abc: { "1": "no" } },
        },
        400,
      ),
    );
    const res = await put(app, { answers: { "3320347": { "120794": "1" } } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "answers_rejected",
        message: "Saving answers failed - all transactions aborted",
        errors: { "3320347": { "120794": "Question type (28) not yet supported!" } },
      },
    });
  });

  it("uses the error field when a rejection has no errors map", async () => {
    const { app } = setup(() => json({ error: "Server error! Message: boom" }, 400));
    const res = await put(app, { answers: { "1": { "2": "x" } } });
    expect(await res.json()).toEqual({
      error: { code: "answers_rejected", message: "Server error! Message: boom" },
    });
  });

  it("uses the message field, or a default for a non-JSON rejection", async () => {
    const a = setup(() => json({ message: "Nope" }, 400));
    expect(await (await put(a.app, { answers: { "1": { "2": "x" } } })).json()).toEqual({
      error: { code: "answers_rejected", message: "Nope" },
    });
    const b = setup(() => new Response("<html>", { status: 400 }));
    const res = await put(b.app, { answers: { "1": { "2": "x" } } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "answers_rejected" } });
  });

  it("maps 401 to credentials_rejected", async () => {
    const { app } = setup(() => new Response(null, { status: 401 }));
    const res = await put(app, { answers: { "1": { "2": "x" } } });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "credentials_rejected" } });
  });

  it("maps 5xx and network failures to 502", async () => {
    const a = setup(() => new Response("x", { status: 500 }));
    expect((await put(a.app, { answers: { "1": { "2": "x" } } })).status).toBe(502);
    const b = setup(() => {
      throw new TypeError("fetch failed");
    });
    expect((await put(b.app, { answers: { "1": { "2": "x" } } })).status).toBe(502);
  });

  it("logs failures without body content or the key", async () => {
    const secret = "PARTICIPANT-SECRET-VALUE";
    const a = setup(() =>
      json({ message: secret, errors: { "1": { "2": secret } } }, 400),
    );
    await put(a.app, { answers: { "1": { "2": secret } } });
    const b = setup(() => new Response(secret, { status: 500 }));
    await put(b.app, { answers: { "1": { "2": secret } } });
    const c = setup();
    await put(c.app, { answers: { "1": { "2": secret }, x: 1 } });
    for (const logs of [a.logs, b.logs, c.logs]) {
      expect(logs).toHaveLength(1);
      expect(logs[0]).not.toContain(secret);
      expect(logs[0]).not.toContain(KEY);
    }
    expect(a.logs[0]).toBe("PUT /api/answers 400 1234567 upstream=400");
    expect(b.logs[0]).toBe("PUT /api/answers 502 1234567 upstream=500");
  });
});
