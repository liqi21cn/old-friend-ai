"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Users,
  MessagesSquare,
  ScrollText,
  Image as ImageIcon,
  Film,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GlobalProgress } from "./global-progress";
import { UserWidget } from "./user-widget";

interface NavItem {
  label: string;
  description: string;
  href: string;
  match: (path: string) => boolean;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  {
    label: "角色",
    description: "录入与蒸馏",
    href: "/characters",
    match: (p) => p.startsWith("/characters"),
    icon: Users,
  },
  {
    label: "对话",
    description: "多 Agent 并行扮演",
    href: "/dialogue",
    match: (p) => p.startsWith("/dialogue"),
    icon: MessagesSquare,
  },
  {
    label: "剧本",
    description: "对白审阅 / 旁白收束",
    href: "/screenplay",
    match: (p) => p.startsWith("/screenplay"),
    icon: ScrollText,
  },
  {
    label: "资产",
    description: "角色 / 场景 / 道具",
    href: "/assets",
    match: (p) => p.startsWith("/assets"),
    icon: ImageIcon,
  },
  {
    label: "分镜",
    description: "Sequence ID 表",
    href: "/storyboard",
    match: (p) => p.startsWith("/storyboard"),
    icon: Film,
  },
];

export function WizardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const path = usePathname();

  // Public / chromeless routes — render plain children, no sidebar / progress.
  if (path === "/login") {
    return <>{children}</>;
  }

  return (
    <div className="relative z-10 min-h-dvh flex">
      <aside className="w-[260px] shrink-0 border-r border-border bg-surface/70 backdrop-blur-xl flex flex-col sticky top-0 h-dvh self-start">
        <div className="px-5 py-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="旧识"
              onError={(e) => {
                // graceful fallback to placeholder svg if logo.png not deployed yet
                const img = e.currentTarget;
                if (!img.dataset.fallback) {
                  img.dataset.fallback = "1";
                  img.src = "/logo.svg";
                }
              }}
              className="h-9 w-9 rounded-md object-cover shadow-[0_0_24px_rgb(124_58_237/0.35)]"
            />
            <div>
              <h1 className="text-sm font-semibold leading-tight tracking-tight">
                旧识
              </h1>
              <p className="text-2xs text-faint mt-0.5 font-mono tracking-wide">
                OLD FRIEND AI
              </p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          <p className="label-mono px-2 mb-2">工作台</p>
          {NAV.map((item) => {
            const isActive = item.match(path);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href as any}
                className={cn(
                  "group flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors",
                  isActive
                    ? "bg-primary/15 text-foreground"
                    : "text-subtle hover:bg-elevated hover:text-foreground",
                )}
              >
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded transition-colors",
                    isActive
                      ? "bg-primary text-primary-fg shadow-[0_0_12px_rgb(124_58_237/0.6)]"
                      : "bg-muted text-subtle group-hover:bg-elevated",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className={cn(
                      "font-medium",
                      isActive && "text-foreground",
                    )}
                  >
                    {item.label}
                  </div>
                  <div className="text-2xs text-faint truncate mt-0.5">
                    {item.description}
                  </div>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="px-3 pt-3 pb-3 border-t border-border space-y-3">
          <UserWidget />
          <div className="flex items-center justify-between text-2xs text-faint px-2">
            <span className="font-mono">DeepSeek V4 Pro</span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              在线
            </span>
          </div>
        </div>
      </aside>

      <main className="flex-1 min-w-0 flex flex-col">{children}</main>

      <GlobalProgress />
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Optional small meta line above the title, e.g. crumbs or context tags. */
  meta?: React.ReactNode;
  /**
   * Deprecated — kept for source compatibility while existing pages still pass it.
   * The visual numbering has been removed; this prop is ignored.
   */
  step?: number;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-xl">
      <div className="px-8 py-5 flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          {meta && (
            <div className="flex items-center gap-2 text-2xs text-faint mb-1.5">
              {meta}
            </div>
          )}
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {description && (
            <p className="mt-1.5 text-sm text-subtle max-w-2xl leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>
    </header>
  );
}
