"use client";
/**
 * Floating global progress dock — sticks to the bottom-right, polls
 * /api/jobs/active every 1.5s while there's at least one active job.
 * Survives navigation and page refresh (state lives in DB).
 */
import * as React from "react";
import Link from "next/link";
import {
  Loader2,
  ChevronUp,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  X,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface JobLike {
  id: string;
  kind: string;
  title: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  total: number;
  doneCount: number;
  failedCount: number;
  skippedCount: number;
  payload?: { sessionId?: string } | null;
}

function jobTarget(job: JobLike): string {
  if (job.kind === "batch-distill") return "/characters/new";
  if (job.kind === "avatar-refresh") return "/characters";
  if (job.kind === "render-storyboard") {
    const sid = job.payload?.sessionId;
    return sid ? `/screenplay/${sid}` : "/screenplay";
  }
  return "#";
}

function jobLabel(kind: string): string {
  switch (kind) {
    case "batch-distill":
      return "返回批量导入";
    case "avatar-refresh":
      return "返回角色库";
    case "render-storyboard":
      return "返回剧本";
    default:
      return "查看";
  }
}

export function GlobalProgress() {
  const [jobs, setJobs] = React.useState<JobLike[]>([]);
  const [expanded, setExpanded] = React.useState(false);
  const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    let alive = true;
    let consecutiveEmpty = 0;
    async function tick() {
      try {
        const res = await fetch("/api/jobs/active", { cache: "no-store" });
        if (!alive) return;
        if (res.ok) {
          const data = (await res.json()) as JobLike[];
          setJobs(data);
          consecutiveEmpty = data.length === 0 ? consecutiveEmpty + 1 : 0;
        }
      } catch {
        /* swallow */
      }
      if (alive) {
        // Slow down when there's nothing happening
        const delay = jobs.length > 0 ? 1500 : Math.min(8000, 3000 + consecutiveEmpty * 1000);
        setTimeout(tick, delay);
      }
    }
    tick();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = jobs.filter((j) => !dismissed.has(j.id));
  if (visible.length === 0) return null;

  const totalDone = visible.reduce((a, j) => a + j.doneCount + j.skippedCount, 0);
  const totalAll = visible.reduce((a, j) => a + j.total, 0);
  const totalFailed = visible.reduce((a, j) => a + j.failedCount, 0);
  const allRunning = visible.every((j) => j.status === "running" || j.status === "pending");

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[360px] max-w-[calc(100vw-2rem)] animate-fade-in">
      <div className="rounded-lg border border-border bg-surface/95 backdrop-blur-xl shadow-2xl shadow-black/40 overflow-hidden">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full px-4 py-3 flex items-center gap-3 hover:bg-elevated/60 transition-colors cursor-pointer text-left"
        >
          <div className="relative h-7 w-7 shrink-0 flex items-center justify-center rounded bg-primary/15 text-primary">
            {allRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Activity className="h-3.5 w-3.5" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-foreground flex items-center gap-2">
              <span>{visible.length} 个进行中任务</span>
              {totalFailed > 0 && (
                <span className="text-2xs text-destructive font-mono tabular-nums">
                  · {totalFailed} 失败
                </span>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary to-accent transition-all"
                  style={{
                    width: `${totalAll ? (totalDone / totalAll) * 100 : 0}%`,
                  }}
                />
              </div>
              <span className="text-2xs text-faint tabular-nums whitespace-nowrap font-mono">
                {totalDone} / {totalAll}
              </span>
            </div>
          </div>
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-faint shrink-0" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5 text-faint shrink-0" />
          )}
        </button>

        {expanded && (
          <div className="border-t border-border max-h-[40vh] overflow-auto">
            {visible.map((j) => (
              <JobRow
                key={j.id}
                job={j}
                onDismiss={() =>
                  setDismissed((s) => new Set(s).add(j.id))
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function JobRow({ job, onDismiss }: { job: JobLike; onDismiss: () => void }) {
  const pct = job.total
    ? ((job.doneCount + job.skippedCount + job.failedCount) / job.total) * 100
    : 0;
  return (
    <div className="px-4 py-3 border-b border-border/60 last:border-0 group">
      <div className="flex items-center gap-2 mb-2">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full shrink-0",
            job.status === "running" && "bg-primary animate-pulse",
            job.status === "pending" && "bg-faint",
            job.status === "done" && "bg-success",
            job.status === "failed" && "bg-destructive",
          )}
        />
        <p className="text-xs font-medium truncate flex-1">{job.title}</p>
        <button
          onClick={onDismiss}
          className="opacity-0 group-hover:opacity-100 text-faint hover:text-foreground transition-opacity"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="flex items-center gap-2 mb-1.5">
        <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-2xs text-faint tabular-nums whitespace-nowrap font-mono">
          {job.doneCount + job.skippedCount} / {job.total}
        </span>
      </div>
      <div className="flex items-center justify-between text-2xs text-faint">
        <span className="flex items-center gap-1.5">
          {job.doneCount > 0 && (
            <span className="text-success">
              <CheckCircle2 className="h-2.5 w-2.5 inline mr-0.5" />
              {job.doneCount}
            </span>
          )}
          {job.failedCount > 0 && (
            <span className="text-destructive">
              <AlertCircle className="h-2.5 w-2.5 inline mr-0.5" />
              {job.failedCount}
            </span>
          )}
          {job.skippedCount > 0 && (
            <span className="text-warning">跳过 {job.skippedCount}</span>
          )}
        </span>
        <Link
          href={jobTarget(job) as any}
          className="text-primary hover:underline"
        >
          {jobLabel(job.kind)} →
        </Link>
      </div>
    </div>
  );
}
