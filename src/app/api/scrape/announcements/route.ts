import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

// Investify.pk announcements scraper (covers both company news and company results)
// Schedule: Mon-Fri, 9:00 AM - 5:00 PM PKT
// Returns categorized announcements: news + results, with PDF links.

export const dynamic = "force-dynamic";
export const revalidate = 300;

interface Announcement {
  id: string;
  company: string;
  symbol: string;
  title: string;
  type: "news" | "result" | "dividend" | "agm" | "other";
  pdfLink: string | null;
  link: string;
  publishedAt: string | null;
  summary: string;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const filter = searchParams.get("type"); // "news" | "result" | null = all
  try {
    const res = await fetch("https://www.investify.pk/announcements", {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LatentBot/1.0; +https://latent.pk)",
        "Accept": "text/html",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch investify.pk/announcements: ${res.status}` },
        { status: res.status }
      );
    }
    const html = await res.text();
    const $ = cheerio.load(html);

    const announcements: Announcement[] = [];

    // Try multiple selectors
    $("article, .announcement, .announcement-card, .news-card, tr").each((_, el) => {
      const $el = $(el);
      const title = $el.find("h2, h3, h4, .title, .announcement-title, td.title").first().text().trim();
      const link = $el.find("a").first().attr("href") || "";
      const pdfLink = $el.find('a[href$=".pdf"]').attr("href") || null;
      const time = $el.find("time, .date, .published, .timestamp").first().text().trim();
      const summary = $el.find("p, .summary, .excerpt").first().text().trim();

      if (!title) return;
      const company = extractCompany(title);
      const symbol = extractSymbol(title) || company;
      const type = classifyAnnouncement(title);

      announcements.push({
        id: `ann_${announcements.length}_${Date.now()}`,
        company,
        symbol,
        title,
        type,
        pdfLink: pdfLink ? (pdfLink.startsWith("http") ? pdfLink : `https://www.investify.pk${pdfLink}`) : null,
        link: link.startsWith("http") ? link : `https://www.investify.pk${link}`,
        publishedAt: time || null,
        summary: summary.slice(0, 280),
      });
    });

    // Fallback: list items
    if (announcements.length === 0) {
      $("a").each((_, el) => {
        const $a = $(el);
        const title = $a.text().trim();
        const link = $a.attr("href") || "";
        if (title.length > 20 && title.length < 300 && (link.includes("/announcement") || link.includes("/result") || link.includes("/news"))) {
          const company = extractCompany(title);
          const symbol = extractSymbol(title) || company;
          const type = classifyAnnouncement(title);
          announcements.push({
            id: `ann_${announcements.length}_${Date.now()}`,
            company,
            symbol,
            title,
            type,
            pdfLink: null,
            link: link.startsWith("http") ? link : `https://www.investify.pk${link}`,
            publishedAt: null,
            summary: "",
          });
        }
      });
    }

    // Deduplicate by link/title
    const seen = new Set<string>();
    const unique = announcements.filter((a) => {
      const k = a.link + "|" + a.title;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const filtered = filter ? unique.filter((a) => a.type === filter) : unique;

    return NextResponse.json({
      announcements: filtered.slice(0, 50),
      scrapedAt: new Date().toISOString(),
      source: "https://www.investify.pk/announcements",
      schedule: "Mon-Fri 09:00-17:00 PKT",
      total: filtered.length,
    });
  } catch (err) {
    console.error("[/api/scrape/announcements] error:", err);
    return NextResponse.json(
      { error: "Scraper failed", detail: err instanceof Error ? err.message : "Unknown" },
      { status: 502 }
    );
  }
}

function extractCompany(title: string): string {
  // PSX announcements typically start with company name or symbol in brackets
  const match = title.match(/^([A-Z][A-Z&\s]+?)(?:\s+(?:announced|posted|declared|reported|filed|notified)|[:\-\s])/);
  if (match) return match[1].trim();
  return title.split(" ").slice(0, 3).join(" ");
}

function extractSymbol(title: string): string {
  const m = title.match(/\b([A-Z]{2,5})\b/);
  return m ? m[1] : "";
}

function classifyAnnouncement(title: string): Announcement["type"] {
  const t = title.toLowerCase();
  if (/result|quarter|q1|q2|q3|q4|half year|annual report|eps|earning|profit|loss|income statement|balance sheet/.test(t)) {
    return "result";
  }
  if (/dividend|interim|final dividend|cash dividend|bonus|right issue/.test(t)) {
    return "dividend";
  }
  if (/agm|annual general|extraordinary general|egm|book closure/.test(t)) {
    return "agm";
  }
  return "news";
}
