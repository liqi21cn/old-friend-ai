"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Save,
  Sparkles,
  ArrowRight,
  Loader2,
  Film,
  MessageSquare,
  Wand2,
  Plus,
  X,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Turn {
  speaker: string;
  text: string;
  action?: string | null;
}
interface Round {
  round: number;
  turns: Turn[];
}
interface Transcript {
  sessionId: string;
  startedAt: string;
  scene: {
    setting: string;
    conflict: string;
    goal: string;
    opener?: string;
  };
  characters: Array<{ id: string; name?: string }>;
  rounds: Round[];
  narration?: string; // appended summary coda
}

export function ScreenplayEditor({
  sessionId,
  initialTranscript,
}: {
  sessionId: string;
  initialTranscript: Transcript;
}) {
  const router = useRouter();
  const [transcript, setTranscript] = React.useState<Transcript>(
    initialTranscript,
  );
  const [narration, setNarration] = React.useState(
    initialTranscript.narration || "",
  );
  const [generatingNarration, setGeneratingNarration] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [renderJobId, setRenderJobId] = React.useState<string | null>(null);
  const [renderJob, setRenderJob] = React.useState<any | null>(null);

  function updateTurn(roundIdx: number, turnIdx: number, patch: Partial<Turn>) {
    setTranscript((t) => {
      const next = { ...t, rounds: t.rounds.map((r) => ({ ...r, turns: [...r.turns] })) };
      next.rounds[roundIdx].turns[turnIdx] = {
        ...next.rounds[roundIdx].turns[turnIdx],
        ...patch,
      };
      return next;
    });
  }

  function addTurn(roundIdx: number) {
    setTranscript((t) => {
      const next = { ...t, rounds: t.rounds.map((r) => ({ ...r, turns: [...r.turns] })) };
      next.rounds[roundIdx].turns.push({
        speaker: t.characters[0]?.id || "",
        text: "",
        action: null,
      });
      return next;
    });
  }

  function removeTurn(roundIdx: number, turnIdx: number) {
    setTranscript((t) => {
      const next = { ...t, rounds: t.rounds.map((r) => ({ ...r, turns: [...r.turns] })) };
      next.rounds[roundIdx].turns.splice(turnIdx, 1);
      return next;
    });
  }

  async function generateNarration() {
    setGeneratingNarration(true);
    try {
      const res = await fetch("/api/narration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setNarration(data.narration);
    } catch (e: any) {
      alert("生成失败：" + e.message);
    } finally {
      setGeneratingNarration(false);
    }
  }

  async function save() {
    setSaving(true);
    await fetch(`/api/transcripts/${sessionId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...transcript, narration }),
    });
    setSaving(false);
  }

  // Restore in-flight render job from localStorage on mount so the banner
  // survives reload / tab switch.
  React.useEffect(() => {
    const stored = localStorage.getItem(`render-job:${sessionId}`);
    if (stored) setRenderJobId(stored);
  }, [sessionId]);

  // Poll the render job while it's active.
  React.useEffect(() => {
    if (!renderJobId) return;
    let alive = true;
    async function tick() {
      try {
        const res = await fetch(`/api/jobs/${renderJobId}`, {
          cache: "no-store",
        });
        if (!alive) return;
        if (res.status === 404) {
          // Job was deleted or never existed — clear the local ref.
          setRenderJobId(null);
          setRenderJob(null);
          localStorage.removeItem(`render-job:${sessionId}`);
          return;
        }
        if (res.ok) {
          const data = await res.json();
          setRenderJob(data);
          if (
            data.status === "done" ||
            data.status === "failed" ||
            data.status === "cancelled"
          ) {
            // Stop polling — keep banner visible until user dismisses it.
            return;
          }
        }
      } catch {
        /* swallow */
      }
      if (alive) setTimeout(tick, 1500);
    }
    tick();
    return () => {
      alive = false;
    };
  }, [renderJobId, sessionId]);

  async function renderStoryboard() {
    setSubmitting(true);
    try {
      await save();
      const res = await fetch(`/api/screenplay/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episode: 1, sceneNo: 1 }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { jobId: string };
      setRenderJobId(data.jobId);
      localStorage.setItem(`render-job:${sessionId}`, data.jobId);
    } catch (e: any) {
      alert("提交任务失败：" + (e?.message || String(e)));
    } finally {
      setSubmitting(false);
    }
  }

  function dismissRenderBanner() {
    setRenderJobId(null);
    setRenderJob(null);
    localStorage.removeItem(`render-job:${sessionId}`);
  }

  async function retryFailedShots() {
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/screenplay/${sessionId}/retry-failed`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        jobId: string | null;
        message?: string;
      };
      if (data.jobId) {
        setRenderJobId(data.jobId);
        localStorage.setItem(`render-job:${sessionId}`, data.jobId);
      } else if (data.message) {
        alert(data.message);
      }
    } catch (e: any) {
      alert("重试失败：" + (e?.message || String(e)));
    } finally {
      setSubmitting(false);
    }
  }

  const renderJobIsActive =
    renderJob &&
    (renderJob.status === "pending" || renderJob.status === "running");

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Action bar */}
      <div className="px-8 py-3 border-b border-border bg-surface/40 flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs">
          <Badge variant="primary">
            <MessageSquare className="h-3 w-3 mr-1" />
            {transcript.rounds.reduce((a, r) => a + r.turns.length, 0)} 段对白
          </Badge>
          <Badge>{transcript.rounds.length} 轮</Badge>
          <Badge>{transcript.characters.length} 角色</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={save} disabled={saving}>
            <Save className="h-3.5 w-3.5" />
            {saving ? "保存中..." : "保存修改"}
          </Button>
          <Button
            variant="accent"
            size="sm"
            onClick={renderStoryboard}
            disabled={submitting || renderJobIsActive}
            title={
              renderJobIsActive
                ? "已有渲染任务在跑，关闭横幅后可重新提交"
                : undefined
            }
          >
            {submitting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Film className="h-3.5 w-3.5" />
            )}
            {submitting
              ? "提交中..."
              : renderJobIsActive
              ? "渲染进行中"
              : "渲染分镜"}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {renderJob && (
        <RenderJobBanner
          job={renderJob}
          sessionId={sessionId}
          onDismiss={dismissRenderBanner}
          onRetryFull={renderStoryboard}
          onRetryFailed={retryFailedShots}
          retrying={submitting}
        />
      )}

      <div className="flex-1 overflow-auto px-8 py-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Scene header */}
          <div className="rounded-lg border border-border bg-surface/50 px-5 py-4">
            <div className="flex items-baseline gap-3 mb-3">
              <span className="label-mono">scene</span>
              <code className="font-mono text-sm text-accent">
                EP01 / SC01
              </code>
            </div>
            <div className="space-y-2">
              <SceneField
                label="setting"
                value={transcript.scene.setting}
                onChange={(v) =>
                  setTranscript((t) => ({
                    ...t,
                    scene: { ...t.scene, setting: v },
                  }))
                }
              />
              <SceneField
                label="conflict"
                value={transcript.scene.conflict}
                onChange={(v) =>
                  setTranscript((t) => ({
                    ...t,
                    scene: { ...t.scene, conflict: v },
                  }))
                }
              />
              <SceneField
                label="goal"
                value={transcript.scene.goal}
                onChange={(v) =>
                  setTranscript((t) => ({
                    ...t,
                    scene: { ...t.scene, goal: v },
                  }))
                }
              />
            </div>
          </div>

          {/* Rounds */}
          {transcript.rounds.map((round, ri) => (
            <div key={ri} className="space-y-3">
              <div className="flex items-center gap-3 sticky top-0 z-10 bg-background py-1">
                <span className="label-mono">round</span>
                <code className="font-mono text-sm tabular-nums text-accent">
                  {String(round.round).padStart(2, "0")}
                </code>
                <div className="flex-1 hr-etched" />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => addTurn(ri)}
                  className="text-2xs"
                >
                  <Plus className="h-3 w-3" />
                  追加发言
                </Button>
              </div>
              {round.turns.map((turn, ti) => (
                <TurnEditor
                  key={ti}
                  turn={turn}
                  characters={transcript.characters}
                  onChange={(p) => updateTurn(ri, ti, p)}
                  onRemove={() => removeTurn(ri, ti)}
                />
              ))}
            </div>
          ))}

          {/* Narration coda — highlighted */}
          <div
            className={cn(
              "rounded-lg border-2 px-5 py-5 transition-colors",
              narration
                ? "border-warning/40 bg-warning/5"
                : "border-dashed border-warning/30 bg-warning/[0.03]",
            )}
          >
            <div className="flex items-start justify-between mb-3 gap-3">
              <div>
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <span className="inline-flex h-5 px-1.5 items-center rounded bg-warning/20 text-warning text-2xs font-mono">
                    NARRATION
                  </span>
                  旁白收束（剧本末尾自动追加）
                </h3>
                <p className="text-2xs text-subtle mt-1 leading-relaxed">
                  对全场对白做一段画外音总结：呼应主题、收束冲突。LLM
                  生成，可自由修改。
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={generateNarration}
                disabled={generatingNarration}
              >
                {generatingNarration ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                {narration ? "重新生成" : "生成旁白"}
              </Button>
            </div>
            <Textarea
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
              placeholder="（旁白未生成。点右上角的按钮让 LLM 根据上文对白产出一段总结性旁白；之后你可以修改或重写。）"
              rows={5}
              className="text-sm leading-relaxed bg-surface/60 border-warning/30 focus-visible:border-warning"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SceneField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="label-mono w-16 shrink-0 pt-1.5">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={1}
        className={cn(
          "flex-1 bg-transparent text-sm leading-relaxed text-foreground resize-none border-0 p-0",
          "focus:outline-none focus:ring-0 focus:border-0",
        )}
      />
    </div>
  );
}

function TurnEditor({
  turn,
  characters,
  onChange,
  onRemove,
}: {
  turn: Turn;
  characters: Array<{ id: string; name?: string }>;
  onChange: (p: Partial<Turn>) => void;
  onRemove: () => void;
}) {
  const char = characters.find((c) => c.id === turn.speaker);
  const hash = Array.from(turn.speaker).reduce(
    (a, c) => a + c.charCodeAt(0),
    0,
  );
  const hue1 = hash % 360;
  const hue2 = (hash * 13) % 360;

  return (
    <div className="group rounded-lg border border-border bg-surface/40 hover:bg-surface px-4 py-3 transition-colors">
      <div className="flex items-start gap-3">
        <div
          className="h-9 w-9 shrink-0 rounded flex items-center justify-center text-white text-xs font-semibold"
          style={{
            background: `linear-gradient(135deg, hsl(${hue1} 70% 45%), hsl(${hue2} 65% 35%))`,
          }}
        >
          {(char?.name || turn.speaker).slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <select
              value={turn.speaker}
              onChange={(e) => onChange({ speaker: e.target.value })}
              className="text-sm font-semibold bg-transparent border-0 p-0 text-foreground cursor-pointer focus:outline-none focus:ring-0"
            >
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.id}
                </option>
              ))}
            </select>
            <code className="text-2xs font-mono text-faint">
              {turn.speaker}
            </code>
            <button
              onClick={onRemove}
              className="ml-auto opacity-0 group-hover:opacity-100 text-faint hover:text-destructive transition-opacity"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <Input
            value={turn.action || ""}
            onChange={(e) => onChange({ action: e.target.value || null })}
            placeholder="（动作描述，可拍到的画面，可留空）"
            className="text-xs text-accent italic mb-1.5 bg-muted/40 border-border h-7"
          />
          <Textarea
            value={turn.text}
            onChange={(e) => onChange({ text: e.target.value })}
            rows={2}
            placeholder="对白"
            className="text-sm leading-relaxed bg-transparent border-0 p-0 resize-none focus-visible:ring-0"
          />
        </div>
      </div>
    </div>
  );
}

interface RenderJobBannerProps {
  job: {
    id: string;
    status: "pending" | "running" | "done" | "failed" | "cancelled";
    total: number;
    doneCount: number;
    failedCount: number;
    items?: Array<{
      rowIndex: number;
      label: string;
      status: "queued" | "running" | "done" | "failed" | "skipped";
      message?: string | null;
    }>;
    result?: any;
    error?: string | null;
  };
  sessionId: string;
  onDismiss: () => void;
  onRetryFull: () => void;
  onRetryFailed: () => void;
  retrying?: boolean;
}

function RenderJobBanner({
  job,
  sessionId,
  onDismiss,
  onRetryFull,
  onRetryFailed,
  retrying,
}: RenderJobBannerProps) {
  const pct = job.total
    ? Math.min(100, (job.doneCount / job.total) * 100)
    : 0;

  const phaseAItem = job.items?.find((i) => i.rowIndex === 0);
  const phaseADone = phaseAItem?.status === "done";
  const phaseAFailed = phaseAItem?.status === "failed";

  const phaseBItems = (job.items || []).filter((i) => i.rowIndex >= 1);
  const phaseBDone = phaseBItems.filter((i) => i.status === "done").length;
  const phaseBFailed = phaseBItems.filter((i) => i.status === "failed").length;

  let phaseLabel = "";
  if (job.status === "pending") {
    phaseLabel = "排队中...";
  } else if (job.status === "running") {
    if (!phaseADone && !phaseAFailed) {
      phaseLabel = "Phase A · 生成镜头骨架（30-90 秒）";
    } else if (phaseADone) {
      phaseLabel = `Phase B · 为 ${phaseBItems.length} 个镜头并行生成视频分段提示词`;
    } else if (phaseAFailed) {
      phaseLabel = "Phase A 失败";
    }
  } else if (job.status === "done") {
    phaseLabel = "渲染完成";
  } else if (job.status === "failed") {
    phaseLabel = "渲染失败";
  } else if (job.status === "cancelled") {
    phaseLabel = "已取消";
  }

  const isActive = job.status === "pending" || job.status === "running";
  const isDone = job.status === "done";
  const isFailed = job.status === "failed";

  return (
    <div
      className={cn(
        "border-b px-8 py-3 flex items-start gap-3 animate-fade-in",
        isFailed
          ? "border-destructive/40 bg-destructive/5"
          : isDone
          ? "border-success/40 bg-success/5"
          : "border-primary/40 bg-primary/5",
      )}
    >
      {isActive ? (
        <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0 mt-0.5" />
      ) : isDone ? (
        <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
      ) : (
        <X className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-xs font-semibold">{phaseLabel}</p>
          <code className="font-mono text-2xs text-faint">
            job {job.id.slice(0, 8)}
          </code>
          {phaseBFailed > 0 && (
            <span className="text-2xs text-destructive">
              · {phaseBFailed} 个镜头失败
            </span>
          )}
        </div>

        {isActive && (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden max-w-md">
              <div
                className="h-full bg-gradient-to-r from-primary to-accent transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-2xs text-faint tabular-nums font-mono whitespace-nowrap">
              {job.doneCount} / {job.total || "?"}
            </span>
          </div>
        )}

        {isFailed && job.error && (
          <p className="mt-1 text-2xs text-destructive leading-relaxed">
            {job.error}
          </p>
        )}

        {isActive && (
          <p className="mt-2 text-2xs text-faint">
            任务在后台运行，可随时切换到其他页面。右下角浮动条 +
            本页面都会同步进度。
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
        {/* Partial failure: offer retry-failed-only */}
        {isDone && job.failedCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={onRetryFailed}
            disabled={retrying}
          >
            {retrying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            重试 {job.failedCount} 个失败镜头
          </Button>
        )}
        {/* Full failure: offer full re-render */}
        {isFailed && (
          <Button
            size="sm"
            variant="outline"
            onClick={onRetryFull}
            disabled={retrying}
          >
            {retrying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            重新渲染
          </Button>
        )}
        {isFailed && (
          <Link href={`/storyboard/${sessionId}` as any}>
            <Button size="sm" variant="ghost">
              查看分镜表
            </Button>
          </Link>
        )}
        {isDone && (
          <Link href={`/assets/${sessionId}` as any}>
            <Button size="sm" variant="accent">
              查看资产 <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        )}
        <button
          onClick={onDismiss}
          className="h-7 w-7 rounded flex items-center justify-center text-faint hover:text-foreground hover:bg-elevated transition-colors"
          title="隐藏横幅（任务不会被取消）"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
