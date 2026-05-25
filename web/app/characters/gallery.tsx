"use client";
import * as React from "react";
import Link from "next/link";
import {
  Plus,
  Search,
  Sparkles,
  User,
  Drama,
  Calendar,
  Tag,
  ExternalLink,
  Network,
  ArrowRight,
  ImageDown,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import type { CharacterMeta } from "@/lib/repo";
import { cn } from "@/lib/utils";

export function CharactersGallery({
  real,
  fictional,
}: {
  real: CharacterMeta[];
  fictional: CharacterMeta[];
}) {
  const [tab, setTab] = React.useState<"real" | "fictional">(
    real.length === 0 && fictional.length > 0 ? "fictional" : "real",
  );
  const [q, setQ] = React.useState("");
  const [refreshingAvatars, setRefreshingAvatars] = React.useState(false);

  const missingAvatars =
    real.filter((c) => !c.portrait).length +
    fictional.filter((c) => !c.portrait).length;
  // Avatars whose portrait is still a remote URL — eligible for one-shot
  // migration to /avatars/<id>.<ext> on disk.
  const isRemote = (c: CharacterMeta) =>
    !!c.portrait && /^https?:\/\//i.test(c.portrait);
  const remoteAvatars =
    real.filter(isRemote).length + fictional.filter(isRemote).length;
  const [migratingAvatars, setMigratingAvatars] = React.useState(false);

  async function refreshAvatars() {
    setRefreshingAvatars(true);
    try {
      await fetch("/api/characters/refresh-avatars", { method: "POST" });
      // Job is fire-and-forget; the global progress dock takes it from here.
      // We don't refresh the page right away — let user watch the dock.
    } finally {
      setRefreshingAvatars(false);
    }
  }

  async function migrateAvatars() {
    setMigratingAvatars(true);
    try {
      await fetch("/api/characters/migrate-avatars", { method: "POST" });
    } finally {
      setMigratingAvatars(false);
    }
  }

  const list = tab === "real" ? real : fictional;
  const filtered = q
    ? list.filter(
        (c) =>
          c.name.toLowerCase().includes(q.toLowerCase()) ||
          c.id.toLowerCase().includes(q.toLowerCase()) ||
          (c.tags || []).some((t) => t.toLowerCase().includes(q.toLowerCase())),
      )
    : list;

  return (
    <div className="px-8 py-6 flex-1 overflow-auto">
      <div className="flex items-center justify-between gap-4 mb-5">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="real">
              <User className="h-3.5 w-3.5 mr-1.5 opacity-70" />
              真实人物
              <span className="ml-2 text-faint tabular-nums">{real.length}</span>
            </TabsTrigger>
            <TabsTrigger value="fictional">
              <Drama className="h-3.5 w-3.5 mr-1.5 opacity-70" />
              虚构角色
              <span className="ml-2 text-faint tabular-nums">
                {fictional.length}
              </span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-faint" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索 id、姓名、标签..."
              className="pl-9"
            />
          </div>
        </div>
        {missingAvatars > 0 && (
          <Button
            variant="outline"
            onClick={refreshAvatars}
            disabled={refreshingAvatars}
            title="后台抓取维基百科 / Wikidata / Bing 图像"
          >
            {refreshingAvatars ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImageDown className="h-4 w-4" />
            )}
            补 {missingAvatars} 张头像
          </Button>
        )}
        {remoteAvatars > 0 && (
          <Button
            variant="outline"
            onClick={migrateAvatars}
            disabled={migratingAvatars}
            title="把外链头像下载到服务器本地（防止外链失效）"
          >
            {migratingAvatars ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImageDown className="h-4 w-4" />
            )}
            归档 {remoteAvatars} 张外链
          </Button>
        )}
        <Link href={`/characters/new?type=${tab}`}>
          <Button>
            <Plus className="h-4 w-4" />
            新建角色
          </Button>
        </Link>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={
            tab === "real" ? (
              <User className="h-5 w-5" />
            ) : (
              <Drama className="h-5 w-5" />
            )
          }
          title={
            q
              ? "没有匹配的角色"
              : tab === "real"
              ? "尚无真实人物 skill"
              : "尚无虚构角色 skill"
          }
          description={
            q ? (
              "换个关键词试试。"
            ) : tab === "real" ? (
              <>
                调用女娲流程从书籍 / 播客 / 访谈中蒸馏出可加载的{" "}
                <code className="font-mono text-accent">SKILL.md</code>。
              </>
            ) : (
              <>
                提供作品名 + ≥10 段原文台词 + 关系网，
                女娲-虚构 分支会产出与真实人物兼容的{" "}
                <code className="font-mono text-accent">SKILL.md</code>。
              </>
            )
          }
          action={
            !q && (
              <Link href={`/characters/new?type=${tab}`}>
                <Button>
                  <Plus className="h-4 w-4" />
                  录入第一个角色
                </Button>
              </Link>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((c) => (
            <CharacterCard key={c.id} character={c} />
          ))}
          <Link
            href={`/characters/new?type=${tab}`}
            className="group flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface/30 hover:bg-surface/60 hover:border-primary/40 transition-colors min-h-[220px]"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-elevated text-subtle group-hover:bg-primary/15 group-hover:text-primary transition-colors">
              <Plus className="h-5 w-5" />
            </div>
            <span className="text-xs text-subtle group-hover:text-foreground transition-colors">
              新建{tab === "real" ? "真实人物" : "虚构角色"}
            </span>
          </Link>
        </div>
      )}
    </div>
  );
}

function CharacterCard({ character }: { character: CharacterMeta }) {
  return (
    <Card className="hover:border-primary/40 hover:bg-surface transition-all group">
      <div className="p-5">
        <div className="flex items-start gap-3">
          <Portrait character={character} />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold truncate text-foreground">
                  {character.name}
                </h3>
                <code className="text-2xs font-mono text-faint">
                  {character.id}
                </code>
              </div>
              <Badge variant={character.type === "real" ? "primary" : "accent"}>
                {character.type === "real" ? "real" : "fictional"}
              </Badge>
            </div>
            {character.era && (
              <div className="mt-2 flex items-center gap-1.5 text-2xs text-subtle">
                <Calendar className="h-3 w-3 text-faint" />
                <span>{character.era}</span>
              </div>
            )}
            {character.source_work && (
              <div className="mt-1 flex items-center gap-1.5 text-2xs text-subtle truncate">
                <ExternalLink className="h-3 w-3 text-faint shrink-0" />
                <span className="truncate">{character.source_work}</span>
              </div>
            )}
          </div>
        </div>

        {character.tags && character.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {character.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-2xs bg-muted text-subtle"
              >
                <Tag className="h-2.5 w-2.5 opacity-50" />
                {tag}
              </span>
            ))}
            {character.tags.length > 4 && (
              <span className="text-2xs text-faint px-1">
                +{character.tags.length - 4}
              </span>
            )}
          </div>
        )}

        {character.relations && character.relations.length > 0 && (
          <div className="mt-3 flex items-center gap-1.5 text-2xs text-faint">
            <Network className="h-3 w-3" />
            <span className="tabular-nums">
              {character.relations.length} 个关系
            </span>
          </div>
        )}
      </div>

      <div className="border-t border-border px-5 py-3 flex items-center justify-between text-2xs">
        <Link
          href={`/characters/${character.id}`}
          className="text-subtle hover:text-foreground transition-colors flex items-center gap-1"
        >
          审阅 / 修改
          <ArrowRight className="h-3 w-3" />
        </Link>
        <code className="font-mono text-faint truncate max-w-[60%]">
          {character.skill_path.replace(/^characters\//, "")}
        </code>
      </div>
    </Card>
  );
}

function Portrait({ character }: { character: CharacterMeta }) {
  // Deterministic gradient from id hash so same character always looks identical
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
        "relative flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-sm font-semibold text-white overflow-hidden",
        "ring-1 ring-white/5",
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
        <span className="relative z-10">{initials}</span>
      )}
      {character.type === "fictional" && (
        <span className="absolute bottom-0.5 right-0.5 text-2xs z-20 bg-background/50 rounded p-0.5 backdrop-blur-sm">
          <Sparkles className="h-2.5 w-2.5 opacity-80" />
        </span>
      )}
    </div>
  );
}
