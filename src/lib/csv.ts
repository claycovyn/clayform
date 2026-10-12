import { displayValue, isQuestion } from "./engine";
import type { Form, ResponseRecord } from "./types";

function cell(value: string): string {
  // Neutralise spreadsheet formulas (CSV injection) and quote everything.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function responsesToCsv(form: Form, responses: ResponseRecord[], fileUrl: (id: string) => string): string {
  const questions = form.fields.filter(isQuestion);
  const header = [
    "Response ID", "Status", "Started", "Completed", ...questions.map((q) => q.title || q.ref),
    ...form.hiddenFields, "Score", "Ending",
  ];
  const lines = [header.map(cell).join(",")];
  for (const r of responses) {
    const row = [
      r.id,
      r.completedAt ? "complete" : "partial",
      r.startedAt,
      r.completedAt ?? "",
      ...questions.map((q) => {
        const v = r.answers[q.ref];
        if (v && typeof v === "object" && !Array.isArray(v)) return fileUrl(v.fileId);
        return displayValue(v);
      }),
      ...form.hiddenFields.map((h) => r.hidden[h] ?? ""),
      String(r.score),
      form.endings.find((e) => e.id === r.endingId)?.title ?? "",
    ];
    lines.push(row.map(cell).join(","));
  }
  // BOM so Excel opens UTF-8 correctly.
  return "﻿" + lines.join("\r\n");
}
