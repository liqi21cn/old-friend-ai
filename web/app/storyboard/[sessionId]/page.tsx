import { notFound, redirect } from "next/navigation";
import { readScreenplay, readTranscript } from "@/lib/repo";
import { getSession } from "@/lib/auth";
import { PageHeader } from "@/components/wizard-shell";
import { StoryboardTable } from "./table";

export const dynamic = "force-dynamic";

export default async function StoryboardPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const s = await getSession();
  if (!s) redirect("/login" as any);
  const userId = s.user.id;
  const { sessionId } = await params;
  const shotsRaw = await readScreenplay(sessionId, userId);
  const transcript = await readTranscript(sessionId, userId);
  if (!shotsRaw || !transcript) return notFound();
  const shots = shotsRaw as any[];

  return (
    <>
      <PageHeader
        step={5}
        title="分镜表"
        description={
          <>
            按 <code className="font-mono text-accent">EP##_SC##_SH###</code>{" "}
            Sequence ID 排列。这是工具产出的最终交付物 ——
            可直接 import 到 AI 短剧制作平台。
          </>
        }
      />
      <StoryboardTable
        sessionId={sessionId}
        shots={shots}
        characters={transcript.characters || []}
      />
    </>
  );
}
