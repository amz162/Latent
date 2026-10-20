// Latent.pk — AI Model Signals: Ensemble computation + tier structure
export type Tier = "TIER_1" | "TIER_2" | "TIER_3" | "TIER_4" | "TIER_CL" | "TIER_CL_2" | "TIER_PI" | "TIER_GM" | "TIER_CG" | "TIER_X" | "TIER_GIAN";

export interface ModelMeta {
  name: string; tier: Tier; tierLabel: string; category: string;
  trained: boolean; untrainedReason?: string;
}

export const ALL_MODELS: ModelMeta[] = [
  { name: "PatchTST", tier: "TIER_1", tierLabel: "Tier 1: SOTA Deep Learning", category: "Transformer-based time-series", trained: true },
  { name: "N-BEATS", tier: "TIER_1", tierLabel: "Tier 1: SOTA Deep Learning", category: "Deep residual stacks", trained: true },
  { name: "TimesNet", tier: "TIER_1", tierLabel: "Tier 1: SOTA Deep Learning", category: "2D variation of 1D time series", trained: true },
  { name: "Informer", tier: "TIER_1", tierLabel: "Tier 1: SOTA Deep Learning", category: "Efficient attention", trained: true },
  { name: "Chronos (Amazon)", tier: "TIER_2", tierLabel: "Tier 2: Foundation Models", category: "T5-tokenized foundation", trained: false, untrainedReason: "Requires chronos-forecasting package" },
  { name: "Lag-Llama", tier: "TIER_2", tierLabel: "Tier 2: Foundation Models", category: "Open-source foundation", trained: false, untrainedReason: "Requires custom repo" },
  { name: "Moirai (Salesforce)", tier: "TIER_2", tierLabel: "Tier 2: Foundation Models", category: "Universal forecasting", trained: false, untrainedReason: "Requires uni2ts" },
  { name: "Time-LLM", tier: "TIER_2", tierLabel: "Tier 2: Foundation Models", category: "LLM-reformatted", trained: false, untrainedReason: "Requires LLM pipeline" },
  { name: "XGBoost", tier: "TIER_3", tierLabel: "Tier 3: Classical ML", category: "Gradient-boosted trees regressor", trained: true },
  { name: "LightGBM", tier: "TIER_3", tierLabel: "Tier 3: Classical ML", category: "Light GBT regressor", trained: true },
  { name: "CatBoost", tier: "TIER_3", tierLabel: "Tier 3: Classical ML", category: "Categorical-boosted regressor", trained: true },
  { name: "Random Forest", tier: "TIER_3", tierLabel: "Tier 3: Classical ML", category: "Decision tree ensemble", trained: true },
  { name: "LSTM", tier: "TIER_3", tierLabel: "Tier 3: Classical ML", category: "LSTM neural net (PyTorch)", trained: true },
  { name: "CNN-LSTM", tier: "TIER_4", tierLabel: "Tier 4: Hybrid + Specialized", category: "CNN+LSTM hybrid", trained: true },
  { name: "Transformer-LSTM", tier: "TIER_4", tierLabel: "Tier 4: Hybrid + Specialized", category: "Transformer+LSTM hybrid", trained: true },
  { name: "TabNet", tier: "TIER_4", tierLabel: "Tier 4: Hybrid + Specialized", category: "Attention-based tabular", trained: false, untrainedReason: "Data type issue" },
  { name: "FinGPT", tier: "TIER_4", tierLabel: "Tier 4: Hybrid + Specialized", category: "LLM fine-tuned for finance", trained: false, untrainedReason: "Requires BloombergGPT" },
  // CL Tier: Classical/Linear models
  { name: "ARIMA", tier: "TIER_CL", tierLabel: "CL Tier: Classical/Linear", category: "ARIMA classic baseline for daily price series", trained: true },
  { name: "Holt-Winters", tier: "TIER_CL", tierLabel: "CL Tier: Classical/Linear", category: "Exponential smoothing trend/seasonality", trained: true },
  { name: "GARCH", tier: "TIER_CL", tierLabel: "CL Tier: Classical/Linear", category: "Volatility forecast model", trained: true },
  { name: "Ridge Regression", tier: "TIER_CL", tierLabel: "CL Tier: Classical/Linear", category: "Linear regression on indicators (RSI, MACD, MA, volume)", trained: true },
  { name: "Kalman Filter", tier: "TIER_CL", tierLabel: "CL Tier: Classical/Linear", category: "Real-time state estimation filter", trained: true },
  { name: "Prophet", tier: "TIER_CL", tierLabel: "CL Tier: Classical/Linear", category: "Facebook Prophet trend/seasonality forecasting", trained: true },
  { name: "GRU", tier: "TIER_CL", tierLabel: "CL Tier: Classical/Linear", category: "Small GRU (1-2 layers, daily data)", trained: true },
  { name: "XGBoost (CL)", tier: "TIER_CL", tierLabel: "CL Tier: Classical/Linear", category: "Best accuracy-per-cost (copied from Tier 3)", trained: true },
  { name: "LightGBM (CL)", tier: "TIER_CL", tierLabel: "CL Tier: Classical/Linear", category: "Light GBT (copied from Tier 3)", trained: true },
  { name: "Random Forest (CL)", tier: "TIER_CL", tierLabel: "CL Tier: Classical/Linear", category: "Decision tree ensemble (copied from Tier 3)", trained: true },
  { name: "LSTM (CL)", tier: "TIER_CL", tierLabel: "CL Tier: Classical/Linear", category: "Small LSTM (copied from Tier 3)", trained: true },
  // CL-2 Tier: 7 CPU classifiers + logistic meta, support/ATR SL rule,
  // TP1-before-SL-in-5-days target, calibrated exp_win_rate confidence.
  { name: "LightGBM-A (CL-2)", tier: "TIER_CL_2", tierLabel: "CL-2 Tier: Calibrated Classifier Ensemble", category: "LightGBM classifier (config A: 100 trees, depth 3)", trained: true },
  { name: "LightGBM-B (CL-2)", tier: "TIER_CL_2", tierLabel: "CL-2 Tier: Calibrated Classifier Ensemble", category: "LightGBM classifier (config B: 60 trees, depth 5)", trained: true },
  { name: "HistGBM (CL-2)", tier: "TIER_CL_2", tierLabel: "CL-2 Tier: Calibrated Classifier Ensemble", category: "sklearn HistGradientBoosting classifier", trained: true },
  { name: "ExtraTrees (CL-2)", tier: "TIER_CL_2", tierLabel: "CL-2 Tier: Calibrated Classifier Ensemble", category: "ExtraTrees classifier", trained: true },
  { name: "RandomForest (CL-2)", tier: "TIER_CL_2", tierLabel: "CL-2 Tier: Calibrated Classifier Ensemble", category: "RandomForest classifier", trained: true },
  { name: "Logistic (CL-2)", tier: "TIER_CL_2", tierLabel: "CL-2 Tier: Calibrated Classifier Ensemble", category: "Logistic regression baseline", trained: true },
  { name: "MLP (CL-2)", tier: "TIER_CL_2", tierLabel: "CL-2 Tier: Calibrated Classifier Ensemble", category: "Small MLP (32-unit hidden layer)", trained: true },
  // PI Tier: 4 models (Linear/Logistic Regression, Pattern Matcher KNN, Neural Network)
  // + logistic meta-ensemble. Same support/ATR SL rule + TP1-before-SL target as CL-2.
  { name: "Linear Regression (PI)", tier: "TIER_PI", tierLabel: "PI Tier: Pattern & Indicator Models", category: "Linear regression on 20 indicators (predicts realized 5-day return)", trained: true },
  { name: "Logistic Regression (PI)", tier: "TIER_PI", tierLabel: "PI Tier: Pattern & Indicator Models", category: "Logistic regression (predicts P(TP1 hit before SL) in 5 days)", trained: true },
  { name: "Pattern Matcher KNN (PI)", tier: "TIER_PI", tierLabel: "PI Tier: Pattern & Indicator Models", category: "KNN classifier (k=15, distance-weighted) — pattern matching", trained: true },
  { name: "Neural Network (PI)", tier: "TIER_PI", tierLabel: "PI Tier: Pattern & Indicator Models", category: "MLPClassifier (64-32 hidden, tanh) — distinct from CL-2's MLP", trained: true },
  // GM Tier: 4-Pillar Weighted Framework (Technical 35% + Announcements 30%
  // + Fundamental 20% + Macro 15%). Rule-based, not ML. Each pillar is shown
  // as a separate "model" card for transparency; the combined signal is the
  // GM_MODEL ensemble entry. ATR rule: SL=1.5×ATR, TP1/2/3=1.5/3/4.5×ATR;
  // exits: 50%@TP1+BE, 30%@TP2, 20% trailing 20-EMA.
  { name: "Technical Engine (GM)", tier: "TIER_GM", tierLabel: "GM Tier: 4-Pillar Weighted Framework", category: "MA Trend + RSI/MACD + Bollinger Bands + OBV (35% weight)", trained: true },
  { name: "Announcements Engine (GM)", tier: "TIER_GM", tierLabel: "GM Tier: 4-Pillar Weighted Framework", category: "YoY EPS growth + dividend yield + EPS surprise (30% weight)", trained: true },
  { name: "Fundamental Engine (GM)", tier: "TIER_GM", tierLabel: "GM Tier: 4-Pillar Weighted Framework", category: "P/E + gross/net margin + interest coverage (20% weight)", trained: true },
  { name: "Macro Engine (GM)", tier: "TIER_GM", tierLabel: "GM Tier: 4-Pillar Weighted Framework", category: "KSE-100 trend + KIBOR + USD/PKR + Brent (15% weight)", trained: true },
  // CG Tier: 2 swing-trading models (LightGBM primary + XGBoost challenger)
  // with triple-barrier labels, 10-day horizon, 1R/2R/3R TPs, walk-forward CV,
  // and full cost model (brokerage + taxes + slippage + 15% CGT on gains).
  // CG-Ensemble = probability averaging of the 2 models + decile calibration.
  { name: "LightGBM (CG)", tier: "TIER_CG", tierLabel: "CG Tier: Swing-Trading Classifier Ensemble", category: "LightGBM primary classifier — triple-barrier, 10-day horizon, TP1=1R", trained: true },
  { name: "XGBoost (CG)", tier: "TIER_CG", tierLabel: "CG Tier: Swing-Trading Classifier Ensemble", category: "XGBoost challenger — same target/horizon as LightGBM (CG)", trained: true },
  // X Tier: NEW — 10 complementary strategies + LightGBM meta-labeling ensemble
  // with proper chronological methodology (3-way split, purge+embargo, untouched OOS test,
  // Platt+isotonic calibration). 90% precision achieved on untouched test, but
  // negative net expectancy due to entry gaps + costs (honest report).
  { name: "Trend Multi-TF (X)", tier: "TIER_X", tierLabel: "X Tier: 10-Strategy Meta-Labeling Ensemble", category: "Multi-timeframe trend (price > EMA20 > EMA50 > SMA200 + EMA separation > 0.5%)", trained: true },
  { name: "Breakout RelVol (X)", tier: "TIER_X", tierLabel: "X Tier: 10-Strategy Meta-Labeling Ensemble", category: "Breakout + relative volume (close > 20-day high AND vol > 1.5× 50d avg)", trained: true },
  { name: "Trend Pullback (X)", tier: "TIER_X", tierLabel: "X Tier: 10-Strategy Meta-Labeling Ensemble", category: "Trend pullback to EMA20 (price > EMA50, low touches EMA20 within 2%)", trained: true },
  { name: "RSI Divergence (X)", tier: "TIER_X", tierLabel: "X Tier: 10-Strategy Meta-Labeling Ensemble", category: "RSI bullish divergence (price lower-low + RSI higher-low + RSI<35)", trained: true },
  { name: "BB Mean Reversion (X)", tier: "TIER_X", tierLabel: "X Tier: 10-Strategy Meta-Labeling Ensemble", category: "Bollinger Band mean reversion (below lower band + range-bound)", trained: true },
  { name: "Vol Contraction (X)", tier: "TIER_X", tierLabel: "X Tier: 10-Strategy Meta-Labeling Ensemble", category: "Volatility contraction-then-expansion (BB width pattern)", trained: true },
  { name: "Relative Strength (X)", tier: "TIER_X", tierLabel: "X Tier: 10-Strategy Meta-Labeling Ensemble", category: "Relative strength (stock 50d return > KSE-100 50d return + 2%)", trained: true },
  { name: "Market Regime (X)", tier: "TIER_X", tierLabel: "X Tier: 10-Strategy Meta-Labeling Ensemble", category: "Market regime filter (KSE-100 50d return > 2% → bull regime)", trained: true },
  { name: "Meta-Label CG (X)", tier: "TIER_X", tierLabel: "X Tier: 10-Strategy Meta-Labeling Ensemble", category: "Meta-label of CG-Ensemble predictions (raw_prob >= 0.55)", trained: true },
  { name: "Triple Barrier Dyn (X)", tier: "TIER_X", tierLabel: "X Tier: 10-Strategy Meta-Labeling Ensemble", category: "Triple-barrier dynamic (ATR/price < 5% + price > EMA50 = low-vol uptrend)", trained: true },
  // Gian Tier: Square-root support/resistance with odd-number rule.
  { name: "Gian-Ensemble (GIAN)", tier: "TIER_GIAN", tierLabel: "Gian Tier: Square-Root S/R Strategy", category: "Square-root support/resistance with odd-number rule (BUY near S1/S2/S3, SELL near R1/R2/R3)", trained: true },
  // Gian-Extender: Fixed GANN grid (Linear GANN 2.0 Pine Script by Adib Noorani)
  { name: "Gian-Extender (GIAN-EXT)", tier: "TIER_GIAN", tierLabel: "Gian Tier: Square-Root S/R Strategy", category: "Fixed GANN square-of-9 levels (1, 9, 25, 49, 81, 121, 169, 225, 289, 361, 441, 529, 625, ...)", trained: true },
  // M-Ensemble: Historical price-touch support/resistance with ATR clustering
  { name: "M-Ensemble (M)", tier: "TIER_GIAN", tierLabel: "Gian Tier: Square-Root S/R Strategy", category: "Historical price-touch S/R with ATR clustering (scan all highs/lows, cluster within 1×ATR, pick top 3)", trained: true },
];

// Tier weights for tierWeightedEnsemble.
export const TIER_WEIGHTS: Record<Tier, number> = {
  TIER_1: 0.30, TIER_2: 0.20, TIER_3: 0.25, TIER_4: 0.10,
  TIER_CL: 0.15, TIER_CL_2: 0.20, TIER_PI: 0.20, TIER_GM: 0.20, TIER_CG: 0.20, TIER_X: 0.20, TIER_GIAN: 0.20,
};

export interface ModelPrediction {
  name: string; tier: Tier; tierLabel: string; category: string;
  trained: boolean; untrainedReason?: string;
  direction?: "LONG" | "SHORT"; signal?: "BUY" | "SELL" | "HOLD";
  confidence?: number; currentPrice?: number; entry?: number;
  sl?: number; tp1?: number; tp2?: number; tp3?: number; avgReturn?: number;
  metrics?: any; backtest?: any;
}

export interface EnsembleResult {
  method: string; methodLabel: string;
  signal: "BUY" | "SELL" | "HOLD"; direction: "LONG" | "SHORT";
  confidence: number; predictedPrice: number;
  entry: number; sl: number; tp1: number; tp2: number; tp3: number;
  modelCount: number; buyCount: number; sellCount: number; holdCount: number;
}

function avg(arr: number[], fallback: number = 0): number {
  return arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : fallback;
}

function emptyEnsemble(method: string, label: string): EnsembleResult {
  return {
    method, methodLabel: label, signal: "HOLD", direction: "LONG", confidence: 0,
    predictedPrice: 0, entry: 0, sl: 0, tp1: 0, tp2: 0, tp3: 0,
    modelCount: 0, buyCount: 0, sellCount: 0, holdCount: 0,
  };
}

export function majorityVoteEnsemble(preds: ModelPrediction[]): EnsembleResult {
  const trained = preds.filter(p => p.trained && p.signal);
  const buyCount = trained.filter(p => p.signal === "BUY").length;
  const sellCount = trained.filter(p => p.signal === "SELL").length;
  const holdCount = trained.filter(p => p.signal === "HOLD").length;
  let signal: "BUY" | "SELL" | "HOLD" = "HOLD";
  let direction: "LONG" | "SHORT" = "LONG";
  if (buyCount > sellCount && buyCount > holdCount) { signal = "BUY"; direction = "LONG"; }
  else if (sellCount > buyCount && sellCount > holdCount) { signal = "SELL"; direction = "SHORT"; }
  const entry = trained[0]?.entry || trained[0]?.currentPrice || 0;
  const tp1s = trained.filter(p => p.tp1).map(p => p.tp1 as number);
  const tp2s = trained.filter(p => p.tp2).map(p => p.tp2 as number);
  const tp3s = trained.filter(p => p.tp3).map(p => p.tp3 as number);
  const sls = trained.filter(p => p.sl).map(p => p.sl as number);
  const allTPs = [...tp1s, ...tp2s, ...tp3s];
  const confidence = trained.length > 0 ? Math.round(Math.max(buyCount, sellCount, holdCount) / trained.length * 100) : 0;
  return {
    method: "MAJORITY_VOTE", methodLabel: "A. Majority Vote", signal, direction,
    confidence, predictedPrice: avg(allTPs), entry,
    sl: avg(sls, entry), tp1: avg(tp1s, entry), tp2: avg(tp2s, entry), tp3: avg(tp3s, entry),
    modelCount: trained.length, buyCount, sellCount, holdCount,
  };
}

export function probabilityWeightedEnsemble(preds: ModelPrediction[]): EnsembleResult {
  const trained = preds.filter(p => p.trained && p.avgReturn !== undefined);
  if (!trained.length) return emptyEnsemble("PROBABILITY_WEIGHTED", "B. Probability-Weighted");
  const avgRet = trained.reduce((s, p) => s + (p.avgReturn as number), 0) / trained.length;
  let signal: "BUY" | "SELL" | "HOLD" = "HOLD";
  let direction: "LONG" | "SHORT" = "LONG";
  if (avgRet > 0.01) { signal = "BUY"; direction = "LONG"; }
  else if (avgRet < -0.01) { signal = "SELL"; direction = "SHORT"; }
  const entry = trained[0]?.entry || trained[0]?.currentPrice || 0;
  const tp1s = trained.filter(p => p.tp1).map(p => p.tp1 as number);
  const tp2s = trained.filter(p => p.tp2).map(p => p.tp2 as number);
  const tp3s = trained.filter(p => p.tp3).map(p => p.tp3 as number);
  const sls = trained.filter(p => p.sl).map(p => p.sl as number);
  return {
    method: "PROBABILITY_WEIGHTED", methodLabel: "B. Probability-Weighted", signal, direction,
    confidence: Math.round(Math.abs(avgRet) * 1000),
    predictedPrice: avg([...tp1s, ...tp2s, ...tp3s]), entry,
    sl: avg(sls, entry), tp1: avg(tp1s, entry), tp2: avg(tp2s, entry), tp3: avg(tp3s, entry),
    modelCount: trained.length,
    buyCount: trained.filter(p => p.signal === "BUY").length,
    sellCount: trained.filter(p => p.signal === "SELL").length,
    holdCount: trained.filter(p => p.signal === "HOLD").length,
  };
}

export function tierWeightedEnsemble(preds: ModelPrediction[]): EnsembleResult {
  const trained = preds.filter(p => p.trained && p.avgReturn !== undefined);
  if (!trained.length) return emptyEnsemble("TIER_WEIGHTED", "C. Tier-Weighted");
  let weightedSum = 0, weightTotal = 0;
  for (const p of trained) {
    const tw = TIER_WEIGHTS[p.tier] || 0.25;
    weightedSum += (p.avgReturn as number) * tw;
    weightTotal += tw;
  }
  const wr = weightTotal > 0 ? weightedSum / weightTotal : 0;
  let signal: "BUY" | "SELL" | "HOLD" = "HOLD";
  let direction: "LONG" | "SHORT" = "LONG";
  if (wr > 0.01) { signal = "BUY"; direction = "LONG"; }
  else if (wr < -0.01) { signal = "SELL"; direction = "SHORT"; }
  const entry = trained[0]?.entry || trained[0]?.currentPrice || 0;
  const tp1s = trained.filter(p => p.tp1).map(p => p.tp1 as number);
  const tp2s = trained.filter(p => p.tp2).map(p => p.tp2 as number);
  const tp3s = trained.filter(p => p.tp3).map(p => p.tp3 as number);
  const sls = trained.filter(p => p.sl).map(p => p.sl as number);
  return {
    method: "TIER_WEIGHTED", methodLabel: "C. Tier-Weighted", signal, direction,
    confidence: Math.round(Math.abs(wr) * 1000),
    predictedPrice: avg([...tp1s, ...tp2s, ...tp3s]), entry,
    sl: avg(sls, entry), tp1: avg(tp1s, entry), tp2: avg(tp2s, entry), tp3: avg(tp3s, entry),
    modelCount: trained.length,
    buyCount: trained.filter(p => p.signal === "BUY").length,
    sellCount: trained.filter(p => p.signal === "SELL").length,
    holdCount: trained.filter(p => p.signal === "HOLD").length,
  };
}

export function computeFinalConsensus(ens: EnsembleResult[]) {
  const buyV = ens.filter(e => e.signal === "BUY").length;
  const sellV = ens.filter(e => e.signal === "SELL").length;
  const holdV = ens.filter(e => e.signal === "HOLD").length;
  let signal: "BUY" | "SELL" | "HOLD" = "HOLD";
  let direction: "LONG" | "SHORT" = "LONG";
  if (buyV >= 2) { signal = "BUY"; direction = "LONG"; }
  else if (sellV >= 2) { signal = "SELL"; direction = "SHORT"; }
  const entry = ens[0]?.entry || 0;
  const predictedPrices = ens.map(e => e.predictedPrice).filter(p => p > 0);
  return {
    signal, direction,
    confidence: ens.length > 0 ? Math.round(ens.reduce((s, e) => s + e.confidence, 0) / ens.length) : 0,
    agreement: Math.round(Math.max(buyV, sellV, holdV) / ens.length * 100),
    predictedPriceRange: { min: predictedPrices.length ? Math.min(...predictedPrices) : entry, max: predictedPrices.length ? Math.max(...predictedPrices) : entry },
    entry,
    sl: avg(ens.map(e => e.sl), entry),
    tp1: avg(ens.map(e => e.tp1), entry),
    tp2: avg(ens.map(e => e.tp2), entry),
    tp3: avg(ens.map(e => e.tp3), entry),
  };
}
