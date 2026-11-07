import * as XLSX from "xlsx";
import { describe, expect, it, vi } from "vitest";
import { SpreadsheetError, createSpreadsheetClient } from "./client.ts";
import type { WorkerLike } from "./client.ts";
import type { Reply, Request } from "./protocol.ts";
import { createHandler } from "./worker.ts";

const file = (rows: unknown[][], name = "a.xlsx"): File => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "S");
  return new File([XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer], name);
};

// Runs the real handler, delivering replies asynchronously like a worker would.
const fakeWorker = () => {
  const sent: Request[] = [];
  const worker: WorkerLike = {
    postMessage: (req) => {
      sent.push(req);
      void handle(req);
    },
    terminate: vi.fn(),
    onmessage: null,
    onerror: null,
  };
  const handle = createHandler((reply: Reply) => setTimeout(() => worker.onmessage?.({ data: reply }), 0));
  return { worker, sent };
};

const rows = [["a", "b"], ["1", "2"]];

describe("spreadsheet client", () => {
  it("resolves load, selectSheet and selectHeader", async () => {
    const { worker } = fakeWorker();
    const client = createSpreadsheetClient(() => worker);
    const loaded = await client.load(file(rows));
    expect(loaded).toMatchObject({ fileName: "a.xlsx", sheet: "S" });
    const sheet = await client.selectSheet(loaded.sheet);
    const table = await client.selectHeader(sheet.headerRow);
    expect(table).toMatchObject({ rowCount: 1 });
  });
  it("forwards progress of the load", async () => {
    const { worker } = fakeWorker();
    const client = createSpreadsheetClient(() => worker);
    const stages: string[] = [];
    const off = client.onProgress((s) => stages.push(s));
    await client.load(file(rows));
    off();
    await client.load(file(rows));
    expect(stages).toEqual(["reading", "parsing", "indexing"]);
  });
  it("supersedes an older load", async () => {
    const { worker } = fakeWorker();
    const client = createSpreadsheetClient(() => worker);
    const first = client.load(file(rows, "first.xlsx"));
    const second = client.load(file(rows, "second.xlsx"));
    await expect(first).rejects.toMatchObject({ code: "superseded" });
    await expect(second).resolves.toMatchObject({ fileName: "second.xlsx" });
  });
  it("supersedes older header selections only", async () => {
    const { worker } = fakeWorker();
    const client = createSpreadsheetClient(() => worker);
    await client.load(file(rows));
    await client.selectSheet("S");
    const first = client.selectHeader(1);
    const second = client.selectHeader(2);
    await expect(first).rejects.toBeInstanceOf(SpreadsheetError);
    await expect(second).resolves.toMatchObject({ rowCount: 0 });
  });
  it("rejects with the worker's error", async () => {
    const { worker } = fakeWorker();
    const client = createSpreadsheetClient(() => worker);
    await expect(client.load(new File([new Uint8Array([1, 2])], "bad.xlsx"))).rejects.toMatchObject({
      code: "unreadable",
      message: expect.stringContaining("bad.xlsx"),
    });
  });
  it("rejects pending calls on a crash and recreates the worker", async () => {
    const first = { ...fakeWorker().worker, postMessage: vi.fn() } as WorkerLike;
    const second = fakeWorker().worker;
    const made = [first, second];
    const client = createSpreadsheetClient(() => made.shift()!);
    const pending = client.load(file(rows));
    first.onerror?.({});
    await expect(pending).rejects.toMatchObject({ code: "unreadable" });
    expect(first.terminate).toHaveBeenCalled();
    await expect(client.load(file(rows))).resolves.toMatchObject({ type: "loaded" });
  });
  it("fires onReset after a crash, once pending calls are rejected", async () => {
    const first = { ...fakeWorker().worker, postMessage: vi.fn() } as WorkerLike;
    const client = createSpreadsheetClient(() => first);
    const order: string[] = [];
    const off = client.onReset(() => order.push("reset"));
    const pending = client.load(file(rows)).catch(() => order.push("rejected"));
    first.onerror?.({});
    await pending;
    expect(order).toContain("rejected");
    expect(order.filter((e) => e === "reset")).toHaveLength(1);
    off();
    first.onerror?.({});
    expect(order.filter((e) => e === "reset")).toHaveLength(1);
  });

  describe("matching", () => {
    const parts = [
      { memberNo: "1", firstName: "Eva", lastName: "Ek", ssno: null, email: null, cancelled: false, confirmed: true, answers: {} },
    ];
    const params = (o = {}) => ({
      sources: [{ kind: "memberNo" as const, column: "a" }],
      includeCancelled: false,
      includeUnconfirmed: false,
      resolutions: [],
      winners: [],
      ...o,
    });
    const ready = async () => {
      const { worker } = fakeWorker();
      const client = createSpreadsheetClient(() => worker);
      await client.load(file([["a", "b"], ["1", "2"], ["7", "8"]]));
      await client.selectSheet("S");
      await client.selectHeader(1);
      return client;
    };
    it("sets participants and matches", async () => {
      const client = await ready();
      await expect(client.setParticipants("v1", parts)).resolves.toMatchObject({ type: "participantsSet", version: "v1" });
      const r = await client.match(params());
      expect(r.totals).toMatchObject({ matched: 1, unmatched: 1 });
    });
    it("rejects match before participants with bad_request", async () => {
      const client = await ready();
      await expect(client.match(params())).rejects.toMatchObject({ code: "bad_request" });
    });
    it("supersedes older matches and older setParticipants", async () => {
      const client = await ready();
      const s1 = client.setParticipants("v1", parts);
      const s2 = client.setParticipants("v2", parts);
      await expect(s1).rejects.toMatchObject({ code: "superseded" });
      await s2;
      const m1 = client.match(params());
      const m2 = client.match(params({ includeCancelled: true }));
      await expect(m1).rejects.toMatchObject({ code: "superseded" });
      await expect(m2).resolves.toMatchObject({ type: "matched" });
    });
    it("does not let match supersede setParticipants, but selectHeader supersedes match", async () => {
      const client = await ready();
      const s = client.setParticipants("v1", parts);
      const m = client.match(params());
      await expect(s).resolves.toMatchObject({ type: "participantsSet" });
      await m.catch(() => undefined);
      await client.setParticipants("v1", parts);
      const m2 = client.match(params());
      const h = client.selectHeader(1);
      await expect(m2).rejects.toMatchObject({ code: "superseded" });
      await h;
    });
    describe("mapping", () => {
      const mapping = {
        column: "b", questionId: "q", emptyCells: "skip" as const, existing: "overwrite" as const, decisions: [] as [string, string][],
        question: { id: "q", kind: "text" as const, choices: [] },
      };
      const matched = async () => {
        const client = await ready();
        await client.setParticipants("v1", parts);
        await client.match(params());
        return client;
      };
      it("maps answers and lists skipped rows", async () => {
        const client = await matched();
        const r = await client.mapAnswers([mapping]);
        expect(r.questions[0]).toMatchObject({ questionId: "q", counts: { set: 1 } });
        await expect(client.skippedRows("q")).resolves.toMatchObject({ type: "skipped", rows: [] });
      });
      it("rejects mapAnswers without a match result", async () => {
        const client = await ready();
        await client.setParticipants("v1", parts);
        await expect(client.mapAnswers([mapping])).rejects.toMatchObject({ code: "bad_request" });
      });
      it("supersedes older mapAnswers and skippedRows, and mapAnswers is superseded by match", async () => {
        const client = await matched();
        const a1 = client.mapAnswers([mapping]);
        const a2 = client.mapAnswers([mapping]);
        await expect(a1).rejects.toMatchObject({ code: "superseded" });
        await expect(a2).resolves.toMatchObject({ type: "mapped" });
        const s1 = client.skippedRows("q");
        const s2 = client.skippedRows("q");
        await expect(s1).rejects.toMatchObject({ code: "superseded" });
        await s2;
        const a3 = client.mapAnswers([mapping]);
        const m = client.match(params());
        await expect(a3).rejects.toMatchObject({ code: "superseded" });
        await m;
      });
    });
    describe("writing", () => {
      const mapping = {
        column: "b", questionId: "q", emptyCells: "skip" as const, existing: "overwrite" as const, decisions: [] as [string, string][],
        question: { id: "q", kind: "text" as const, choices: [] },
      };
      const mapped = async () => {
        const client = await ready();
        await client.setParticipants("v1", parts);
        await client.match(params());
        await client.mapAnswers([mapping]);
        return client;
      };
      it("plans, fetches bodies and lists rows", async () => {
        const client = await mapped();
        const plan = await client.writePlan(10);
        expect(plan.totals).toMatchObject({ participants: 1, set: 1 });
        await expect(client.batchBody(0)).resolves.toMatchObject({ answers: { "1": { q: "2" } } });
        await expect(client.reviewList("writes", 0, 10)).resolves.toMatchObject({ total: 2 });
      });
      it("supersedes older writePlan and reviewList, but not batchBody by reviewList or batchBody", async () => {
        const client = await mapped();
        await client.writePlan(10);
        const l1 = client.reviewList("all", 0, 10);
        const l2 = client.reviewList("all", 0, 10);
        await expect(l1).rejects.toMatchObject({ code: "superseded" });
        await l2;
        const b1 = client.batchBody(0);
        const b2 = client.batchBody(0);
        const l3 = client.reviewList("all", 0, 10);
        await expect(b1).resolves.toMatchObject({ type: "body" });
        await expect(b2).resolves.toMatchObject({ type: "body" });
        await l3;
        const p1 = client.writePlan(10);
        const p2 = client.writePlan(10);
        await expect(p1).rejects.toMatchObject({ code: "superseded" });
        await p2;
      });
      it("is superseded by mapAnswers, match and setParticipants", async () => {
        const client = await mapped();
        await client.writePlan(10);
        for (const again of [
          () => client.mapAnswers([mapping]),
          () => client.match(params()),
          () => client.setParticipants("v2", parts),
        ]) {
          const a = client.writePlan(10);
          const b = client.batchBody(0);
          const c = client.reviewList("all", 0, 10);
          const d = again();
          for (const x of [a, b, c]) await expect(x).rejects.toMatchObject({ code: "superseded" });
          await d;
          await client.match(params());
          await client.mapAnswers([mapping]);
          await client.writePlan(10);
        }
      });
      it("is dropped when the worker crashes", async () => {
        const { worker } = fakeWorker();
        const client = createSpreadsheetClient(() => worker);
        const b = client.batchBody(0);
        worker.onerror?.({});
        await expect(b).rejects.toMatchObject({ code: "unreadable" });
      });
    });
  });
});
