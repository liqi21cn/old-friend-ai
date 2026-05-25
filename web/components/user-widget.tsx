"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut, ShieldCheck, User as UserIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface User {
  id: number;
  username: string;
  name: string;
  email: string;
  is_admin: boolean;
  user_level: string;
}

export function UserWidget() {
  const router = useRouter();
  const [user, setUser] = React.useState<User | null>(null);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (alive && data?.user) setUser(data.user);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onDocClick = () => setOpen(false);
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  async function logout() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  if (!user) {
    return (
      <div className="flex items-center gap-2 px-2 py-2 text-2xs text-faint">
        <div className="h-7 w-7 rounded shimmer" />
        <span>加载中...</span>
      </div>
    );
  }

  const initials = (user.name || user.username || "?").slice(0, 1).toUpperCase();
  const display = user.name || user.username;

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "w-full flex items-center gap-2 rounded-md px-2 py-2 transition-colors cursor-pointer",
          open
            ? "bg-elevated text-foreground"
            : "text-subtle hover:bg-elevated hover:text-foreground",
        )}
      >
        <div className="h-7 w-7 shrink-0 rounded bg-gradient-to-br from-primary to-accent flex items-center justify-center text-xs font-semibold text-white">
          {initials}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="text-xs font-medium truncate">{display}</div>
          <div className="text-2xs text-faint truncate font-mono">
            {user.username}
          </div>
        </div>
        {user.is_admin && (
          <ShieldCheck
            className="h-3.5 w-3.5 text-accent shrink-0"
            aria-label="admin"
          />
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-2 rounded-md border border-border bg-surface/95 backdrop-blur-xl shadow-2xl shadow-black/40 overflow-hidden animate-fade-in">
          <div className="px-3 py-3 border-b border-border">
            <p className="text-sm font-semibold">{display}</p>
            <p className="text-2xs text-faint font-mono mt-0.5">
              {user.email || user.username}
            </p>
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <span className="px-1.5 py-0.5 rounded text-2xs bg-elevated text-subtle">
                等级 · {user.user_level}
              </span>
              {user.is_admin && (
                <span className="px-1.5 py-0.5 rounded text-2xs bg-accent/15 text-accent border border-accent/30">
                  管理员
                </span>
              )}
            </div>
          </div>
          <button
            onClick={logout}
            disabled={busy}
            className="w-full px-3 py-2.5 text-xs text-left hover:bg-elevated transition-colors cursor-pointer flex items-center gap-2 text-subtle hover:text-destructive disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogOut className="h-3.5 w-3.5" />
            )}
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
