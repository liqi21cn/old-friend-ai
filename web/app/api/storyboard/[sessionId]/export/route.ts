/**
 * Export storyboard as .md / .json / .fdx (Final Draft XML).
 */
import { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readScreenplay, readTranscript, SCREENPLAYS_DIR } from "@/lib/repo";
import { requireUserId } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const userId = await requireUserId();
  const format = new URL(req.url).searchParams.get("format") || "md";

  const shots = await readScreenplay(sessionId, userId);
  if (!shots) return new Response("not found", { status: 404 });

  if (format === "json") {
    return new Response(JSON.stringify(shots, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${sessionId}.json"`,
      },
    });
  }
  if (format === "md") {
    try {
      const md = await readFile(
        join(SCREENPLAYS_DIR, `${sessionId}.md`),
        "utf8",
      );
      return new Response(md, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${sessionId}.md"`,
        },
      });
    } catch {
      // fall through to rebuild
    }
    // Rebuild .md from json
    const rebuilt = rebuildMarkdown(shots);
    return new Response(rebuilt, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${sessionId}.md"`,
      },
    });
  }
  if (format === "fdx") {
    const transcript = await readTranscript(sessionId, userId);
    const fdx = renderFinalDraft(shots, transcript);
    return new Response(fdx, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${sessionId}.fdx"`,
      },
    });
  }
  return new Response("unsupported format", { status: 400 });
}

function rebuildMarkdown(shots: any[]): string {
  const lines: string[] = ["# Storyboard", ""];
  for (const s of shots) {
    lines.push(`## ${s.sequence_id}  ${s.shot_type} · ${s.camera_hint}`);
    if (s.action) lines.push(`（动作）${s.action}`);
    for (const d of s.dialogue || []) {
      lines.push(`${d.speaker}：「${d.text}」`);
    }
    lines.push(`节拍：${s.beat} · ${s.duration_est}s`);
    lines.push("");
  }
  return lines.join("\n");
}

function renderFinalDraft(shots: any[], transcript: any): string {
  const escape = (s: string) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const sceneHeader = transcript?.scene?.setting || "SCENE";
  const paras: string[] = [];
  paras.push(
    `<Paragraph Type="Scene Heading"><Text>INT. ${escape(sceneHeader)}</Text></Paragraph>`,
  );
  for (const s of shots) {
    paras.push(
      `<Paragraph Type="Shot"><Text>${escape(s.sequence_id)} — ${escape(s.shot_type)} · ${escape(s.camera_hint)} · ${escape(s.beat)} (${s.duration_est}s)</Text></Paragraph>`,
    );
    if (s.action) {
      paras.push(
        `<Paragraph Type="Action"><Text>${escape(s.action)}</Text></Paragraph>`,
      );
    }
    for (const d of s.dialogue || []) {
      paras.push(
        `<Paragraph Type="Character"><Text>${escape(d.speaker)}</Text></Paragraph>`,
      );
      paras.push(
        `<Paragraph Type="Dialogue"><Text>${escape(d.text)}</Text></Paragraph>`,
      );
    }
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
    ${paras.join("\n    ")}
  </Content>
</FinalDraft>`;
}
