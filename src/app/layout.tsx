import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { AppShell } from "./components/shell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "REMEDY — AI Compliance Remediation Memory Agent",
  description:
    "REMEDY remembers whether previous remediation attempts actually worked, and uses those outcomes to change the next recommendation. Recurring finding -> Hindsight historical memory -> human-approved remediation.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
