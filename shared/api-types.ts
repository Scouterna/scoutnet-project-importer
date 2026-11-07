export type ErrorCode =
  | "bad_request"
  | "credentials_rejected"
  | "upstream_unreachable"
  | "not_found"
  | "answers_rejected";

// member number -> question ID -> Scoutnet's message
export type AnswerErrors = Record<string, Record<string, string>>;

export type ErrorBody = {
  error: { code: ErrorCode; message: string; errors?: AnswerErrors };
};

export type QuestionChoice = { id: string; label: string };

export type Question = {
  id: string;
  label: string;
  description: string | null;
  type: string | null;
  tabId: string | null;
  sectionId: string | null;
  choices: QuestionChoice[];
};

export type FormTab = { id: string; title: string };
export type FormSection = { id: string; title: string };

export type Form = {
  id: string;
  title: string;
  tabs: FormTab[];
  sections: FormSection[];
  questions: Question[];
};

export type QuestionsResponse = { forms: Form[] };

export type TrimmedParticipant = {
  memberNo: string;
  firstName: string | null;
  lastName: string | null;
  ssno: string | null;
  email: string | null;
  cancelled: boolean;
  confirmed: boolean;
  answers: Record<string, string | string[] | null>;
};

export type ParticipantsResponse = {
  participants: TrimmedParticipant[];
  fetchedAt: string;
};

// member number -> question ID -> value
export type WriteAnswersRequest = {
  answers: Record<string, Record<string, string>>;
};

export type AnswerResult = "updated" | "unchanged";

export type WriteAnswersResponse = {
  results: Record<string, Record<string, AnswerResult>>;
  notFound: string[];
  noMember: string[];
};
