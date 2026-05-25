"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  User,
  Drama,
  Plus,
  X,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Quote,
  FileSpreadsheet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { BatchImport } from "./batch-import";

type Stage = "form" | "generating" | "review";

export function NewCharacterForm({
  initialType,
}: {
  initialType: "real" | "fictional";
}) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"real" | "fictional" | "batch">(
    initialType,
  );
  // `type` is only meaningful when mode ∈ { real, fictional }; in batch mode it's unused.
  const type: "real" | "fictional" = mode === "batch" ? "real" : mode;
  const [stage, setStage] = React.useState<Stage>("form");
  const [progress, setProgress] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [generated, setGenerated] = React.useState<{
    id: string;
    skill: string;
    meta: any;
  } | null>(null);

  // Form fields
  const [id, setId] = React.useState("");
  const [name, setName] = React.useState("");
  const [era, setEra] = React.useState("");
  const [tags, setTags] = React.useState("");
  // Fictional-only
  const [sourceWork, setSourceWork] = React.useState("");
  const [coreConflict, setCoreConflict] = React.useState("");
  const [worldview, setWorldview] = React.useState("");
  const [limitations, setLimitations] = React.useState("");
  const [voiceSamples, setVoiceSamples] = React.useState<string[]>([""]);
  const [relations, setRelations] = React.useState<
    Array<{ target: string; type: string; status: string }>
  >([]);

  const voiceCount = voiceSamples.filter((v) => v.trim().length > 0).length;
  const canSubmit =
    id.trim() &&
    name.trim() &&
    (type === "real"
      ? era.trim()
      : sourceWork.trim() &&
        coreConflict.trim() &&
        voiceCount >= 10);

  async function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    setStage("generating");
    setProgress([]);

    try {
      const payload = {
        type,
        id,
        name,
        era,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        ...(type === "fictional"
          ? {
              source_work: sourceWork,
              core_conflict: coreConflict,
              worldview,
              limitations,
              voice_samples: voiceSamples.filter((v) => v.trim()),
              relations,
            }
          : {}),
      };

      const res = await fetch("/api/characters/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok || !res.body) {
        const t = await res.text();
        throw new Error(t || "生成失败");
      }

      // Stream progress (SSE-lite — line-delimited JSON)
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.kind === "progress") {
              setProgress((p) => [...p, ev.message]);
            } else if (ev.kind === "done") {
              setGenerated(ev.payload);
              setStage("review");
            } else if (ev.kind === "error") {
              throw new Error(ev.message);
            }
          } catch (e) {
            // ignore non-JSON chunks
          }
        }
      }
    } catch (e: any) {
      setError(e.message || String(e));
      setStage("form");
    }
  }

  async function handleSave() {
    if (!generated) return;
    const res = await fetch("/api/characters/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        meta: generated.meta,
        skill: generated.skill,
      }),
    });
    if (res.ok) {
      router.push("/characters");
      router.refresh();
    } else {
      setError("保存失败：" + (await res.text()));
    }
  }

  if (stage === "generating") {
    return (
      <div className="flex-1 overflow-auto px-8 py-8">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary animate-pulse" />
              {type === "real"
                ? "女娲蒸馏中（6 个研究 Agent 并行）"
                : "女娲-虚构 蒸馏中（5 个作品分析 Agent 并行）"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 font-mono text-xs max-h-[400px] overflow-auto">
              {progress.length === 0 && (
                <div className="text-faint flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  正在召唤研究子 Agent...
                </div>
              )}
              {progress.map((line, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 animate-fade-in text-subtle"
                >
                  <span className="text-faint tabular-nums shrink-0 w-6 text-right">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>{line}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 text-primary">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="shimmer h-2 flex-1 rounded" />
              </div>
            </div>
            <p className="mt-6 text-2xs text-faint leading-relaxed">
              推理模型生成完整 SKILL.md 通常需要 30–90
              秒。生成期间不要刷新页面。
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (stage === "review" && generated) {
    return (
      <SkillReviewer
        id={generated.id}
        initialSkill={generated.skill}
        meta={generated.meta}
        onSave={async (skill) => {
          await fetch("/api/characters/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ meta: generated.meta, skill }),
          });
          router.push("/characters");
          router.refresh();
        }}
        onDiscard={() => {
          setStage("form");
          setGenerated(null);
        }}
      />
    );
  }

  return (
    <div className="flex-1 overflow-auto px-8 py-6">
      <div className="max-w-3xl mx-auto">
        <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
          <div className="flex items-center justify-between mb-5">
            <TabsList>
              <TabsTrigger value="real">
                <User className="h-3.5 w-3.5 mr-1.5 opacity-70" />
                真实人物
              </TabsTrigger>
              <TabsTrigger value="fictional">
                <Drama className="h-3.5 w-3.5 mr-1.5 opacity-70" />
                虚构角色
              </TabsTrigger>
              <TabsTrigger value="batch">
                <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5 opacity-70" />
                批量导入
              </TabsTrigger>
            </TabsList>
            <Badge variant="ghost">
              <span className="font-mono">
                {mode === "batch"
                  ? "nuwa-skill · 批量"
                  : mode === "real"
                  ? "nuwa-skill"
                  : "女娲-虚构"}
              </span>
            </Badge>
          </div>

          {error && (
            <div className="mb-5 flex items-start gap-3 rounded border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
              <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-destructive">生成失败</p>
                <p className="text-xs text-subtle mt-1">{error}</p>
              </div>
            </div>
          )}

          <TabsContent value="real">
            <Card>
              <CardContent className="pt-5 space-y-5">
                <CommonFields
                  id={id}
                  setId={setId}
                  name={name}
                  setName={setName}
                  tags={tags}
                  setTags={setTags}
                />
                <div>
                  <Label required>所处时代</Label>
                  <Input
                    value={era}
                    onChange={(e) => setEra(e.target.value)}
                    placeholder="1955-2011"
                  />
                  <p className="text-2xs text-faint mt-1.5">
                    形如 <code className="font-mono">1955-2011</code>，
                    用于辅助 Agent 锁定研究材料的时代上下文。
                  </p>
                </div>
                <div className="rounded-md bg-accent/10 border border-accent/30 p-3 text-xs text-subtle leading-relaxed">
                  <strong className="text-accent">真实人物流程</strong>：女娲会启动 6
                  个研究子 Agent（books / podcasts / interviews / criticism /
                  decisions / timelines），三重交叉验证后产出 SKILL.md。
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="fictional">
            <div className="space-y-4">
              <Card>
                <CardContent className="pt-5 space-y-5">
                  <CommonFields
                    id={id}
                    setId={setId}
                    name={name}
                    setName={setName}
                    tags={tags}
                    setTags={setTags}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label required>原作品</Label>
                      <Input
                        value={sourceWork}
                        onChange={(e) => setSourceWork(e.target.value)}
                        placeholder="《哈姆雷特》(莎士比亚, 1600)"
                      />
                    </div>
                    <div>
                      <Label>所属年代</Label>
                      <Input
                        value={era}
                        onChange={(e) => setEra(e.target.value)}
                        placeholder="文艺复兴晚期"
                      />
                    </div>
                  </div>
                  <div>
                    <Label required>核心矛盾（一句话）</Label>
                    <Input
                      value={coreConflict}
                      onChange={(e) => setCoreConflict(e.target.value)}
                      placeholder="父亲被叔叔毒杀，被迫在复仇与道德之间挣扎"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Quote className="h-3.5 w-3.5" />
                      原文台词样本
                    </CardTitle>
                    <Badge
                      variant={voiceCount >= 10 ? "success" : "warning"}
                    >
                      {voiceCount} / 10 (硬约束)
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {voiceSamples.map((s, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="label-mono w-6 text-right pt-2.5">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <Textarea
                        value={s}
                        rows={1}
                        onChange={(e) => {
                          const next = [...voiceSamples];
                          next[i] = e.target.value;
                          setVoiceSamples(next);
                        }}
                        placeholder="To be, or not to be, that is the question..."
                        className="flex-1 min-h-9 resize-none"
                      />
                      {voiceSamples.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            setVoiceSamples(
                              voiceSamples.filter((_, j) => j !== i),
                            );
                          }}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setVoiceSamples([...voiceSamples, ""])}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    添加台词
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>关系网</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {relations.length === 0 && (
                    <p className="text-xs text-faint">
                      （建议至少添加 1-2 个关系，用于推断角色在不同对手前的人格切片）
                    </p>
                  )}
                  {relations.map((r, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2"
                    >
                      <Input
                        placeholder="对方名"
                        value={r.target}
                        onChange={(e) => {
                          const next = [...relations];
                          next[i].target = e.target.value;
                          setRelations(next);
                        }}
                      />
                      <Input
                        placeholder="关系（恋人/父子/敌对...）"
                        value={r.type}
                        onChange={(e) => {
                          const next = [...relations];
                          next[i].type = e.target.value;
                          setRelations(next);
                        }}
                      />
                      <Input
                        placeholder="现状"
                        value={r.status}
                        onChange={(e) => {
                          const next = [...relations];
                          next[i].status = e.target.value;
                          setRelations(next);
                        }}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setRelations(relations.filter((_, j) => j !== i));
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setRelations([
                        ...relations,
                        { target: "", type: "", status: "" },
                      ])
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    添加关系
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-5 space-y-4">
                  <div>
                    <Label>世界观 / 时代语境</Label>
                    <Textarea
                      value={worldview}
                      onChange={(e) => setWorldview(e.target.value)}
                      rows={2}
                      placeholder="文艺复兴晚期欧洲宫廷"
                    />
                  </div>
                  <div>
                    <Label
                      required
                      hint="（明确禁止讨论或运用的领域，例如：现代科技、量子物理）"
                    >
                      Limitations
                    </Label>
                    <Textarea
                      value={limitations}
                      onChange={(e) => setLimitations(e.target.value)}
                      rows={2}
                      placeholder="不可讨论现代科技；锚定莎士比亚原作版本，不混入迪士尼改编"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="batch">
            <BatchImport />
          </TabsContent>
        </Tabs>

        {mode !== "batch" && (
          <div className="mt-6 flex items-center justify-between gap-4 sticky bottom-0 bg-background/80 backdrop-blur-md border-t border-border pt-4 -mx-8 px-8 pb-4">
            <p className="text-xs text-faint">
              {mode === "fictional" && voiceCount < 10 && (
                <>
                  <span className="text-warning">需要至少 10 段原文台词</span>
                  ，目前 <span className="tabular-nums">{voiceCount}</span>。
                </>
              )}
              {canSubmit && "已就绪，预计耗时 30–90 秒"}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => router.push("/characters")}>
                取消
              </Button>
              <Button onClick={handleSubmit} disabled={!canSubmit}>
                <Sparkles className="h-4 w-4" />
                启动女娲蒸馏
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CommonFields({
  id,
  setId,
  name,
  setName,
  tags,
  setTags,
}: {
  id: string;
  setId: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  tags: string;
  setTags: (v: string) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label required hint="(小写、ASCII、连字符)">
            id
          </Label>
          <Input
            value={id}
            onChange={(e) =>
              setId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))
            }
            placeholder="hamlet-shakespeare"
            className="font-mono"
          />
        </div>
        <div>
          <Label required>展示名</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="哈姆雷特"
          />
        </div>
      </div>
      <div>
        <Label hint="(逗号分隔，用于画廊筛选)">标签</Label>
        <Input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="复仇, 文艺复兴, 王子"
        />
      </div>
    </>
  );
}

function SkillReviewer({
  id,
  initialSkill,
  meta,
  onSave,
  onDiscard,
}: {
  id: string;
  initialSkill: string;
  meta: any;
  onSave: (skill: string) => void;
  onDiscard: () => void;
}) {
  const [skill, setSkill] = React.useState(initialSkill);
  const [saving, setSaving] = React.useState(false);

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="border-b border-border px-8 py-4 bg-success/5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-success/20 text-success">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">
              蒸馏完成 — 审阅 SKILL.md
            </h3>
            <p className="text-xs text-subtle mt-0.5">
              左侧渲染 / 右侧编辑。满意后保存到{" "}
              <code className="font-mono text-accent">
                characters/{meta.type}/{id}/SKILL.md
              </code>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onDiscard}>
            放弃，重新填表
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onSave(skill);
            }}
          >
            <CheckCircle2 className="h-4 w-4" />
            保存到角色库
          </Button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-2 overflow-hidden">
        <div className="overflow-auto px-8 py-6 border-r border-border bg-surface/20">
          <p className="label-mono mb-3">preview</p>
          <article className="prose-skill">
            <SkillRender content={skill} />
          </article>
        </div>
        <div className="flex flex-col overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center justify-between">
            <p className="label-mono">editor</p>
            <span className="text-2xs text-faint tabular-nums">
              {skill.length} chars
            </span>
          </div>
          <textarea
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            className={cn(
              "flex-1 w-full p-5 bg-background font-mono text-xs leading-relaxed",
              "resize-none border-0 focus:outline-none focus:ring-0",
            )}
          />
        </div>
      </div>
    </div>
  );
}

function SkillRender({ content }: { content: string }) {
  // Lightweight markdown rendering: just headings, paragraphs, lists, code
  const lines = content.split("\n");
  const out: React.ReactNode[] = [];
  let listBuffer: string[] = [];
  let codeBuffer: string[] | null = null;

  const flushList = () => {
    if (listBuffer.length) {
      out.push(
        <ul key={out.length} className="my-2 ml-4 space-y-1">
          {listBuffer.map((l, i) => (
            <li key={i} className="text-sm text-subtle list-disc">
              {l.replace(/^[-*]\s+/, "")}
            </li>
          ))}
        </ul>,
      );
      listBuffer = [];
    }
  };

  for (const line of lines) {
    if (codeBuffer !== null) {
      if (line.startsWith("```")) {
        out.push(
          <pre
            key={out.length}
            className="my-3 rounded bg-muted/60 border border-border p-3 overflow-x-auto font-mono text-2xs leading-relaxed"
          >
            {codeBuffer.join("\n")}
          </pre>,
        );
        codeBuffer = null;
      } else {
        codeBuffer.push(line);
      }
      continue;
    }
    if (line.startsWith("```")) {
      flushList();
      codeBuffer = [];
      continue;
    }
    if (line.match(/^---/)) {
      flushList();
      out.push(<hr key={out.length} className="hr-etched my-4" />);
      continue;
    }
    if (line.startsWith("# ")) {
      flushList();
      out.push(
        <h1
          key={out.length}
          className="mt-4 mb-3 text-lg font-semibold text-foreground"
        >
          {line.slice(2)}
        </h1>,
      );
      continue;
    }
    if (line.startsWith("## ")) {
      flushList();
      out.push(
        <h2
          key={out.length}
          className="mt-4 mb-2 text-sm font-semibold text-foreground flex items-center gap-2"
        >
          <span className="h-3 w-0.5 bg-primary rounded-full" />
          {line.slice(3)}
        </h2>,
      );
      continue;
    }
    if (line.startsWith("### ")) {
      flushList();
      out.push(
        <h3
          key={out.length}
          className="mt-3 mb-1.5 text-xs font-semibold text-subtle"
        >
          {line.slice(4)}
        </h3>,
      );
      continue;
    }
    if (line.match(/^[-*]\s/)) {
      listBuffer.push(line);
      continue;
    }
    flushList();
    if (line.trim()) {
      out.push(
        <p
          key={out.length}
          className="my-1.5 text-sm leading-relaxed text-subtle"
        >
          {line}
        </p>,
      );
    }
  }
  flushList();
  return <>{out}</>;
}
