"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Save,
  ArrowLeft,
  Trash2,
  Sparkles,
  Check,
  Calendar,
  ExternalLink,
  Network,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CharacterMeta } from "@/lib/repo";
import { cn } from "@/lib/utils";

export function CharacterReviewer({
  id,
  meta,
  initialSkill,
}: {
  id: string;
  meta: CharacterMeta;
  initialSkill: string;
}) {
  const router = useRouter();
  const [skill, setSkill] = React.useState(initialSkill);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const dirty = skill !== initialSkill;

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/characters/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill }),
    });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh();
    }
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="border-b border-border px-8 py-3 flex items-center justify-between gap-4 bg-surface/40">
        <div className="flex items-center gap-3">
          <Link href="/characters">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-3.5 w-3.5" />
              返回角色库
            </Button>
          </Link>
          <div className="h-5 w-px bg-border" />
          <Badge variant={meta.type === "real" ? "primary" : "accent"}>
            {meta.type === "real" ? "real" : "fictional"}
          </Badge>
          {meta.era && (
            <span className="flex items-center gap-1 text-2xs text-subtle">
              <Calendar className="h-3 w-3 text-faint" />
              {meta.era}
            </span>
          )}
          {meta.source_work && (
            <span className="flex items-center gap-1 text-2xs text-subtle truncate max-w-xs">
              <ExternalLink className="h-3 w-3 text-faint" />
              {meta.source_work}
            </span>
          )}
          {meta.relations && meta.relations.length > 0 && (
            <span className="flex items-center gap-1 text-2xs text-subtle">
              <Network className="h-3 w-3 text-faint" />
              {meta.relations.length} 关系
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-2xs text-warning flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-warning" />
              未保存
            </span>
          )}
          {saved && (
            <span className="text-2xs text-success flex items-center gap-1">
              <Check className="h-3 w-3" />
              已保存
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              if (
                !confirm(
                  `确认删除角色 ${meta.name} (${id})？此操作不可恢复。`,
                )
              )
                return;
              const res = await fetch(
                `/api/characters/${encodeURIComponent(id)}`,
                { method: "DELETE" },
              );
              if (res.ok) router.push("/characters");
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </Button>
          <Button
            size="sm"
            onClick={save}
            disabled={!dirty || saving}
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? "保存中..." : "保存修改"}
          </Button>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-2 overflow-hidden">
        <div className="overflow-auto px-8 py-6 border-r border-border bg-surface/20">
          <p className="label-mono mb-3">preview</p>
          <PreviewSkill content={skill} />
        </div>
        <div className="flex flex-col overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center justify-between">
            <p className="label-mono">editor · markdown</p>
            <span className="text-2xs text-faint tabular-nums">
              {skill.length} chars · {skill.split("\n").length} lines
            </span>
          </div>
          <textarea
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            className={cn(
              "flex-1 w-full p-5 bg-background font-mono text-xs leading-relaxed",
              "resize-none border-0 focus:outline-none focus:ring-0",
            )}
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
}

function PreviewSkill({ content }: { content: string }) {
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
