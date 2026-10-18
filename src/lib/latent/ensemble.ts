// Latent.pk — AI Model Signals: Ensemble computation + tier structure
export type Tier = "TIER_1" | "TIER_2" | "TIER_3" | "TIER_4" | "TIER_CL";

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
];

export const TIER_WEIGHTS: Record<Tier, number> = { TIER_1: 0.30, TIER_2: 0.20, TIER_3: 0.25, TIER_4: 0.10, TIER_CL: 0.15 };

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
