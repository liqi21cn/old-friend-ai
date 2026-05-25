import { NextRequest, NextResponse } from "next/server";
import {
  callExternalLogin,
  setSessionCookie,
  type Session,
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
  };
  if (!body.username || !body.password) {
    return NextResponse.json(
      { error: "缺少用户名或密码" },
      { status: 400 },
    );
  }
  const result = await callExternalLogin(body.username, body.password);
  if ("error" in result) {
    return NextResponse.json(
      { error: friendlyMessage(result.error) },
      { status: result.status },
    );
  }
  const session: Session = {
    token: result.token,
    user: result.user,
    issuedAt: Date.now(),
  };
  const res = NextResponse.json({ ok: true, user: result.user });
  setSessionCookie(res, session);
  return res;
}

function friendlyMessage(en: string): string {
  const lower = en.toLowerCase();
  if (lower.includes("invalid credentials"))
    return "用户名或密码错误";
  if (lower.includes("missing api key") || lower.includes("invalid api key"))
    return "服务端 API Key 配置错误";
  if (lower.includes("account is disabled"))
    return "账号已被禁用";
  if (lower.includes("not configured"))
    return "登录服务未配置";
  if (lower.includes("timeout"))
    return "登录服务响应超时，请稍后重试";
  return en;
}
