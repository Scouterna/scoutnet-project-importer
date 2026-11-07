import { describe, expect, it } from "vitest";
import type { WriteAnswersResponse } from "../../shared/api-types.ts";
import { clearOutcomes, countOutcomes, getOutcomes, mergeOutcomes, recordOutcomes } from "./outcomes.ts";
import { runBatches } from "./runner.ts";
import type { Answers, Progress } from "./runner.ts";

class FakeError extends Error {
  code: string;
  errors?: Record<string, Record<string, string>>;
  constructor(code: string, message = code, errors?: Record<string, Record<string, string>>) {
    super(message);
    this.code = code;
    if (errors) this.errors = errors;
  }
}

// batch i holds members `${i}1` and `${i}2`, each with questions 7 and 8
const bodies: Answers[] = [0, 1, 2, 3].map((i) => ({
  [`${i}1`]: { "7": "a", "8": "b" },
  [`${i}2`]: { "7": "c", "8": "d" },
}));
const batches = bodies.map((b) => ({ members: Object.keys(b), answers: 4 }));
const getBody = async (i: number) => structuredClone(bodies[i]!);

const ok = (body: Answers): WriteAnswersResponse => ({
  results: Object.fromEntries(
    Object.entries(body).map(([m, qs]) => [m, Object.fromEntries(Object.keys(qs).map((q) => [q, "updated" as const]))]),
  ),
  notFound: [],
  noMember: [],
});

const status = (r: { outcomes: Map<string, Map<string, { status: string }>> }, m: string, q: string) =>
  r.outcomes.get(m)?.get(q);

describe("runBatches", () => {
  it("sends batches one after another and reports progress", async () => {
    const calls: string[][] = [];
    let inFlight = 0;
    const progress: Progress[] = [];
    const r = await runBatches({
      batches,
      getBody,
      send: async (body) => {
        expect(++inFlight).toBe(1);
        calls.push(Object.keys(body));
        await Promise.resolve();
        inFlight--;
        return ok(body);
      },
      onProgress: (p) => progress.push(p),
    });
    expect(calls).toEqual([["01", "02"], ["11", "12"], ["21", "22"], ["31", "32"]]);
    expect(r.sent).toBe(4);
    expect(r.stopped).toBeNull();
    expect(progress.map((p) => p.batchesDone)).toEqual([0, 1, 2, 3, 4]);
    expect(progress.at(-1)).toEqual({ batchesDone: 4, batchesTotal: 4, answersDone: 16, answersTotal: 16 });
    expect(countOutcomes(r.outcomes).updated).toBe(16);
  });

  it("fetches each body just before sending it", async () => {
    const order: string[] = [];
    await runBatches({
      batches,
      getBody: async (i) => {
        order.push(`get${i}`);
        return bodies[i]!;
      },
      send: async (body) => {
        order.push("send");
        return ok(body);
      },
    });
    expect(order).toEqual(["get0", "send", "get1", "send", "get2", "send", "get3", "send"]);
  });

  describe("cancel", () => {
    it("finishes the current batch and records the rest as not attempted", async () => {
      const ctl = new AbortController();
      let n = 0;
      const r = await runBatches({
        batches,
        getBody,
        signal: ctl.signal,
        send: async (body) => {
          if (++n === 2) ctl.abort();
          return ok(body);
        },
      });
      expect(n).toBe(2);
      expect(r.sent).toBe(2);
      expect(r.stopped).toBe("cancelled");
      expect(r.unsent).toEqual([2, 3]);
      expect(status(r, "11", "7")).toEqual({ status: "updated" });
      expect(status(r, "21", "7")).toEqual({ status: "notAttempted", reason: "cancelled" });
      expect(status(r, "32", "8")).toEqual({ status: "notAttempted", reason: "cancelled" });
      expect(countOutcomes(r.outcomes)).toMatchObject({ updated: 8, notAttempted: 8 });
    });

    it("sends nothing when cancelled before the first batch", async () => {
      const ctl = new AbortController();
      ctl.abort();
      let n = 0;
      const r = await runBatches({ batches, getBody, signal: ctl.signal, send: async (b) => (n++, ok(b)) });
      expect(n).toBe(0);
      expect(r.sent).toBe(0);
      expect(countOutcomes(r.outcomes).notAttempted).toBe(16);
    });
  });

  describe("rejected answers isolated", () => {
    it("fails the named answer and resends the rest once", async () => {
      const sends: Answers[] = [];
      const r = await runBatches({
        batches: [batches[0]!],
        getBody,
        send: async (body) => {
          sends.push(body);
          if (sends.length === 1) throw new FakeError("answers_rejected", "rejected", { "01": { "8": "Unsupported" } });
          return ok(body);
        },
      });
      expect(sends).toHaveLength(2);
      expect(sends[1]).toEqual({ "01": { "7": "a" }, "02": { "7": "c", "8": "d" } });
      expect(status(r, "01", "8")).toEqual({ status: "failed", message: "Unsupported" });
      expect(status(r, "01", "7")).toEqual({ status: "updated" });
      expect(status(r, "02", "8")).toEqual({ status: "updated" });
      expect(r.failedBatches).toEqual([]);
      expect(r.sent).toBe(1);
    });

    it("drops a member whose answers are all named", async () => {
      const sends: Answers[] = [];
      await runBatches({
        batches: [batches[0]!],
        getBody,
        send: async (body) => {
          sends.push(body);
          if (sends.length === 1)
            throw new FakeError("answers_rejected", "x", { "01": { "7": "no", "8": "no" } });
          return ok(body);
        },
      });
      expect(Object.keys(sends[1]!)).toEqual(["02"]);
    });

    it("does not resend when nothing is left", async () => {
      let n = 0;
      const r = await runBatches({
        batches: [{ members: ["01"], answers: 1 }],
        getBody: async () => ({ "01": { "7": "a" } }),
        send: async () => {
          n++;
          throw new FakeError("answers_rejected", "x", { "01": { "7": "bad" } });
        },
      });
      expect(n).toBe(1);
      expect(status(r, "01", "7")).toEqual({ status: "failed", message: "bad" });
    });

    it("fails the whole remainder when the resend is rejected too", async () => {
      let n = 0;
      const r = await runBatches({
        batches: [batches[0]!],
        getBody,
        send: async () => {
          n++;
          if (n === 1) throw new FakeError("answers_rejected", "first", { "01": { "8": "Unsupported" } });
          throw new FakeError("answers_rejected", "still bad");
        },
      });
      expect(n).toBe(2);
      expect(status(r, "01", "8")).toEqual({ status: "failed", message: "Unsupported" });
      expect(status(r, "01", "7")).toEqual({ status: "failed", message: "still bad" });
      expect(status(r, "02", "8")).toEqual({ status: "failed", message: "still bad" });
      expect(r.failedBatches).toEqual([]);
    });

    it("does not resend after a cancel", async () => {
      const ctl = new AbortController();
      let n = 0;
      const r = await runBatches({
        batches: [batches[0]!, batches[1]!],
        getBody,
        signal: ctl.signal,
        send: async () => {
          n++;
          ctl.abort();
          throw new FakeError("answers_rejected", "x", { "01": { "8": "bad" } });
        },
      });
      expect(n).toBe(1);
      expect(status(r, "02", "7")).toEqual({ status: "notAttempted", reason: "cancelled" });
      expect(status(r, "11", "7")).toEqual({ status: "notAttempted", reason: "cancelled" });
      expect(status(r, "01", "8")).toEqual({ status: "failed", message: "bad" });
    });
  });

  describe("failed batches", () => {
    it("continues after an unreachable batch and keeps its index for retry", async () => {
      let n = 0;
      const sentBodies: string[] = [];
      const r = await runBatches({
        batches,
        getBody,
        send: async (body) => {
          n++;
          if (n === 3) throw new FakeError("upstream_unreachable", "Scoutnet could not be reached");
          sentBodies.push(Object.keys(body)[0]!);
          return ok(body);
        },
      });
      expect(sentBodies).toEqual(["01", "11", "31"]);
      expect(r.failedBatches).toEqual([2]);
      expect(r.sent).toBe(3);
      expect(status(r, "21", "7")).toEqual({ status: "failed", message: "Scoutnet could not be reached" });
    });

    it("fails the whole batch on a rejection without errors, a bad request or an unknown error", async () => {
      const codes = ["answers_rejected", "bad_request", undefined];
      let n = 0;
      const r = await runBatches({
        batches: batches.slice(0, 3),
        getBody,
        send: async () => {
          const code = codes[n++];
          if (code === undefined) throw new Error("boom");
          throw new FakeError(code);
        },
      });
      expect(r.failedBatches).toEqual([0, 1, 2]);
      expect(n).toBe(3);
      expect(countOutcomes(r.outcomes).failed).toBe(12);
    });

    it("fails the batch when its body cannot be fetched", async () => {
      const r = await runBatches({
        batches: batches.slice(0, 2),
        getBody: async (i) => {
          if (i === 0) throw new Error("gone");
          return bodies[i]!;
        },
        send: async (b) => ok(b),
      });
      expect(r.failedBatches).toEqual([0]);
      expect(r.sent).toBe(1);
    });

    it("stops on rejected credentials and marks the rest not attempted", async () => {
      let n = 0;
      const r = await runBatches({
        batches,
        getBody,
        send: async () => {
          n++;
          throw new FakeError("credentials_rejected");
        },
      });
      expect(n).toBe(1);
      expect(r.stopped).toBe("key rejected");
      expect(r.sent).toBe(0);
      expect(r.unsent).toEqual([0, 1, 2, 3]);
      expect(countOutcomes(r.outcomes).notAttempted).toBe(16);
      expect(status(r, "01", "7")).toEqual({ status: "notAttempted", reason: "key rejected" });
    });

    it("stops when the key is rejected on the resend", async () => {
      let n = 0;
      const r = await runBatches({
        batches: batches.slice(0, 2),
        getBody,
        send: async () => {
          n++;
          if (n === 1) throw new FakeError("answers_rejected", "x", { "01": { "8": "bad" } });
          throw new FakeError("credentials_rejected");
        },
      });
      expect(r.stopped).toBe("key rejected");
      expect(status(r, "02", "7")).toEqual({ status: "notAttempted", reason: "key rejected" });
      expect(status(r, "11", "7")).toEqual({ status: "notAttempted", reason: "key rejected" });
    });
  });

  describe("answer outcomes", () => {
    it("records unchanged, not found and no member per answer", async () => {
      const r = await runBatches({
        batches: [batches[0]!],
        getBody,
        send: async () => ({
          results: { "01": { "7": "updated", "8": "unchanged" } },
          notFound: ["02"],
          noMember: [],
        }),
      });
      expect(status(r, "01", "7")).toEqual({ status: "updated" });
      expect(status(r, "01", "8")).toEqual({ status: "unchanged" });
      expect(status(r, "02", "7")).toEqual({ status: "notFound" });
      expect(status(r, "02", "8")).toEqual({ status: "notFound" });

      const r2 = await runBatches({
        batches: [batches[0]!],
        getBody,
        send: async () => ({ results: {}, notFound: [], noMember: ["01"] }),
      });
      expect(status(r2, "01", "7")).toEqual({ status: "noMember" });
      // not mentioned counts as unchanged
      expect(status(r2, "02", "7")).toEqual({ status: "unchanged" });
    });
  });

  describe("retry", () => {
    it("runs only the given batches and overwrites their earlier outcomes", async () => {
      const first = await runBatches({
        batches,
        getBody,
        send: async (body) => {
          if ("11" in body) throw new FakeError("upstream_unreachable");
          return ok(body);
        },
      });
      expect(first.failedBatches).toEqual([1]);
      const sends: string[] = [];
      const second = await runBatches({
        batches,
        indexes: first.failedBatches,
        getBody,
        send: async (b) => (sends.push(Object.keys(b)[0]!), ok(b)),
      });
      expect(sends).toEqual(["11"]);
      expect(second.failedBatches).toEqual([]);
      const all = new Map(first.outcomes);
      mergeOutcomes(all, second.outcomes);
      expect(countOutcomes(all)).toMatchObject({ updated: 16, failed: 0 });
    });

    it("leaves unsent batches unmarked when markUnsent is false", async () => {
      const ctl = new AbortController();
      ctl.abort();
      const r = await runBatches({ batches, indexes: [1, 2], getBody, signal: ctl.signal, send: async (b) => ok(b), markUnsent: false });
      expect(r.unsent).toEqual([1, 2]);
      expect(r.outcomes.size).toBe(0);
    });
  });
});

describe("outcome store", () => {
  it("keeps recorded outcomes until cleared", () => {
    clearOutcomes();
    recordOutcomes(new Map([["1", new Map([["7", { status: "updated" as const }]])]]));
    expect(getOutcomes().get("1")?.get("7")).toEqual({ status: "updated" });
    recordOutcomes(new Map([["1", new Map([["7", { status: "failed" as const, message: "x" }]])]]));
    expect(getOutcomes().get("1")?.get("7")).toEqual({ status: "failed", message: "x" });
    clearOutcomes();
    expect(getOutcomes().size).toBe(0);
  });
});
