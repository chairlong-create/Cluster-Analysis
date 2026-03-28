import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "对话聚类分析工作台",
  description: "本地运行的对话信号提取、聚类分类与类别管理工作台。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
