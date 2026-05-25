import Link from "next/link";
import { redirect } from "next/navigation";
import { listSessions, readScreenplay, readTranscript } from "@/lib/repo";
import { getSession } from "@/lib/auth";
import { PageHeader } from "@/components/wizard-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { Image as ImageIcon, ArrowRight } from "lucide-react";

export const dynamic = "force-dynamic";

interface SessionCard {
  id: string;
  sp: any[];
  characters: Array<{ id: string; name?: string }>;
}

export default async function AssetsIndexPage() {
  const s = await getSession();
  if (!s) redirect("/login" as any);
  const userId = s.user.id;
  const sessionIds = await listSessions(userId);
  const sessions = (
    await Promise.all(
      sessionIds.map(async (id): Promise<SessionCard | null> => {
        const sp = await readScreenplay(id, userId);
        if (!sp) return null;
        const t = await readTranscript(id, userId);
        const characters = (t?.characters as SessionCard["characters"]) || [];
        return { id, sp, characters };
      }),
    )
  ).filter(Boolean) as SessionCard[];

  return (
    <>
      <PageHeader
        step={4}
        title="资产工作区"
        description="选一个已有分镜的 session 进入资产生成。需要先在剧本页点「渲染分镜」。"
      />
      <div className="flex-1 overflow-auto px-8 py-6">
        {sessions.length === 0 ? (
          <EmptyState
            icon={<ImageIcon className="h-5 w-5" />}
            title="没有已渲染分镜的 session"
            description={
              <>
                先到{" "}
                <Link href="/screenplay" className="text-primary hover:underline">
                  剧本页
                </Link>{" "}
                打开一个 transcript 并点「渲染分镜」。
              </>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sessions.map(({ id, sp, characters }) => (
              <Link key={id} href={`/assets/${id}` as any}>
                <Card className="hover:border-primary/40 cursor-pointer transition-colors h-full">
                  <div className="p-5">
                    <code className="font-mono text-2xs text-accent">
                      {id}
                    </code>
                    <p className="mt-3 text-sm">
                      <span className="tabular-nums">{sp.length}</span> 个镜头
                    </p>
                    {characters.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {characters.map((c) => (
                          <span
                            key={c.id}
                            className="text-2xs px-2 py-0.5 rounded bg-muted text-subtle"
                          >
                            {c.name || c.id}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="border-t border-border px-5 py-2.5 flex items-center justify-end text-2xs text-subtle">
                    <ArrowRight className="h-3 w-3" />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
