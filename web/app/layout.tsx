import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { WizardShell } from "@/components/wizard-shell";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["300", "400", "500", "600", "700"],
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "旧识 · Old Friend AI · 角色驱动短剧生成器",
  description:
    "蒸馏古今人物的思维框架，多 Agent 并行扮演对话，渲染为可拍摄的短剧分镜。",
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className={`${inter.variable} ${mono.variable}`}>
      <body>
        <WizardShell>{children}</WizardShell>
      </body>
    </html>
  );
}
