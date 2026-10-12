export type FieldType =
  | "short_text"
  | "long_text"
  | "email"
  | "phone"
  | "number"
  | "url"
  | "multiple_choice"
  | "picture_choice"
  | "dropdown"
  | "yes_no"
  | "rating"
  | "opinion_scale"
  | "nps"
  | "date"
  | "legal"
  | "ranking"
  | "file_upload"
  | "statement";

export interface Choice {
  id: string;
  label: string;
  /** Points added to the response score when this choice is picked (quizzes, lead scoring). */
  score?: number;
  imageUrl?: string;
}

export interface Field {
  id: string;
  /** Short key used in logic, recall ({{ref}}), exports and webhooks. */
  ref: string;
  type: FieldType;
  title: string;
  description?: string;
  required?: boolean;
  placeholder?: string;
  imageUrl?: string;
  // choices
  choices?: Choice[];
  multiple?: boolean;
  allowOther?: boolean;
  randomize?: boolean;
  // rating / scale
  steps?: number;
  scaleStart?: number;
  labels?: { left?: string; right?: string };
  // number / text limits
  min?: number;
  max?: number;
  maxLength?: number;
  // statement / legal
  buttonLabel?: string;
}

export type Operator =
  | "is"
  | "is_not"
  | "contains"
  | "not_contains"
  | "starts_with"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "answered"
  | "not_answered";

export type ConditionSource =
  | { kind: "field"; ref: string }
  | { kind: "score" }
  | { kind: "hidden"; key: string };

export interface Condition {
  source: ConditionSource;
  op: Operator;
  value?: string;
}

export interface LogicRule {
  id: string;
  /** Rule is checked when the respondent leaves this field. */
  fromRef: string;
  match: "all" | "any";
  conditions: Condition[];
  /** A field ref, or "ending:<id>". */
  goTo: string;
}

export interface Ending {
  id: string;
  title: string;
  description?: string;
  buttonLabel?: string;
  buttonUrl?: string;
  /** Send respondents here after a short pause. */
  redirectUrl?: string;
  /** Shown automatically when the final score falls in this range (both inclusive, both optional). */
  minScore?: number;
  maxScore?: number;
}

export type FontChoice = "sans" | "serif" | "rounded" | "mono" | "display";

export interface Theme {
  preset: string;
  bg: string;
  text: string;
  accent: string;
  buttonText: string;
  font: FontChoice;
  radius: number;
  backgroundImage?: string;
  align: "left" | "center";
}

export interface FormSettings {
  mode: "conversational" | "classic";
  showProgress: boolean;
  showQuestionNumbers: boolean;
  allowResume: boolean;
  closed: boolean;
  closedMessage: string;
  closeAt?: string;
  responseLimit?: number;
  webhookUrl?: string;
  webhookSecret?: string;
  branding: boolean;
}

export interface Welcome {
  enabled: boolean;
  title: string;
  description?: string;
  buttonLabel: string;
  imageUrl?: string;
}

export interface Form {
  id: string;
  slug: string;
  title: string;
  status: "draft" | "published";
  welcome: Welcome;
  fields: Field[];
  logic: LogicRule[];
  endings: Ending[];
  hiddenFields: string[];
  theme: Theme;
  settings: FormSettings;
  createdAt: string;
  updatedAt: string;
}

export interface FileAnswer {
  fileId: string;
  name: string;
  size: number;
  type: string;
}

export type AnswerValue = string | number | boolean | string[] | FileAnswer | null;

export type Answers = Record<string, AnswerValue>;

export interface ResponseRecord {
  id: string;
  formId: string;
  answers: Answers;
  hidden: Record<string, string>;
  score: number;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  lastRef?: string;
  endingId?: string;
  meta: { userAgent?: string; referrer?: string; durationMs?: number };
}

export interface FormStats {
  views: number;
  starts: number;
  completes: number;
}

export interface Ctx {
  answers: Answers;
  hidden: Record<string, string>;
  score: number;
}
