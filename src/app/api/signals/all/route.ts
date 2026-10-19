import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { cacheGetJSON, cacheSetJSON } from "@/lib/latent/cache";
import {
  ALL_MODELS,
  type ModelPrediction,
  majorityVoteEnsemble,
  probabilityWeightedEnsemble,
  tierWeightedEnsemble,
  computeFinalConsensus,
  type EnsembleResult,
} from "@/lib/latent/ensemble";

// Batch signals endpoint — iterates all 361 stocks in ml_predictions_multi.json,
// computes the SAME `finalConsensus` value used by /api/ai-model-signals/[symbol]
// (so the Signals tab and AI Models tab always agree), filters to BUY/SELL signals
// with R:R ≥ 1:2 (reward ≥ 2× risk, using TP3 (21-day target) as the reward target),
// and returns the list sorted by R:R descending.
//
// This endpoint is the single source of truth for both the Dashboard's "active
// signals" count and the SignalSection's signal grid — so the two views always
// agree on what counts as an actionable signal.
//
// Algorithm:
//   1. Read ml_predictions_multi.json
//   2. For each symbol present in cl_ensemble_predictions OR cl_extender_predictions:
//      - Build the per-model predictions array (same as the AI Models tab does)
//      - Compute Majority Vote, Probability-Weighted, Tier-Weighted ensembles
//      - Append CL-Ensemble and CL-Extender entries from the file
//      - Compute finalConsensus across all 5 ensembles
//      - Skip if finalConsensus.signal is HOLD or invalid
//      - Compute R:R = |tp3 - entry| / |entry - sl|
//      - Skip if R:R < 2 (sub-1:2 setups filtered out)
//   3. Return sorted by R:R descending

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CACHE_KEY = "signals:all";
const MIN_RISK_REWARD = 1.99; // 1:2 minimum → reward ≥ 2× risk (1.99 to avoid floating-point edge cases like PRL's 1.9999999)

export interface StockSignalSummary {
  symbol: string;
  stockName: string;
  signal: "BUY" | "SELL";
  direction: "LONG" | "SHORT";
  confidence: number;
  currentPrice: number;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  riskReward: number; // |tp3 - entry| / |entry - sl|
  avgReturn: number;
  // provenance — for debugging & UI display
  ensembleBuyCount: number; // how many of the 5 ensembles voted BUY
  ensembleSellCount: number; // how many of the 5 ensembles voted SELL
  ensembleHoldCount: number; // how many of the 5 ensembles voted HOLD
  modelBuyCount: number; // how many of the 22 trained models voted BUY
  modelSellCount: number; // how many of the 22 trained models voted SELL
  modelHoldCount: number; // how many of the 22 trained models voted HOLD
}

function computeRiskReward(entry: number, tp3: number, sl: number): number {
  const reward = Math.abs(tp3 - entry);
  const risk = Math.abs(entry - sl);
  if (risk <= 0) return 0;
  return reward / risk;
}

// Build per-symbol ModelPrediction[] — same logic as
// /api/ai-model-signals/[symbol]/route.ts. We inline it here (instead of importing
// from a shared lib) to keep the batch endpoint self-contained and avoid a hot
// dependency on the per-symbol route's shape.
function buildPredictionsForSymbol(
  symbol: string,
  multi: any
): ModelPrediction[] {
  const models: Record<string, any> | undefined = multi?.models;
  if (!models) return [];

  return ALL_MODELS.map((meta) => {
    const lookupName = meta.name.replace(" (CL)", "");
    const nk = lookupName.replace(/\s+/g, "");
    const md = models[lookupName] || models[nk] || models[meta.name];
    if (!md?.trained) {
      return { ...meta, trained: false, untrainedReason: meta.untrainedReason };
    }
    const p = md.predictions?.[symbol];
    if (!p) {
      return { ...meta, trained: true, untrainedReason: `No prediction for ${symbol}` };
    }
    const bt =
      multi?.backtesting?.[lookupName] ||
      multi?.backtesting?.[nk] ||
      multi?.backtesting?.[meta.name];
    return {
      ...meta,
      trained: true,
      direction: p.direction,
      signal: p.signal,
      confidence: p.confidence,
      currentPrice: p.currentPrice,
      entry: p.entry,
      sl: p.sl,
      tp1: p.tp1,
      tp2: p.tp2,
      tp3: p.tp3,
      avgReturn: p.avgReturn,
      metrics: md.metrics,
      backtest: bt,
    } as ModelPrediction;
  });
}

// Build the 6-ensemble list for a symbol — same logic as
// /api/ai-model-signals/[symbol]/route.ts (3 base + CL-Ensemble + CL-Extender + CL-2).
function buildEnsemblesForSymbol(
  symbol: string,
  predictions: ModelPrediction[],
  multi: any
): EnsembleResult[] {
  const baseEnsembles: EnsembleResult[] = [
    majorityVoteEnsemble(predictions),
    probabilityWeightedEnsemble(predictions),
    tierWeightedEnsemble(predictions),
  ];

  const clEnsPred = multi?.cl_ensemble_predictions?.[symbol];
  const clExtPred = multi?.cl_extender_predictions?.[symbol];
  const cl2EnsPred = multi?.cl2_ensemble_predictions?.[symbol];

  const ensembles: EnsembleResult[] = [...baseEnsembles];

  if (clEnsPred) {
    ensembles.push({
      method: "CL_ENSEMBLE",
      methodLabel: "D. CL-Ensemble (LGB70+Log30)",
      signal: clEnsPred.signal as EnsembleResult["signal"],
      direction: clEnsPred.direction as EnsembleResult["direction"],
      confidence: clEnsPred.confidence,
      predictedPrice: clEnsPred.tp3,
      entry: clEnsPred.entry,
      sl: clEnsPred.sl,
      tp1: clEnsPred.tp1,
      tp2: clEnsPred.tp2,
      tp3: clEnsPred.tp3,
      modelCount: 2,
      buyCount: 0,
      sellCount: 0,
      holdCount: 0,
    });
  }

  if (clExtPred) {
    ensembles.push({
      method: "CL_EXTENDER",
      methodLabel: "E. CL-Extender (8-model weighted)",
      signal: clExtPred.signal as EnsembleResult["signal"],
      direction: clExtPred.direction as EnsembleResult["direction"],
      confidence: clExtPred.confidence,
      predictedPrice: clExtPred.tp3,
      entry: clExtPred.entry,
      sl: clExtPred.sl,
      tp1: clExtPred.tp1,
      tp2: clExtPred.tp2,
      tp3: clExtPred.tp3,
      modelCount: 8,
      buyCount: 0,
      sellCount: 0,
      holdCount: 0,
    });
  }

  // CL-2 Ensemble: 7 CPU classifiers + logistic meta on OOF predictions,
  // calibrated via decile binning. SL rule: support/ATR. Target: TP1 hit
  // before SL in 5 days. Exits: 50%@TP1, 30%@TP2, 20%@TP3, SL→BE after TP1.
  if (cl2EnsPred) {
    ensembles.push({
      method: "CL2_ENSEMBLE",
      methodLabel: "F. CL-2 Ensemble (7 classifiers + logistic meta, calibrated)",
      signal: cl2EnsPred.signal as EnsembleResult["signal"],
      direction: cl2EnsPred.direction as EnsembleResult["direction"],
      confidence: cl2EnsPred.confidence,
      predictedPrice: cl2EnsPred.tp3,
      entry: cl2EnsPred.entry,
      sl: cl2EnsPred.sl,
      tp1: cl2EnsPred.tp1,
      tp2: cl2EnsPred.tp2,
      tp3: cl2EnsPred.tp3,
      modelCount: 7,
      buyCount: 0,
      sellCount: 0,
      holdCount: 0,
    });
  }

  return ensembles;
}

function buildSignalList(multi: any): StockSignalSummary[] {
  const clEns: Record<string, any> | undefined = multi?.cl_ensemble_predictions;
  const clExt: Record<string, any> | undefined = multi?.cl_extender_predictions;
  const cl2Ens: Record<string, any> | undefined = multi?.cl2_ensemble_predictions;
  if (!clEns && !clExt && !cl2Ens) return [];

  // Union of all symbols — covers every stock that has any ensemble prediction
  // in the file (i.e. every stock the training scripts saw).
  const symbolSet = new Set<string>([
    ...Object.keys(clEns || {}),
    ...Object.keys(clExt || {}),
    ...Object.keys(cl2Ens || {}),
  ]);

  const out: StockSignalSummary[] = [];

  for (const symbol of symbolSet) {
    // Step 1: build per-model predictions (same as AI Models tab)
    const predictions = buildPredictionsForSymbol(symbol, multi);
    if (predictions.length === 0) continue;

    // Step 2: build the 5-ensemble list (Majority Vote, Prob-Weighted, Tier-Weighted, CL-Ensemble, CL-Extender)
    const ensembles = buildEnsemblesForSymbol(symbol, predictions, multi);
    if (ensembles.length === 0) continue;

    // Step 3: compute finalConsensus (same as AI Models tab)
    const fc = computeFinalConsensus(ensembles);
    if (!fc) continue;
    if (fc.signal !== "BUY" && fc.signal !== "SELL") continue;

    // Step 4: validate trade params (avoid div-by-zero / junk entries)
    const entry = typeof fc.entry === "number" ? fc.entry : 0;
    const sl = typeof fc.sl === "number" ? fc.sl : 0;
    const tp1 = typeof fc.tp1 === "number" ? fc.tp1 : 0;
    const tp2 = typeof fc.tp2 === "number" ? fc.tp2 : 0;
    const tp3 = typeof fc.tp3 === "number" ? fc.tp3 : 0;
    if (entry <= 0 || sl <= 0 || tp3 <= 0) continue;

    // Step 5: R:R filter (≥ 1:2 using TP3 as reward target)
    const rr = computeRiskReward(entry, tp3, sl);
    if (rr < MIN_RISK_REWARD) continue;

    // Resolve currentPrice: prefer the CL-Ensemble currentPrice (matches what
    // the per-stock endpoint returns as `data.currentPrice`), fallback to any
    // model's currentPrice, fallback to entry.
    let currentPrice = 0;
    const clEnsPred = clEns?.[symbol];
    const clExtPred = clExt?.[symbol];
    if (clEnsPred && typeof clEnsPred.currentPrice === "number" && clEnsPred.currentPrice > 0) {
      currentPrice = clEnsPred.currentPrice;
    } else if (clExtPred && typeof clExtPred.currentPrice === "number" && clExtPred.currentPrice > 0) {
      currentPrice = clExtPred.currentPrice;
    } else {
      for (const p of predictions) {
        if (typeof p.currentPrice === "number" && p.currentPrice > 0) {
          currentPrice = p.currentPrice;
          break;
        }
      }
    }
    if (!currentPrice) currentPrice = entry;

    // Avg return across trained models that reported one — for the UI reason string
    const avgReturns = predictions
      .filter((p) => p.trained && typeof p.avgReturn === "number")
      .map((p) => p.avgReturn as number);
    const avgReturn =
      avgReturns.length > 0 ? avgReturns.reduce((s, v) => s + v, 0) / avgReturns.length : 0;

    // Per-model vote counts — useful for the UI's "X / 22 models" tooltip
    const trainedPredictions = predictions.filter((p) => p.trained && p.signal);
    const modelBuyCount = trainedPredictions.filter((p) => p.signal === "BUY").length;
    const modelSellCount = trainedPredictions.filter((p) => p.signal === "SELL").length;
    const modelHoldCount = trainedPredictions.filter((p) => p.signal === "HOLD").length;

    // Per-ensemble vote counts — useful for the UI's "X / 5 ensembles" tooltip
    const ensembleBuyCount = ensembles.filter((e) => e.signal === "BUY").length;
    const ensembleSellCount = ensembles.filter((e) => e.signal === "SELL").length;
    const ensembleHoldCount = ensembles.filter((e) => e.signal === "HOLD").length;

    out.push({
      symbol,
      stockName: symbol, // client resolves full name via StockSearch/companies API
      signal: fc.signal as "BUY" | "SELL",
      direction: fc.direction === "SHORT" ? "SHORT" : "LONG",
      confidence: fc.confidence,
      currentPrice,
      entry,
      sl,
      tp1,
      tp2,
      tp3,
      riskReward: rr,
      avgReturn,
      ensembleBuyCount,
      ensembleSellCount,
      ensembleHoldCount,
      modelBuyCount,
      modelSellCount,
      modelHoldCount,
    });
  }

  // Sort by R:R descending (highest reward-to-risk first)
  out.sort((a, b) => b.riskReward - a.riskReward);
  return out;
}

export async function GET(req: Request) {
  const start = Date.now();

  // Cache for 5 minutes — the underlying predictions file is regenerated by a
  // daily cron, so caching the filtered list keeps the dashboard snappy.
  // The `?refresh=1` query param forces a cache-bypass, used by the
  // SignalSection's "Refresh signals" button.
  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";
  if (refresh) {
    // Bust the cache — caller explicitly wants fresh data
  } else {
    const cached = await cacheGetJSON<{ signals: StockSignalSummary[]; generatedAt: string }>(CACHE_KEY);
    if (cached) {
      return NextResponse.json({
        ...cached,
        cached: true,
        latencyMs: Date.now() - start,
      });
    }
  }

  let multi: any = null;
  try {
    const filePath = path.join(process.cwd(), "data", "ml_predictions_multi.json");
    multi = JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch {
    return NextResponse.json(
      { error: "Predictions file not found. Run: python3 scripts/train_all_with_backtesting.py" },
      { status: 503 }
    );
  }

  const signals = buildSignalList(multi);
  const resp = {
    signals,
    count: signals.length,
    buyCount: signals.filter((s) => s.signal === "BUY").length,
    sellCount: signals.filter((s) => s.signal === "SELL").length,
    minRiskReward: MIN_RISK_REWARD,
    generatedAt: multi?.trained_at || new Date().toISOString(),
    stocksScanned: Object.keys({
      ...(multi?.cl_ensemble_predictions || {}),
      ...(multi?.cl_extender_predictions || {}),
      ...(multi?.cl2_ensemble_predictions || {}),
    }).length,
    // Method disclosure — so the UI can show "Source: Final Consensus (6 ensembles)"
    method: "finalConsensus",
    ensemblesConsidered: [
      "Majority Vote",
      "Probability-Weighted",
      "Tier-Weighted",
      "CL-Ensemble",
      "CL-Extender",
      "CL-2 Ensemble",
    ],
  };

  await cacheSetJSON(CACHE_KEY, resp, 300); // 5-minute TTL
  return NextResponse.json({ ...resp, cached: false, latencyMs: Date.now() - start });
}
