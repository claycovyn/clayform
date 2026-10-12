import type { Metadata, Viewport } from "next";
import { GOOGLE_FONTS_HREF } from "@/lib/fields";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Clayform — free, open-source forms", template: "%s · Clayform" },
  description:
    "Beautiful one-question-at-a-time forms. Free forever, open source, self-hosted. No response limits, no paywalled logic, no branding you can't remove.",
  icons: { icon: "/favicon.svg", apple: "/icon-512.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#2F5BFF" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={GOOGLE_FONTS_HREF} />
      </head>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
