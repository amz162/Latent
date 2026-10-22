import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import * as cheerio from "cheerio";
import ZAI from "z-ai-web-dev-sdk";
import type { ChatMessage } from "z-ai-web-dev-sdk";
import { cacheGetJSON, cacheSetJSON } from "@/lib/latent/cache";

// Latent.pk LLM API — News Interpretation Endpoint
// Uses GLM-4-Plus (Z.ai's open-weights model family) — NOT ChatGPT or Claude.
// Cached by content hash via shared cache (Redis in production, in-memory in dev).
//
// To swap to a different LLM in production (e.g., self-hosted Ollama + Llama 3.2),
// replace the ZAI client initialization below with:
//   const resp = await fetch("http://localhost:11434/api/chat", {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({
//       model: "llama3.2:3b",
//       messages: [...],
//       stream: false,
//       format: "json",
//     }),
//   });
//
// The rest of the architecture (prompts, response parsing, UI integration)
// stays identical — only the LLM call changes.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 hours (news doesn't change)
function cacheKeyFor(req: InterpretRequest): string {
  // Hash the input to deduplicate identical interpretations
  const content = `${req.headline || ""}|${req.summary || ""}|${req.link || ""}`;
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
  }
  return `llm:interpret-news:${Math.abs(hash).toString(36)}`;
}

interface InterpretRequest {
  headline?: string;
  summary?: string;
  link?: string;
  rawArticleText?: string;
}

interface InterpretResponse {
  impact: "positive" | "negative" | "neutral";
  impactStrength: "weak" | "moderate" | "strong";
  affectedStocks: string[];
  sectorBreakdown: { sector: string; stocks: string[] }[];
  laymanExplanation: string;
  shortTermOutlook: string;
  riskFactors: string[];
  model: string;
  latencyMs: number;
}

const SYSTEM_PROMPT = `You are Latent.pk's financial news analyst for the Pakistan Stock Exchange (PSX). Your job is to interpret news articles for retail investors in Pakistan who have low financial literacy.

CRITICAL RULES:
1. Output ONLY valid JSON — no markdown, no commentary, no trailing text.
2. NEVER make explicit BUY/SELL recommendations — that's the job of the XGBoost signal model, not you.
3. Stick to PSX-listed stocks (KSE-100) — only mention companies that actually trade on PSX.
4. Be conservative: if you're not sure of the impact, say "neutral" not "positive"/"negative".
5. Use layman language in the explanation — avoid jargon like "P/E expansion", "multiple re-rating", "yield curve".
6. Explain WHY the news matters, not just WHAT it is.
7. If the article is about non-Pakistan or non-financial topics, return impact "neutral" and a short explanation.

PSX sector reference for categorization:
- Banking: MEEZAN (MEBL), HBL, MCB, UBL, BAFL, NBP
- Energy (E&P): OGDC, PPL, POL
- Energy (Marketing): PSO, APL, SHEL, SNGP, SSGC
- Power: HUBC, KAPCO, NPL, LPL
- Cement: LUCK, DGKC, MLCF, CHCC, FCCL
- Fertilizer: ENGRO, FFBL, FATIMA, FFC
- Tech: SYS, AVN, TRSM, PICT
- Auto: HCAR, INDU, PSMC, MTL
- Pharma: GLAXO, ABOT, SEARL
- Steel: ISPK, ASTL, MUGHAL

Your JSON output shape:
{
  "impact": "positive" | "negative" | "neutral",
  "impactStrength": "weak" | "moderate" | "strong",
  "affectedStocks": ["SYMBOL1", "SYMBOL2", ...],
  "sectorBreakdown": [{"sector": "Banking", "stocks": ["MEBL", "HBL"]}, ...],
  "laymanExplanation": "2-4 sentence plain-English explanation of WHY this news matters and how it could affect the listed stocks",
  "shortTermOutlook": "1-2 sentence outlook for the next trading session (be conservative)",
  "riskFactors": ["risk 1", "risk 2", ...]
}`;

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    const body: InterpretRequest = await req.json();

    // Validation: require at least a headline, rawArticleText, OR a link
    // (the link will be fetched below to extract article content)
    if (!body.headline && !body.rawArticleText && !body.link) {
      return NextResponse.json(
        { error: "Either 'headline', 'rawArticleText', or 'link' is required" },
        { status: 400 }
      );
    }

    // If only a link is provided (no headline, no rawArticleText), fetch the
    // article HTML and extract the title + main text so the LLM has content to
    // interpret. This fixes the "paste a link → click Interpret" flow.
    if (body.link && !body.headline && !body.rawArticleText) {
      const extracted = await fetchArticleFromLink(body.link);
      if (extracted) {
        body.headline = body.headline || extracted.headline;
        body.rawArticleText = extracted.rawArticleText;
      }
      // If extraction failed, fall back to using the URL itself as the
      // "headline" so the LLM at least has *some* input to reason about.
      if (!body.headline && !body.rawArticleText) {
        body.headline = body.link;
      }
    }

    // Check cache by content hash
    const cacheKey = cacheKeyFor(body);
    const cached = await cacheGetJSON<InterpretResponse>(cacheKey);
    if (cached) {
      return NextResponse.json({
        ...cached,
        model: cached.model + " (cached)",
        latencyMs: Date.now() - startTime,
        cached: true,
      });
    }

    // Initialize the ZAI SDK — reads from /etc/.z-ai-config
    const client = await ZAI.create();

    const userMessage = buildUserMessage(body);

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ];

    const completion = await client.chat.completions.create({
      messages,
      temperature: 0.3,
      max_tokens: 800,
    });

    const rawContent: string =
      completion?.choices?.[0]?.message?.content || "";

    // Parse the LLM's JSON output (it may have code-fence wrappers)
    const parsed = parseJsonFromLlm(rawContent);

    if (!parsed) {
      // Fallback: if LLM didn't return valid JSON, return a neutral response
      return NextResponse.json({
        impact: "neutral" as const,
        impactStrength: "weak" as const,
        affectedStocks: [],
        sectorBreakdown: [],
        laymanExplanation:
          "The model could not produce a structured interpretation. This is unusual — try again or paste a clearer article.",
        shortTermOutlook: "Insufficient signal to forecast.",
        riskFactors: ["Model output parsing failed"],
        model: completion?.model || "glm-4-plus",
        latencyMs: Date.now() - startTime,
      } as InterpretResponse);
    }

    // Cache it for 24 hours before returning
    await cacheSetJSON(cacheKey, parsed, CACHE_TTL_SECONDS);

    return NextResponse.json({
      ...parsed,
      model: completion?.model || "glm-4-plus",
      latencyMs: Date.now() - startTime,
      cached: false,
    } as InterpretResponse & { cached: boolean });
  } catch (err) {
    console.error("[/api/llm/interpret-news] error:", err);
    return NextResponse.json(
      {
        error: "LLM interpretation failed",
        detail: err instanceof Error ? err.message : "Unknown error",
        latencyMs: Date.now() - startTime,
      },
      { status: 502 }
    );
  }
}

// Fetch an article from a URL and extract the headline + main text content.
// Used when the user only pastes a link (no headline/rawArticleText provided).
async function fetchArticleFromLink(
  link: string
): Promise<{ headline: string; rawArticleText: string } | null> {
  try {
    const res = await fetch(link, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; LatentBot/1.0; +https://latent.pk)",
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
      // Defensive timeout via AbortController — don't let slow upstreams
      // block the whole LLM request.
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    // Extract headline: prefer OpenGraph/twitter title, fall back to <title>, <h1>
    const headline =
      $('meta[property="og:title"]').attr("content")?.trim() ||
      $('meta[name="twitter:title"]').attr("content")?.trim() ||
      $("title").first().text().trim() ||
      $("h1").first().text().trim() ||
      "";

    // Extract main text: collect <p> tags inside <article> or <main>, fall back
    // to all <p> tags. Strip scripts/styles/nav noise.
    $("script, style, nav, footer, header, aside, form").remove();
    const paragraphs: string[] = [];
    const collect = (selector: string) =>
      $(selector).find("p").each((_, el) => {
        const text = $(el).text().trim();
        if (text.length > 40) paragraphs.push(text); // skip short fragments
      });
    if ($("article").first().length) {
      collect("article");
    } else if ($("main").first().length) {
      collect("main");
    } else {
      // Whole document fallback
      $("p").each((_, el) => {
        const text = $(el).text().trim();
        if (text.length > 40) paragraphs.push(text);
      });
    }
    const rawArticleText = paragraphs.slice(0, 15).join("\n\n");

    if (!headline && !rawArticleText) return null;
    return { headline, rawArticleText };
  } catch (err) {
    console.error("[/api/llm/interpret-news] article fetch failed:", err);
    return null;
  }
}

function buildUserMessage(body: InterpretRequest): string {
  const parts: string[] = [];
  if (body.headline) parts.push(`Headline: ${body.headline}`);
  if (body.summary) parts.push(`Summary: ${body.summary}`);
  if (body.link) parts.push(`Source URL: ${body.link}`);
  if (body.rawArticleText) parts.push(`Article text:\n${body.rawArticleText.slice(0, 3000)}`);
  parts.push(
    "\nAnalyze this news for the Pakistan Stock Exchange (PSX). Return the JSON object per the schema in your system instructions."
  );
  return parts.join("\n\n");
}

function parseJsonFromLlm(raw: string): Partial<InterpretResponse> | null {
  if (!raw) return null;
  // Try direct parse first
  try {
    return JSON.parse(raw);
  } catch {
    // Try to extract from code fences
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      try {
        return JSON.parse(fenceMatch[1]);
      } catch {
        /* fall through */
      }
    }
    // Try to find first { ... } block
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
