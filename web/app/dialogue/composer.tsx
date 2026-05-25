"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  Play,
  RotateCcw,
  CheckCircle2,
  Clock,
  Target,
  MapPin,
  Sparkles,
  X,
  AlertCircle,
  Loader2,
  Search,
  User as UserIcon,
  Drama,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { CharacterMeta } from "@/lib/repo";
import { cn } from "@/lib/utils";

interface Turn {
  speaker: string;
  text: string;
  action?: string | null;
  /** Optional self-quote citation. `quote` is an exact substring of `text`
   *  that the UI bolds; `source` is the book name, rendered inline as
   *  【出自《xxx》】 right after the bolded quote. Older transcripts may have
   *  citation without `quote` — UI then falls back to a small footer tag. */
  citation?: { quote?: string; source: string } | null;
}
interface Round {
  round: number;
  turns: Turn[];
}
interface DialogueStage {
  title: string;
  description: string;
}

// Each turn now caps at ~80 Chinese chars (≈5-7s of spoken video). Rounds
// per preset are tuned to land near the nominal duration when both
// characters fill the cap: e.g. 60s ≈ 5 rounds × 2 chars × 6s ≈ 60s.
const DURATION_PRESETS = [
  { label: "30s", value: 30, rounds: 3 },
  { label: "60s", value: 60, rounds: 5 },
  { label: "90s", value: 90, rounds: 7 },
  { label: "120s", value: 120, rounds: 10 },
];

type Stage = "setup" | "running" | "review";

export function DialogueComposer({
  characters,
}: {
  characters: CharacterMeta[];
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<string[]>([]);
  const [setting, setSetting] = React.useState("");
  const [conflict, setConflict] = React.useState("");
  const [goal, setGoal] = React.useState("");
  const [opener, setOpener] = React.useState("");
  const [stages, setStages] = React.useState<DialogueStage[]>([]);
  const [narratorOutro, setNarratorOutro] = React.useState(true);
  // Stored as nullable so the custom-duration input can be fully empty while
  // the user is editing (Number("") would silently snap to 0). The Start
  // button is disabled until a positive number is committed.
  const [duration, setDuration] = React.useState<number | null>(60);
  const [stage, setStage] = React.useState<Stage>("setup");
  const [rounds, setRounds] = React.useState<Round[]>([]);
  const [currentRound, setCurrentRound] = React.useState(0);
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [charFilter, setCharFilter] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<"all" | "real" | "fictional">(
    "all",
  );
  const [suggestingScene, setSuggestingScene] = React.useState(false);
  const [suggestError, setSuggestError] = React.useState<string | null>(null);

  const computedRounds =
    duration == null
      ? 0
      : DURATION_PRESETS.find((p) => p.value === duration)?.rounds ??
        Math.max(2, Math.round(duration / 12));

  const canStart =
    selected.length >= 2 &&
    setting.trim() !== "" &&
    conflict.trim() !== "" &&
    goal.trim() !== "" &&
    typeof duration === "number" &&
    duration > 0;

  function toggleCharacter(id: string) {
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  }

  async function suggestScene() {
    if (selected.length < 2) return;
    setSuggestingScene(true);
    setSuggestError(null);
    try {
      const res = await fetch("/api/dialogue/suggest-scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characters: selected }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        setting: string;
        conflict: string;
        goal: string;
        opener?: string;
        stages?: DialogueStage[];
      };
      setSetting(data.setting);
      setConflict(data.conflict);
      setGoal(data.goal);
      if (data.opener) setOpener(data.opener);
      if (Array.isArray(data.stages) && data.stages.length > 0) {
        setStages(
          data.stages
            .filter((s) => s && s.title && s.description)
            .map((s) => ({
              title: s.title.trim(),
              description: s.description.trim(),
            })),
        );
      }
    } catch (e: any) {
      setSuggestError(e.message || "自动生成失败");
    } finally {
      setSuggestingScene(false);
    }
  }

  async function startDialogue(restart = false) {
    setError(null);
    setStage("running");
    if (!restart) setRounds([]);
    else setRounds([]);
    setCurrentRound(0);

    try {
      const res = await fetch("/api/dialogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characters: selected,
          scene: { setting, conflict, goal, opener: opener || undefined },
          rounds: computedRounds,
          narrator_outro: narratorOutro,
          stages: stages
            .filter((s) => s.title.trim() && s.description.trim())
            .map((s) => ({
              title: s.title.trim(),
              description: s.description.trim(),
            })),
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(await res.text());
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const accRounds: Round[] = [];

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
            if (ev.kind === "turn") {
              let round = accRounds.find((r) => r.round === ev.round);
              if (!round) {
                round = { round: ev.round, turns: [] };
                accRounds.push(round);
                setCurrentRound(ev.round);
              }
              round.turns.push(ev.turn);
              setRounds([...accRounds]);
            } else if (ev.kind === "done") {
              setSessionId(ev.sessionId);
              setStage("review");
            } else if (ev.kind === "error") {
              throw new Error(ev.message);
            }
          } catch (e) {
            /* skip non-JSON */
          }
        }
      }
    } catch (e: any) {
      setError(e.message || String(e));
      setStage("setup");
    }
  }

  if (characters.length < 2) {
    return (
      <div className="px-8 py-8">
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title="至少需要 2 个角色才能开始对话"
          description={
            <>
              回到{" "}
              <a
                href="/characters"
                className="text-primary hover:underline"
              >
                角色资产库
              </a>{" "}
              先生成几个 SKILL.md。
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden flex">
      {/* Left: Setup pane */}
      <div
        className={cn(
          "shrink-0 border-r border-border overflow-auto bg-surface/30 transition-all",
          stage === "setup" ? "w-full max-w-2xl" : "w-[360px]",
        )}
      >
        <div className="p-6 space-y-5">
          {/* Character picker */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <Label className="mb-0 text-sm">
                <Users className="h-3.5 w-3.5 inline mr-1.5 opacity-70" />
                选定角色
                <span className="text-2xs text-faint ml-2 font-normal">
                  · 按生成时间倒序
                </span>
              </Label>
              <Badge
                variant={selected.length >= 2 ? "success" : "warning"}
              >
                {selected.length} / 至少 2
              </Badge>
            </div>

            {/* Search + type filter */}
            <div className="flex items-center gap-2 mb-3">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-faint" />
                <Input
                  value={charFilter}
                  onChange={(e) => setCharFilter(e.target.value)}
                  placeholder="按 id / 姓名 / 标签 / 时代 过滤"
                  className="pl-8 h-8 text-xs"
                />
                {charFilter && (
                  <button
                    onClick={() => setCharFilter("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="inline-flex items-center gap-0.5 rounded border border-border bg-surface p-0.5">
                {(
                  [
                    { key: "all" as const, label: "全部", icon: null },
                    { key: "real" as const, label: "真人", icon: UserIcon },
                    {
                      key: "fictional" as const,
                      label: "虚构",
                      icon: Drama,
                    },
                  ]
                ).map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    onClick={() => setTypeFilter(key)}
                    className={cn(
                      "px-2 h-7 rounded text-2xs transition-colors flex items-center gap-1 cursor-pointer",
                      typeFilter === key
                        ? "bg-elevated text-foreground shadow-[0_1px_0_rgb(255_255_255/0.04)_inset]"
                        : "text-subtle hover:text-foreground",
                    )}
                  >
                    {Icon && <Icon className="h-3 w-3 opacity-70" />}
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {(() => {
              const q = charFilter.trim().toLowerCase();
              const filteredChars = characters.filter((c) => {
                if (typeFilter !== "all" && c.type !== typeFilter) return false;
                if (!q) return true;
                if (c.id.toLowerCase().includes(q)) return true;
                if (c.name.toLowerCase().includes(q)) return true;
                if ((c.era || "").toLowerCase().includes(q)) return true;
                if ((c.tags || []).some((t) => t.toLowerCase().includes(q)))
                  return true;
                return false;
              });
              const selectedHidden = selected.filter(
                (id) => !filteredChars.some((c) => c.id === id),
              );

              return (
                <>
                  {(q || typeFilter !== "all") && (
                    <p className="text-2xs text-faint mb-2 flex items-center gap-1.5">
                      <span className="tabular-nums">{filteredChars.length}</span>
                      <span>/</span>
                      <span className="tabular-nums">{characters.length}</span>
                      <span>匹配</span>
                      {selectedHidden.length > 0 && (
                        <span className="text-warning ml-1">
                          · 已选 {selectedHidden.length} 个被隐藏
                        </span>
                      )}
                    </p>
                  )}
                  {filteredChars.length === 0 ? (
                    <div className="rounded border border-dashed border-border bg-muted/20 py-6 text-center text-xs text-faint">
                      没有匹配的角色
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 max-h-[360px] overflow-auto pr-1 -mr-1">
                      {filteredChars.map((c) => {
                        const checked = selected.includes(c.id);
                        return (
                          <button
                            key={c.id}
                            onClick={() => toggleCharacter(c.id)}
                            disabled={stage !== "setup"}
                            className={cn(
                              "flex items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed",
                              checked
                                ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                                : "border-border bg-muted/40 hover:bg-elevated hover:border-border",
                            )}
                          >
                            <Portrait character={c} size="sm" />
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium truncate">
                                {c.name}
                              </div>
                              <div className="text-2xs text-faint truncate font-mono">
                                {c.id}
                                {c.era && (
                                  <span className="ml-1.5 opacity-70">
                                    · {c.era}
                                  </span>
                                )}
                              </div>
                            </div>
                            {checked && (
                              <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </section>

          {/* Scene */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Label className="text-sm mb-0">
                <Target className="h-3.5 w-3.5 inline mr-1.5 opacity-70" />
                场景与主题
              </Label>
              <Button
                variant="outline"
                size="sm"
                onClick={suggestScene}
                disabled={
                  selected.length < 2 ||
                  suggestingScene ||
                  stage !== "setup"
                }
                title={
                  selected.length < 2
                    ? "先选 2 个或更多角色"
                    : "从所选角色的 SKILL.md 提炼最大冲突，自动填写设定/冲突/目标/开场"
                }
              >
                {suggestingScene ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                {suggestingScene ? "提炼中..." : "自动生成"}
              </Button>
            </div>
            {suggestError && (
              <div className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-2xs">
                <AlertCircle className="h-3 w-3 text-destructive mt-0.5 shrink-0" />
                <span className="text-destructive">{suggestError}</span>
              </div>
            )}
            <div>
              <Label className="text-2xs" required>
                <MapPin className="h-3 w-3 inline mr-1 opacity-60" />
                设定 (setting)
              </Label>
              <Textarea
                value={setting}
                onChange={(e) => setSetting(e.target.value)}
                placeholder="加州咖啡馆，黄昏，落地窗外是橘色天空"
                rows={2}
                disabled={stage !== "setup"}
              />
            </div>
            <div>
              <Label className="text-2xs" required>
                核心冲突 (conflict)
              </Label>
              <Input
                value={conflict}
                onChange={(e) => setConflict(e.target.value)}
                placeholder="火星殖民必须优先 vs 把 iPhone 17 做到极致才有意义"
                disabled={stage !== "setup"}
              />
            </div>
            <div>
              <Label className="text-2xs" required>
                戏剧目标 (goal)
              </Label>
              <Input
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="一方承认对方主张的合理性，或两人接受不和而散"
                disabled={stage !== "setup"}
              />
            </div>
            <div>
              <Label className="text-2xs">开场触发动作 (opener，可选)</Label>
              <Input
                value={opener}
                onChange={(e) => setOpener(e.target.value)}
                placeholder="马斯克刚把一卷火星建造图甩在桌上"
                disabled={stage !== "setup"}
              />
            </div>
            <label className="flex items-start gap-2.5 rounded-md border border-border bg-muted/30 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="checkbox"
                checked={narratorOutro}
                onChange={(e) => setNarratorOutro(e.target.checked)}
                disabled={stage !== "setup"}
                className="mt-0.5 h-3.5 w-3.5 accent-primary cursor-pointer disabled:cursor-not-allowed"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium">旁白收尾</div>
                <div className="text-2xs text-faint mt-0.5 leading-relaxed">
                  对话生成完成后，自动追加一段全剧收束旁白（80 字以内）。
                </div>
              </div>
            </label>
          </section>

          {/* Stages — optional dramatic arc. If present, each round is mapped
              to a stage proportionally and that stage's title + description
              is injected into the LLM context for the speaking characters. */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm mb-0">
                <Drama className="h-3.5 w-3.5 inline mr-1.5 opacity-70" />
                对话阶段
                <span className="text-2xs text-faint ml-2 font-normal">
                  · 戏剧节拍 · 可选
                </span>
              </Label>
              <span className="text-2xs text-faint tabular-nums">
                {stages.length} 阶段
              </span>
            </div>
            {stages.length === 0 ? (
              <p className="text-2xs text-faint leading-relaxed mb-2">
                按场景的戏剧弧分阶段（如：痛苦根源 → 自我救赎 → 心魔对抗 → 生命终局）。
                每个阶段一个标题 + 一行立场对峙。点&ldquo;自动生成&rdquo;一并生成；
                也可手动添加。
              </p>
            ) : null}
            <div className="space-y-2">
              {stages.map((s, i) => (
                <div
                  key={i}
                  className="rounded-md border border-border bg-muted/30 p-2.5"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="label-mono text-accent text-2xs tabular-nums shrink-0">
                      阶段{i + 1}
                    </span>
                    <Input
                      value={s.title}
                      onChange={(e) => {
                        const v = e.target.value;
                        setStages((arr) =>
                          arr.map((x, j) => (j === i ? { ...x, title: v } : x)),
                        );
                      }}
                      placeholder="标题（如：痛苦根源）"
                      disabled={stage !== "setup"}
                      className="h-7 text-xs flex-1"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setStages((arr) => arr.filter((_, j) => j !== i))
                      }
                      disabled={stage !== "setup"}
                      className="h-6 w-6 rounded flex items-center justify-center text-faint hover:text-destructive hover:bg-elevated disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shrink-0"
                      title="删除该阶段"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <Input
                    value={s.description}
                    onChange={(e) => {
                      const v = e.target.value;
                      setStages((arr) =>
                        arr.map((x, j) =>
                          j === i ? { ...x, description: v } : x,
                        ),
                      );
                    }}
                    placeholder="描述（如：「欲望钟摆」 VS 「心外无物」）"
                    disabled={stage !== "setup"}
                    className="h-7 text-xs"
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setStages((arr) => [...arr, { title: "", description: "" }])
                }
                disabled={stage !== "setup" || stages.length >= 6}
                className="w-full rounded-md border border-dashed border-border text-2xs text-subtle hover:bg-elevated hover:text-foreground py-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors"
              >
                + 添加阶段{stages.length >= 6 ? "（已达上限 6）" : ""}
              </button>
            </div>
            {stages.length > 0 && (
              <p className="text-2xs text-faint mt-2 leading-relaxed">
                · 对话按 <span className="tabular-nums">{computedRounds}</span>{" "}
                轮均匀映射到 <span className="tabular-nums">{stages.length}</span>{" "}
                个阶段。本轮处于哪个阶段会作为上下文写进角色的 prompt。
              </p>
            )}
          </section>

          {/* Duration */}
          <section>
            <Label className="text-sm">
              <Clock className="h-3.5 w-3.5 inline mr-1.5 opacity-70" />
              目标视频时长
            </Label>
            <div className="grid grid-cols-4 gap-2">
              {DURATION_PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setDuration(p.value)}
                  disabled={stage !== "setup"}
                  className={cn(
                    "rounded-md border py-3 text-center transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed",
                    duration === p.value
                      ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                      : "border-border bg-muted/40 hover:bg-elevated",
                  )}
                >
                  <div className="text-sm font-semibold tabular-nums">
                    {p.label}
                  </div>
                  <div className="text-2xs text-faint mt-0.5 tabular-nums">
                    {p.rounds} 轮
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Label className="text-2xs mb-0 shrink-0">自定义</Label>
              <Input
                type="number"
                value={duration ?? ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") {
                    setDuration(null);
                    return;
                  }
                  const n = Number(raw);
                  setDuration(Number.isFinite(n) && n > 0 ? n : null);
                }}
                disabled={stage !== "setup"}
                className="font-mono tabular-nums"
                min={10}
                max={600}
                placeholder="秒"
              />
              <span className="text-2xs text-faint">
                秒 → <span className="tabular-nums">{computedRounds}</span> 轮
              </span>
            </div>
          </section>

          {error && (
            <div className="flex items-start gap-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs">
              <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
              <p className="text-destructive">{error}</p>
            </div>
          )}

          {stage === "setup" && (
            <Button
              className="w-full"
              size="lg"
              disabled={!canStart}
              onClick={() => startDialogue(false)}
            >
              <Play className="h-4 w-4" />
              开始对话（约 {computedRounds * selected.length} 段对白 · {selected.length} 角色交替）
            </Button>
          )}
          {stage === "running" && (
            <div className="rounded-md bg-primary/10 border border-primary/30 px-3 py-2.5 flex items-center gap-2 text-xs">
              <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
              <span className="text-foreground">
                对话生成中 · {selected.length} 个角色交替发言
              </span>
            </div>
          )}
          {stage === "review" && sessionId && (
            <div className="space-y-2">
              <div className="rounded-md bg-success/10 border border-success/30 px-3 py-2.5 flex items-center gap-2 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                <span className="text-foreground">
                  对话已完成 ·{" "}
                  <code className="font-mono text-2xs text-accent">
                    {sessionId}
                  </code>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() => startDialogue(true)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  重新对话
                </Button>
                <Button
                  variant="accent"
                  onClick={() => router.push(`/screenplay/${sessionId}`)}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  确认 → 剧本
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right: Live transcript */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="px-6 py-3 border-b border-border bg-background/60 flex items-center justify-between sticky top-0">
          <div className="flex items-center gap-2 text-sm">
            <span className="label-mono">live transcript</span>
            {rounds.length > 0 && (
              <span className="text-2xs text-faint tabular-nums">
                {rounds.reduce((acc, r) => acc + r.turns.length, 0)} 段对白
              </span>
            )}
          </div>
          {stage === "running" && (
            <span className="flex items-center gap-1.5 text-2xs">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-primary">streaming</span>
            </span>
          )}
        </div>

        <div className="flex-1 overflow-auto px-6 py-6">
          {rounds.length === 0 && stage === "setup" && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center max-w-md">
                <div className="mx-auto h-12 w-12 rounded-full bg-elevated flex items-center justify-center text-faint mb-3">
                  <Sparkles className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium">还没开始对话</p>
                <p className="text-xs text-faint mt-1 leading-relaxed">
                  填好左侧参数，点&ldquo;开始对话&rdquo;。
                  <br />
                  角色按选定顺序交替发言，每段对白控制在 150 字以内。
                </p>
              </div>
            </div>
          )}
          {rounds.length === 0 && stage === "running" && (
            <div className="space-y-3 max-w-3xl mx-auto">
              {selected.map((_, i) => (
                <div key={i} className="flex gap-3">
                  <div className="h-8 w-8 rounded shimmer" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-32 shimmer rounded" />
                    <div className="h-3 w-full shimmer rounded" />
                    <div className="h-3 w-3/4 shimmer rounded" />
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="max-w-3xl mx-auto space-y-4">
            {rounds.flatMap((r) => r.turns).map((turn, i) => {
              if (turn.speaker === "__narrator") {
                return (
                  <div
                    key={i}
                    className="my-6 mx-auto max-w-2xl rounded-md border border-accent/30 bg-accent/5 px-5 py-4 animate-fade-in"
                  >
                    <div className="label-mono text-accent text-2xs mb-1.5 text-center">
                      旁白 · narrator
                    </div>
                    <p className="text-sm leading-relaxed text-foreground italic text-center">
                      {turn.text}
                    </p>
                  </div>
                );
              }
              const char = characters.find((c) => c.id === turn.speaker);
              return (
                <div key={i} className="flex gap-3 animate-fade-in group">
                  {char && <Portrait character={char} size="sm" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm font-semibold text-foreground">
                        {char?.name || turn.speaker}
                      </span>
                      <code className="text-2xs font-mono text-faint">
                        {turn.speaker}
                      </code>
                    </div>
                    {turn.action && (
                      <p className="text-xs text-accent italic mb-1.5 flex items-start gap-1.5">
                        <span className="select-none">（</span>
                        <span>{turn.action}</span>
                        <span className="select-none">）</span>
                      </p>
                    )}
                    <p className="text-sm leading-relaxed text-subtle">
                      <TurnText
                        text={turn.text}
                        citation={turn.citation || undefined}
                      />
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Render a turn's text with the cited passage bolded inline and the source
 * shown as 【出自《xxx》】 right after the bolded quote.
 *
 * Three render modes:
 *   1. citation has a quote + that quote appears in text → split text into
 *      [before, quote, after], bold the quote, inject source tag after.
 *   2. citation has only a source (legacy or fuzzy quote) → render text
 *      as-is + append "——《source》" italic tag at the end (old behavior).
 *   3. no citation → plain text.
 */
function TurnText({
  text,
  citation,
}: {
  text: string;
  citation?: { quote?: string; source: string };
}) {
  if (!citation || !citation.source) {
    return <>{text}</>;
  }
  const q = (citation.quote || "").trim();
  if (q && text.includes(q)) {
    const i = text.indexOf(q);
    const before = text.slice(0, i);
    const after = text.slice(i + q.length);
    return (
      <>
        {before}
        <strong className="font-semibold text-foreground">{q}</strong>
        <span className="mx-1 text-2xs text-faint align-baseline">
          【出自{citation.source}】
        </span>
        {after}
      </>
    );
  }
  // Fallback — no inline quote available, footer-style tag like before.
  return (
    <>
      {text}
      <span className="ml-2 text-2xs text-faint italic">
        ——{citation.source}
      </span>
    </>
  );
}

function Portrait({
  character,
  size = "md",
}: {
  character: CharacterMeta;
  size?: "sm" | "md";
}) {
  const hash = Array.from(character.id).reduce(
    (a, c) => a + c.charCodeAt(0),
    0,
  );
  const hue1 = hash % 360;
  const hue2 = (hash * 13) % 360;
  const initials = character.name.slice(0, 2);
  const [imgError, setImgError] = React.useState(false);
  const showImage = character.portrait && !imgError;

  return (
    <div
      className={cn(
        "relative shrink-0 flex items-center justify-center rounded text-white font-semibold overflow-hidden",
        size === "sm" ? "h-8 w-8 text-xs" : "h-12 w-12 text-sm",
      )}
      style={
        showImage
          ? undefined
          : {
              background: `linear-gradient(135deg, hsl(${hue1} 70% 45%), hsl(${hue2} 65% 35%))`,
            }
      }
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={character.portrait!}
          alt={character.name}
          onError={() => setImgError(true)}
          className="absolute inset-0 w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        initials
      )}
    </div>
  );
}
