import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { Signal, SignalDirection, TradeHorizon } from "@/lib/latent/types";

// ML signal endpoint — now serving REAL XGBoost predictions
// Predictions are pre-computed by scripts/train_xgboost.py and cached in
// data/ml_predictions.json. Re-run the training script to refresh.
//
// Production architecture:
//   - Training: Python XGBoost on real PSX OHLCV (2 years, 3,427 rows, 19 features)
//   - Inference: pre-computed predictions, served from JSON cache
//   - Refresh: daily cron re-runs training script, regenerates predictions
//
// To re-train: python3 scripts/train_xgboost.py
// To refresh data: python3 scripts/fetch_ohlcv.py

export const dynamic = "force-dynamic";

interface PredictionEntry {
  direction: "LONG" | "SHORT";
  horizon: TradeHorizon;
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

async function loadPredictions(): Promise<PredictionsFile | null> {
  try {
    const filePath = path.join(process.cwd(), "data", "ml_predictions.json");
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    console.error("[/api/ml/signal] Failed to load predictions file:", err);
    return null;
  }
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

function deriveDirection(confidence: number, probaUp: number): SignalDirection {
  if (probaUp >= 0.65) return "LONG";
  if (probaUp <= 0.35) return "SHORT";
  return "LONG";
}

function deriveActionLayman(
  symbol: string,
  pred: PredictionEntry
): string {
  const action = pred.direction === "LONG" ? "BUY" : "SELL (or avoid)";
  const rsiNote =
    pred.latest_features.rsi_14 > 70 ? "RSI is overbought (>70) — wait for pullback before entry." :
    pred.latest_features.rsi_14 < 30 ? "RSI is oversold (<30) — bounce likely." :
    "RSI is mid-range — neutral.";
  const volNote =
    pred.latest_features.volatility_14d > 4 ? "Volatility elevated — use smaller position size." :
    "Volatility normal.";
  const returnNote =
    pred.latest_features.return_14d > 0 ? `14-day momentum is positive (${pred.latest_features.return_14d.toFixed(1)}%) — trend supporting.` :
    pred.latest_features.return_14d < 0 ? `14-day momentum is negative (${pred.latest_features.return_14d.toFixed(1)}%) — counter-trend setup, higher risk.` :
    "14-day momentum is flat.";
  return `Action: ${action} ${symbol} at ${pred.entryPrice}. Target ${pred.targetPrice}. Stop-loss ${pred.stopLoss}. Confidence ${pred.confidence}/100. ${rsiNote} ${volNote} ${returnNote}`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const symbolUpper = symbol.toUpperCase();
  const predictions = await loadPredictions();

  if (!predictions) {
    return NextResponse.json(
      { error: "Predictions file not found. Run: python3 scripts/train_xgboost.py" },
      { status: 503 }
    );
  }

  const pred = predictions.predictions[symbolUpper];
  if (!pred) {
    return NextResponse.json(
      { error: `No prediction for ${symbolUpper}. Available: ${Object.keys(predictions.predictions).join(", ")}` },
      { status: 404 }
    );
  }

  // Build Signal object matching the Signal interface
  const signal: Signal = {
    id: `sig_${symbolUpper}_${Date.now()}`,
    symbol: symbolUpper,
    stockName: STOCK_NAMES[symbolUpper] || symbolUpper,
    direction: pred.direction,
    horizon: pred.horizon,
    entryPrice: pred.entryPrice,
    targetPrice: pred.targetPrice,
    stopLoss: pred.stopLoss,
    confidenceScore: pred.confidence,
    setupScore: pred.confidence, // alias for display in UI
    status: "ACTIVE",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 14 * 86400 * 1000).toISOString(),
    explanation: {
      summary: `Real XGBoost model output for ${symbolUpper}. Model probability of +5% rise within 14 days: ${(pred.model_probability_up * 100).toFixed(1)}%. Direction: ${pred.direction}. Confidence: ${pred.confidence}/100.`,
      technicalLayman: `The model analyzed ${symbolUpper}'s last 14 days of trading through 19 technical indicators (RSI, MACD, Bollinger Bands, ATR, OBV, SMAs, momentum, volatility). Current RSI: ${pred.latest_features.rsi_14.toFixed(0)} (0-100 scale; <30 oversold, >70 overbought). 14-day return: ${pred.latest_features.return_14d.toFixed(1)}%. Volatility: ${pred.latest_features.volatility_14d.toFixed(1)}% daily.`,
      technicalTerms: [
        {
          term: "Model probability (up)",
          meaning: "Probability (0-1) that the stock rises ≥5% within the next 14 trading days, as computed by the XGBoost classifier.",
          current: `${(pred.model_probability_up * 100).toFixed(1)}%`,
          impact: pred.model_probability_up >= 0.65 ? "Bullish — model predicts upside" : pred.model_probability_up <= 0.35 ? "Bearish — model predicts downside" : "Neutral — model uncertain",
        },
        {
          term: "RSI (14)",
          meaning: "Relative Strength Index — momentum 0-100. >70 = overbought (risks pullback), <30 = oversold (risks bounce).",
          current: pred.latest_features.rsi_14.toFixed(0),
          impact: pred.latest_features.rsi_14 > 70 ? "Caution — overbought" : pred.latest_features.rsi_14 < 30 ? "Oversold — bounce likely" : "Mid-range — neutral",
        },
        {
          term: "MACD histogram",
          meaning: "Difference between MACD line and signal line. Positive = bullish momentum, negative = bearish.",
          current: pred.latest_features.macd_hist.toFixed(3),
          impact: pred.latest_features.macd_hist > 0 ? "Bullish momentum" : pred.latest_features.macd_hist < 0 ? "Bearish momentum" : "Momentum flat",
        },
        {
          term: "Bollinger Bands",
          meaning: "Price range where the stock normally trades. Upper band = expensive zone, lower band = cheap zone. Current price near upper band = potentially overbought.",
          current: pred.latest_features.bb_pct_b.toFixed(2),
          impact: pred.latest_features.bb_pct_b > 0.8 ? "At upper band — caution" : pred.latest_features.bb_pct_b < 0.2 ? "At lower band — value zone" : "Mid-band — neutral",
        },
        {
          term: "ATR (14-day)",
          meaning: "How much the stock typically moves in a day, on average, over the last 14 days. Higher ATR = more volatile/risky.",
          current: pred.latest_features.atr_14.toFixed(2),
          impact: pred.latest_features.atr_14 > 10 ? "High volatility — use smaller position size" : pred.latest_features.atr_14 > 5 ? "Moderate volatility" : "Low volatility — calmer",
        },
        {
          term: "14-day return",
          meaning: "How much the stock price changed in the last 2 weeks. Positive = went up, negative = went down.",
          current: `${pred.latest_features.return_14d.toFixed(1)}%`,
          impact: pred.latest_features.return_14d > 2 ? "Short-term bullish" : pred.latest_features.return_14d < -2 ? "Short-term bearish" : "Flat",
        },
        {
          term: "14-day volatility",
          meaning: "Standard deviation of daily returns over 14 days. Higher = more volatile = wider stops needed.",
          current: `${pred.latest_features.volatility_14d.toFixed(1)}%`,
          impact: pred.latest_features.volatility_14d > 4 ? "Elevated — reduce size" : "Normal",
        },
        {
          term: "Volume",
          meaning: "Number of shares traded today. High volume = lots of interest/activity. Low volume = quiet day.",
          current: "—",
          impact: "Sentiment confirmation input",
        },
      ],
      fundamentalLayman: `Fundamental data for ${symbolUpper} is fetched from askanalyst.com.pk /financialstatement/ endpoint. See Fundamental News tab for latest company announcements, results, and dividend declarations.`,
      fundamentalFactors: [
        { label: "Model confidence", value: `${pred.confidence}/100`, impact: pred.confidence > 70 ? "positive" : pred.confidence < 50 ? "negative" : "neutral" },
        { label: "Direction", value: pred.direction, impact: pred.direction === "LONG" ? "positive" : "negative" },
        { label: "Probability of upside", value: `${(pred.model_probability_up * 100).toFixed(1)}%`, impact: pred.model_probability_up > 0.6 ? "positive" : pred.model_probability_up < 0.4 ? "negative" : "neutral" },
      ],
      newsLayman: "See Fundamental News tab for the latest news + announcements impacting this stock.",
      newsItems: [],
      actionLayman: deriveActionLayman(symbolUpper, pred),
      riskFactors: [
        "Model trained on 2 years of PSX data — limited historical depth",
        "Past performance does not guarantee future returns",
        "PSX carries inherent market risk",
        "Always do your own research before trading",
        `Current volatility: ${pred.latest_features.volatility_14d.toFixed(1)}% daily`,
      ],
    },
  };

  return NextResponse.json({
    signal,
    model: {
      type: "xgboost_v1",
      version: predictions.model_version,
      trainedAt: predictions.trained_at,
      metrics: predictions.metrics,
      features: 19,
      trainedOn: "real PSX OHLCV from askanalyst.com.pk",
      lastTrainedAt: predictions.trained_at,
      disclaimer: "Real XGBoost model trained on 3,427 rows of real PSX OHLCV data. Labels: did price rise ≥5% within 14 days. Past performance does not guarantee future returns.",
    },
  });
}
