import { notFound, redirect } from "next/navigation";
import { readTranscript } from "@/lib/repo";
import { getSession } from "@/lib/auth";
import { PageHeader } from "@/components/wizard-shell";
import { ScreenplayEditor } from "./editor";

export const dynamic = "force-dynamic";

export default async function ScreenplayEditPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const s = await getSession();
  if (!s) redirect("/login" as any);
  const { sessionId } = await params;
  const transcript = await readTranscript(sessionId, s.user.id);
  if (!transcript) return notFound();

  return (
    <>
      <PageHeader
        step={3}
        title="剧本预览 / 编辑"
        description={
          <>
            <code className="font-mono text-accent">{sessionId}</code> ·{" "}
            {transcript.scene?.conflict}
          </>
        }
      />
      <ScreenplayEditor sessionId={sessionId} initialTranscript={transcript} />
    </>
  );
}
