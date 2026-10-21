"use client";

import { useEffect } from "react";
import { useI18n } from "@/lib/latent/i18n";

// Synchronizes <html dir> + <html lang> + body font class with the selected language.
// Urdu (rtl) → switches to Noto Nastaliq Urdu font + dir=rtl
// English / Roman Urdu → defaults back to LTR + Inter font

export function LanguageDirSync() {
  const lang = useI18n((s) => s.lang);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    const body = document.body;

    if (lang === "urdu") {
      html.setAttribute("dir", "rtl");
      html.setAttribute("lang", "ur");
      body.classList.add("font-urdu");
      body.style.fontFamily = "var(--font-urdu), var(--font-inter-sans), sans-serif";
    } else if (lang === "roman_urdu") {
      html.setAttribute("dir", "ltr");
      html.setAttribute("lang", "ur-Latn");
      body.classList.remove("font-urdu");
      body.style.fontFamily = "";
    } else {
      html.setAttribute("dir", "ltr");
      html.setAttribute("lang", "en");
      body.classList.remove("font-urdu");
      body.style.fontFamily = "";
    }
  }, [lang]);

  return null;
}
