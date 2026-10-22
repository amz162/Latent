import { NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import type { ChatMessage } from "z-ai-web-dev-sdk";
import { cacheGetJSON, cacheSetJSON } from "@/lib/latent/cache";
import { MOCK_STOCKS } from "@/lib/latent/mock-stocks";

// Latent.pk — Per-Stock Portfolio News Digest
// For each stock in the user's portfolio (or all 8 covered stocks by default),
// fetches news from askanalyst.com.pk /api/news/{symbol}, then calls the LLM
// to interpret each news item with stock-specific impact analysis.
//
// Cached aggressively (24hr per symbol per news item) to keep latency low.
// User's manual URL paste (in Fundamental News tab) is the extra-feature path
// for ultra-fast news from any source.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface NewsItem {
  title?: string;
  link?: string;
  source?: string;
  publishedAt?: string;
  summary?: string;
}

interface InterpretedNewsItem extends NewsItem {
  symbol: string;
  impact: "positive" | "negative" | "neutral";
  impactStrength: "weak" | "moderate" | "strong";
  laymanExplanation: string;
  shortTermOutlook: string;
  affectedStocks: string[];
}

interface NewsDigestResponse {
  symbol: string;
  stockName: string;
  newsCount: number;
  interpretedItems: InterpretedNewsItem[];
  source: string;
  fetchedAt: string;
  cached: boolean;
}

const SYSTEM_PROMPT = `You are Latent.pk's financial news analyst for the Pakistan Stock Exchange (PSX). For each news article about a specific PSX-listed stock, generate a concise interpretation focused on that stock.

CRITICAL RULES:
1. Output ONLY valid JSON — no markdown, no commentary.
2. Focus on the specific stock mentioned in the user prompt. Other stocks can be mentioned in affectedStocks if the news is sector-wide.
3. Be conservative — if the news isn't clearly positive or negative, return "neutral".
4. Layman language — explain WHY the news matters in plain terms.
5. Don't make BUY/SELL recommendations.
6. 2-3 sentence explanations max.

Your JSON output shape:
{
  "impact": "positive" | "negative" | "neutral",
  "impactStrength": "weak" | "moderate" | "strong",
  "laymanExplanation": "2-3 sentence plain-English explanation of WHY this news matters for this stock",
  "shortTermOutlook": "1-2 sentence conservative outlook for next session",
  "affectedStocks": ["SYMBOL1", ...]
}`;

export async function GET(req: Request) {
  const startTime = Date.now();
  const { searchParams } = new URL(req.url);
  const symbolsParam = searchParams.get("symbols"); // comma-separated, e.g. "ENGRO,HUBC"
  const limit = Math.min(Number(searchParams.get("limit") || "3"), 5); // news per stock

  // Determine symbols to process — default to all 8 covered stocks
  const symbols = symbolsParam
    ? symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : MOCK_STOCKS.map((s) => s.symbol);

  if (symbols.length === 0) {
    return NextResponse.json({ error: "No symbols provided" }, { status: 400 });
  }

  const digest: NewsDigestResponse[] = [];

  for (const symbol of symbols) {
    const stock = MOCK_STOCKS.find((s) => s.symbol === symbol);
    const stockName = stock?.name || symbol;

    // Step 1: Fetch news for this symbol from askanalyst.com.pk
    let newsItems: NewsItem[] = [];
    try {
      const res = await fetch(
        `https://api.askanalyst.com.pk/api/news/${encodeURIComponent(symbol)}`,
        { headers: { "User-Agent": "LatentBot/1.0", "Accept": "application/json" } }
      );
      if (res.ok) {
        const data = await res.json();
        // Handle various response shapes (array, object with news array, etc.)
        if (Array.isArray(data)) {
          newsItems = data.slice(0, limit);
        } else if (Array.isArray(data?.news)) {
          newsItems = data.news.slice(0, limit);
        } else if (Array.isArray(data?.data)) {
          newsItems = data.data.slice(0, limit);
        }
      }
    } catch (err) {
      console.warn(`[news-digest] Failed to fetch news for ${symbol}:`, err);
    }

    if (newsItems.length === 0) {
      digest.push({
        symbol,
        stockName,
        newsCount: 0,
        interpretedItems: [],
        source: "askanalyst.com.pk",
        fetchedAt: new Date().toISOString(),
        cached: false,
      });
      continue;
    }

    // Step 2: For each news item, check cache → call LLM if not cached
    const interpretedItems: InterpretedNewsItem[] = [];

    for (const item of newsItems) {
      const cacheKey = `llm:news-digest:${symbol}:${hashString(item.title || item.link || "")}`;
      const cached = await cacheGetJSON<InterpretedNewsItem>(cacheKey);

      if (cached) {
        interpretedItems.push({ ...cached, symbol });
        continue;
      }

      // Call LLM to interpret
      try {
        const client = await ZAI.create();
        const userMessage = `Stock: ${symbol} — ${stockName}\nSector: ${stock?.sector || "unknown"}\n\nNews headline: ${item.title || "(no headline)"}\nSummary: ${item.summary || "(no summary available)"}\nSource: ${item.source || "unknown"}\n\nGenerate the JSON object per your system instructions. Focus the analysis on ${symbol}.`;

        const messages: ChatMessage[] = [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ];

        const completion = await client.chat.completions.create({
          messages,
          temperature: 0.3,
          max_tokens: 400,
        });

        const rawContent: string = completion?.choices?.[0]?.message?.content || "";
        const parsed = parseJsonFromLlm(rawContent);

        if (parsed) {
          const interpreted: InterpretedNewsItem = {
            ...item,
            symbol,
            impact: parsed.impact || "neutral",
            impactStrength: parsed.impactStrength || "weak",
            laymanExplanation: parsed.laymanExplanation || "",
            shortTermOutlook: parsed.shortTermOutlook || "",
            affectedStocks: Array.isArray(parsed.affectedStocks) ? parsed.affectedStocks : [symbol],
          };
          interpretedItems.push(interpreted);
          // Cache for 24 hours
          await cacheSetJSON(cacheKey, interpreted, 24 * 60 * 60);
        }
      } catch (err) {
        console.warn(`[news-digest] LLM call failed for ${symbol} news:`, err);
      }
    }

    digest.push({
      symbol,
      stockName,
      newsCount: newsItems.length,
      interpretedItems,
      source: "askanalyst.com.pk + GLM-4",
      fetchedAt: new Date().toISOString(),
      cached: interpretedItems.length > 0 && interpretedItems.length < newsItems.length,
    });
  }

  return NextResponse.json({
    digest,
    symbolsProcessed: symbols.length,
    totalNewsItems: digest.reduce((s, d) => s + d.newsCount, 0),
    totalInterpreted: digest.reduce((s, d) => s + d.interpretedItems.length, 0),
    latencyMs: Date.now() - startTime,
    model: "glm-4-plus",
  });
}

function hashString(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function parseJsonFromLlm(raw: string): any | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1]);
      } catch {
        /* fall through */
      }
    }
    const braceMatch = raw.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[0]);
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}
