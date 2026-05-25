"use client";
import * as React from "react";
import {
  Download,
  Film,
  Clock,
  Users,
  Layers,
  ChevronDown,
  ChevronRight,
  Camera,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDuration, cn } from "@/lib/utils";

interface VideoSegment {
  time_range: string;
  desc: string;
  kling_prompt?: string;
  seedance_prompt?: string;
  image_refs?: string[];
  beat_emotion?: string;
  dialogue?: Array<{ speaker: string; text: string }>;
}

interface Shot {
  sequence_id: string;
  shot_type: string;
  characters: string[];
  action: string | null;
  dialogue: Array<{ speaker: string; text: string }>;
  beat: string;
  camera_hint: string;
  duration_est: number;
  video_segments?: VideoSegment[];
  _warnings?: string[];
}

interface Character {
  id: string;
  name?: string;
}

const BEAT_VARIANT: Record<
  string,
  "primary" | "accent" | "warning" | "success" | "destructive" | "secondary"
> = {
  施压: "destructive",
  退让: "secondary",
  转折: "accent",
  揭示: "warning",
  沉默: "ghost" as any,
  爆发: "destructive",
  落定: "success",
};

export function StoryboardTable({
  sessionId,
  shots,
  characters,
}: {
  sessionId: string;
  shots: Shot[];
  characters: Character[];
}) {
  const [openId, setOpenId] = React.useState<string | null>(null);

  const totalDuration = shots.reduce((a, s) => a + (s.duration_est || 0), 0);
  const charCount = new Set(shots.flatMap((s) => s.characters || [])).size;

  function exportFormat(format: "md" | "json" | "fdx") {
    window.location.href = `/api/storyboard/${sessionId}/export?format=${format}`;
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* Stats header */}
      <div className="px-8 py-5 border-b border-border bg-surface/30 grid grid-cols-4 gap-4">
        <StatCard
          icon={<Film className="h-4 w-4" />}
          label="总镜头数"
          value={shots.length}
          unit="SH"
        />
        <StatCard
          icon={<Clock className="h-4 w-4" />}
          label="总时长"
          value={formatDuration(totalDuration)}
          unit="估算"
        />
        <StatCard
          icon={<Users className="h-4 w-4" />}
          label="出场角色"
          value={charCount}
          unit="个"
        />
        <StatCard
          icon={<Layers className="h-4 w-4" />}
          label="节拍类型"
          value={new Set(shots.map((s) => s.beat)).size}
          unit="种"
        />
      </div>

      {/* Action bar */}
      <div className="px-8 py-3 border-b border-border flex items-center justify-between bg-background/60">
        <code className="font-mono text-2xs text-accent">{sessionId}</code>
        <div className="flex items-center gap-1.5">
          <span className="text-2xs text-faint mr-2">导出：</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportFormat("md")}
          >
            <Download className="h-3 w-3" />
            .md
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportFormat("json")}
          >
            <Download className="h-3 w-3" />
            .json
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportFormat("fdx")}
          >
            <Download className="h-3 w-3" />
            .fdx
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-surface/95 backdrop-blur-md border-b border-border">
            <tr className="text-left">
              <th className="px-3 py-2.5 label-mono w-32">sequence id</th>
              <th className="px-3 py-2.5 label-mono w-24">景别</th>
              <th className="px-3 py-2.5 label-mono w-20">机位</th>
              <th className="px-3 py-2.5 label-mono w-20">节拍</th>
              <th className="px-3 py-2.5 label-mono w-16 text-right">时长</th>
              <th className="px-3 py-2.5 label-mono">动作 / 对白</th>
              <th className="px-3 py-2.5 label-mono w-32">出场角色</th>
              <th className="px-3 py-2.5 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {shots.map((shot, i) => {
              const isOpen = openId === shot.sequence_id;
              return (
                <React.Fragment key={shot.sequence_id}>
                  <tr
                    onClick={() =>
                      setOpenId(isOpen ? null : shot.sequence_id)
                    }
                    className={cn(
                      "border-b border-border/60 hover:bg-elevated/60 cursor-pointer transition-colors",
                      isOpen && "bg-elevated",
                    )}
                  >
                    <td className="px-3 py-3 font-mono text-2xs text-accent tabular-nums">
                      {shot.sequence_id}
                    </td>
                    <td className="px-3 py-3 text-foreground">
                      {shot.shot_type}
                    </td>
                    <td className="px-3 py-3 text-subtle">
                      <span className="inline-flex items-center gap-1">
                        <Camera className="h-3 w-3 opacity-50" />
                        {shot.camera_hint}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant={BEAT_VARIANT[shot.beat] || "default"}>
                        {shot.beat}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-subtle">
                      {shot.duration_est}s
                    </td>
                    <td className="px-3 py-3 min-w-0">
                      <div className="line-clamp-1">
                        {shot.action && (
                          <span className="text-accent italic mr-2">
                            （{shot.action}）
                          </span>
                        )}
                        {shot.dialogue?.[0] && (
                          <span className="text-foreground">
                            <span className="text-faint mr-1">
                              {speakerName(shot.dialogue[0].speaker, characters)}:
                            </span>
                            {shot.dialogue[0].text}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex -space-x-1">
                        {(shot.characters || []).map((cid) => (
                          <CharAvatar
                            key={cid}
                            character={characters.find((c) => c.id === cid)}
                            id={cid}
                          />
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-faint">
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-muted/30">
                      <td colSpan={8} className="px-3 py-4 animate-fade-in">
                        <ShotDetail shot={shot} characters={characters} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>

        {shots.length === 0 && (
          <div className="p-16 text-center text-faint">无分镜数据</div>
        )}
      </div>
    </div>
  );
}

const NEGATIVE_SUFFIX =
  "【负面】模糊，低画质，畸形，多余手指，水印，文字叠加，恐怖谷效应，过度饱和，动作抽搐，面部变形";

/**
 * Merge a shot's video_segments into one platform-specific prompt string the
 * user can copy verbatim into 可灵 / 即梦 (both support 音画同出).
 *
 * - Each △ is anchored by its time_range
 * - Each △ carries any dialogue that should be voiced during that window —
 *   pulled from seg.dialogue (new-format renders) OR falling back to the
 *   parent shot's dialogue dumped onto the FIRST △ (old-format renders that
 *   don't have per-segment dialogue yet)
 * - The trailing 【负面】 from each individual segment is stripped and
 *   re-appended once at the end (otherwise the merged blob repeats the
 *   negative block N times)
 */
function mergeSegmentPrompts(
  segments: VideoSegment[],
  platform: "kling" | "seedance",
  shotDialogue: Array<{ speaker: string; text: string }> = [],
  characters: Character[] = [],
): string {
  // If no segment carries per-△ dialogue but the shot has dialogue, dump the
  // whole shot dialogue onto segment 0 as a best-effort fallback for old data.
  const anySegHasDialogue = segments.some(
    (s) => Array.isArray(s.dialogue) && s.dialogue.length > 0,
  );

  const parts = segments
    .map((seg, idx) => {
      const raw =
        (platform === "kling" ? seg.kling_prompt : seg.seedance_prompt) ||
        seg.desc ||
        "";
      const visual = raw
        .replace(/【负面】[\s\S]*$/, "")
        .replace(/【\s*$/, "")
        .trim();
      if (!visual) return "";

      // Resolve dialogue for this △
      let lines: Array<{ speaker: string; text: string }> = [];
      if (Array.isArray(seg.dialogue) && seg.dialogue.length > 0) {
        lines = seg.dialogue;
      } else if (!anySegHasDialogue && idx === 0 && shotDialogue.length > 0) {
        lines = shotDialogue;
      }

      const dialogueChunk =
        lines.length > 0
          ? "  台词：" +
            lines
              .map(
                (d) => `${speakerName(d.speaker, characters)}「${d.text}」`,
              )
              .join(" ")
          : "";

      return `△ ${seg.time_range} ${visual}${dialogueChunk}`;
    })
    .filter(Boolean);
  if (parts.length === 0) return "";
  return parts.join("  ") + "  " + NEGATIVE_SUFFIX;
}

function speakerName(
  speaker: string,
  characters: Character[],
): string {
  if (!speaker) return "";
  if (speaker === "NARRATOR") return "旁白";
  const c = characters.find((x) => x.id === speaker);
  return c?.name || speaker;
}

function StatCard({
  icon,
  label,
  value,
  unit,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  unit: string;
}) {
  return (
    <Card className="px-4 py-3">
      <div className="flex items-center justify-between mb-1">
        <span className="label-mono">{label}</span>
        <span className="text-faint">{icon}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        <span className="text-2xs text-faint">{unit}</span>
      </div>
    </Card>
  );
}

function CharAvatar({
  character,
  id,
}: {
  character?: Character;
  id: string;
}) {
  const hash = Array.from(id).reduce((a, c) => a + c.charCodeAt(0), 0);
  const hue1 = hash % 360;
  const hue2 = (hash * 13) % 360;
  return (
    <div
      title={character?.name || id}
      className="h-5 w-5 rounded ring-2 ring-background flex items-center justify-center text-white text-2xs font-semibold overflow-hidden"
      style={{
        background: `linear-gradient(135deg, hsl(${hue1} 70% 45%), hsl(${hue2} 65% 35%))`,
      }}
    >
      {(character?.name || id).slice(0, 1)}
    </div>
  );
}

function ShotDetail({
  shot,
  characters,
}: {
  shot: Shot;
  characters: Character[];
}) {
  return (
    <div className="grid grid-cols-3 gap-6">
      <div className="col-span-2 space-y-4">
        {shot.action && (
          <div>
            <p className="label-mono mb-1">action</p>
            <p className="text-sm text-accent italic leading-relaxed">
              （{shot.action}）
            </p>
          </div>
        )}
        {shot.dialogue && shot.dialogue.length > 0 && (
          <div>
            <p className="label-mono mb-1">dialogue</p>
            <div className="space-y-2">
              {shot.dialogue.map((d, i) => {
                return (
                  <div key={i} className="flex gap-3">
                    <span className="text-xs font-semibold text-foreground min-w-[80px]">
                      {speakerName(d.speaker, characters)}
                    </span>
                    <p className="text-sm leading-relaxed text-subtle flex-1">
                      「{d.text}」
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {shot.video_segments && shot.video_segments.length > 0 && (
          <div>
            <p className="label-mono mb-2 flex items-center gap-1.5">
              视频分段提示词
              <span className="text-2xs text-faint normal-case tracking-normal font-normal">
                · {shot.video_segments.length} 段 △ · 合计{" "}
                {shot.duration_est}s · 复制整段直接喂可灵 / 即梦
              </span>
            </p>

            <CopyablePromptBlock
              label="即梦 Seedance 2.0"
              labelColor="text-accent"
              borderColor="border-accent/30"
              text={mergeSegmentPrompts(
                shot.video_segments,
                "seedance",
                shot.dialogue,
                characters,
              )}
            />
            <CopyablePromptBlock
              label="可灵 3.0"
              labelColor="text-primary"
              borderColor="border-primary/30"
              text={mergeSegmentPrompts(
                shot.video_segments,
                "kling",
                shot.dialogue,
                characters,
              )}
            />
          </div>
        )}

        {shot._warnings && shot._warnings.length > 0 && (
          <div className="rounded border border-warning/30 bg-warning/5 px-3 py-2">
            <p className="label-mono mb-1 text-warning">warnings</p>
            <ul className="ml-4 list-disc text-2xs text-warning leading-relaxed">
              {shot._warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="space-y-3 border-l border-border pl-6">
        <div>
          <p className="label-mono mb-1">出场角色</p>
          <div className="flex flex-wrap gap-1.5">
            {(shot.characters || []).map((cid) => {
              const char = characters.find((c) => c.id === cid);
              return (
                <Badge key={cid} variant="primary">
                  {char?.name || cid}
                </Badge>
              );
            })}
          </div>
        </div>
        <div>
          <p className="label-mono mb-1">资产引用</p>
          <p className="text-2xs text-faint leading-relaxed">
            （在{" "}
            <a
              href={`/assets/${shot.sequence_id.split("_").slice(0, 2).join("_")}`}
              className="text-primary hover:underline"
            >
              资产页
            </a>{" "}
            为每个角色 / 道具 / 场景生成图像后，此处显示缩略图）
          </p>
        </div>
        <div>
          <p className="label-mono mb-1">原始数据</p>
          <pre className="text-2xs font-mono text-faint bg-background/60 rounded p-2 overflow-x-auto">
            {JSON.stringify(shot, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

function CopyablePromptBlock({
  label,
  labelColor,
  borderColor,
  text,
}: {
  label: string;
  labelColor: string;
  borderColor: string;
  text: string;
}) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available — silent fail */
    }
  }

  return (
    <div
      className={cn(
        "group relative mt-2 rounded border bg-muted/40 px-3 py-2.5",
        borderColor,
      )}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className={cn("text-2xs font-mono font-semibold", labelColor)}>
          [{label}]
        </span>
        <button
          onClick={copy}
          className="opacity-0 group-hover:opacity-100 transition-opacity h-6 px-2 rounded text-2xs flex items-center gap-1 bg-background/60 border border-border hover:bg-elevated cursor-pointer"
          title="复制完整 prompt"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-success" />
              <span className="text-success">已复制</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>复制</span>
            </>
          )}
        </button>
      </div>
      <p className="font-mono text-2xs leading-relaxed text-foreground whitespace-pre-wrap break-words select-all">
        {text}
      </p>
    </div>
  );
}

