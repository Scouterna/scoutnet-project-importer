import { expect, it } from "vitest";
import { summarise } from "./summary.ts";

const p = (cancelled: boolean, confirmed = true) => ({
  memberNo: "1", firstName: null, lastName: null, ssno: null, email: null, cancelled, confirmed, answers: {},
});
const form = (n: number) => ({
  id: "f", title: "F", tabs: [], sections: [],
  questions: Array.from({ length: n }, (_, i) => ({
    id: String(i), label: "", description: null, type: null, tabId: null, sectionId: null, choices: [],
  })),
});
const questions = { forms: [form(2), form(3)] };
const none = { includeCancelled: false, includeUnconfirmed: false };

it("counts available participants with and without cancelled", () => {
  const participants = { participants: [p(false), p(false), p(true)], fetchedAt: "t" };
  expect(summarise(questions, participants, none)).toMatchObject({
    total: 3, cancelled: 1, available: 2, forms: 2, questions: 5,
  });
  expect(summarise(questions, participants, { ...none, includeCancelled: true }).available).toBe(3);
});

it("excludes unconfirmed by default and counts overlaps once", () => {
  const participants = {
    participants: [p(false), p(false, false), p(true, false), p(true)],
    fetchedAt: "t",
  };
  expect(summarise(questions, participants, none)).toMatchObject({
    total: 4, cancelled: 2, unconfirmed: 2, available: 1,
  });
  expect(summarise(questions, participants, { ...none, includeUnconfirmed: true }).available).toBe(2);
  expect(summarise(questions, participants, { includeCancelled: true, includeUnconfirmed: true }).available).toBe(4);
});
