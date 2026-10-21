import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Latent.pk — PSX Investment Intelligence",
  description: "AI-driven investment intelligence for the Pakistan Stock Exchange.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#0A0E1A] text-[#F4F7FB] antialiased" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
