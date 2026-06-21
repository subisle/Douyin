import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "抖音",
  description: "抖音项目",
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
