import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { LanguageDirSync } from "@/components/latent/LanguageDirSync";

export const metadata: Metadata = {
  title: "Latent.pk — AI-Driven Investment Intelligence for PSX",
  description: "AI-driven investment intelligence for the Pakistan Stock Exchange.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="antialiased bg-background text-foreground" style={{ fontFamily: "system-ui, sans-serif" }}>
        <LanguageDirSync />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
