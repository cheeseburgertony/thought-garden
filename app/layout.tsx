import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Thought Garden — 思维花园",
  description: "An AI-powered spatial thinking canvas. Let your ideas grow.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
