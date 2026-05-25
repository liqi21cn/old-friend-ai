import { notFound } from "next/navigation";
import { readCharacter } from "@/lib/repo";
import { PageHeader } from "@/components/wizard-shell";
import { CharacterReviewer } from "./reviewer";

export const dynamic = "force-dynamic";

export default async function CharacterReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await readCharacter(id);
  if (!data) return notFound();

  return (
    <>
      <PageHeader
        step={1}
        title={`${data.meta.name} · 角色 skill 审阅`}
        description={
          <>
            <code className="font-mono text-accent">
              {data.meta.skill_path}
            </code>
          </>
        }
      />
      <CharacterReviewer id={id} meta={data.meta} initialSkill={data.skill} />
    </>
  );
}
