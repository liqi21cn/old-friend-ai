"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Download,
  Upload,
  FileSpreadsheet,
  Play,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  Sparkles,
  RotateCcw,
  Trash2,
  X,
  Info,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { parseCsv, rowsToCharacters, type CharacterRow } from "@/lib/csv";
import { cn } from "@/lib/utils";

type RowStage =
  | "ready"
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "skipped";

interface RowState extends CharacterRow {
  stage: RowStage;
  message?: string;
}

interface JobItem {
  rowIndex: number;
  targetId: string | null;
  label: string;
  status: "queued" | "running" | "done" | "failed" | "skipped";
  message: string | null;
}

interface Job {
  id: string;
  kind: string;
  title: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  total: number;
  doneCount: number;
  failedCount: number;
  skippedCount: number;
  concurrency: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  items: JobItem[];
}

const STAGE_VARIANT: Record<
  RowStage,
  "default" | "primary" | "accent" | "warning" | "success" | "destructive" | "secondary"
> = {
  ready: "default",
  queued: "secondary",
  running: "primary",
  done: "success",
  failed: "destructive",
  skipped: "warning",
};

const STAGE_LABEL: Record<RowStage, string> = {
  ready: "待生成",
  queued: "排队中",
  running: "蒸馏中",
  done: "已完成",
  failed: "失败",
  skipped: "已跳过",
};

const ACTIVE_JOB_LS_KEY = "person-skills:batch:activeJobId";

export function BatchImport() {
  const router = useRouter();
  const [rows, setRows] = React.useState<RowState[]>([]);
  const [headerErrors, setHeaderErrors] = React.useState<string[]>([]);
  const [concurrency, setConcurrency] = React.useState(5);
  const [filter, setFilter] = React.useState("");
  const [dragOver, setDragOver] = React.useState(false);
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [job, setJob] = React.useState<Job | null>(null);
  const [starting, setStarting] = React.useState(false);

  // Persist + restore the running jobId across navigation/refresh
  React.useEffect(() => {
    const stored = localStorage.getItem(ACTIVE_JOB_LS_KEY);
    if (stored) setJobId(stored);
  }, []);
  React.useEffect(() => {
    if (jobId) localStorage.setItem(ACTIVE_JOB_LS_KEY, jobId);
    else localStorage.removeItem(ACTIVE_JOB_LS_KEY);
  }, [jobId]);

  // Poll the active job
  React.useEffect(() => {
    if (!jobId) return;
    let alive = true;
    async function tick() {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!alive) return;
        if (res.ok) {
          const data = (await res.json()) as Job;
          setJob(data);
          // Sync table rows with job item statuses
          setRows((prev) => {
            if (prev.length === 0) return prev;
            const byIdx = new Map(data.items.map((it) => [it.rowIndex, it]));
            return prev.map((r) => {
              const it = byIdx.get(r.rowIndex);
              if (!it) return r;
              return {
                ...r,
                stage: it.status,
                message: it.message ?? undefined,
              };
            });
          });
          if (
            data.status === "done" ||
            data.status === "failed" ||
            data.status === "cancelled"
          ) {
            router.refresh();
            // Keep the local jobId visible until user clicks dismiss, so they
            // see the final state. But stop polling.
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
  }, [jobId, router]);

  function loadCsvText(text: string) {
    const parsed = parseCsv(text);
    const { characters, headerErrors } = rowsToCharacters(parsed);
    setHeaderErrors(headerErrors);
    setRows(
      characters.map((c) => ({
        ...c,
        stage: c.errors.length ? "failed" : "ready",
        message: c.errors.length ? c.errors.join("；") : undefined,
      })),
    );
    // Starting a new upload clears the prior job reference
    setJobId(null);
    setJob(null);
  }

  async function handleFile(file: File) {
    const text = await file.text();
    loadCsvText(text);
  }

  function updateRow(rowIndex: number, patch: Partial<RowState>) {
    setRows((arr) =>
      arr.map((r) => (r.rowIndex === rowIndex ? { ...r, ...patch } : r)),
    );
  }

  function removeRow(rowIndex: number) {
    setRows((arr) => arr.filter((r) => r.rowIndex !== rowIndex));
  }

  function reset() {
    setRows([]);
    setHeaderErrors([]);
    setJobId(null);
    setJob(null);
  }

  async function startBatch(retryFailedOnly = false) {
    const payload = rows.filter((r) => {
      if (r.errors.length > 0) return false;
      if (retryFailedOnly)
        return r.stage === "failed" || r.stage === "skipped";
      return r.stage === "ready" || r.stage === "failed";
    });
    if (payload.length === 0) return;

    setStarting(true);
    payload.forEach((r) =>
      updateRow(r.rowIndex, { stage: "queued", message: undefined }),
    );

    try {
      const res = await fetch("/api/characters/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: payload, concurrency }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { jobId: string };
      setJobId(data.jobId);
    } catch (e: any) {
      alert("提交批量任务失败：" + e.message);
    } finally {
      setStarting(false);
    }
  }

  async function cancelJob() {
    if (!jobId) return;
    await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
  }

  const stats = React.useMemo(() => {
    const s = { total: rows.length, ready: 0, done: 0, failed: 0, running: 0, errors: 0 };
    for (const r of rows) {
      if (r.errors.length) s.errors++;
      if (r.stage === "ready") s.ready++;
      if (r.stage === "done") s.done++;
      if (r.stage === "failed") s.failed++;
      if (r.stage === "queued" || r.stage === "running") s.running++;
    }
    return s;
  }, [rows]);

  const filtered = filter
    ? rows.filter(
        (r) =>
          r.id.toLowerCase().includes(filter.toLowerCase()) ||
          r.name.toLowerCase().includes(filter.toLowerCase()),
      )
    : rows;

  const jobIsRunning =
    job?.status === "running" || job?.status === "pending" || starting;

  // Banner: shown when a persisted job exists but no rows loaded yet (e.g. user
  // navigated back to the page mid-run from elsewhere)
  if (rows.length === 0 && jobId && job) {
    return <ResumeBanner job={job} onDismiss={reset} />;
  }

  if (rows.length === 0) {
    return (
      <UploadDropzone
        onText={loadCsvText}
        onFile={handleFile}
        dragOver={dragOver}
        setDragOver={setDragOver}
        headerErrors={headerErrors}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 sticky top-0 z-10 bg-background/85 backdrop-blur-md py-3 -mx-8 px-8 border-b border-border">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="primary">
            <FileSpreadsheet className="h-3 w-3 mr-1" />
            <span className="tabular-nums">{stats.total}</span> 行
          </Badge>
          {stats.ready > 0 && (
            <Badge>
              <Clock className="h-3 w-3 mr-1" />
              <span className="tabular-nums">{stats.ready}</span> 待生成
            </Badge>
          )}
          {stats.running > 0 && (
            <Badge variant="primary">
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              <span className="tabular-nums">{stats.running}</span> 进行中
            </Badge>
          )}
          {stats.done > 0 && (
            <Badge variant="success">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              <span className="tabular-nums">{stats.done}</span> 完成
            </Badge>
          )}
          {stats.failed > 0 && (
            <Badge variant="destructive">
              <AlertCircle className="h-3 w-3 mr-1" />
              <span className="tabular-nums">{stats.failed}</span> 失败
            </Badge>
          )}
          {jobId && (
            <code className="ml-2 font-mono text-2xs text-accent">
              job {jobId.slice(0, 8)}
            </code>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-faint" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="过滤"
              className="pl-8 h-8 w-32 text-xs"
            />
          </div>
          {!jobIsRunning && (
            <label className="flex items-center gap-1.5 text-2xs text-subtle">
              并发
              <input
                type="number"
                min={1}
                max={10}
                value={concurrency}
                onChange={(e) =>
                  setConcurrency(
                    Math.max(1, Math.min(10, Number(e.target.value) || 5)),
                  )
                }
                className="w-12 h-7 rounded border border-border bg-muted px-1.5 text-xs font-mono tabular-nums text-center"
              />
            </label>
          )}
          {!jobIsRunning ? (
            <>
              <Button variant="ghost" size="sm" onClick={reset}>
                <Trash2 className="h-3.5 w-3.5" />
                清空
              </Button>
              {stats.failed > 0 && stats.ready === 0 ? (
                <Button size="sm" onClick={() => startBatch(true)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  仅重试失败 ({stats.failed})
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => startBatch(false)}
                  disabled={stats.ready === 0 && stats.failed === 0}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  开始生成 ({stats.ready + stats.failed})
                </Button>
              )}
            </>
          ) : (
            <Button variant="destructive" size="sm" onClick={cancelJob}>
              <X className="h-3.5 w-3.5" />
              中止
            </Button>
          )}
        </div>
      </div>

      {job && (job.status === "done" || job.status === "cancelled") && (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 flex items-center gap-3 text-sm animate-fade-in",
            job.failedCount > 0
              ? "border-warning/40 bg-warning/10"
              : "border-success/40 bg-success/10",
          )}
        >
          {job.failedCount > 0 ? (
            <AlertCircle className="h-4 w-4 text-warning" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-success" />
          )}
          <span>
            批量{job.status === "cancelled" ? "已中止" : "完成"}：
            <span className="text-success font-semibold tabular-nums mx-1">
              {job.doneCount}
            </span>{" "}
            成功 ·
            <span className="text-warning font-semibold tabular-nums mx-1">
              {job.skippedCount}
            </span>{" "}
            跳过 ·
            <span className="text-destructive font-semibold tabular-nums mx-1">
              {job.failedCount}
            </span>{" "}
            失败 / 共
            <span className="font-semibold tabular-nums mx-1">
              {job.total}
            </span>
            。已写入角色库（含 portrait 自动抓取）。
          </span>
        </div>
      )}

      <Card>
        <div className="overflow-auto max-h-[60vh]">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface z-10 border-b border-border">
              <tr className="text-left">
                <th className="px-3 py-2.5 label-mono w-12">行</th>
                <th className="px-3 py-2.5 label-mono w-20">type</th>
                <th className="px-3 py-2.5 label-mono w-36">id</th>
                <th className="px-3 py-2.5 label-mono w-40">姓名</th>
                <th className="px-3 py-2.5 label-mono w-32">时代</th>
                <th className="px-3 py-2.5 label-mono">标签</th>
                <th className="px-3 py-2.5 label-mono w-32">状态</th>
                <th className="px-3 py-2.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <BatchRow
                  key={row.rowIndex}
                  row={row}
                  onChange={(p) => updateRow(row.rowIndex, p)}
                  onRemove={() => removeRow(row.rowIndex)}
                  disabled={jobIsRunning}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ResumeBanner({ job, onDismiss }: { job: Job; onDismiss: () => void }) {
  const pct = job.total
    ? ((job.doneCount + job.skippedCount + job.failedCount) / job.total) * 100
    : 0;
  return (
    <Card className="px-6 py-5">
      <div className="flex items-center gap-4">
        <div className="h-10 w-10 rounded-md bg-primary/15 text-primary flex items-center justify-center shrink-0">
          {job.status === "running" || job.status === "pending" ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-5 w-5" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">{job.title}</h3>
          <p className="text-xs text-subtle mt-0.5">
            {job.status === "running"
              ? "正在后台运行（你刚才离开了页面，但任务还在跑）"
              : "上次离开时尚未完成的批量任务"}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-accent transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-2xs text-faint tabular-nums font-mono">
              {job.doneCount + job.skippedCount} / {job.total}
              {job.failedCount > 0 && (
                <span className="text-destructive ml-1">
                  · {job.failedCount} 失败
                </span>
              )}
            </span>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          关闭
        </Button>
      </div>
    </Card>
  );
}

function BatchRow({
  row,
  onChange,
  onRemove,
  disabled,
}: {
  row: RowState;
  onChange: (p: Partial<RowState>) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const isError = row.stage === "failed" || row.errors.length > 0;
  return (
    <tr
      className={cn(
        "border-b border-border/40 hover:bg-elevated/30 transition-colors",
        row.stage === "done" && "bg-success/5",
        isError && "bg-destructive/5",
      )}
    >
      <td className="px-3 py-2 font-mono tabular-nums text-faint text-2xs">
        {row.rowIndex}
      </td>
      <td className="px-3 py-2">
        <Badge variant={row.type === "real" ? "primary" : "accent"}>
          {row.type}
        </Badge>
      </td>
      <td className="px-3 py-2">
        <input
          value={row.id}
          disabled={disabled || row.stage === "done"}
          onChange={(e) =>
            onChange({
              id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
            })
          }
          className="w-full bg-transparent font-mono text-2xs text-foreground border-0 p-0 focus:outline-none focus:ring-0 disabled:opacity-50"
        />
      </td>
      <td className="px-3 py-2">
        <input
          value={row.name}
          disabled={disabled || row.stage === "done"}
          onChange={(e) => onChange({ name: e.target.value })}
          className="w-full bg-transparent text-foreground border-0 p-0 focus:outline-none focus:ring-0 disabled:opacity-50"
        />
      </td>
      <td className="px-3 py-2 text-subtle">
        <input
          value={row.era}
          disabled={disabled || row.stage === "done"}
          onChange={(e) => onChange({ era: e.target.value })}
          className="w-full bg-transparent border-0 p-0 focus:outline-none focus:ring-0 disabled:opacity-50"
        />
      </td>
      <td className="px-3 py-2 text-subtle">
        <div className="flex flex-wrap gap-1">
          {row.tags.map((t, i) => (
            <span
              key={i}
              className="px-1.5 py-0.5 rounded bg-muted text-2xs"
            >
              {t}
            </span>
          ))}
          {row.tags.length === 0 && (
            <span className="text-faint text-2xs">—</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <Badge variant={STAGE_VARIANT[row.stage]}>
            {row.stage === "running" || row.stage === "queued" ? (
              <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />
            ) : null}
            {STAGE_LABEL[row.stage]}
          </Badge>
          {row.message && (
            <span
              className={cn(
                "text-2xs leading-tight",
                isError ? "text-destructive" : "text-faint",
              )}
              title={row.message}
            >
              {row.message.length > 50
                ? row.message.slice(0, 50) + "..."
                : row.message}
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2">
        <button
          onClick={onRemove}
          disabled={disabled}
          className="text-faint hover:text-destructive disabled:opacity-30 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

function UploadDropzone({
  onText,
  onFile,
  dragOver,
  setDragOver,
  headerErrors,
}: {
  onText: (text: string) => void;
  onFile: (file: File) => Promise<void>;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  headerErrors: string[];
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [pasteText, setPasteText] = React.useState("");

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-accent/30 bg-accent/5 px-5 py-4 flex items-start gap-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent">
          <Info className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">批量导入角色清单</h3>
          <p className="text-xs text-subtle mt-1 leading-relaxed">
            一次性提交 N 个角色，系统按设定并发（默认 5）调用女娲蒸馏 SKILL.md
            并落到{" "}
            <code className="font-mono text-accent">MySQL</code> + 同步一份只读副本到{" "}
            <code className="font-mono text-accent">
              characters/&lt;type&gt;/&lt;id&gt;/
            </code>
            。任务持久化到{" "}
            <code className="font-mono text-accent">jobs</code> 表，刷新或切到其他页面后{" "}
            <strong className="text-foreground">右下角浮动进度条</strong>{" "}
            会继续显示进度。
          </p>
        </div>
        <a href="/api/characters/template" download>
          <Button variant="outline" size="sm">
            <Download className="h-3.5 w-3.5" />
            下载 CSV 模板
          </Button>
        </a>
      </div>

      {headerErrors.length > 0 && (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs">
          <p className="font-semibold text-destructive flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" />
            模板格式错误
          </p>
          <ul className="mt-1 ml-5 list-disc text-destructive">
            {headerErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) await onFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "rounded-lg border-2 border-dashed transition-colors px-8 py-16 text-center cursor-pointer",
          dragOver
            ? "border-primary bg-primary/10"
            : "border-border bg-surface/40 hover:bg-surface/60 hover:border-primary/40",
        )}
      >
        <div className="mx-auto h-12 w-12 rounded-lg bg-elevated flex items-center justify-center text-primary mb-3">
          <Upload className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium">
          拖放 CSV 文件，或点击选择
        </p>
        <p className="text-2xs text-faint mt-1">
          UTF-8 编码 · 仅 .csv · 表头：type, id, name, era, tags
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) await onFile(f);
            e.target.value = "";
          }}
        />
      </div>

      <div className="flex items-center gap-2 justify-center">
        <div className="hr-etched flex-1 max-w-xs" />
        <span className="label-mono">或</span>
        <div className="hr-etched flex-1 max-w-xs" />
      </div>

      {pasteOpen ? (
        <div className="space-y-2">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="type,id,name,era,tags&#10;real,jobs,Steve Jobs,1955-2011,&quot;产品,极简&quot;&#10;real,musk,Elon Musk,1971-,火箭"
            rows={6}
            className="w-full rounded border border-border bg-muted px-3 py-2 text-xs font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring focus:border-primary resize-vertical"
          />
          <div className="flex items-center gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPasteOpen(false);
                setPasteText("");
              }}
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onText(pasteText);
                setPasteOpen(false);
              }}
              disabled={!pasteText.trim()}
            >
              解析粘贴内容
            </Button>
          </div>
        </div>
      ) : (
        <div className="text-center">
          <Button variant="ghost" size="sm" onClick={() => setPasteOpen(true)}>
            粘贴 CSV 文本
          </Button>
        </div>
      )}
    </div>
  );
}
