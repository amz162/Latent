import { NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import type { ChatMessage } from "z-ai-web-dev-sdk";
import { cacheGetJSON, cacheSetJSON } from "@/lib/latent/cache";
import { parseFinancialData, parseRatiosToQuarters, detectPattern, generatePatternSummary, type PatternRecognitionResult } from "@/lib/latent/patterns";
import { MOCK_STOCKS } from "@/lib/latent/mock-stocks";

// GET /api/pattern-recognition/[symbol]
// Fetches last 5 years (or max available) of quarterly financials from AskAnalyst,
// runs the pattern detection algorithm, then calls GLM-4 to produce a layman summary
// of the patterns + their effect on the stock in each quarter.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 hours (financials don't change often)
const cacheKey = (symbol: string) => `llm:pattern-recognition:${symbol}`;

const SYSTEM_PROMPT = `You are Latent.pk's financial analyst for the Pakistan Stock Exchange (PSX). Your job is to take quarterly financial data + a detected pattern, then explain to a retail Pakistani investor (low financial literacy) what's happening with this company.

CRITICAL RULES:
1. Output ONLY valid JSON — no markdown, no commentary outside JSON.
2. Use layman language — define any technical term in 1 short clause.
3. Reference specific quarters and specific growth numbers from the input data.
4. Don't make BUY/SELL recommendations — focus on explaining the PATTERN.
5. Pakistan-specific context: PKR amounts, fiscal calendar, SBP rate environment.
6. Don't fabricate news events — use "may be due to" language for hypotheses.

Your JSON output shape:
{
  "laymanSummary": "3-5 sentence plain-English summary of the detected pattern",
  "quarterByQuarterAnalysis": [
    {
      "period": "Q1 2024",
      "whatHappened": "1-2 sentence plain-English description of what happened this quarter",
      "whyItMatters": "1-2 sentence explanation of why this matters for the stock",
      "impactOnStock": "positive | negative | neutral"
    }
  ],
  "bestQuarterExplanation": "1-2 sentences explaining why the best quarter was strong",
  "worstQuarterExplanation": "1-2 sentences explaining why the worst quarter was weak",
  "seasonalityInsight": "1-2 sentences on any quarterly seasonality pattern detected",
  "forwardLookingConcern": "1-2 sentences on what the user should watch for in the next quarter"
}`;

interface LlmPatternResponse {
  laymanSummary: string;
  quarterByQuarterAnalysis: {
    period: string;
    whatHappened: string;
    whyItMatters: string;
    impactOnStock: "positive" | "negative" | "neutral";
  }[];
  bestQuarterExplanation: string;
  worstQuarterExplanation: string;
  seasonalityInsight: string;
  forwardLookingConcern: string;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const startTime = Date.now();
  const { symbol } = await params;
  const symbolUpper = symbol.toUpperCase();

  const stock = MOCK_STOCKS.find((s) => s.symbol === symbolUpper);
  if (!stock) {
    return NextResponse.json(
      { error: `Unknown symbol: ${symbolUpper}` },
      { status: 404 }
    );
  }

  // Check cache first
  const cachedKey = cacheKey(symbolUpper);
  const cached = await cacheGetJSON<PatternRecognitionResult & { llm: LlmPatternResponse }>(cachedKey);
  if (cached) {
    return NextResponse.json({
      ...cached,
      cached: true,
      latencyMs: Date.now() - startTime,
    });
  }

  // Step 1: Fetch historical ratios (annual EPS/DPS/BVPS data) from AskAnalyst.com.pk
  // The /api/psx/ratio/[symbol] endpoint returns REAL annual financial data going back ~10 years.
  // This is what we use for pattern detection (instead of /financialstatement which only has metadata + PDF links).
  let rawRatios: unknown = null;
  try {
    const res = await fetch(
      `http://localhost:3000/api/psx/ratio/${encodeURIComponent(symbolUpper)}`,
      { headers: { "Accept": "application/json" } }
    );
    if (res.ok) {
      rawRatios = await res.json();
    }
  } catch (err) {
    console.warn(`[pattern-recognition] Failed to fetch ratios for ${symbolUpper}:`, err);
  }

  // Step 2: Parse + run pattern detection algorithm
  const quarters = parseRatiosToQuarters(rawRatios);
  const patternData = detectPattern(quarters);
  const fallbackSummary = generatePatternSummary(symbolUpper, patternData);

  // If insufficient data, return without LLM call
  if (patternData.patternType === "INSUFFICIENT_DATA" || quarters.length < 4) {
    return NextResponse.json({
      symbol: symbolUpper,
      stockName: stock.name,
      quarters,
      pattern: patternData,
      llm: {
        laymanSummary: fallbackSummary,
        quarterByQuarterAnalysis: [],
        bestQuarterExplanation: "",
        worstQuarterExplanation: "",
        seasonalityInsight: "",
        forwardLookingConcern: "Insufficient historical data for forward-looking analysis.",
      } as LlmPatternResponse,
      cached: false,
      latencyMs: Date.now() - startTime,
      note: "Pattern recognition requires at least 4 quarters of data. Some companies (newly listed) may have less.",
    });
  }

  // Step 3: Call GLM-4 to produce layman summary
  try {
    const client = await ZAI.create();
    const userMessage = buildUserMessage(symbolUpper, stock.name, patternData);

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ];

    const completion = await client.chat.completions.create({
      messages,
      temperature: 0.4,
      max_tokens: 1200,
    });

    const rawContent: string = completion?.choices?.[0]?.message?.content || "";
    const parsed = parseJsonFromLlm(rawContent);

    const result: PatternRecognitionResult & { llm: LlmPatternResponse } = {
      symbol: symbolUpper,
      quarters,
      pattern: patternData,
      summary: parsed?.laymanSummary || fallbackSummary,
      llm: {
        laymanSummary: parsed?.laymanSummary || fallbackSummary,
        quarterByQuarterAnalysis: Array.isArray(parsed?.quarterByQuarterAnalysis) ? parsed.quarterByQuarterAnalysis : [],
        bestQuarterExplanation: parsed?.bestQuarterExplanation || "",
        worstQuarterExplanation: parsed?.worstQuarterExplanation || "",
        seasonalityInsight: parsed?.seasonalityInsight || "",
        forwardLookingConcern: parsed?.forwardLookingConcern || "",
      },
    };

    // Cache for 24 hours
    await cacheSetJSON(cachedKey, result, CACHE_TTL_SECONDS);

    return NextResponse.json({
      ...result,
      cached: false,
      latencyMs: Date.now() - startTime,
      model: completion?.model || "glm-4-plus",
    });
  } catch (err) {
    console.error("[pattern-recognition] LLM call failed:", err);
    // Fallback: return pattern detection without LLM
    return NextResponse.json({
      symbol: symbolUpper,
      stockName: stock.name,
      quarters,
      pattern: patternData,
      summary: fallbackSummary,
      llm: {
        laymanSummary: fallbackSummary,
        quarterByQuarterAnalysis: [],
        bestQuarterExplanation: "",
        worstQuarterExplanation: "",
        seasonalityInsight: "",
        forwardLookingConcern: "",
      } as LlmPatternResponse,
      cached: false,
      latencyMs: Date.now() - startTime,
      error: "LLM call failed — showing algorithm-only pattern detection",
    });
  }
}

function buildUserMessage(symbol: string, stockName: string, pattern: any): string {
  return `Analyze the quarterly financial pattern for this PSX-listed stock:

STOCK: ${symbol} — ${stockName}

DETECTED PATTERN: ${pattern.patternLabel}
PATTERN CONFIDENCE SCORE: ${pattern.patternScore}/100

KEY METRICS:
- Trend slope (EPS regression): ${pattern.trendSlope.toFixed(3)} PKR/quarter
- Coefficient of variation (lower = more stable): ${(pattern.coefficientOfVariation * 100).toFixed(1)}%
- Average YoY EPS growth: ${pattern.avgYoYGrowth !== null ? pattern.avgYoYGrowth.toFixed(1) + "%" : "n/a"}
- Average QoQ EPS growth: ${pattern.avgQoQGrowth !== null ? pattern.avgQoQGrowth.toFixed(1) + "%" : "n/a"}
- Total revenue growth (first to last quarter): ${pattern.totalRevenueGrowth !== null ? pattern.totalRevenueGrowth.toFixed(1) + "%" : "n/a"}
- EPS volatility (CV): ${(pattern.epsVolatility * 100).toFixed(1)}%

BEST QUARTER: ${pattern.bestQuarter ? `${pattern.bestQuarter.period} (YoY growth ${pattern.bestQuarter.yoyGrowth?.toFixed(1)}%)` : "n/a"}
WORST QUARTER: ${pattern.worstQuarter ? `${pattern.worstQuarter.period} (YoY growth ${pattern.worstQuarter.yoyGrowth?.toFixed(1)}%)` : "n/a"}

QUARTERLY DATA (chronological):
${pattern.quarters.map((q: any) => `  ${q.period}: Revenue=${q.revenue ? q.revenue.toLocaleString() : "n/a"}, EPS=${q.eps.toFixed(2)}, Margin=${q.profitMargin.toFixed(1)}%, YoY=${q.yoyGrowth !== null ? q.yoyGrowth.toFixed(1) + "%" : "n/a"}`).join("\n")}

SEASONALITY (avg YoY growth by calendar quarter):
${pattern.quarterlySeasonality.length > 0 ? pattern.quarterlySeasonality.map((s: any) => `  ${s.quarter}: ${s.avgGrowth.toFixed(1)}% avg`).join("\n") : "  (insufficient data)"}

Generate the JSON object per your system instructions. Provide layman-friendly analysis of what's happening quarter-by-quarter, why each quarter mattered for the stock, and what to watch for next.`;
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
