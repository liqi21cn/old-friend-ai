import { readIndex } from "@/lib/repo";
import { PageHeader } from "@/components/wizard-shell";
import { DialogueComposer } from "./composer";

export const dynamic = "force-dynamic";

export default async function DialoguePage() {
  const characters = await readIndex({ orderBy: "created_desc" });
  return (
    <>
      <PageHeader
        step={2}
        title="多 Agent 并行对话"
        description={
          <>
            选 2 个或更多角色，设定主题与目标时长。每一轮所有角色{" "}
            <span className="text-accent">并行发言</span>
            ——不存在「后说话者被先说话者带跑」的偏置。
          </>
        }
      />
      <DialogueComposer characters={characters} />
    </>
  );
}
