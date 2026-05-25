import { readIndex } from "@/lib/repo";
import { PageHeader } from "@/components/wizard-shell";
import { CharactersGallery } from "./gallery";

export const dynamic = "force-dynamic";

export default async function CharactersPage() {
  const characters = await readIndex();
  const real = characters.filter((c) => c.type === "real");
  const fictional = characters.filter((c) => c.type === "fictional");

  return (
    <>
      <PageHeader
        step={1}
        title="角色资产库"
        description={
          <>
            管理你的真人与虚构角色 skill。每个角色一份蒸馏后的{" "}
            <code className="font-mono text-accent">SKILL.md</code>{" "}
            ——含表达 DNA、心智模型、决策启发式与边界约束。
          </>
        }
      />
      <CharactersGallery real={real} fictional={fictional} />
    </>
  );
}
