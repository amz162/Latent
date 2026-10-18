import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Noto_Nastaliq_Urdu } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { LanguageDirSync } from "@/components/latent/LanguageDirSync";

const interSans = Inter({
  variable: "--font-inter-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const notoUrdu = Noto_Nastaliq_Urdu({
  variable: "--font-urdu",
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

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
        className={`${interSans.variable} ${jetbrainsMono.variable} ${notoUrdu.variable} antialiased bg-background text-foreground`}
      >
        <LanguageDirSync />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
