import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "CGMP",
    template: "%s | CGMP",
  },
  description: "CGMP PWA MVP. 雑に入れて、AIで整えて、あとで探せる。",
  manifest: "/manifest.webmanifest",
  applicationName: "CGMP",
  appleWebApp: {
    capable: true,
    title: "CGMP",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-950 text-zinc-50">{children}</body>
    </html>
  );
}
