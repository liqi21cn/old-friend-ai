"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  LogIn,
  Sparkles,
  AlertCircle,
  User as UserIcon,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

export function LoginForm({
  from,
  initialError,
}: {
  from?: string;
  initialError?: string;
}) {
  const router = useRouter();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(initialError ?? null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || `登录失败 (${res.status})`);
        return;
      }
      router.push((from || "/") as any);
      router.refresh();
    } catch (e: any) {
      setError(e.message || "网络错误");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative z-10 min-h-dvh flex items-center justify-center px-6">
      {/* Decorative gradient backdrop */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute -top-40 -left-32 h-96 w-96 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-24 h-96 w-96 rounded-full bg-accent/15 blur-3xl" />
      </div>

      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="旧识"
            onError={(e) => {
              const img = e.currentTarget;
              if (!img.dataset.fallback) {
                img.dataset.fallback = "1";
                img.src = "/logo.svg";
              }
            }}
            className="h-12 w-12 rounded-lg object-cover shadow-[0_0_32px_rgb(124_58_237/0.4)]"
          />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">旧识</h1>
            <p className="text-2xs text-faint font-mono tracking-wide mt-0.5">
              OLD FRIEND AI
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface/80 backdrop-blur-xl p-7 shadow-2xl shadow-black/40">
          <h2 className="text-lg font-semibold tracking-tight">登录</h2>
          <p className="text-xs text-subtle mt-1">
            使用统一账号登录，凭据将通过外部认证服务校验。
          </p>

          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <Label required>用户名</Label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-faint pointer-events-none" />
                <Input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="zsadmin"
                  autoComplete="username"
                  className="pl-9"
                  disabled={busy}
                  autoFocus
                  required
                />
              </div>
            </div>
            <div>
              <Label required>密码</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-faint pointer-events-none" />
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="pl-9"
                  disabled={busy}
                  required
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                <AlertCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
                <p className="text-destructive leading-relaxed">{error}</p>
              </div>
            )}

            <Button
              type="submit"
              size="lg"
              disabled={busy || !username || !password}
              className="w-full"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              {busy ? "校验中..." : "登录"}
            </Button>
          </form>

          <p className="text-2xs text-faint text-center mt-6 leading-relaxed">
            登录由外部认证服务提供。
            <br />
            遇到「用户名或密码错误」请联系系统管理员。
          </p>
        </div>
      </div>
    </div>
  );
}
