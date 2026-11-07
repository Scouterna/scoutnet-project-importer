import { describe, expect, it } from "vitest";
import { asRecord } from "./normalise.ts";
import { trimParticipant, trimParticipants } from "./participants.ts";

describe("asRecord", () => {
  it("maps [], null and undefined to {}", () => {
    expect(asRecord([])).toEqual({});
    expect(asRecord(null)).toEqual({});
    expect(asRecord(undefined)).toEqual({});
  });
  it("passes objects through", () => {
    const value = { a: 1 };
    expect(asRecord(value)).toBe(value);
  });
});

const raw = {
  member_no: 1234,
  first_name: "Anna",
  last_name: "Ek",
  ssno: "20100101-1234",
  primary_email: "anna@example.com",
  cancelled: false,
  confirmed: true,
  questions: { "7": "yes", "8": null },
  contact_info: { mobile_phone: "070" },
  primary_membership_info: { group_name: "G" },
  pc_courses: { "89": "2024-01-01" },
};

describe("trimParticipant", () => {
  it("keeps only the listed fields with member number as string", () => {
    const out = trimParticipant(raw);
    expect(out).toEqual({
      memberNo: "1234",
      firstName: "Anna",
      lastName: "Ek",
      ssno: "20100101-1234",
      email: "anna@example.com",
      cancelled: false,
      confirmed: true,
      answers: { "7": "yes", "8": null },
    });
    expect(Object.keys(out)).not.toContain("contact_info");
    expect(JSON.stringify(out)).not.toContain("070");
  });
  it("returns empty answers for questions: []", () => {
    expect(trimParticipant({ ...raw, questions: [] }).answers).toEqual({});
  });
  it("keeps multiple-choice arrays as strings and stringifies numbers", () => {
    const out = trimParticipant({ questions: { "1": ["80925", 80926], "2": 3, "3": { a: 1 }, "4": null } });
    expect(out.answers).toEqual({ "1": ["80925", "80926"], "2": "3", "3": null, "4": null });
  });
  it("falls back to the collection key and null fields", () => {
    const out = trimParticipant({ cancelled: true }, "55");
    expect(out).toMatchObject({ memberNo: "55", firstName: null, email: null, cancelled: true });
  });
  it("treats only confirmed: false as unconfirmed", () => {
    expect(trimParticipant({ confirmed: false }).confirmed).toBe(false);
    expect(trimParticipant({ confirmed: null }).confirmed).toBe(true);
    expect(trimParticipant({}).confirmed).toBe(true);
  });
});

describe("trimParticipants", () => {
  it("handles [], null, undefined", () => {
    expect(trimParticipants([])).toEqual([]);
    expect(trimParticipants(null)).toEqual([]);
    expect(trimParticipants(undefined)).toEqual([]);
  });
  it("converts a keyed object to an array", () => {
    expect(trimParticipants({ "1234": raw })).toHaveLength(1);
  });
});
