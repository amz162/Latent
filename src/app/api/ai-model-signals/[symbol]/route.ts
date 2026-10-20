import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { cacheGetJSON, cacheSetJSON, cacheDelete } from "@/lib/latent/cache";
import {
  ALL_MODELS,
  type ModelPrediction,
  majorityVoteEnsemble,
  probabilityWeightedEnsemble,
  tierWeightedEnsemble,
  computeFinalConsensus,
} from "@/lib/latent/ensemble";
import { MOCK_STOCKS } from "@/lib/latent/mock-stocks";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const CK = (s: string) => `ai-model-signals:${s}`;

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const start = Date.now();
  const { symbol } = await params;
  const sym = symbol.toUpperCase();
  const stock = MOCK_STOCKS.find((s) => s.symbol === sym);

  let stockName = stock?.name || sym;
  let currentPrice = stock?.price || 0;

  if (!stock) {
    try {
      const ohlcvText = await fs.readFile(
        path.join(process.cwd(), "data", "ohlcv_all", `${sym}.csv`),
        "utf-8"
      );
      const lines = ohlcvText.trim().split("\n");
      if (lines.length > 1) {
        const lastLine = lines[lines.length - 1].split(",");
        currentPrice = parseFloat(lastLine[4]) || 0;
      }
    } catch {
      try {
        const finText = await fs.readFile(
          path.join(process.cwd(), "data", "financials", `${sym}.json`),
          "utf-8"
        );
        const finData = JSON.parse(finText);
        stockName = finData.company_name || finData.symbol || sym;
      } catch {}
    }
  }

  const url = new URL(req.url);
  const refresh = url.searchParams.get("refresh") === "1";
  if (refresh) await cacheDelete(CK(sym));
  const cached = refresh ? null : await cacheGetJSON<any>(CK(sym));
  if (cached) return NextResponse.json({ ...cached, cached: true, latencyMs: Date.now() - start });

  let multi: any = null;
  try {
    multi = JSON.parse(
      await fs.readFile(path.join(process.cwd(), "data", "ml_predictions_multi.json"), "utf-8")
    );
  } catch {
    return NextResponse.json(
      { error: "Run: python3 scripts/train_all_with_backtesting.py" },
      { status: 503 }
    );
  }

  // Fallback: if we still don't have a currentPrice, pull from the predictions file
  if (!currentPrice) {
    const clPred = multi?.cl_ensemble_predictions?.[sym];
    if (clPred && typeof clPred.currentPrice === "number" && clPred.currentPrice > 0) {
      currentPrice = clPred.currentPrice;
    } else {
      for (const m of Object.values(multi?.models || {}) as any[]) {
        if (!m?.trained) continue;
        const p = m?.predictions?.[sym];
        if (p && typeof p.currentPrice === "number" && p.currentPrice > 0) {
          currentPrice = p.currentPrice;
          break;
        }
      }
    }
  }

  // Build per-model predictions array.
  // The lookup must handle three naming conventions for the model key in
  // ml_predictions_multi.json's `models` dict:
  //   1. "Random Forest"      → meta.name = "Random Forest" (direct match)
  //   2. "RandomForest"        → meta.name with spaces stripped (nk)
  //   3. "XGBoost (CL)"       → lookupName strips " (CL)" → "XGBoost"
  //   4. "LightGBM-A (CL-2)"  → new CL-2 suffix — the .replace(" (CL)", "")
  //                              doesn't strip " (CL-2)" so lookupName stays
  //                              as "LightGBM-A (CL-2)" which matches the
  //                              JSON key directly.
  const predictions: ModelPrediction[] = ALL_MODELS.map((meta) => {
    const lookupName = meta.name.replace(" (CL)", "");
    const nk = lookupName.replace(/\s+/g, "");
    const md = multi?.models?.[lookupName] || multi?.models?.[nk] || multi?.models?.[meta.name];
    if (!md?.trained)
      return { ...meta, trained: false, untrainedReason: meta.untrainedReason || multi?.untrained_models?.[meta.name] };
    const p = md.predictions?.[sym];
    if (!p)
      return { ...meta, trained: true, untrainedReason: `No prediction for ${sym}` };
    const bt = multi?.backtesting?.[lookupName] || multi?.backtesting?.[nk] || multi?.backtesting?.[meta.name];
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
      // Pass-through extras for CL-2 models (raw_prob, exp_win_rate, agreement)
      // — the UI can optionally display these.
      ...(p.raw_prob !== undefined ? { raw_prob: p.raw_prob } : {}),
      ...(p.exp_win_rate !== undefined ? { exp_win_rate: p.exp_win_rate } : {}),
      ...(p.agreement !== undefined ? { agreement: p.agreement } : {}),
      metrics: md.metrics,
      backtest: bt,
    } as ModelPrediction;
  });

  // ---- Build ensembles array (6 ensembles now: 3 base + CL + CL-Extender + CL-2)
  const baseEnsembles = [
    majorityVoteEnsemble(predictions),
    probabilityWeightedEnsemble(predictions),
    tierWeightedEnsemble(predictions),
  ];

  const clEnsPred = multi?.cl_ensemble_predictions?.[sym];
  const clExtPred = multi?.cl_extender_predictions?.[sym];
  const cl2EnsPred = multi?.cl2_ensemble_predictions?.[sym];
  const piEnsPred = multi?.pi_ensemble_predictions?.[sym];
  const gmEnsPred = multi?.gm_model_predictions?.[sym];
  const cgEnsPred = multi?.cg_ensemble_predictions?.[sym];
  const xEnsPred = multi?.x_ensemble_predictions?.[sym];
  const gianEnsPred = multi?.gian_ensemble_predictions?.[sym];
  const gianExtPred = multi?.gian_extender_predictions?.[sym];
  const mEnsPred = multi?.m_ensemble_predictions?.[sym];

  const clEnsEntry = clEnsPred
    ? {
        method: "CL_ENSEMBLE",
        methodLabel: "D. CL-Ensemble (LGB70+Log30)",
        signal: clEnsPred.signal as any,
        direction: clEnsPred.direction as any,
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
      }
    : null;

  const clExtEntry = clExtPred
    ? {
        method: "CL_EXTENDER",
        methodLabel: "E. CL-Extender (8-model weighted)",
        signal: clExtPred.signal as any,
        direction: clExtPred.direction as any,
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
      }
    : null;

  // CL-2 Ensemble: 7 CPU classifiers + logistic meta on OOF predictions,
  // calibrated via decile binning on OOS backtest. SL rule: support/ATR
  // (whichever closer to entry, min 0.5×ATR); target = TP1 hit before SL
  // in 5 days; exits = 50%@TP1, 30%@TP2, 20%@TP3, SL→BE after TP1.
  const cl2EnsEntry = cl2EnsPred
    ? {
        method: "CL2_ENSEMBLE",
        methodLabel: "F. CL-2 Ensemble (7 classifiers + logistic meta, calibrated)",
        signal: cl2EnsPred.signal as any,
        direction: cl2EnsPred.direction as any,
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
        // CL-2 specific transparency fields (rendered in the UI's CL-2 row)
        raw_prob: cl2EnsPred.raw_prob,
        exp_win_rate: cl2EnsPred.exp_win_rate,
        agreement: cl2EnsPred.agreement,
      }
    : null;

  // PI-Ensemble: 4 models (Linear/Logistic Regression, Pattern Matcher KNN,
  // Neural Network) + logistic meta on OOF predictions, calibrated via decile
  // binning. Same SL rule and target as CL-2.
  const piEnsEntry = piEnsPred
    ? {
        method: "PI_ENSEMBLE",
        methodLabel: "G. PI-Ensemble (4 models: Linear/Logistic, KNN, NN)",
        signal: piEnsPred.signal as any,
        direction: piEnsPred.direction as any,
        confidence: piEnsPred.confidence,
        predictedPrice: piEnsPred.tp3,
        entry: piEnsPred.entry,
        sl: piEnsPred.sl,
        tp1: piEnsPred.tp1,
        tp2: piEnsPred.tp2,
        tp3: piEnsPred.tp3,
        modelCount: 4,
        buyCount: 0,
        sellCount: 0,
        holdCount: 0,
        // PI-specific transparency fields
        raw_prob: piEnsPred.raw_prob,
        exp_win_rate: piEnsPred.exp_win_rate,
        agreement: piEnsPred.agreement,
      }
    : null;

  // GM-Model Ensembler: 4-Pillar Weighted Framework
  // (Technical 35% + Announcements 30% + Fundamental 20% + Macro 15%).
  // Rule-based, not ML. SL = 1.5×ATR; TP1/2/3 = 1.5/3/4.5×ATR.
  // Exits: 50%@TP1 (SL→BE), 30%@TP2, 20% trailing 20-EMA.
  const gmEnsEntry = gmEnsPred
    ? {
        method: "GM_MODEL",
        methodLabel: "H. GM-Model Ensembler (4-Pillar: 35/30/20/15)",
        signal: gmEnsPred.signal as any,
        direction: gmEnsPred.direction as any,
        confidence: gmEnsPred.confidence,
        predictedPrice: gmEnsPred.tp3,
        entry: gmEnsPred.entry,
        sl: gmEnsPred.sl,
        tp1: gmEnsPred.tp1,
        tp2: gmEnsPred.tp2,
        tp3: gmEnsPred.tp3,
        modelCount: 4, // 4 pillars
        buyCount: 0,
        sellCount: 0,
        holdCount: 0,
        // GM-specific transparency fields
        total_score: gmEnsPred.total_score,
        pillars: gmEnsPred.pillars,
      }
    : null;

  // CG-Ensemble: 2 swing-trading classifiers (LightGBM + XGBoost) with
  // triple-barrier labels (10-day horizon), 1R/2R/3R TPs, walk-forward CV,
  // cost model (50 bps round-trip + 15% CGT on gains). Probability averaging
  // of the 2 models + decile calibration.
  const cgEnsEntry = cgEnsPred
    ? {
        method: "CG_ENSEMBLE",
        methodLabel: "I. CG-Ensemble (LightGBM + XGBoost, triple-barrier, cost-aware)",
        signal: cgEnsPred.signal as any,
        direction: cgEnsPred.direction as any,
        confidence: cgEnsPred.confidence,
        predictedPrice: cgEnsPred.tp3,
        entry: cgEnsPred.entry,
        sl: cgEnsPred.sl,
        tp1: cgEnsPred.tp1,
        tp2: cgEnsPred.tp2,
        tp3: cgEnsPred.tp3,
        modelCount: 2,
        buyCount: 0,
        sellCount: 0,
        holdCount: 0,
        // CG-specific transparency fields
        raw_prob: cgEnsPred.raw_prob,
        exp_win_rate: cgEnsPred.exp_win_rate,
        agreement: cgEnsPred.agreement,
        expected_return: cgEnsPred.expected_return,
        r_pct: cgEnsPred.r_pct,
      }
    : null;

  // X-Ensemble: 10 complementary strategies + LightGBM meta-labeling.
  // Proper methodology: 3-way chronological split (train 60% / calibrate 15%
  // / test 25%) with 15-bar purge+embargo, next-bar-open entries, conservative
  // ambiguous-barrier handling, Platt + isotonic calibration. 90% precision
  // achieved on untouched OOS test, but negative net expectancy (honest report).
  const xEnsEntry = xEnsPred
    ? {
        method: "X_ENSEMBLE",
        methodLabel: "J. X-Ensemble (10 strategies + LightGBM meta-labeling, cost-aware)",
        signal: xEnsPred.signal as any,
        direction: xEnsPred.direction as any,
        confidence: xEnsPred.confidence,
        predictedPrice: xEnsPred.tp3,
        entry: xEnsPred.entry,
        sl: xEnsPred.sl,
        tp1: xEnsPred.tp1,
        tp2: xEnsPred.tp2,
        tp3: xEnsPred.tp3,
        modelCount: 10, // 10 strategies
        buyCount: 0,
        sellCount: 0,
        holdCount: 0,
        // X-specific transparency fields
        raw_prob: xEnsPred.raw_prob,
        exp_win_rate: xEnsPred.exp_win_rate,
        agreement: xEnsPred.agreement,
        strategy_signals: xEnsPred.strategy_signals,
      }
    : null;

  // Gian-Ensemble: Square-root support/resistance with odd-number rule.
  const gianEnsEntry = gianEnsPred
    ? {
        method: "GIAN_ENSEMBLE",
        methodLabel: "K. Gian-Ensemble (Square-root S/R with odd-number rule)",
        signal: gianEnsPred.signal as any,
        direction: gianEnsPred.direction as any,
        confidence: gianEnsPred.confidence,
        predictedPrice: gianEnsPred.tp3,
        entry: gianEnsPred.entry,
        sl: gianEnsPred.sl,
        tp1: gianEnsPred.tp1,
        tp2: gianEnsPred.tp2,
        tp3: gianEnsPred.tp3,
        modelCount: 6, // 6 S/R levels
        buyCount: 0,
        sellCount: 0,
        holdCount: 0,
        gian_levels: gianEnsPred.gian_levels,
      }
    : null;

  // Gian-Extender: Fixed GANN grid (Linear GANN 2.0 Pine Script).
  const gianExtEntry = gianExtPred
    ? {
        method: "GIAN_EXTENDER",
        methodLabel: "L. Gian-Extender (Fixed GANN square-of-9 levels, Linear GANN 2.0)",
        signal: gianExtPred.signal as any,
        direction: gianExtPred.direction as any,
        confidence: gianExtPred.confidence,
        predictedPrice: gianExtPred.tp3,
        entry: gianExtPred.entry,
        sl: gianExtPred.sl,
        tp1: gianExtPred.tp1,
        tp2: gianExtPred.tp2,
        tp3: gianExtPred.tp3,
        modelCount: 6, // 6 S/R levels
        buyCount: 0,
        sellCount: 0,
        holdCount: 0,
        gann_levels: gianExtPred.gann_levels,
      }
    : null;

  // M-Ensemble: Historical price-touch S/R with ATR clustering.
  const mEnsEntry = mEnsPred
    ? {
        method: "M_ENSEMBLE",
        methodLabel: "M. M-Ensemble (Historical price-touch S/R with ATR clustering)",
        signal: mEnsPred.signal as any,
        direction: mEnsPred.direction as any,
        confidence: mEnsPred.confidence,
        predictedPrice: mEnsPred.tp3,
        entry: mEnsPred.entry,
        sl: mEnsPred.sl,
        tp1: mEnsPred.tp1,
        tp2: mEnsPred.tp2,
        tp3: mEnsPred.tp3,
        modelCount: 6, // 6 S/R levels
        buyCount: 0,
        sellCount: 0,
        holdCount: 0,
        m_levels: mEnsPred.m_levels,
      }
    : null;

  const ensembles = [...baseEnsembles];
  if (clEnsEntry) ensembles.push(clEnsEntry);
  if (clExtEntry) ensembles.push(clExtEntry);
  if (cl2EnsEntry) ensembles.push(cl2EnsEntry);
  if (piEnsEntry) ensembles.push(piEnsEntry);
  if (gmEnsEntry) ensembles.push(gmEnsEntry);
  if (cgEnsEntry) ensembles.push(cgEnsEntry);
  if (xEnsEntry) ensembles.push(xEnsEntry);
  if (gianEnsEntry) ensembles.push(gianEnsEntry);
  if (gianExtEntry) ensembles.push(gianExtEntry);
  if (mEnsEntry) ensembles.push(mEnsEntry);

  const finalConsensus = computeFinalConsensus(ensembles);

  // Build tiers — include TIER_GIAN
  const tiers = (
    ["TIER_1", "TIER_2", "TIER_3", "TIER_4", "TIER_CL", "TIER_CL_2", "TIER_PI", "TIER_GM", "TIER_CG", "TIER_X", "TIER_GIAN"] as const
  ).map((t) => ({
    tier: t,
    label: ALL_MODELS.find((m) => m.tier === t)?.tierLabel || t,
    models: predictions.filter((p) => p.tier === t),
  }));

  const resp = {
    symbol: sym,
    stockName,
    currentPrice,
    tiers,
    ensembles,
    finalConsensus,
    trainedModelCount: predictions.filter((p) => p.trained).length,
    totalModelCount: predictions.length,
    trainedAt: multi?.trained_at,
    backtesting: multi?.backtesting || {},
    ensembleBacktesting: multi?.ensemble_backtesting || {},
    walkForward: multi?.walk_forward_backtesting || {},
    clEnsemble: multi?.cl_ensemble_backtest || {},
    clEnsembleAll: multi?.cl_ensemble_backtest_all || {},
    clExtender: multi?.cl_extender_backtest || {},
    clEnsemblePredictions: multi?.cl_ensemble_predictions || {},
    clExtenderPredictions: multi?.cl_extender_predictions || {},
    // CL-2 ensemble predictions + metadata
    cl2EnsemblePredictions: multi?.cl2_ensemble_predictions || {},
    cl2Metadata: multi?.cl2_metadata || {},
    // PI-Ensemble predictions + metadata
    piEnsemblePredictions: multi?.pi_ensemble_predictions || {},
    piMetadata: multi?.pi_metadata || {},
    // GM-Model predictions + metadata
    gmModelPredictions: multi?.gm_model_predictions || {},
    gmMetadata: multi?.gm_metadata || {},
    // CG-Ensemble predictions + metadata
    cgEnsemblePredictions: multi?.cg_ensemble_predictions || {},
    cgMetadata: multi?.cg_metadata || {},
    // X-Ensemble predictions + metadata (NEW)
    xEnsemblePredictions: multi?.x_ensemble_predictions || {},
    xMetadata: multi?.x_metadata || {},
    // Gian-Ensemble + Gian-Extender predictions + metadata
    gianEnsemblePredictions: multi?.gian_ensemble_predictions || {},
    gianExtenderPredictions: multi?.gian_extender_predictions || {},
    gianMetadata: multi?.gian_metadata || {},
    gianExtenderMetadata: multi?.gian_extender_metadata || {},
    // M-Ensemble predictions + metadata
    mEnsemblePredictions: multi?.m_ensemble_predictions || {},
    mMetadata: multi?.m_metadata || {},
  };

  await cacheSetJSON(CK(sym), resp, 3600);
  return NextResponse.json({ ...resp, cached: false, latencyMs: Date.now() - start });
}
