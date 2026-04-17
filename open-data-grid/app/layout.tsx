import type { ReactNode } from "react";
import type { Metadata } from "next";
import { IBM_Plex_Sans, Space_Grotesk } from "next/font/google";

import { FloatingNav } from "@/components/layout/FloatingNav";

import "./globals.css";

const headingFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
});

const bodyFont = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "Alchemy's Open Data Grid",
  description: "Unified IMF, World Bank, and FRED data explorer with backend-powered normalization and Excel export.",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className={`${headingFont.variable} ${bodyFont.variable}`}>
        <FloatingNav />
        {children}
      </body>
    </html>
  );
}
