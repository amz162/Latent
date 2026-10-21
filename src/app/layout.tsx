import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { LanguageDirSync } from "@/components/latent/LanguageDirSync";

export const metadata: Metadata = {
  title: "Latent.pk — AI-Driven Investment Intelligence for PSX",
  description: "Turning 'what stock should I buy' into 'here's the plan to reach your goal.' AI-driven, goal-based investment intelligence for the Pakistan Stock Exchange.",
  keywords: ["Latent.pk", "PSX", "Pakistan Stock Exchange", "investment", "AI signals", "robo-advisor"],
  authors: [{ name: "Latent.pk" }],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <LanguageDirSync />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
