import { blankForm, choice, newField, THEME_PRESETS, uid } from "./fields";
import type { Field, Form } from "./types";

export interface Template {
  id: string;
  name: string;
  blurb: string;
  build: () => Form;
}

function f(form: Form, partial: Partial<Field> & Pick<Field, "type" | "title">): Field {
  const field = { ...newField(partial.type, form.fields), ...partial };
  form.fields.push(field);
  return field;
}

export const TEMPLATES: Template[] = [
  {
    id: "blank",
    name: "Blank",
    blurb: "Start from nothing.",
    build: () => blankForm(),
  },
  {
    id: "contact",
    name: "Contact / lead form",
    blurb: "Name, email, what they need — with budget logic.",
    build: () => {
      const form = blankForm("Let's talk");
      form.welcome = { enabled: true, title: "Let's talk", description: "Four quick questions. Under a minute.", buttonLabel: "Start" };
      f(form, { type: "short_text", ref: "name", title: "First, what's your name?", required: true });
      f(form, { type: "email", ref: "email", title: "Nice to meet you, {{name}}. What's your email?", required: true });
      const need = f(form, {
        type: "multiple_choice",
        ref: "need",
        title: "What can we help with?",
        required: true,
        allowOther: true,
        choices: [choice("A new project"), choice("Support"), choice("Partnership")],
      });
      f(form, {
        type: "dropdown",
        ref: "budget",
        title: "Roughly what budget do you have in mind?",
        choices: [choice("Under $1k"), choice("$1k – $10k"), choice("$10k+")],
      });
      f(form, { type: "long_text", ref: "details", title: "Tell us a bit more.", placeholder: "The more context, the better." });
      form.logic.push({
        id: uid(6),
        fromRef: need.ref,
        match: "any",
        conditions: [{ source: { kind: "field", ref: need.ref }, op: "is_not", value: "A new project" }],
        goTo: "details",
      });
      form.endings = [{ id: uid(6), title: "Thanks, {{name}}.", description: "We'll reply to {{email}} within a day." }];
      return form;
    },
  },
  {
    id: "nps",
    name: "Customer feedback (NPS)",
    blurb: "NPS with a follow-up that changes with the score.",
    build: () => {
      const form = blankForm("Quick feedback");
      form.theme = { ...THEME_PRESETS[5] };
      form.welcome = { enabled: false, title: "Quick feedback", buttonLabel: "Start" };
      f(form, { type: "nps", ref: "nps", title: "How likely are you to recommend us to a friend?", required: true });
      f(form, { type: "long_text", ref: "love", title: "What do you love most?" });
      f(form, { type: "long_text", ref: "fix", title: "Sorry to hear that. What's the one thing we should fix?" });
      f(form, { type: "rating", ref: "support", title: "How would you rate our support?", steps: 5 });
      form.logic.push(
        { id: uid(6), fromRef: "nps", match: "all", conditions: [{ source: { kind: "field", ref: "nps" }, op: "lte", value: "6" }], goTo: "fix" },
        // Promoters and passives skip the "what should we fix" question.
        { id: uid(6), fromRef: "love", match: "all", conditions: [{ source: { kind: "field", ref: "nps" }, op: "answered" }], goTo: "support" },
      );
      form.endings = [{ id: uid(6), title: "Thank you!", description: "Every answer gets read by a person." }];
      return form;
    },
  },
  {
    id: "rsvp",
    name: "Event RSVP",
    blurb: "Attending? Plus-ones, dietary needs, consent.",
    build: () => {
      const form = blankForm("You're invited");
      form.theme = { ...THEME_PRESETS[6] };
      form.welcome = { enabled: true, title: "You're invited", description: "Let us know if you can make it.", buttonLabel: "RSVP" };
      f(form, { type: "short_text", ref: "name", title: "Your name?", required: true });
      f(form, { type: "yes_no", ref: "coming", title: "Can you make it, {{name}}?", required: true });
      f(form, { type: "number", ref: "guests", title: "How many people are you bringing?", min: 0, max: 5 });
      f(form, {
        type: "multiple_choice",
        ref: "diet",
        title: "Any dietary needs?",
        multiple: true,
        allowOther: true,
        choices: [choice("Vegetarian"), choice("Vegan"), choice("Gluten-free"), choice("None")],
      });
      f(form, { type: "legal", ref: "photos", title: "I'm OK with appearing in event photos.", required: false });
      const sorry = { id: uid(6), title: "We'll miss you, {{name}}.", description: "Thanks for letting us know." };
      const yay = { id: uid(6), title: "See you there, {{name}}!", description: "We'll send details closer to the day." };
      form.endings = [yay, sorry];
      form.logic.push({
        id: uid(6),
        fromRef: "coming",
        match: "all",
        conditions: [{ source: { kind: "field", ref: "coming" }, op: "is", value: "no" }],
        goTo: `ending:${sorry.id}`,
      });
      return form;
    },
  },
  {
    id: "quiz",
    name: "Scored quiz",
    blurb: "Points per answer, a different ending by score.",
    build: () => {
      const form = blankForm("How well do you know coffee?");
      form.theme = { ...THEME_PRESETS[1] };
      form.welcome = { enabled: true, title: "How well do you know coffee?", description: "Three questions. No pressure.", buttonLabel: "Let's go" };
      f(form, {
        type: "multiple_choice",
        ref: "q1",
        title: "Which country grows the most coffee?",
        required: true,
        randomize: true,
        choices: [choice("Brazil", { score: 1 }), choice("Colombia"), choice("Ethiopia"), choice("Vietnam")],
      });
      f(form, {
        type: "multiple_choice",
        ref: "q2",
        title: "Espresso has more caffeine per cup than drip coffee.",
        required: true,
        choices: [choice("True"), choice("False", { score: 1 })],
      });
      f(form, {
        type: "multiple_choice",
        ref: "q3",
        title: "What's a 'ristretto'?",
        required: true,
        choices: [choice("A shorter, stronger espresso", { score: 1 }), choice("Espresso with milk foam"), choice("Cold brew concentrate")],
      });
      form.endings = [
        { id: uid(6), title: "Barista level: {{score}}/3 ☕", description: "You really know your beans.", minScore: 3 },
        { id: uid(6), title: "Solid: {{score}}/3", description: "Not bad at all.", minScore: 1, maxScore: 2 },
        { id: uid(6), title: "{{score}}/3 — time for a coffee", description: "Every expert started somewhere.", maxScore: 0 },
      ];
      return form;
    },
  },
  {
    id: "job",
    name: "Job application",
    blurb: "Contact details, portfolio link, CV upload.",
    build: () => {
      const form = blankForm("Join the team");
      form.theme = { ...THEME_PRESETS[2] };
      form.settings.mode = "classic";
      form.welcome = { enabled: true, title: "Join the team", description: "Takes about five minutes. You can come back and finish later.", buttonLabel: "Apply" };
      f(form, { type: "short_text", ref: "name", title: "Full name", required: true });
      f(form, { type: "email", ref: "email", title: "Email", required: true });
      f(form, { type: "phone", ref: "phone", title: "Phone" });
      f(form, { type: "url", ref: "portfolio", title: "Portfolio or LinkedIn" });
      f(form, { type: "file_upload", ref: "cv", title: "Upload your CV", required: true });
      f(form, { type: "opinion_scale", ref: "remote", title: "How much do you want to work remotely?", steps: 5, labels: { left: "In the office", right: "Fully remote" } });
      f(form, { type: "long_text", ref: "why", title: "Why this role?", required: true });
      f(form, { type: "legal", ref: "privacy", title: "I agree you can keep my application on file for 12 months.", required: true });
      form.endings = [{ id: uid(6), title: "Application received.", description: "We'll be in touch at {{email}}." }];
      return form;
    },
  },
];
