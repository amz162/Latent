import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { LanguageDirSync } from "@/components/latent/LanguageDirSync";

// Use CSS variables instead of next/font/google (which fails during build
// when Google Fonts servers are unreachable). The font-family is set
// in globals.css using system font stacks.
const fontVars = {
  variable: "--font-inter-sans",
};
const monoVars = {
  variable: "--font-jetbrains-mono",
};
const urduVars = {
  variable: "--font-urdu",
};

export const metadata: Metadata = {
  title: "Latent.pk — AI-Driven Investment Intelligence for PSX",
  description:
    "Turning 'what stock should I buy' into 'here's the plan to reach your goal.' AI-driven, goal-based investment intelligence for the Pakistan Stock Exchange.",
  keywords: [
    "Latent.pk",
    "PSX",
    "Pakistan Stock Exchange",
    "investment",
    "AI signals",
    "robo-advisor",
  ],
  authors: [{ name: "Latent.pk" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${fontVars.variable} ${monoVars.variable} ${urduVars.variable} antialiased bg-background text-foreground`}
      >
        <LanguageDirSync />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
