import * as XLSX from "xlsx";
import { describe, expect, it, vi } from "vitest";
import type { TrimmedParticipant } from "../../shared/api-types.ts";
import type {
  LoadedReply,
  MappedReply,
  MappingInput,
  MatchParams,
  MatchedReply,
  PlanReply,
  Reply,
  RowsReply,
  BodyReply,
  FileReply,
  WrittenReply,
  SheetReply,
  SkippedReply,
  TableReply,
} from "./protocol.ts";
import type { AnswerOutcome } from "../writing/outcomes.ts";
import { createHandler } from "./worker.ts";

const xlsxFile = (sheets: Record<string, unknown[][]>, name = "book.xlsx"): File => {
  const book = XLSX.utils.book_new();
  for (const [sheet, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheet);
  }
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([bytes], name);
};

const csvFile = (bytes: number[] | string, name = "list.csv"): File =>
  new File([typeof bytes === "string" ? new TextEncoder().encode(bytes) : new Uint8Array(bytes)], name);

const setup = () => {
  const replies: Reply[] = [];
  const handle = createHandler((r) => replies.push(r));
  let id = 0;
  const last = <T extends Reply>() => replies.at(-1) as T;
  return {
    replies,
    load: async (file: File) => (await handle({ type: "load", id: ++id, file }), last<LoadedReply>()),
    sheet: async (sheet: string) => (await handle({ type: "selectSheet", id: ++id, sheet }), last<SheetReply>()),
    header: async (headerRow: number) =>
      (await handle({ type: "selectHeader", id: ++id, headerRow }), last<TableReply>()),
  };
};

const members = [
  ["Anmälda"],
  ["Medlemsnummer", "Namn", "Kost"],
  ["0012345", "Eva", "Vegan"],
  [],
  ["0012346", "Olle", ""],
];

describe("worker handler", () => {
  it("loads an xlsx, guesses the header and builds the table", async () => {
    const w = setup();
    const loaded = await w.load(xlsxFile({ Anmälda: members }));
    expect(loaded).toMatchObject({ type: "loaded", fileName: "book.xlsx", sheet: "Anmälda" });
    expect(loaded.sheets).toEqual([{ name: "Anmälda", rows: 4, empty: false }]);
    const sheet = await w.sheet("Anmälda");
    expect(sheet.headerRow).toBe(2);
    expect(sheet.topRows.map((r) => r.sheetRow)).toEqual([1, 2, 3, 5]);
    const table = await w.header(sheet.headerRow);
    expect(table.columns.map((c) => c.name)).toEqual(["Medlemsnummer", "Namn", "Kost"]);
    expect(table.rowCount).toBe(2);
    expect(table.preview[1]!.cells.map((c) => c.text)).toEqual(["0012346", "Olle", ""]);
  });
  it("sends progress before loaded, with the request id", async () => {
    const w = setup();
    await w.load(xlsxFile({ A: [["a", "b"]] }));
    expect(w.replies.map((r) => r.type)).toEqual(["progress", "progress", "progress", "loaded"]);
    expect(w.replies.every((r) => r.id === 1)).toBe(true);
  });
  it("selects the first non-empty sheet and lists all", async () => {
    const w = setup();
    const loaded = await w.load(xlsxFile({ Info: [[]], Anmälda: members }));
    expect(loaded.sheet).toBe("Anmälda");
    expect(loaded.sheets.map((s) => [s.name, s.empty])).toEqual([["Info", true], ["Anmälda", false]]);
    const info = await w.sheet("Info");
    expect(info.topRows).toEqual([]);
    expect(info.headerRow).toBe(1);
  });
  it("lets the user override the header row", async () => {
    const w = setup();
    await w.load(xlsxFile({ S: [["t"], ["a", "b"], ["c", "d"], ["e", "f"]] }));
    await w.sheet("S");
    const table = await w.header(3);
    expect(table.columns.map((c) => c.name)).toEqual(["c", "d"]);
    expect(table.rowCount).toBe(1);
  });
  it("limits the preview to 10 rows and the top rows to 20", async () => {
    const w = setup();
    const rows = [["n", "m"], ...Array.from({ length: 250 }, (_, i) => [`x${i}`, "y"])];
    await w.load(xlsxFile({ S: rows }));
    const sheet = await w.sheet("S");
    expect(sheet.topRows).toHaveLength(20);
    const table = await w.header(1);
    expect(table.rowCount).toBe(250);
    expect(table.preview).toHaveLength(10);
  });
  it("keeps dates as ISO and numbers as numbers", async () => {
    const w = setup();
    await w.load(xlsxFile({ S: [["Datum", "Antal"], [{ t: "n", v: 45292, z: "yyyy-mm-dd" }, 3]] }));
    await w.sheet("S");
    const table = await w.header(1);
    const [date, count] = table.preview[0]!.cells;
    expect(date).toMatchObject({ date: "2024-01-01", value: "2024-01-01" });
    expect(count).toEqual({ text: "3", value: 3 });
  });

  it("reads a Windows-1252 semicolon CSV", async () => {
    const w = setup();
    const head = [..."Namn;Ort\n"].map((c) => c.charCodeAt(0));
    const row = [0xc5, 0x73, 0x61, 0x20, 0xd6, 0x62, 0x65, 0x72, 0x67, 0x3b, 0x31, 0x2c, 0x35];
    const loaded = await w.load(csvFile([...head, ...row]));
    await w.sheet(loaded.sheet);
    const table = await w.header(1);
    expect(table.columns.map((c) => c.name)).toEqual(["Namn", "Ort"]);
    expect(table.preview[0]!.cells.map((c) => c.text)).toEqual(["Åsa Öberg", "1,5"]);
  });
  it("reads a UTF-8 comma CSV with BOM and keeps numbers as text", async () => {
    const w = setup();
    await w.load(csvFile("﻿Nr,Namn\n0123,\"Eriksson, Eva\"\n20100101-1234,Olle\n"));
    await w.sheet("Sheet1");
    const table = await w.header(1);
    expect(table.columns.map((c) => c.name)).toEqual(["Nr", "Namn"]);
    expect(table.preview.map((r) => r.cells.map((c) => c.text))).toEqual([
      ["0123", "Eriksson, Eva"],
      ["20100101-1234", "Olle"],
    ]);
  });

  it("reports an unreadable file and keeps the previous workbook", async () => {
    const w = setup();
    await w.load(xlsxFile({ Keep: [["a", "b"], ["1", "2"]] }));
    const bad = new File([new Uint8Array([1, 2, 3, 4])], "broken.xlsx");
    await w.load(bad);
    expect(w.replies.at(-1)).toMatchObject({ type: "error", code: "unreadable" });
    expect((w.replies.at(-1) as { message: string }).message).toContain("broken.xlsx");
    const sheet = await w.sheet("Keep");
    expect(sheet.type).toBe("sheet");
    const table = await w.header(1);
    expect(table.rowCount).toBe(1);
  });
  it("rejects unknown sheets and a header before any sheet", async () => {
    const w = setup();
    await w.header(1);
    expect(w.replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
    await w.load(xlsxFile({ S: [["a", "b"]] }));
    await w.sheet("Nope");
    expect(w.replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
  });

  describe("superseded loads", () => {
    const raw = () => {
      const replies: Reply[] = [];
      return { replies, handle: createHandler((r) => replies.push(r)) };
    };
    const errors = (replies: Reply[]) =>
      replies.flatMap((r) => (r.type === "error" ? [[r.id, r.code]] : []));

    it("keeps the accepted workbook when A is superseded and B fails", async () => {
      const { replies, handle } = raw();
      await handle({ type: "load", id: 1, file: xlsxFile({ X: [["x1", "x2"], ["1", "2"]] }) });
      const a = handle({ type: "load", id: 2, file: xlsxFile({ A: [["a1", "a2"]] }) });
      const b = handle({
        type: "load",
        id: 3,
        file: new File([new Uint8Array([1, 2, 3, 4])], "broken.xlsx"),
      });
      await Promise.all([a, b]);
      expect(errors(replies)).toEqual([
        [2, "superseded"],
        [3, "unreadable"],
      ]);
      await handle({ type: "selectSheet", id: 4, sheet: "X" });
      await handle({ type: "selectHeader", id: 5, headerRow: 1 });
      expect(replies.at(-2)).toMatchObject({ type: "sheet", sheet: "X" });
      expect(replies.at(-1)).toMatchObject({ type: "table", rowCount: 1 });
    });

    it("does not commit a superseded load that would succeed", async () => {
      const { replies, handle } = raw();
      await handle({ type: "load", id: 1, file: xlsxFile({ X: [["x1", "x2"]] }) });
      const a = handle({ type: "load", id: 2, file: xlsxFile({ A: [["a1", "a2"]] }) });
      const b = handle({ type: "load", id: 3, file: xlsxFile({ B: [["b1", "b2"]] }) });
      await Promise.all([a, b]);
      expect(errors(replies)).toEqual([[2, "superseded"]]);
      await handle({ type: "selectSheet", id: 4, sheet: "A" });
      expect(replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
      await handle({ type: "selectSheet", id: 5, sheet: "B" });
      expect(replies.at(-1)).toMatchObject({ type: "sheet", sheet: "B" });
    });
  });

  describe("matching", () => {
    const p = (memberNo: string, o: Partial<TrimmedParticipant> = {}): TrimmedParticipant => ({
      memberNo, firstName: null, lastName: null, ssno: null, email: null, cancelled: false, confirmed: true, answers: {}, ...o,
    });
    const participants = [
      p("1", { firstName: "Eva", lastName: "Ek", ssno: "200001019999", email: "eva@x.se" }),
      p("2", { firstName: "Olle", lastName: "Ek", email: "shared@x.se" }),
      p("3", { firstName: "Siv", lastName: "Ek", email: "shared@x.se" }),
      p("4", { firstName: "Gone", lastName: "Away", cancelled: true }),
    ];
    // sheetRows 2..6 (header on row 1)
    const sheetRows = [
      ["Nr", "Epost"],
      ["1", ""],
      ["", "shared@x.se"],
      ["4", ""],
      ["9", ""],
      ["1", ""],
    ];
    const params = (o: Partial<MatchParams> = {}): MatchParams => ({
      sources: [{ kind: "memberNo", column: "Nr" }, { kind: "email", column: "Epost" }],
      includeCancelled: false,
      includeUnconfirmed: false,
      resolutions: [],
      winners: [],
      ...o,
    });
    const pair = (opts?: Parameters<typeof createHandler>[1]) => {
      const replies: Reply[] = [];
      const handle = createHandler((r) => replies.push(r), opts);
      let id = 0;
      const send = async (req: object) => (await handle({ ...req, id: ++id } as never), replies.at(-1)!);
      return { replies, handle, send };
    };
    const ready = async (opts?: Parameters<typeof createHandler>[1]) => {
      const h = pair(opts);
      await h.send({ type: "load", file: xlsxFile({ S: sheetRows }) });
      await h.send({ type: "selectSheet", sheet: "S" });
      await h.send({ type: "selectHeader", headerRow: 1 });
      return h;
    };
    const setParts = (h: ReturnType<typeof pair>, version = "v1") =>
      h.send({ type: "setParticipants", version, participants });
    const doMatch = async (h: ReturnType<typeof pair>, o?: Partial<MatchParams>) =>
      (await h.send({ type: "match", ...params(o) })) as MatchedReply;

    it("replies participantsSet and matches, lists and excludes", async () => {
      const h = await ready();
      expect(await setParts(h)).toMatchObject({ type: "participantsSet", version: "v1" });
      const r = await doMatch(h);
      expect(r.type).toBe("matched");
      expect(r.totals).toMatchObject({ matched: 0, ambiguous: 1, excluded: 1, unmatched: 1, conflictRows: 2 });
      expect(r.conflicts).toEqual([
        {
          member: { memberNo: "1", firstName: "Eva", lastName: "Ek", email: "eva@x.se" },
          rows: [
            { sheetRow: 2, cells: { 0: "1", 1: "" } },
            { sheetRow: 6, cells: { 0: "1", 1: "" } },
          ],
          winner: null,
        },
      ]);
      expect(r.ambiguous).toHaveLength(1);
      expect(r.ambiguous[0]).toMatchObject({ sheetRow: 3, cells: { 0: "", 1: "shared@x.se" } });
      expect(r.ambiguous[0]!.candidates.map((c) => c.memberNo)).toEqual(["2", "3"]);
      expect(r.excluded.map((e) => e.sheetRow)).toEqual([4]);
      expect(r.unmatched.map((e) => e.sheetRow)).toEqual([5]);
      expect(JSON.stringify(r)).not.toContain("200001019999");
      expect(JSON.stringify(r)).not.toContain("ssno");
    });
    it("includes cancelled participants when asked", async () => {
      const h = await ready();
      await setParts(h);
      const r = await doMatch(h, { includeCancelled: true });
      expect(r.excluded).toEqual([]);
      expect(r.totals.matched).toBe(1);
    });
    it("applies winners and resolutions, and sends only source cells", async () => {
      const h = await ready();
      await setParts(h);
      const r = await doMatch(h, { winners: [["1", 6]], resolutions: [[3, "3"]] });
      expect(r.totals).toMatchObject({ matched: 2, matchedByResolution: 1, ambiguous: 0, conflictRows: 1 });
      expect(r.conflicts[0]!.winner).toBe(6);
      const one = await doMatch(h, { sources: [{ kind: "email", column: "Epost" }] });
      expect(Object.keys(one.ambiguous[0]!.cells)).toEqual(["0"]);
    });
    describe("participants without a row", () => {
      const nos = (r: MatchedReply) => r.withoutRow.map((m) => [m.memberNo, m.pending]);
      it("lists pool members with no row in participant order, with info", async () => {
        const h = await ready();
        await setParts(h);
        const r = await doMatch(h, { sources: [{ kind: "memberNo", column: "Nr" }] });
        expect(r.withoutRow).toEqual([
          { memberNo: "1", firstName: "Eva", lastName: "Ek", email: "eva@x.se", pending: "conflict" },
          { memberNo: "2", firstName: "Olle", lastName: "Ek", email: "shared@x.se", pending: null },
          { memberNo: "3", firstName: "Siv", lastName: "Ek", email: "shared@x.se", pending: null },
        ]);
        expect(JSON.stringify(r.withoutRow)).not.toContain("ssno");
      });
      it("does not list matched or cancelled-excluded members", async () => {
        const h = await ready();
        await setParts(h);
        const r = await doMatch(h, { winners: [["1", 6]], resolutions: [[3, "3"]] });
        expect(nos(r)).toEqual([["2", null]]);
        const c = await doMatch(h, { includeCancelled: true, winners: [["1", 6]], resolutions: [[3, "3"]] });
        expect(c.withoutRow.map((m) => m.memberNo)).toEqual(["2"]);
        const none = await doMatch(h, { sources: [{ kind: "memberNo", column: "Nr" }] });
        expect(none.withoutRow.map((m) => m.memberNo)).not.toContain("4");
      });
      it("marks ambiguous candidates and conflict members", async () => {
        const h = await ready();
        await setParts(h);
        const r = await doMatch(h);
        expect(nos(r)).toEqual([["1", "conflict"], ["2", "ambiguous"], ["3", "ambiguous"]]);
        const skipped = await doMatch(h, { winners: [["1", "skip"]] });
        expect(nos(skipped)).toEqual([["1", "conflict"], ["2", "ambiguous"], ["3", "ambiguous"]]);
      });
      it("removes a candidate once a resolution picks them", async () => {
        const h = await ready();
        await setParts(h);
        const r = await doMatch(h, { resolutions: [[3, "3"]] });
        expect(nos(r)).toEqual([["1", "conflict"], ["2", null]]);
      });
    });
    it("reports missing sources and omits their cells", async () => {
      const h = await ready();
      await setParts(h);
      const r = await doMatch(h, { sources: [{ kind: "memberNo", column: "Nope" }, { kind: "email", column: "Epost" }] });
      expect(r.missingSources).toEqual([0]);
      expect(r.ambiguous[0]!.cells).toEqual({ 1: "shared@x.se" });
    });
    it("joins split name columns", async () => {
      const h = pair();
      await h.send({ type: "load", file: xlsxFile({ S: [["F", "L"], ["Eva", "Ek"]] }) });
      await h.send({ type: "selectSheet", sheet: "S" });
      await h.send({ type: "selectHeader", headerRow: 1 });
      await setParts(h);
      const r = await doMatch(h, { sources: [{ kind: "name", layout: "split", first: "F", last: "L" }] });
      expect(r.totals.matched).toBe(1);
    });
    it("answers bad_request before a table or participants are set", async () => {
      const h = pair();
      await doMatch(h);
      expect(h.replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
      await setParts(h);
      await doMatch(h);
      expect(h.replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
      const g = await ready();
      await doMatch(g);
      expect(g.replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
    });
    it("keeps the last result and clears it on load, selectSheet and selectHeader", async () => {
      const h = await ready();
      await setParts(h);
      expect(h.handle.lastMatch()).toBeNull();
      await doMatch(h);
      expect(h.handle.lastMatch()).not.toBeNull();
      await h.send({ type: "selectHeader", headerRow: 1 });
      expect(h.handle.lastMatch()).toBeNull();
      const r = await doMatch(h);
      expect(r.type).toBe("matched");
      await h.send({ type: "selectSheet", sheet: "S" });
      expect(h.handle.lastMatch()).toBeNull();
      await h.send({ type: "selectHeader", headerRow: 1 });
      await doMatch(h);
      await h.send({ type: "load", file: xlsxFile({ S: [["a"]] }) });
      expect(h.handle.lastMatch()).toBeNull();
    });
    it("caches indexes per kind and version", async () => {
      const build = vi.fn((_: TrimmedParticipant[], __: string, ___: Date) => new Map<string, string[]>());
      const h = await ready({ buildIndex: build });
      await setParts(h, "v1");
      await doMatch(h);
      expect(build.mock.calls.map((c) => c[1])).toEqual(["memberNo", "email"]);
      await doMatch(h);
      await doMatch(h, { sources: [{ kind: "memberNo", column: "Nr" }] });
      expect(build).toHaveBeenCalledTimes(2);
      await setParts(h, "v2");
      await doMatch(h);
      expect(build).toHaveBeenCalledTimes(4);
    });
    it("uses the same today for indexing and matching", async () => {
      const d = new Date(2026, 9, 29);
      const seen: Date[] = [];
      const h = await ready({ today: () => d, buildIndex: (_, __, today) => (seen.push(today), new Map()) });
      await setParts(h);
      await doMatch(h);
      expect(seen.every((x) => x === d)).toBe(true);
    });
  });
});

describe("mapping answers", () => {
  const p = (memberNo: string, answers: TrimmedParticipant["answers"], o: Partial<TrimmedParticipant> = {}): TrimmedParticipant => ({
    memberNo, firstName: "Fn" + memberNo, lastName: "Ln", ssno: "200001019999", email: null, cancelled: false, confirmed: true, answers, ...o,
  });
  const participants = [
    p("1", { q1: "SECRET-ANSWER", q2: "80922" }),
    p("2", { q1: null, q2: null }),
    p("3", { q1: "same", q2: null }),
    p("4", { q1: "x" }),
  ];
  // sheetRows 2..7; row 6 and 7 both point at member 1 (conflict), row 5 is unmatched
  const sheetRows = [
    ["Nr", "Anteckning", "Mat"],
    ["1", "new text", "Vegetarisk"],
    ["2", "", "veg"],
    ["3", "same", "Kött"],
    ["9", "unmatched", "Vegetarisk"],
    ["1", "loser", "Vegetarisk"],
    ["4", "", ""],
  ];
  const choices = [{ id: "80922", label: "Vegetarisk" }, { id: "80923", label: "Kött" }];
  const mapping = (o: Partial<MappingInput> & { column: string; question: MappingInput["question"] }): MappingInput => ({
    questionId: o.question.id, emptyCells: "skip", existing: "overwrite", decisions: [], ...o,
  });
  const text = mapping({ column: "Anteckning", question: { id: "q1", kind: "text", choices: [] } });
  const food = mapping({ column: "Mat", question: { id: "q2", kind: "choice", choices } });
  const matchParams: MatchParams = {
    sources: [{ kind: "memberNo", column: "Nr" }],
    includeCancelled: false, includeUnconfirmed: false, resolutions: [], winners: [["1", 2]],
  };

  const setup = async (match = true) => {
    const replies: Reply[] = [];
    const handle = createHandler((r) => replies.push(r));
    let id = 0;
    const send = async (req: object) => (await handle({ ...req, id: ++id } as never), replies.at(-1)!);
    await send({ type: "load", file: xlsxFile({ S: sheetRows }) });
    await send({ type: "selectSheet", sheet: "S" });
    await send({ type: "selectHeader", headerRow: 1 });
    await send({ type: "setParticipants", version: "v1", participants });
    if (match) await send({ type: "match", ...matchParams });
    const map = async (mappings: MappingInput[]) => (await send({ type: "mapAnswers", mappings })) as MappedReply;
    return { replies, handle, send, map };
  };

  it("counts per question for the matched rows only", async () => {
    const w = await setup();
    const r = await w.map([text, food]);
    expect(r.type).toBe("mapped");
    const [t, f] = r.questions;
    // matched rows: 2 (member 1 winner), 3, 4, 7
    expect(t!.counts).toMatchObject({ overwrite: 1, set: 0, unchanged: 1, skipEmpty: 2 });
    expect(t!.values).toBeUndefined();
    expect(f!.counts).toMatchObject({ unchanged: 1, set: 1, skipUnmapped: 1, skipEmpty: 1 });
    expect(Object.values(f!.counts).reduce((a, b) => a + b, 0)).toBe(4);
    expect(f!.values!.map((v) => [v.value, v.rows, v.auto, v.suggestion])).toEqual([
      ["Vegetarisk", 1, "80922", null],
      ["veg", 1, null, "80922"],
      ["Kött", 1, "80923", null],
    ]);
  });
  it("applies decisions and rules", async () => {
    const w = await setup();
    const r = await w.map([
      { ...food, decisions: [["veg", "80922"]], existing: "fillEmpty" },
      { ...text, emptyCells: "clear" },
    ]);
    expect(r.questions[0]!.counts).toMatchObject({ set: 2, unchanged: 1, skipUnmapped: 0 });
    expect(r.questions[1]!.counts).toMatchObject({ clear: 1 });
  });
  it("sends yes/no tables without recognised variants", async () => {
    const w = await setup();
    const r = await w.map([mapping({ column: "Mat", question: { id: "q3", kind: "yesNo", choices: [] } })]);
    expect(r.questions[0]!.values!.map((v) => v.value)).toEqual(["Vegetarisk", "veg", "Kött"]);
  });
  it("lists skipped rows on demand with the cell text and reason", async () => {
    const w = await setup();
    await w.map([food]);
    const r = (await w.send({ type: "skippedRows", questionId: "q2" })) as SkippedReply;
    expect(r.rows).toEqual([
      { sheetRow: 3, value: "veg", reason: "skipUnmapped" },
      { sheetRow: 7, value: "", reason: "skipEmpty" },
    ]);
  });
  it("never puts current answers or ssno in its replies", async () => {
    const w = await setup();
    await w.map([text, food]);
    await w.send({ type: "skippedRows", questionId: "q1" });
    await w.send({ type: "skippedRows", questionId: "q2" });
    const sent = JSON.stringify(w.replies.filter((r) => r.type === "mapped" || r.type === "skipped"));
    expect(sent).not.toContain("SECRET-ANSWER");
    expect(sent).not.toContain("200001019999");
    expect(sent).not.toContain("Fn1");
    expect(sent).not.toContain('"memberNo"');
  });
  it("answers bad_request without a match result, an unknown column or an unmapped question", async () => {
    const w = await setup(false);
    await w.map([text]);
    expect(w.replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
    await w.send({ type: "match", ...matchParams });
    await w.map([{ ...text, column: "Nope" }]);
    expect(w.replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
    await w.send({ type: "skippedRows", questionId: "q1" });
    expect(w.replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
  });
  it("keeps the last diff by member and question, and clears it when the match or table changes", async () => {
    const w = await setup();
    expect(w.handle.lastDiff()).toBeNull();
    await w.map([text, food]);
    const d = w.handle.lastDiff()!;
    expect([...d.keys()].sort()).toEqual(["1", "2", "3", "4"]);
    expect(d.get("1")!.get("q1")).toEqual({ outcome: "overwrite", value: "new text" });
    expect(d.get("2")!.get("q2")).toEqual({ outcome: "skipUnmapped", value: null });
    await w.send({ type: "match", ...matchParams });
    expect(w.handle.lastDiff()).toBeNull();
    await w.map([text]);
    expect(w.handle.lastDiff()).not.toBeNull();
    await w.send({ type: "selectHeader", headerRow: 1 });
    expect(w.handle.lastDiff()).toBeNull();
    await w.send({ type: "skippedRows", questionId: "q1" });
    expect(w.replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
  });
  it("keeps the value table when only decisions change", async () => {
    const w = await setup();
    const a = await w.map([food]);
    const b = await w.map([{ ...food, decisions: [["veg", "skip"]] }]);
    expect(b.questions[0]!.values).toEqual(a.questions[0]!.values);
    expect(b.questions[0]!.counts.skipUnmapped).toBe(1);
  });
});

describe("write plan and review list", () => {
  const p = (memberNo: string, answers: TrimmedParticipant["answers"], o: Partial<TrimmedParticipant> = {}): TrimmedParticipant => ({
    memberNo, firstName: "Fn" + memberNo, lastName: "Ln", ssno: null, email: null, cancelled: false, confirmed: true, answers, ...o,
  });
  const participants = [
    p("1", { q1: "old", q2: null }),
    p("2", { q1: null, q2: null }),
    p("3", { q1: "same", q2: null }),
    p("4", { q1: "x", q2: null }),
    p("5", { q1: null, q2: null }),
  ];
  // sheet rows 2..7: member order in the sheet is 4, 2, 3, 1, 5(empty) , 9 (unmatched)
  const sheetRows = [
    ["Nr", "Text", "Antal"],
    ["4", "", "1,5"],
    ["2", "two", "abc"],
    ["3", "same", ""],
    ["1", "new", "2"],
    ["5", "", ""],
    ["9", "ghost", "7"],
  ];
  const mapping = (column: string, id: string, kind: "text" | "number", o: Partial<MappingInput> = {}): MappingInput => ({
    column, questionId: id, emptyCells: "skip", existing: "overwrite", decisions: [], question: { id, kind, choices: [] }, ...o,
  });
  const text = mapping("Text", "q1", "text", { emptyCells: "clear" });
  const num = mapping("Antal", "q2", "number");
  const matchParams: MatchParams = {
    sources: [{ kind: "memberNo", column: "Nr" }],
    includeCancelled: false, includeUnconfirmed: false, resolutions: [], winners: [],
  };
  const setup = async () => {
    const replies: Reply[] = [];
    const handle = createHandler((r) => replies.push(r));
    let id = 0;
    const send = async (req: object) => (await handle({ ...req, id: ++id } as never), replies.at(-1)!);
    await send({ type: "load", file: xlsxFile({ S: sheetRows }) });
    await send({ type: "selectSheet", sheet: "S" });
    await send({ type: "selectHeader", headerRow: 1 });
    await send({ type: "setParticipants", version: "v1", participants });
    await send({ type: "match", ...matchParams });
    const map = async (m: MappingInput[]) => send({ type: "mapAnswers", mappings: m });
    const plan = async (batchSize: number) => (await send({ type: "writePlan", batchSize })) as PlanReply;
    const body = async (index: number) => (await send({ type: "batchBody", index })) as BodyReply;
    const list = async (filter: "writes" | "all", offset = 0, limit = 500) =>
      (await send({ type: "reviewList", filter, offset, limit })) as RowsReply;
    return { replies, send, map, plan, body, list };
  };
  // member 4: q1 clear, q2 set 1.5 | member 2: q1 set, q2 skipInvalid | member 3: both unchanged/skipEmpty
  // member 1: q1 overwrite, q2 set 2 | member 5: q1 unchanged (empty, nothing to clear), q2 skipEmpty

  it("groups changes by member in sheet row order and totals the outcomes", async () => {
    const w = await setup();
    await w.map([text, num]);
    const r = await w.plan(10);
    expect(r.batches).toEqual([{ members: ["4", "2", "1"], answers: 5 }]);
    expect(r.totals).toEqual({ participants: 3, set: 3, overwrite: 1, clear: 1, skipped: 3, unchanged: 2 });
  });
  it("chunks by batch size and validates it", async () => {
    const w = await setup();
    await w.map([text, num]);
    const r = await w.plan(2);
    expect(r.batches).toEqual([{ members: ["4", "2"], answers: 3 }, { members: ["1"], answers: 2 }]);
    for (const bad of [0, 1.5, -1]) {
      await w.send({ type: "writePlan", batchSize: bad });
      expect(w.replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
    }
    expect((await w.plan(5000)).type).toBe("plan");
    expect((await w.plan(1)).batches).toHaveLength(3);
  });
  it("answers bad_request without a diff", async () => {
    const w = await setup();
    await w.send({ type: "writePlan", batchSize: 5 });
    expect(w.replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
    await w.send({ type: "batchBody", index: 0 });
    expect(w.replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
    await w.send({ type: "reviewList", filter: "all", offset: 0, limit: 10 });
    expect(w.replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
  });
  it("builds a body with only the planned answers and exact values", async () => {
    const w = await setup();
    await w.map([text, num]);
    await w.plan(2);
    const b0 = await w.body(0);
    expect(b0).toEqual({ type: "body", id: b0.id, index: 0, answers: { "4": { q1: "", q2: "1.5" }, "2": { q1: "two" } } });
    const b1 = await w.body(1);
    expect(b1.answers).toEqual({ "1": { q1: "new", q2: "2" } });
    for (const index of [2, -1, 0.5]) {
      await w.send({ type: "batchBody", index });
      expect(w.replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
    }
  });
  it("needs a plan for batchBody, and drops it when the mapping changes", async () => {
    const w = await setup();
    await w.map([text, num]);
    await w.send({ type: "batchBody", index: 0 });
    expect(w.replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
    await w.plan(5);
    await w.map([text]);
    await w.send({ type: "batchBody", index: 0 });
    expect(w.replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
    expect((await w.plan(5)).totals).toMatchObject({ set: 1, overwrite: 1, clear: 1 });
    await w.send({ type: "match", ...matchParams });
    await w.send({ type: "batchBody", index: 0 });
    expect(w.replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
  });
  const answersOf = (r: RowsReply) =>
    r.rows.flatMap((i) => (i.kind === "answer" ? [i] : []));
  it("lists writes by sheet row then question order, and all with skipped and unchanged", async () => {
    const w = await setup();
    await w.map([text, num]);
    const writes = await w.list("writes");
    expect(writes.total).toBe(5 + 3);
    expect(answersOf(writes).map((r) => [r.sheetRow, r.memberNo, r.questionId, r.outcome])).toEqual([
      [2, "4", "q1", "clear"],
      [2, "4", "q2", "set"],
      [3, "2", "q1", "set"],
      [5, "1", "q1", "overwrite"],
      [5, "1", "q2", "set"],
    ]);
    expect(writes.rows[1]).toEqual({
      kind: "answer", sheetRow: 2, memberNo: "4", name: "Fn4 Ln", questionId: "q1", current: "x", next: "", outcome: "clear",
    });
    const all = await w.list("all");
    expect(all.total).toBe(10 + 5);
    expect(answersOf(all).find((r) => r.outcome === "skipInvalid")).toMatchObject({ memberNo: "2", current: null, next: null });
    expect(answersOf(all).filter((r) => r.outcome === "unchanged").map((r) => r.memberNo)).toEqual(["3", "5"]);
  });
  it("puts a header with counts before each member's answers", async () => {
    const w = await setup();
    await w.map([text, num]);
    const { rows } = await w.list("writes");
    expect(rows.map((i) => (i.kind === "member" ? `H${i.memberNo}` : `${i.memberNo}:${i.questionId}`))).toEqual([
      "H4", "4:q1", "4:q2", "H2", "2:q1", "H1", "1:q1", "1:q2",
    ]);
    const heads = rows.flatMap((i) => (i.kind === "member" ? [i] : []));
    expect(heads.map((h) => [h.sheetRow, h.name, h.answers, h.writes])).toEqual([
      [2, "Fn4 Ln", 2, 2], [3, "Fn2 Ln", 1, 1], [5, "Fn1 Ln", 2, 2],
    ]);
    const all = await w.list("all");
    expect(all.rows.flatMap((i) => (i.kind === "member" ? [[i.memberNo, i.answers, i.writes]] : []))).toEqual([
      ["4", 2, 2], ["2", 2, 1], ["3", 2, 0], ["1", 2, 2], ["5", 2, 0],
    ]);
  });
  it("pages the list over items, across a member boundary, and caps the limit at 500", async () => {
    const w = await setup();
    await w.map([text, num]);
    // items: H4 4:q1 4:q2 | H2 2:q1 | H1 1:q1 1:q2
    const page = await w.list("writes", 2, 3);
    expect(page.total).toBe(8);
    expect(page.rows.map((i) => (i.kind === "member" ? `H${i.memberNo}` : `${i.memberNo}:${i.questionId}`))).toEqual(["4:q2", "H2", "2:q1"]);
    expect(page.rows[1]).toMatchObject({ kind: "member", answers: 1, writes: 1 });
    expect((await w.list("writes", 100, 10)).rows).toEqual([]);
    for (const [offset, limit] of [[0, 501], [0, 0], [-1, 5]]) {
      await w.send({ type: "reviewList", filter: "all", offset, limit });
      expect(w.replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
    }
  });
  it("shows current answers only for the returned page", async () => {
    const w = await setup();
    await w.map([text, num]);
    const before = w.replies.length;
    await w.list("writes", 0, 2);
    const sent = JSON.stringify(w.replies.slice(before));
    expect(sent).toContain('"current":"x"');
    expect(sent).not.toContain("old");
  });
  it("follows a new mapAnswers: the list reflects it and the old plan is gone", async () => {
    const w = await setup();
    await w.map([text, num]);
    await w.plan(5);
    await w.map([num]);
    expect(answersOf(await w.list("writes")).every((r) => r.questionId === "q2")).toBe(true);
    await w.send({ type: "batchBody", index: 0 });
    expect(w.replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
    expect((await w.plan(5)).totals).toMatchObject({ set: 2, overwrite: 0, clear: 0 });
    await w.send({ type: "setParticipants", version: "v2", participants });
    await w.send({ type: "reviewList", filter: "all", offset: 0, limit: 5 });
    expect(w.replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
  });
});

describe("rows not imported", () => {
  const p = (memberNo: string, answers: TrimmedParticipant["answers"] = {}): TrimmedParticipant => ({
    memberNo, firstName: "F", lastName: "L", ssno: null, email: null, cancelled: false, confirmed: true, answers,
  });
  const text: MappingInput = {
    column: "Anteckning", questionId: "q1", emptyCells: "skip", existing: "overwrite", decisions: [],
    question: { id: "q1", kind: "text", choices: [] },
  };
  const num: MappingInput = {
    column: "Antal", questionId: "q2", emptyCells: "skip", existing: "overwrite", decisions: [],
    question: { id: "q2", kind: "number", choices: [] },
  };
  const matchParams: MatchParams = {
    sources: [{ kind: "memberNo", column: "Nr" }],
    includeCancelled: false, includeUnconfirmed: false, resolutions: [], winners: [],
  };
  const date = (iso: string) => ({ t: "n", v: Date.parse(`${iso}Z`) / 86400000 + 25569, z: "yyyy-mm-dd" });
  const header = ["Nr", "Anteckning", "Antal", "Datum"];
  // 2: fine, 3: invalid number, 4: unmatched, 5: fine but not written, 6: failed write
  const data = [
    ["1", "a", 1, date("2024-01-01")],
    ["2", "b", "många", date("2024-02-03")],
    ["9", "c", 3, date("2024-03-04")],
    ["4", "d", 4.5, date("2024-05-06")],
    ["5", "e", 5, "text"],
  ];

  const setup = async (rows: unknown[][] = [["Titel"], header, ...data], opts: { sheet?: string; name?: string } = {}) => {
    const replies: Reply[] = [];
    const handle = createHandler((r) => replies.push(r));
    let id = 0;
    const send = async (req: object) => (await handle({ ...req, id: ++id } as never), replies.at(-1)!);
    await send({ type: "load", file: xlsxFile({ [opts.sheet ?? "S"]: rows }, opts.name ?? "anmalningar.xlsx") });
    await send({ type: "selectSheet", sheet: opts.sheet ?? "S" });
    await send({ type: "selectHeader", headerRow: 2 });
    await send({ type: "setParticipants", version: "v1", participants: ["1", "2", "4", "5"].map((n) => p(n)) });
    await send({ type: "match", ...matchParams });
    await send({ type: "mapAnswers", mappings: [text, num] });
    const outcomes: [string, string, AnswerOutcome][] = [
      ["1", "q1", { status: "updated" }],
      ["1", "q2", { status: "updated" }],
      ["2", "q1", { status: "updated" }],
      ["4", "q1", { status: "failed", message: "Nej" }],
      ["4", "q2", { status: "updated" }],
    ];
    const labels: [string, string][] = [["q1", "Anteckning"], ["q2", "Antal"]];
    const exported = async (o = outcomes, countOnly = false) =>
      (await send({ type: "notImported", outcomes: o, questionLabels: labels, countOnly })) as FileReply;
    return { replies, send, handle, outcomes, exported };
  };
  const readBack = (bytes: ArrayBuffer) => {
    const book = XLSX.read(bytes, { type: "array", cellDates: true, dense: true });
    const name = book.SheetNames[0]!;
    return { name, rows: XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name]!, { header: 1, raw: true }) };
  };

  it("exports the header with a Reason column and only the rows with something not imported", async () => {
    const w = await setup();
    const r = await w.exported();
    expect(r).toMatchObject({ type: "file", name: "anmalningar-not-imported.xlsx", rows: 4 });
    const { rows } = readBack(r.bytes!);
    expect(rows[0]).toEqual([...header, "Reason"]);
    // row "1" was fully imported, the rest are not
    expect(rows.slice(1).map((x) => [x[0], x.at(-1)])).toEqual([
      ["2", "Antal: invalid value"],
      ["9", "No match"],
      ["4", "Anteckning: write failed (Nej)"],
      ["5", "Anteckning: not attempted (not written); Antal: not attempted (not written)"],
    ]);
  });
  it("keeps numbers, dates and text as they were", async () => {
    const w = await setup();
    const { rows } = readBack((await w.exported()).bytes!);
    expect(rows[3]).toEqual(["4", "d", 4.5, new Date(Date.UTC(2024, 4, 6)), "Anteckning: write failed (Nej)"]);
    expect(rows[2]![2]).toBe(3);
    expect(rows[4]![3]).toBe("text");
    expect(rows[1]![3]).toEqual(new Date(Date.UTC(2024, 1, 3)));
  });
  it("loads straight back into step 2 with the Reason column", async () => {
    const w = await setup();
    const r = await w.exported();
    const replies: Reply[] = [];
    const handle = createHandler((x) => replies.push(x));
    await handle({ type: "load", id: 1, file: new File([r.bytes!], r.name) });
    await handle({ type: "selectSheet", id: 2, sheet: "S" });
    await handle({ type: "selectHeader", id: 3, headerRow: 1 });
    expect((replies.at(-1) as TableReply).columns.map((c) => c.name)).toEqual([...header, "Reason"]);
    expect((replies.at(-1) as TableReply).rowCount).toBe(4);
  });
  it("keeps a time part of a date", async () => {
    const w = await setup([["Titel"], header, ["1", "a", 1, { t: "n", v: 45292.5, z: "yyyy-mm-dd hh:mm:ss" }]]);
    const { rows } = readBack((await w.exported([])).bytes!);
    expect(rows[1]![3]).toEqual(new Date(Date.UTC(2024, 0, 1, 12)));
  });
  it("counts a fully written file as zero rows", async () => {
    const w = await setup([["Titel"], header, ["1", "a", 1, "x"]]);
    const r = await w.exported([["1", "q1", { status: "updated" }], ["1", "q2", { status: "unchanged" }]]);
    expect(r.rows).toBe(0);
    expect(readBack(r.bytes!).rows).toEqual([[...header, "Reason"]]);
  });
  it("cuts a sheet name over 31 characters", async () => {
    // SheetJS will not write such a name, so rename the sheet inside a finished file
    const long = "B".repeat(40);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Titel"], header, ...data]), "A".repeat(31));
    const cfb = XLSX.CFB.read(new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer), { type: "array" });
    const entry = cfb.FileIndex[cfb.FullPaths.findIndex((f: string) => f.endsWith("xl/workbook.xml"))]!;
    entry.content = new TextEncoder().encode(new TextDecoder().decode(entry.content as Uint8Array).replace("A".repeat(31), long));
    entry.size = (entry.content as Uint8Array).length;
    const bytes = new Uint8Array(XLSX.CFB.write(cfb, { type: "array", fileType: "zip" }) as ArrayLike<number>);

    const replies: Reply[] = [];
    const handle = createHandler((r) => replies.push(r));
    await handle({ type: "load", id: 1, file: new File([bytes], "lang.xlsx") });
    expect((replies.at(-1) as LoadedReply).sheet).toBe(long);
    await handle({ type: "selectSheet", id: 2, sheet: long });
    await handle({ type: "selectHeader", id: 3, headerRow: 2 });
    await handle({ type: "setParticipants", id: 4, version: "v", participants: [p("1")] });
    await handle({ type: "match", id: 5, ...matchParams });
    await handle({ type: "mapAnswers", id: 6, mappings: [text] });
    await handle({ type: "notImported", id: 7, outcomes: [], questionLabels: [] });
    expect(readBack((replies.at(-1) as FileReply).bytes!).name).toBe(long.slice(0, 31));
  });
  it("names the sheet and file of a CSV input", async () => {
    const replies: Reply[] = [];
    const handle = createHandler((r) => replies.push(r));
    await handle({ type: "load", id: 1, file: csvFile("Nr,Anteckning\n1,a\n9,b\n", "x.csv") });
    await handle({ type: "selectSheet", id: 2, sheet: (replies[3] as LoadedReply).sheet });
    await handle({ type: "selectHeader", id: 3, headerRow: 1 });
    await handle({ type: "setParticipants", id: 4, version: "v", participants: [p("1")] });
    await handle({ type: "match", id: 5, ...matchParams });
    await handle({ type: "mapAnswers", id: 6, mappings: [text] });
    await handle({ type: "notImported", id: 7, outcomes: [["1", "q1", { status: "updated" }]], questionLabels: [] });
    const r = replies.at(-1) as FileReply;
    expect(r.name).toBe("x-not-imported.xlsx");
    const { name, rows } = readBack(r.bytes!);
    expect(name).toBe("Not imported");
    expect(rows).toEqual([["Nr", "Anteckning", "Reason"], ["9", "b", "No match"]]);
  });
  it("replaces any original extension with .xlsx and handles a name without one", async () => {
    expect((await (await setup(undefined, { name: "a.b.xls" })).exported(undefined, true)).name).toBe("a.b-not-imported.xlsx");
    expect((await (await setup(undefined, { name: "anmalan" })).exported(undefined, true)).name).toBe("anmalan-not-imported.xlsx");
  });
  it("replies with only the count when asked", async () => {
    const w = await setup();
    const r = await w.exported(w.outcomes, true);
    expect(r).toMatchObject({ type: "file", rows: 4, bytes: null });
  });
  it("answers bad_request without a match result or a diff", async () => {
    const replies: Reply[] = [];
    const handle = createHandler((r) => replies.push(r));
    await handle({ type: "notImported", id: 1, outcomes: [], questionLabels: [] });
    expect(replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
    await handle({ type: "writtenValues", id: 2, answers: [] });
    expect(replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
    const w = await setup();
    await w.send({ type: "match", ...matchParams });
    await w.send({ type: "notImported", outcomes: [], questionLabels: [] });
    expect(w.replies.at(-1)).toMatchObject({ type: "error", code: "bad_request" });
  });
  it("returns the values written for the named answers only", async () => {
    const w = await setup();
    const r = (await w.send({
      type: "writtenValues",
      answers: [["1", "q1"], ["1", "q2"], ["2", "q2"], ["77", "q1"]],
    })) as WrittenReply;
    // member 2's number is invalid, so there is no value; member 77 is unknown
    expect(r.values).toEqual({ "1": { q1: "a", q2: "1" } });
  });
  it("exports 20,000 rows within 3 seconds", async () => {
    const many = Array.from({ length: 20000 }, (_, i) => [String(1000000 + i), `t${i}`, i, date("2024-01-01")]);
    const w = await setup([["Titel"], header, ...many]);
    const started = performance.now();
    const r = await w.exported([]);
    const took = performance.now() - started;
    expect(r.rows).toBe(20000);
    expect(took).toBeLessThan(3000);
    expect(r.bytes!.byteLength).toBeGreaterThan(0);
  }, 30000);
});
