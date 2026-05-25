import { notFound, redirect } from "next/navigation";
import {
  readScreenplay,
  readTranscript,
  readSessionAssets,
  type SessionAsset,
} from "@/lib/repo";
import { getSession } from "@/lib/auth";
import { PageHeader } from "@/components/wizard-shell";
import { AssetsBoard } from "./board";

export const dynamic = "force-dynamic";

type Kind = "character" | "scene" | "prop";

interface BoardAsset {
  id: string;
  name: string;
  kind: Kind;
  prompt?: string;
  imageUrl?: string;
}

export default async function AssetsPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const s = await getSession();
  if (!s) redirect("/login" as any);
  const userId = s.user.id;
  const { sessionId } = await params;

  const screenplay = (await readScreenplay(sessionId, userId)) as Array<{
    characters?: string[];
    action?: string | null;
  }> | null;
  const transcript = await readTranscript(sessionId, userId);
  if (!screenplay || !transcript) return notFound();

  // Authoritative persisted state (prompt + imageUrl)
  const persisted = await readSessionAssets(sessionId, userId);

  // Transcript-derived seeds, used when nothing is persisted yet
  const seedCharSet = new Set<string>();
  for (const shot of screenplay) {
    for (const c of shot.characters || []) seedCharSet.add(c);
  }
  const charSeed: BoardAsset[] = Array.from(seedCharSet).map((id) => ({
    id,
    name: transcript.characters?.find((c: any) => c.id === id)?.name || id,
    kind: "character",
  }));

  const sceneSeed: BoardAsset[] = transcript.scene?.setting
    ? [
        {
          id: "scene-1",
          name: transcript.scene.setting,
          kind: "scene",
        },
      ]
    : [];

  // Merge: persisted first (carries prompt + imageUrl), then any seed names
  // not yet in DB (these are auto-detected from the dialogue/storyboard but
  // user hasn't generated anything for them).
  const merged = mergeAssets(persisted, [...charSeed, ...sceneSeed]);

  const characters = merged.filter((a) => a.kind === "character");
  const scenes = merged.filter((a) => a.kind === "scene");
  const props = merged.filter((a) => a.kind === "prop");

  return (
    <>
      <PageHeader
        step={4}
        title="资产图像生成"
        description={
          <>
            从分镜中抽出{" "}
            <span className="text-foreground">{characters.length}</span> 个角色 ·{" "}
            <span className="text-foreground">{scenes.length}</span> 个场景 ·{" "}
            <span className="text-foreground">{props.length}</span> 个道具。
            提示词和已出图都已存数据库，下次进来直接看。
          </>
        }
      />
      <AssetsBoard
        sessionId={sessionId}
        characters={characters}
        scenes={scenes}
        props={props}
        hasPersisted={persisted.length > 0}
      />
    </>
  );
}

function mergeAssets(
  persisted: SessionAsset[],
  seeds: BoardAsset[],
): BoardAsset[] {
  const out: BoardAsset[] = [];
  const seenByKindName = new Set<string>();
  // Persisted wins on identical (kind, name)
  for (const p of persisted) {
    const key = `${p.kind}::${p.name}`;
    seenByKindName.add(key);
    out.push({
      id: `${p.kind}-db-${encodeURIComponent(p.name)}`,
      name: p.name,
      kind: p.kind,
      prompt: p.prompt ?? undefined,
      imageUrl: p.imageUrl ?? undefined,
    });
  }
  for (const seed of seeds) {
    const key = `${seed.kind}::${seed.name}`;
    if (seenByKindName.has(key)) continue;
    out.push(seed);
  }
  return out;
}
