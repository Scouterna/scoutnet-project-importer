import type { Form } from "../api-types.ts";
import { asRecord } from "./normalise.ts";

type Titled = { id?: number | null; title?: string | null };

export type RawFormDetail = {
  form?: Titled | null;
  questions?: unknown;
  tabs?: unknown;
  sections?: unknown;
};

type RawQuestion = {
  question?: string | null;
  description?: string | null;
  type?: string | null;
  tab_id?: number | null;
  section_id?: number | null;
  choices?: unknown;
};

type RawChoice = { value?: number | null; option?: string | null };

const idOf = (value: number | null | undefined) =>
  value == null ? null : String(value);

const titled = (collection: unknown) =>
  Object.entries(asRecord<Titled>(collection)).map(([key, item]) => ({
    id: String(item.id ?? key),
    title: item.title ?? "",
  }));

export const normaliseForm = (
  listId: string,
  listTitle: string | null | undefined,
  detail: RawFormDetail,
): Form => ({
  id: listId,
  title: detail.form?.title ?? listTitle ?? "",
  tabs: titled(detail.tabs),
  sections: titled(detail.sections),
  questions: Object.entries(asRecord<RawQuestion>(detail.questions)).map(
    ([key, q]) => ({
      id: key,
      label: q.question ?? "",
      description: q.description ?? null,
      type: q.type ?? null,
      tabId: idOf(q.tab_id),
      sectionId: idOf(q.section_id),
      choices: Object.entries(asRecord<RawChoice>(q.choices)).map(
        ([choiceKey, c]) => ({
          id: String(c.value ?? choiceKey),
          label: c.option ?? "",
        }),
      ),
    }),
  ),
});
