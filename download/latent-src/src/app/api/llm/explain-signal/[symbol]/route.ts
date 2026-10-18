import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import ZAI from "z-ai-web-dev-sdk";
import type { ChatMessage } from "z-ai-web-dev-sdk";
import { cacheGetJSON, cacheSetJSON } from "@/lib/latent/cache";

// Latent.pk LLM API — Signal Explanation Enrichment
// Takes the XGBoost signal output for a symbol and asks the LLM to generate
// a richer layman explanation. Cached for 1 hour per symbol via shared cache
// (Redis in production, in-memory in dev).
//
// Uses GLM-4-Plus (Z.ai's open-weights model) — NOT ChatGPT or Claude.
// See /api/llm/interpret-news/route.ts for the production swap-in path to
// self-hosted Ollama + Llama 3.2.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ────────────────────────────────────────────────────────────
// Cache key + TTL
// ────────────────────────────────────────────────────────────
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour
const cacheKey = (symbol: string) => `llm:explain-signal:${symbol}`;

// ────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────

interface PredictionEntry {
  direction: "LONG" | "SHORT";
  horizon: string;
  confidence: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  model_probability_up: number;
  latest_features: {
    rsi_14: number;
    macd_hist: number;
    bb_pct_b: number;
    atr_14: number;
    return_14d: number;
    volatility_14d: number;
  };
}

interface PredictionsFile {
  model_version: string;
  trained_at: string;
  metrics: {
    accuracy: number;
    precision: number;
    recall: number;
    f1: number;
    roc_auc: number | null;
  };
  predictions: Record<string, PredictionEntry>;
}

interface LlmSignalExplanation {
  summary: string;
  technicalLayman: string;
  fundamentalContext: string;
  newsContext: string;
  actionLayman: string;
  riskFactors: string[];
  watchLevels: { level: string; price: number; significance: string }[];
  confidenceInterpretation: string;
}

interface ExplainResponse extends LlmSignalExplanation {
  symbol: string;
  direction: string;
  horizon: string;
  confidence: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  model: string;
  latencyMs: number;
  cached: boolean;
  cachedUntil: string;
}

const STOCK_NAMES: Record<string, string> = {
  ENGRO: "Engro Corporation Limited",
  HUBC: "Hub Power Company Limited",
  LUCK: "Lucky Cement Limited",
  SYS: "Systems Limited",
  MEBL: "Meezan Bank Limited",
  PSO: "Pakistan State Oil Company Limited",
  OGDC: "Oil & Gas Development Company Limited",
  PPL: "Pakistan Petroleum Limited",
};

const STOCK_SECTORS: Record<string, string> = {
  ENGRO: "Conglomerate (fertilizers, foods, petrochemicals)",
  HUBC: "Power generation",
  LUCK: "Cement manufacturing",
  SYS: "Information technology services",
  MEBL: "Islamic banking",
  PSO: "Energy marketing (petroleum products)",
  OGDC: "Oil & gas exploration",
  PPL: "Oil & gas exploration",
};

const SYSTEM_PROMPT = `You are Latent.pk's investment analyst for the Pakistan Stock Exchange (PSX). Your job is to take the output of our XGBoost signal model and explain it in plain, accessible language for retail Pakistani investors with low financial literacy.

CRITICAL RULES:
1. Output ONLY valid JSON — no markdown, no commentary outside the JSON.
2. NEVER override the model's direction (LONG/SHORT). The model is the source of truth for the directional call — your job is to explain WHY, not to second-guess.
3. If model confidence is below 60%, be explicit about that uncertainty in the summary and confidenceInterpretation fields. Don't pretend a 50% confidence call is a strong signal.
4. Use layman language. Define any technical term you use in 1 short clause (e.g., "RSI of 75 means the stock has risen fast recently — overbought territory, may pull back").
5. Reference PSX context where relevant (PKR amounts, Pakistani fiscal calendar, SBP rate environment, etc.).
6. Don't make up specific news events. Use generic phrasing like "recent corporate actions or sector news" unless you're sure.
7. The risk factors should be specific to THIS trade setup, not generic stock-market risks.
8. watchLevels should be 2-3 specific price levels derived from the entry/target/stop — not made-up round numbers.

Your JSON output shape (follow exactly):
{
  "summary": "2-3 sentence overview of what the model is saying about this stock and why",
  "technicalLayman": "3-4 sentences explaining the technical readings (RSI, MACD, Bollinger, momentum, volatility) in plain language",
  "fundamentalContext": "2-3 sentences about what the company does, its sector, and the fundamental backdrop (don't fabricate specific quarterly numbers)",
  "newsContext": "1-2 sentences about the kind of news that would be relevant to watch for this stock (don't invent specific headlines)",
  "actionLayman": "Step-by-step plain-English instructions: what price to enter at, what target to aim for, what stop-loss to set, and how long to hold",
  "riskFactors": ["specific risk 1", "specific risk 2", "specific risk 3-4 total"],
  "watchLevels": [
    {"level": "Resistance", "price": 123.45, "significance": "why this level matters"},
    {"level": "Support", "price": 110.00, "significance": "why this level matters"},
    {"level": "Target", "price": 130.00, "significance": "first take-profit zone"}
  ],
  "confidenceInterpretation": "1-2 sentences on what the model's confidence score actually means and how the user should weight it in their decision"
}`;

// ────────────────────────────────────────────────────────────
// Main handler
// ────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const startTime = Date.now();
  const { symbol } = await params;
  const symbolUpper = symbol.toUpperCase();

  // Check cache first
  const cachedResult = await cacheGetJSON<LlmSignalExplanation>(cacheKey(symbolUpper));
  if (cachedResult) {
    return NextResponse.json({
      ...cachedResult,
      symbol: symbolUpper,
      model: "glm-4-plus (cached)",
      latencyMs: Date.now() - startTime,
      cached: true,
      cachedUntil: new Date(Date.now() + CACHE_TTL_SECONDS * 1000).toISOString(),
    } as ExplainResponse);
  }

  // Load predictions
  let predictions: PredictionsFile | null = null;
  try {
    const filePath = path.join(process.cwd(), "data", "ml_predictions.json");
    const content = await fs.readFile(filePath, "utf-8");
    predictions = JSON.parse(content);
  } catch (err) {
    console.error("[/api/llm/explain-signal] Failed to load predictions:", err);
    return NextResponse.json(
      { error: "Predictions file not found. Run: python3 scripts/train_xgboost.py" },
      { status: 503 }
    );
  }

  const pred = predictions?.predictions?.[symbolUpper];
  if (!pred) {
    return NextResponse.json(
      { error: `No prediction for ${symbolUpper}. Available: ${Object.keys(predictions?.predictions || {}).join(", ")}` },
      { status: 404 }
    );
  }

  // Build user prompt
  const userMessage = buildUserMessage(symbolUpper, pred);

  try {
    const client = await ZAI.create();
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ];

    const completion = await client.chat.completions.create({
      messages,
      temperature: 0.4,
      max_tokens: 1000,
    });

    const rawContent: string =
      completion?.choices?.[0]?.message?.content || "";

    const parsed = parseJsonFromLlm(rawContent);

    if (!parsed) {
      return NextResponse.json(
        {
          error: "LLM output parsing failed",
          raw: rawContent.slice(0, 500),
          latencyMs: Date.now() - startTime,
        },
        { status: 502 }
      );
    }

    // Build the full response
    const result: LlmSignalExplanation = {
      summary: parsed.summary || "",
      technicalLayman: parsed.technicalLayman || "",
      fundamentalContext: parsed.fundamentalContext || "",
      newsContext: parsed.newsContext || "",
      actionLayman: parsed.actionLayman || "",
      riskFactors: Array.isArray(parsed.riskFactors) ? parsed.riskFactors : [],
      watchLevels: Array.isArray(parsed.watchLevels) ? parsed.watchLevels : [],
      confidenceInterpretation: parsed.confidenceInterpretation || "",
    };

    // Cache it
    await cacheSetJSON(cacheKey(symbolUpper), result, CACHE_TTL_SECONDS);

    return NextResponse.json({
      ...result,
      symbol: symbolUpper,
      direction: pred.direction,
      horizon: pred.horizon,
      confidence: pred.confidence,
      entryPrice: pred.entryPrice,
      targetPrice: pred.targetPrice,
      stopLoss: pred.stopLoss,
      model: completion?.model || "glm-4-plus",
      latencyMs: Date.now() - startTime,
      cached: false,
      cachedUntil: new Date(Date.now() + CACHE_TTL_SECONDS * 1000).toISOString(),
    } as ExplainResponse);
  } catch (err) {
    console.error("[/api/llm/explain-signal] LLM call failed:", err);
    return NextResponse.json(
      {
        error: "LLM call failed",
        detail: err instanceof Error ? err.message : "Unknown",
        latencyMs: Date.now() - startTime,
      },
      { status: 502 }
    );
  }
}

function buildUserMessage(symbol: string, pred: PredictionEntry): string {
  const name = STOCK_NAMES[symbol] || symbol;
  const sector = STOCK_SECTORS[symbol] || "general industry";

  return `Analyze the XGBoost signal model output for this PSX-listed stock and generate a layman explanation.

STOCK: ${symbol} — ${name}
SECTOR: ${sector}

MODEL OUTPUT:
- Direction: ${pred.direction}
- Trade horizon: ${pred.horizon}
- Confidence: ${pred.confidence}/100
- Model probability of +5% rise within 14 days: ${(pred.model_probability_up * 100).toFixed(1)}%

TRADE PARAMETERS:
- Entry price: PKR ${pred.entryPrice}
- Target price: PKR ${pred.targetPrice}
- Stop-loss: PKR ${pred.stopLoss}

CURRENT TECHNICAL READINGS (latest bar):
- RSI (14): ${pred.latest_features.rsi_14.toFixed(1)} (0-100 scale; >70 overbought, <30 oversold)
- MACD histogram: ${pred.latest_features.macd_hist.toFixed(3)} (positive = bullish momentum, negative = bearish)
- Bollinger %B: ${pred.latest_features.bb_pct_b.toFixed(2)} (0-1; >0.8 near upper band, <0.2 near lower)
- ATR (14): ${pred.latest_features.atr_14.toFixed(2)} PKR (average daily price movement)
- 14-day return: ${pred.latest_features.return_14d.toFixed(1)}%
- 14-day volatility: ${pred.latest_features.volatility_14d.toFixed(1)}% daily

Generate the JSON object per the schema in your system instructions. Use the trade parameters and technical readings to ground your explanation. Remember: do NOT override the model's direction — your job is to explain it, not second-guess it.`;
}

function parseJsonFromLlm(raw: string): Partial<LlmSignalExplanation> | null {
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
