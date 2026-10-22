import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

// Investify.pk news scraper
// Schedule: Mon-Fri, 9:00 AM - 5:00 PM PKT (pre-session scrape + every 5 min during session)
// This endpoint can be called manually or via a cron job in production.

export const dynamic = "force-dynamic";
export const revalidate = 300; // cache for 5 min

interface NewsItem {
  title: string;
  link: string;
  source: string;
  publishedAt: string | null;
  summary: string;
  category: "national" | "international" | "market" | "company";
  image?: string;
}

export async function GET() {
  try {
    const res = await fetch("https://www.investify.pk/news", {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LatentBot/1.0; +https://latent.pk)",
        "Accept": "text/html",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch investify.pk/news: ${res.status}` },
        { status: res.status }
      );
    }
    const html = await res.text();
    const $ = cheerio.load(html);

    const news: NewsItem[] = [];

    // Try multiple common selectors used by financial news sites
    // Investify.pk uses a card-based layout
    $("article, .news-card, .news-item, .post-card, [data-news-item]").each((_, el) => {
      const $el = $(el);
      const title = $el.find("h2, h3, h4, .title, .news-title").first().text().trim();
      const link = $el.find("a").first().attr("href") || "";
      const summary = $el.find("p, .summary, .excerpt, .description").first().text().trim();
      const img = $el.find("img").first().attr("src") || undefined;
      const time = $el.find("time, .date, .published, .timestamp").first().text().trim();

      if (title && link) {
        news.push({
          title,
          link: link.startsWith("http") ? link : `https://www.investify.pk${link}`,
          source: "Investify.pk",
          publishedAt: time || null,
          summary: summary.slice(0, 280),
          category: classifyNews(title, summary),
          image: img,
        });
      }
    });

    // Fallback: if no items matched, try plain link list parsing
    if (news.length === 0) {
      $("a").each((_, el) => {
        const $a = $(el);
        const title = $a.text().trim();
        const link = $a.attr("href") || "";
        if (title.length > 30 && title.length < 200 && link.includes("/news/")) {
          news.push({
            title,
            link: link.startsWith("http") ? link : `https://www.investify.pk${link}`,
            source: "Investify.pk",
            publishedAt: null,
            summary: "",
            category: classifyNews(title, ""),
          });
        }
      });
    }

    // Deduplicate by link
    const seen = new Set<string>();
    const unique = news.filter((n) => {
      if (seen.has(n.link)) return false;
      seen.add(n.link);
      return true;
    });

    return NextResponse.json({
      news: unique.slice(0, 30),
      scrapedAt: new Date().toISOString(),
      source: "https://www.investify.pk/news",
      schedule: "Mon-Fri 09:00-17:00 PKT, pre-session + every 5 min during session",
      count: unique.length,
    });
  } catch (err) {
    console.error("[/api/scrape/news] error:", err);
    return NextResponse.json(
      { error: "Scraper failed", detail: err instanceof Error ? err.message : "Unknown" },
      { status: 502 }
    );
  }
}

function classifyNews(title: string, summary: string): NewsItem["category"] {
  const text = (title + " " + summary).toLowerCase();
  if (/pakistan|karachi|lahore|islamabad|imran|shehbaz|pml|pti|ppp|sbp|secp|imd|imf/.test(text)) {
    return "national";
  }
  if (/us |america|europe|china|india|oil|brent|crude|fed|ecb|fed rate|global|international|foreign/.test(text)) {
    return "international";
  }
  if (/eps|dividend|quarter|result|profit|revenue|earning|agm|bonus|right|stock split/.test(text)) {
    return "company";
  }
  return "market";
}
