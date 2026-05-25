"use client";
import * as React from "react";
import Link from "next/link";
import {
  Users,
  Mountain,
  Package,
  Wand2,
  RotateCcw,
  ArrowRight,
  ImageIcon,
  Sparkles,
  Loader2,
  Plus,
  X,
  Palette,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select } from "@/components/ui/select";
import { ART_STYLES, DEFAULT_ART_STYLE, type ArtStyle } from "@/lib/asset-prompts";
import { cn } from "@/lib/utils";

interface Asset {
  id: string;
  name: string;
  kind: "character" | "scene" | "prop";
  prompt?: string;
  imageUrl?: string;
  generating?: boolean;
  error?: string;
}

export function AssetsBoard({
  sessionId,
  characters,
  scenes,
  props,
  hasPersisted,
}: {
  sessionId: string;
  characters: Asset[];
  scenes: Asset[];
  props: Asset[];
  /** True when at least one asset row exists in the DB for this session.
   *  When true we never auto-bootstrap analyze(); the user has already
   *  analyzed once and re-running would burn LLM credits + clobber edits. */
  hasPersisted: boolean;
}) {
  const [tab, setTab] = React.useState<"character" | "scene" | "prop">(
    "character",
  );
  const [chars, setChars] = React.useState<Asset[]>(characters);
  const [scns, setScns] = React.useState<Asset[]>(scenes);
  const [prps, setPrps] = React.useState<Asset[]>(props);
  const [artStyle, setArtStyle] = React.useState<ArtStyle>(DEFAULT_ART_STYLE);
  const [analyzing, setAnalyzing] = React.useState(false);
  const analyzeBootstrappedRef = React.useRef(false);
  const [preview, setPreview] = React.useState<{
    url: string;
    name: string;
  } | null>(null);

  // Bootstrap structured analysis on first mount, but ONLY on a truly fresh
  // session. Once anything has been persisted (analyzed once, even partially)
  // we never auto-rerun — the user expects the persisted state to be the
  // authoritative view across visits.
  React.useEffect(() => {
    if (analyzeBootstrappedRef.current) return;
    analyzeBootstrappedRef.current = true;
    if (hasPersisted) return;
    analyze();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Persist a single asset (kind, name) to the server. Patch semantics —
   * undefined fields are left alone server-side.
   */
  async function persist(asset: Asset, patch: Partial<Asset>) {
    try {
      await fetch(`/api/assets/${sessionId}/items`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: asset.kind,
          name: asset.name,
          ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
          ...(patch.imageUrl !== undefined ? { imageUrl: patch.imageUrl } : {}),
        }),
      });
    } catch {
      /* swallow — don't block UI if persistence fails */
    }
  }

  async function persistRemove(asset: Asset) {
    try {
      await fetch(
        `/api/assets/${sessionId}/items?kind=${encodeURIComponent(asset.kind)}&name=${encodeURIComponent(asset.name)}`,
        { method: "DELETE" },
      );
    } catch {
      /* swallow */
    }
  }

  async function analyze() {
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/assets/${sessionId}/extract-inventory`, {
        method: "POST",
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        characters: Array<{ name: string; description?: string }>;
        scenes: Array<{
          location: string;
          timeSetting?: string;
          summary?: string;
          atmosphere?: string;
        }>;
        items: Array<{
          name: string;
          type?: string;
          description?: string;
          significance?: string;
        }>;
      };

      // We collect newly-discovered names per kind, then persist them all at
      // once at the end. Persistence creates DB rows (with prompt/imageUrl
      // null) so the next page visit hydrates from DB and skips re-analyzing.
      const newNames: Array<{
        kind: "character" | "scene" | "prop";
        name: string;
      }> = [];

      // characters: keep existing (those drove the shots originally), augment
      // with newly-identified state-variants from the LLM (e.g. "角色(决战前)").
      setChars((existing) => {
        const seen = new Set(existing.map((c) => c.name));
        const additions = (data.characters || [])
          .filter((c) => c.name && !seen.has(c.name))
          .map((c, i): Asset => {
            newNames.push({ kind: "character", name: c.name });
            return {
              id: `char-llm-${Date.now()}-${i}`,
              name: c.name,
              kind: "character" as const,
            };
          });
        return [...existing, ...additions];
      });

      // scenes: LLM's structured list (含子场景) replaces the single coarse
      // seed scene if the LLM produced anything richer.
      if ((data.scenes || []).length > 0) {
        setScns((existing) => {
          // Persist all scenes the LLM returned (the seed gets superseded)
          const llmScenes = (data.scenes || []).map(
            (s, i): Asset => {
              newNames.push({ kind: "scene", name: s.location });
              return {
                id: `scene-llm-${Date.now()}-${i}`,
                name: s.location,
                kind: "scene" as const,
              };
            },
          );
          return llmScenes;
        });
      }

      // items → props tab.
      setPrps((existing) => {
        const seen = new Set(existing.map((p) => p.name));
        const additions = (data.items || [])
          .filter((p) => p.name && !seen.has(p.name))
          .map((p, i): Asset => {
            newNames.push({ kind: "prop", name: p.name });
            return {
              id: `prop-llm-${Date.now()}-${i}`,
              name: p.name,
              kind: "prop" as const,
            };
          });
        return [...existing, ...additions];
      });

      // Fire-and-forget persistence — small bursts, no need to await each
      void persistMany(newNames);

      // Now auto-generate prompts for every asset that doesn't already have
      // one. Prompts are cheap (text LLM calls) and the user expects the
      // grid to be "ready to go" right after analyze.
      void autoGeneratePromptsForEmpty();
    } catch {
      /* swallow — keep whatever is already shown */
    } finally {
      setAnalyzing(false);
    }
  }

  /**
   * Walk every asset on every tab and call genPrompt for any that lacks one.
   * Runs sequentially per kind (3 simultaneous LLM calls is enough for our
   * provider's rate limit). Each successful prompt is persisted by genPrompt.
   */
  async function autoGeneratePromptsForEmpty() {
    // Snapshot current state — chars/scns/prps may have just been updated by
    // analyze() inside this same microtask, so read straight from the latest
    // setter callbacks.
    let currentChars: Asset[] = [];
    let currentScns: Asset[] = [];
    let currentPrps: Asset[] = [];
    setChars((a) => ((currentChars = a), a));
    setScns((a) => ((currentScns = a), a));
    setPrps((a) => ((currentPrps = a), a));
    const all = [...currentChars, ...currentScns, ...currentPrps].filter(
      (a) => !a.prompt && !a.generating,
    );
    const CONCURRENCY = 3;
    let cursor = 0;
    async function worker() {
      while (cursor < all.length) {
        const idx = cursor++;
        const asset = all[idx];
        try {
          await genPrompt(asset);
        } catch {
          /* individual failures already handled in genPrompt */
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, all.length) }, worker),
    );
  }

  // Persist a batch of (kind, name) tuples to the DB. Each row is created with
  // empty prompt + empty imageUrl — just a placeholder so the next visit
  // hydrates from DB without re-running the LLM analyzer.
  async function persistMany(
    items: Array<{ kind: "character" | "scene" | "prop"; name: string }>,
  ) {
    for (const it of items) {
      try {
        await fetch(`/api/assets/${sessionId}/items`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: it.kind, name: it.name }),
        });
      } catch {
        /* swallow individual failures */
      }
    }
  }

  const list =
    tab === "character" ? chars : tab === "scene" ? scns : prps;
  const setter =
    tab === "character" ? setChars : tab === "scene" ? setScns : setPrps;

  function updateAsset(id: string, patch: Partial<Asset>) {
    setter((arr) => arr.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  async function genPrompt(asset: Asset) {
    updateAsset(asset.id, { generating: true });
    try {
      const res = await fetch("/api/assets/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          asset: { id: asset.id, name: asset.name, kind: asset.kind },
          artStyle,
        }),
      });
      const data = await res.json();
      updateAsset(asset.id, { prompt: data.prompt, generating: false });
      // Persist new prompt so it survives reload
      await persist(asset, { prompt: data.prompt });
    } catch {
      updateAsset(asset.id, { generating: false });
    }
  }

  async function genImage(asset: Asset) {
    if (!asset.prompt) {
      await genPrompt(asset);
      return;
    }
    updateAsset(asset.id, { generating: true, error: undefined });
    try {
      const res = await fetch("/api/assets/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          asset: {
            id: asset.id,
            name: asset.name,
            kind: asset.kind,
            prompt: asset.prompt,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Server explicitly told us the provider call failed
        updateAsset(asset.id, {
          generating: false,
          error: data.error || `出图失败 (${res.status})`,
        });
        return;
      }
      updateAsset(asset.id, {
        imageUrl: data.imageUrl,
        generating: false,
        error: undefined,
      });
      await persist(asset, { imageUrl: data.imageUrl });
    } catch (e: any) {
      updateAsset(asset.id, {
        generating: false,
        error: e?.message || "网络错误",
      });
    }
  }

  function addAsset() {
    const newId = `${tab}-${Date.now()}`;
    setter((arr) => [
      ...arr,
      { id: newId, name: "新资产", kind: tab },
    ]);
  }

  function removeAsset(id: string) {
    let removed: Asset | undefined;
    setter((arr) => {
      removed = arr.find((a) => a.id === id);
      return arr.filter((a) => a.id !== id);
    });
    // Best-effort delete from DB if this asset was ever persisted (i.e. had
    // a prompt or imageUrl). Don't await — UI removes optimistically.
    setTimeout(() => {
      if (removed && (removed.prompt || removed.imageUrl)) {
        void persistRemove(removed);
      }
    }, 0);
  }

  const generatedCount = list.filter((a) => a.imageUrl).length;
  const totalCount = chars.length + scns.length + prps.length;
  const doneCount =
    chars.filter((a) => a.imageUrl).length +
    scns.filter((a) => a.imageUrl).length +
    prps.filter((a) => a.imageUrl).length;

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="px-8 py-3 border-b border-border bg-surface/40 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
            <TabsList>
              <TabsTrigger value="character">
                <Users className="h-3.5 w-3.5 mr-1.5 opacity-70" />
                角色资产
                <span className="ml-2 text-faint tabular-nums">
                  {chars.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="scene">
                <Mountain className="h-3.5 w-3.5 mr-1.5 opacity-70" />
                场景资产
                <span className="ml-2 text-faint tabular-nums">
                  {scns.length}
                </span>
              </TabsTrigger>
              <TabsTrigger value="prop">
                <Package className="h-3.5 w-3.5 mr-1.5 opacity-70" />
                道具资产
                {analyzing ? (
                  <Loader2 className="ml-2 h-3 w-3 animate-spin text-primary" />
                ) : (
                  <span className="ml-2 text-faint tabular-nums">
                    {prps.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="hidden md:flex items-center gap-2 text-2xs ml-3 text-faint">
            <span className="tabular-nums">{doneCount}</span>
            <span>/</span>
            <span className="tabular-nums">{totalCount}</span>
            <span>已出图</span>
            <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary to-accent transition-all"
                style={{
                  width: `${totalCount ? (doneCount / totalCount) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-2xs text-subtle">
            <Palette className="h-3.5 w-3.5 opacity-70" />
            画风
            <Select
              value={artStyle}
              onChange={(e) => setArtStyle(e.target.value as ArtStyle)}
              className="h-8 text-xs w-36"
            >
              {ART_STYLES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </label>
          <Link href={`/storyboard/${sessionId}` as any}>
            <Button variant="accent">
              进入分镜表
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        <div className="mb-4 flex items-center justify-between rounded-md border border-border bg-surface/40 px-4 py-2.5">
          <p className="text-2xs text-subtle leading-relaxed">
            {analyzing
              ? "LLM 正在对剧本做结构化分析（角色 · 场景 · 物品）..."
              : "由 LLM 从剧本对话 + 分镜动作一次性识别。角色支持「不同状态」、场景支持「同一地点的子场景」、物品排除场景陈设和身体部位。"}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={analyze}
            disabled={analyzing}
          >
            {analyzing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {analyzing ? "分析中..." : "重新分析"}
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {list.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              onChange={(p) => updateAsset(asset.id, p)}
              onGenPrompt={() => genPrompt(asset)}
              onGenImage={() => genImage(asset)}
              onRemove={() => removeAsset(asset.id)}
              onPreview={() =>
                asset.imageUrl &&
                setPreview({ url: asset.imageUrl, name: asset.name })
              }
            />
          ))}
          {analyzing && list.length === 0 && (
            <>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="rounded-lg border border-border bg-surface/40 min-h-[280px] overflow-hidden"
                >
                  <div className="aspect-square shimmer" />
                  <div className="p-4 space-y-2">
                    <div className="h-3 w-2/3 shimmer rounded" />
                    <div className="h-2 w-full shimmer rounded" />
                    <div className="h-2 w-3/4 shimmer rounded" />
                  </div>
                </div>
              ))}
            </>
          )}
          <button
            onClick={addAsset}
            className="group flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface/30 hover:bg-surface/60 hover:border-primary/40 transition-colors min-h-[280px] cursor-pointer"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-elevated text-subtle group-hover:bg-primary/15 group-hover:text-primary transition-colors">
              <Plus className="h-5 w-5" />
            </div>
            <span className="text-xs text-subtle">
              手动添加{" "}
              {tab === "character" ? "角色" : tab === "scene" ? "场景" : "道具"}
            </span>
          </button>
        </div>
      </div>

      {preview && (
        <Lightbox
          url={preview.url}
          name={preview.name}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

function AssetCard({
  asset,
  onChange,
  onGenPrompt,
  onGenImage,
  onRemove,
  onPreview,
}: {
  asset: Asset;
  onChange: (p: Partial<Asset>) => void;
  onGenPrompt: () => void;
  onGenImage: () => void;
  onRemove: () => void;
  onPreview: () => void;
}) {
  return (
    <Card className="group hover:border-primary/40 transition-colors flex flex-col">
      <div className="aspect-square bg-muted/40 border-b border-border relative overflow-hidden">
        {asset.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={asset.imageUrl}
            alt={asset.name}
            onClick={onPreview}
            className="absolute inset-0 w-full h-full object-cover cursor-zoom-in transition-transform group-hover:scale-[1.02]"
            title="点击查看原图"
          />
        ) : asset.generating ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <Loader2 className="h-6 w-6 text-primary animate-spin" />
            <span className="text-2xs text-subtle">生成中</span>
            <div className="absolute inset-0 shimmer opacity-30" />
          </div>
        ) : asset.error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-destructive px-4 text-center">
            <X className="h-8 w-8" />
            <span className="text-2xs font-medium">出图失败</span>
            <span
              className="text-2xs text-faint leading-relaxed line-clamp-3"
              title={asset.error}
            >
              {asset.error}
            </span>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-faint">
            <ImageIcon className="h-8 w-8" />
            <span className="text-2xs">未生成</span>
          </div>
        )}
        <button
          onClick={onRemove}
          className="absolute top-1.5 right-1.5 h-6 w-6 rounded bg-background/80 backdrop-blur-sm border border-border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive cursor-pointer"
        >
          <X className="h-3 w-3" />
        </button>
        <div className="absolute top-1.5 left-1.5">
          <Badge
            variant={
              asset.kind === "character"
                ? "primary"
                : asset.kind === "scene"
                ? "accent"
                : "secondary"
            }
          >
            {asset.kind === "character"
              ? "角色"
              : asset.kind === "scene"
              ? "场景"
              : "道具"}
          </Badge>
        </div>
      </div>

      <div className="p-4 space-y-3 flex-1 flex flex-col">
        <Input
          value={asset.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="text-sm font-medium bg-transparent border-0 p-0 h-auto focus-visible:ring-0"
        />
        <Textarea
          value={asset.prompt || ""}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder="（点 ⌬ 生成 prompt，或手动填写图像描述）"
          rows={3}
          className="text-2xs leading-relaxed font-mono bg-muted/40"
        />
        <div className="flex items-center gap-1.5 mt-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={onGenPrompt}
            disabled={asset.generating}
            className="flex-1 text-2xs"
            title="LLM 根据剧本上下文生成图像 prompt"
          >
            <Sparkles className="h-3 w-3" />
            生成 prompt
          </Button>
          <Button
            variant={asset.imageUrl ? "outline" : "default"}
            size="sm"
            onClick={onGenImage}
            disabled={asset.generating || !asset.prompt}
            className="flex-1 text-2xs"
          >
            {asset.imageUrl ? (
              <>
                <RotateCcw className="h-3 w-3" />
                重生成
              </>
            ) : (
              <>
                <Wand2 className="h-3 w-3" />
                出图
              </>
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Lightbox({
  url,
  name,
  onClose,
}: {
  url: string;
  name: string;
  onClose: () => void;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // Lock body scroll while open
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 backdrop-blur-sm p-6 animate-fade-in cursor-zoom-out"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={name}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full object-contain rounded-md shadow-2xl shadow-black/60 cursor-default"
      />
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between gap-4 pointer-events-none">
        <div className="text-sm text-foreground bg-background/70 backdrop-blur-md rounded px-3 py-1.5 max-w-[60%] truncate pointer-events-auto">
          {name}
        </div>
        <div className="flex items-center gap-2 pointer-events-auto">
          <a
            href={url}
            download={`${name}.png`}
            onClick={(e) => e.stopPropagation()}
            className="h-8 px-3 rounded bg-background/70 backdrop-blur-md text-xs flex items-center gap-1.5 hover:bg-background/90 transition-colors"
            title="下载原图"
          >
            <Download className="h-3.5 w-3.5" />
            下载
          </a>
          <button
            onClick={onClose}
            className="h-8 w-8 rounded bg-background/70 backdrop-blur-md flex items-center justify-center hover:bg-background/90 transition-colors"
            title="关闭 (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
