import { TEMPLATE_CSV } from "@/lib/csv";

export const runtime = "nodejs";

export async function GET() {
  // Prepend BOM so Excel opens UTF-8 CSV correctly without garbled Chinese.
  const body = "﻿" + TEMPLATE_CSV + "\n";
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="person-skills-roster-template.csv"',
    },
  });
}
