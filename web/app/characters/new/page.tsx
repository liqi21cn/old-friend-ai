import { PageHeader } from "@/components/wizard-shell";
import { NewCharacterForm } from "./form";

interface SearchParams {
  type?: string;
}

export default async function NewCharacterPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { type } = await searchParams;
  const initialType: "real" | "fictional" =
    type === "fictional" ? "fictional" : "real";

  return (
    <>
      <PageHeader
        step={1}
        title="新建角色 skill"
        description={
          <>
            三种录入路径 ——
            <strong className="text-foreground"> 真实人物 </strong>走原版女娲流程；
            <strong className="text-foreground"> 虚构角色 </strong>走{" "}
            <code className="font-mono text-accent">女娲-虚构</code> 分支（需 ≥10
            条原文台词）；
            <strong className="text-foreground"> 批量导入 </strong>
            上传 CSV 清单一次性生成数十到上百个真人 SKILL.md。
          </>
        }
      />
      <NewCharacterForm initialType={initialType} />
    </>
  );
}
