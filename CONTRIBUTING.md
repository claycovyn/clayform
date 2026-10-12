# Contributing to Clayform

Thanks for helping make forms free.

## Setup

```bash
npm install
npm run dev
```

Sign up at http://localhost:3000/signup to get an account. Data goes to `./data` (git-ignored); delete it to start fresh.

## Before you open a PR

```bash
npm run typecheck
npm test
npm run build
```

## Guidelines

- **Logic belongs in `src/lib/engine.ts`** and must stay pure: the browser and the server both run it. Add a test in `tests/engine.test.ts` for any behaviour change.
- **The server never trusts the browser.** Anything a respondent sends is re-validated in `src/lib/submit.ts`.
- **Every form field must be in `src/lib/schema.ts`**, or imports and saves will strip it.
- **Accessible by default**: real labels, keyboard support, visible focus, and `prefers-reduced-motion` respected (reduce movement, don't remove feedback).
- **No tracking.** Don't add analytics or third-party scripts to the player.
- Keep copy short and human.

## Adding a question type

1. Add the type to `FieldType` in `src/lib/types.ts` and to the enum in `src/lib/schema.ts`.
2. Add metadata and defaults in `src/lib/fields.ts` (`FIELD_TYPES`, `newField`).
3. Validate it in `validateAnswer` (`src/lib/engine.ts`).
4. Render it in `src/components/player/FieldInput.tsx`.
5. Summarise it in `src/components/results/Results.tsx`.
6. Add settings, if any, in `src/components/builder/BuildPanel.tsx`.
