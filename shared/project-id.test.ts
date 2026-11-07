import { describe, expect, it } from "vitest";
import { apiPageUrl, parseProject } from "./project-id.ts";

describe("parseProject", () => {
  const ok = (id: string, env: "production" | "test") => ({ ok: true, id, env });
  it("accepts a plain ID, trimmed, as production", () => {
    expect(parseProject("1234567")).toEqual(ok("1234567", "production"));
    expect(parseProject("  1234567\n")).toEqual(ok("1234567", "production"));
  });
  it("treats a path-only URL as production", () => {
    expect(parseProject("/activities/view/1234567")).toEqual(ok("1234567", "production"));
  });
  it("accepts scoutnet.se with and without scheme and www", () => {
    expect(parseProject("scoutnet.se/activities/view/1234567")).toEqual(ok("1234567", "production"));
    expect(parseProject("www.scoutnet.se/activities/view/1234567")).toEqual(
      ok("1234567", "production"),
    );
    expect(
      parseProject("https://scoutnet.se/activities/view/1234567#project_tabmenu_tab_api_pane"),
    ).toEqual(ok("1234567", "production"));
  });
  it("maps the test host to test", () => {
    expect(parseProject("s1.test.custard.no/activities/view/1234")).toEqual(ok("1234", "test"));
    expect(parseProject("https://s1.test.custard.no/activities/view/1234")).toEqual(
      ok("1234", "test"),
    );
  });
  it("matches the host case-insensitively", () => {
    expect(parseProject("HTTPS://S1.Test.Custard.NO/activities/view/1234")).toEqual(
      ok("1234", "test"),
    );
  });
  it("rejects an unknown host", () => {
    for (const input of [
      "https://example.com/activities/view/1",
      "example.com/activities/view/1",
      "https://scoutnet.se.evil.com/activities/view/1",
    ]) {
      expect(parseProject(input)).toEqual({ ok: false, reason: "unknown_host" });
    }
  });
  it("rejects input without an ID", () => {
    for (const input of ["", "abc", "12ab", "https://scoutnet.se/", "/activities/view/x"]) {
      expect(parseProject(input)).toEqual({ ok: false, reason: "no_id" });
    }
  });
});

describe("apiPageUrl", () => {
  it("links to the production API page", () => {
    expect(apiPageUrl("production", "1234567")).toBe(
      "https://scoutnet.se/activities/view/1234567#project_tabmenu_tab_api_pane",
    );
  });
  it("links to the test API page", () => {
    expect(apiPageUrl("test", "1")).toBe(
      "https://s1.test.custard.no/activities/view/1#project_tabmenu_tab_api_pane",
    );
  });
});
