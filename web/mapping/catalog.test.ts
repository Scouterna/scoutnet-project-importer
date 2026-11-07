import { describe, expect, it } from "vitest";
import type { Form } from "../../shared/api-types.ts";
import { buildCatalog } from "./catalog.ts";

const forms: Form[] = [
  {
    id: "f",
    title: "Anmälan",
    tabs: [{ id: "t", title: "Allmänt" }],
    sections: [{ id: "s", title: "Mat" }],
    questions: [
      { id: "1", label: "Kost", description: null, type: "choice", tabId: "t", sectionId: "s", choices: [{ id: "a", label: "Vego" }] },
      { id: "2", label: "Födelsedag", description: null, type: "other_unsupported_by_api", tabId: null, sectionId: null, choices: [] },
    ],
  },
];

describe("buildCatalog", () => {
  it("groups by form, tab and section and classifies", () => {
    const [a, b] = buildCatalog(forms, [{ answers: {} }]);
    expect(a).toMatchObject({ group: "Anmälan › Allmänt › Mat", kind: "choice", unanswered: true, reason: null });
    expect(b).toMatchObject({ group: "Anmälan", kind: null });
    expect(b!.reason).toMatch(/Date and time/);
  });
  it("makes a choice question with a list answer not importable", () => {
    const [a] = buildCatalog(forms, [{ answers: { "1": ["a", "b"] } }]);
    expect(a!.kind).toBeNull();
  });
});
