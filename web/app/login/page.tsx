import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from, error } = await searchParams;
  const session = await getSession();
  if (session) {
    redirect((from || "/") as any);
  }
  return <LoginForm from={from} initialError={error} />;
}
