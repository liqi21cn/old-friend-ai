import Link from "next/link";
import { redirect } from "next/navigation";
import { readTranscript, listSessions } from "@/lib/repo";
import { getSession } from "@/lib/auth";
import { PageHeader } from "@/components/wizard-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { ScrollText, ArrowRight, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ScreenplayIndexPage() {
  const s = await getSession();
  if (!s) redirect("/login" as any);
  const userId = s.user.id;
  const sessionIds = await listSessions(userId);
  const sessions = (
    await Promise.all(
      sessionIds.map(async (id) => {
        const t = await readTranscript(id, userId);
        return t ? { id, t } : null;
      }),
    )
  ).filter(Boolean) as Array<{ id: string; t: any }>;

  return (
    <>
      <PageHeader
        step={3}
        title="剧本工作区"
        description="选一个对话 session 进入剧本编辑器。你可以修改对白和动作，并在末尾追加旁白收束。"
      />
      <div className="flex-1 overflow-auto px-8 py-6">
        {sessions.length === 0 ? (
          <EmptyState
            icon={<ScrollText className="h-5 w-5" />}
            title="还没有任何对话 session"
            description={
              <>
                先到{" "}
                <Link href="/dialogue" className="text-primary hover:underline">
                  对话编排
                </Link>{" "}
                跑一场对话，剧本会自动出现在这里。
              </>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sessions
              .sort((a, b) =>
                String(b.t.startedAt ?? "").localeCompare(
                  String(a.t.startedAt ?? ""),
                ),
              )
              .map(({ id, t }) => (
                <Link key={id} href={`/screenplay/${id}` as any}>
                  <Card className="hover:border-primary/40 hover:bg-surface cursor-pointer transition-colors h-full">
                    <div className="p-5">
                      <div className="flex items-start justify-between">
                        <code className="font-mono text-2xs text-accent">
                          {id}
                        </code>
                        <span className="text-2xs text-faint tabular-nums flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {t.rounds?.length || 0} 轮
                        </span>
                      </div>
                      <p className="mt-3 text-sm font-medium text-foreground line-clamp-1">
                        {t.scene?.conflict || "(no conflict)"}
                      </p>
                      <p className="mt-1 text-xs text-subtle line-clamp-2">
                        {t.scene?.setting}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-1">
                        {t.characters?.map((c: any) => (
                          <span
                            key={c.id}
                            className="text-2xs px-2 py-0.5 rounded bg-muted text-subtle"
                          >
                            {c.name || c.id}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="border-t border-border px-5 py-2.5 flex items-center justify-between text-2xs text-subtle">
                      <span>{new Date(t.startedAt).toLocaleString()}</span>
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
