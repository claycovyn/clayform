import type { Choice, Field, FieldType, Form, Theme } from "./types";

export function uid(len = 10): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export interface FieldMeta {
  type: FieldType;
  label: string;
  glyph: string;
  group: "Text" | "Choice" | "Scale" | "Other";
  hint: string;
}

export const FIELD_TYPES: FieldMeta[] = [
  { type: "short_text", label: "Short text", glyph: "Aa", group: "Text", hint: "A name, a title, a one-liner" },
  { type: "long_text", label: "Long text", glyph: "¶", group: "Text", hint: "Room to explain" },
  { type: "email", label: "Email", glyph: "@", group: "Text", hint: "Checked for typos" },
  { type: "phone", label: "Phone", glyph: "☏", group: "Text", hint: "Any country format" },
  { type: "number", label: "Number", glyph: "#", group: "Text", hint: "With optional min and max" },
  { type: "url", label: "Website", glyph: "↗", group: "Text", hint: "A link" },
  { type: "multiple_choice", label: "Multiple choice", glyph: "◉", group: "Choice", hint: "One or many, with an Other box" },
  { type: "picture_choice", label: "Picture choice", glyph: "▣", group: "Choice", hint: "Options with images" },
  { type: "dropdown", label: "Dropdown", glyph: "▾", group: "Choice", hint: "Long lists, searchable" },
  { type: "yes_no", label: "Yes / No", glyph: "Y/N", group: "Choice", hint: "One tap" },
  { type: "ranking", label: "Ranking", glyph: "↕", group: "Choice", hint: "Put things in order" },
  { type: "rating", label: "Rating", glyph: "★", group: "Scale", hint: "Stars, 3 to 10" },
  { type: "opinion_scale", label: "Opinion scale", glyph: "1–5", group: "Scale", hint: "A numbered scale with labels" },
  { type: "nps", label: "Net Promoter", glyph: "0–10", group: "Scale", hint: "NPS, calculated for you" },
  { type: "date", label: "Date", glyph: "▦", group: "Other", hint: "A calendar pick" },
  { type: "file_upload", label: "File upload", glyph: "⇪", group: "Other", hint: "Stored on your server" },
  { type: "legal", label: "Consent", glyph: "✓", group: "Other", hint: "Terms, privacy, opt-ins" },
  { type: "statement", label: "Statement", glyph: "❝", group: "Other", hint: "Text between questions" },
];

export function fieldMeta(type: FieldType): FieldMeta {
  return FIELD_TYPES.find((m) => m.type === type) ?? FIELD_TYPES[0];
}

export function choice(label: string, extra: Partial<Choice> = {}): Choice {
  return { id: uid(6), label, ...extra };
}

function refFor(type: FieldType, taken: Set<string>): string {
  const base = type.replace(/_.*/, "") === "multiple" ? "choice" : type.split("_")[0];
  let n = 1;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

export function newField(type: FieldType, existing: Field[] = []): Field {
  const ref = refFor(type, new Set(existing.map((f) => f.ref)));
  const base: Field = { id: uid(), ref, type, title: "", required: false };
  switch (type) {
    case "multiple_choice":
    case "dropdown":
    case "ranking":
      return { ...base, choices: [choice("Option A"), choice("Option B"), choice("Option C")] };
    case "picture_choice":
      return { ...base, choices: [choice("First"), choice("Second")] };
    case "rating":
      return { ...base, steps: 5 };
    case "opinion_scale":
      return { ...base, steps: 5, scaleStart: 1, labels: { left: "Not at all", right: "Completely" } };
    case "nps":
      return {
        ...base,
        title: "How likely are you to recommend us to a friend?",
        labels: { left: "Not likely", right: "Very likely" },
      };
    case "legal":
      return { ...base, title: "I agree to the terms.", required: true };
    case "statement":
      return { ...base, buttonLabel: "Continue" };
    default:
      return base;
  }
}

export const THEME_PRESETS: Theme[] = [
  { preset: "Clay", bg: "#FBF6EE", text: "#1B1714", accent: "#D4683F", buttonText: "#FFFFFF", font: "sans", radius: 12, align: "left" },
  { preset: "Midnight", bg: "#12131A", text: "#F4F1EA", accent: "#9B8CFF", buttonText: "#12131A", font: "sans", radius: 14, align: "left" },
  { preset: "Paper", bg: "#FFFFFF", text: "#111111", accent: "#111111", buttonText: "#FFFFFF", font: "serif", radius: 4, align: "left" },
  { preset: "Moss", bg: "#E9EFE4", text: "#1E2B1F", accent: "#3F6B45", buttonText: "#FFFFFF", font: "rounded", radius: 20, align: "left" },
  { preset: "Volt", bg: "#0B0B0B", text: "#F5F5F0", accent: "#E4FF1A", buttonText: "#0B0B0B", font: "display", radius: 0, align: "left" },
  { preset: "Sky", bg: "#EAF4FF", text: "#0D2440", accent: "#1F6FEB", buttonText: "#FFFFFF", font: "sans", radius: 10, align: "center" },
  { preset: "Bubblegum", bg: "#FFE9F3", text: "#3A1029", accent: "#E5408F", buttonText: "#FFFFFF", font: "rounded", radius: 24, align: "center" },
  { preset: "Terminal", bg: "#0E1510", text: "#B8F5C4", accent: "#38D86A", buttonText: "#0E1510", font: "mono", radius: 2, align: "left" },
];

export const FONT_STACKS: Record<Theme["font"], string> = {
  sans: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "Fraunces, ui-serif, Georgia, 'Times New Roman', serif",
  rounded: "Nunito, ui-rounded, 'SF Pro Rounded', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  display: "'Space Grotesk', Inter, system-ui, sans-serif",
};

export const GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&family=Nunito:wght@400;600;700&family=Space+Grotesk:wght@400;600;700&display=swap";

export function blankForm(title = "Untitled form"): Form {
  const now = new Date().toISOString();
  return {
    id: uid(),
    slug: uid(8),
    title,
    status: "draft",
    welcome: { enabled: true, title, description: "", buttonLabel: "Start" },
    fields: [],
    logic: [],
    endings: [{ id: uid(6), title: "Thanks — that's everything.", description: "Your answers are in." }],
    hiddenFields: [],
    theme: { ...THEME_PRESETS[0] },
    settings: {
      mode: "conversational",
      showProgress: true,
      showQuestionNumbers: true,
      allowResume: true,
      closed: false,
      closedMessage: "This form isn't taking responses right now.",
      branding: false,
    },
    createdAt: now,
    updatedAt: now,
  };
}
