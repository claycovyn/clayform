// Results summary shared by the MCP server: the same numbers the Results page shows.
import { isEmpty, isQuestion, npsScore, plainText } from "./engine";
import type { Form, FormStats, ResponseRecord } from "./types";

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

export function summarize(form: Form, base: FormStats, responses: ResponseRecord[]) {
  const completed = responses.filter((r) => r.completedAt);
  const durations = completed.map((r) => r.meta.durationMs ?? 0).filter((d) => d > 0);
  const questions = form.fields.filter(isQuestion);
  let previous = base.starts;
  const dropOff = questions.map((q) => {
    const answered = responses.filter((r) => !isEmpty(r.answers[q.ref])).length;
    const row = { ref: q.ref, title: plainText(q.title), required: !!q.required, answered, lostSincePrevious: Math.max(0, previous - answered) };
    previous = answered;
    return row;
  });
  const nps = form.fields
    .filter((f) => f.type === "nps")
    .map((f) => {
      const nums = responses.map((r) => r.answers[f.ref]).filter((v) => !isEmpty(v)).map(Number).filter(Number.isFinite);
      return { ref: f.ref, score: npsScore(nums), answers: nums.length };
    });
  return {
    views: base.views,
    starts: base.starts,
    completes: base.completes,
    startRate: pct(base.starts, base.views),
    completionRate: pct(base.completes, base.starts),
    averageDurationSeconds: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 1000) : null,
    lastResponseAt: responses.reduce<string | null>((latest, r) => (!latest || r.updatedAt > latest ? r.updatedAt : latest), null),
    dropOff,
    nps,
  };
}
