import { Signal, Trade, TradeHorizon, TradeStatus } from "./types";
import { MOCK_SIGNALS } from "./mock-signals";

// Generate 50+ historical closed trades across horizons and market regimes
// Some are linked to active signals; others are historical signals now closed.
// All numbers are realistic for KSE-100 stocks (price range 80-900 PKR).

const HISTORICAL_SYMBOLS = ["ENGRO", "HUBC", "LUCK", "SYS", "MEBL", "PSO", "OGDC", "PPL"];
const HORIZONS: TradeHorizon[] = ["DAY", "SWING", "DIVIDEND", "GROWTH"];

function seedRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const rand = seedRandom(42);

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function pickPrice(symbol: string): number {
  const base: Record<string, number> = {
    ENGRO: 285, HUBC: 124, LUCK: 892, SYS: 412, MEBL: 268, PSO: 198, OGDC: 142, PPL: 118,
  };
  return base[symbol] * (0.85 + rand() * 0.3);
}

export const MOCK_TRADES: Trade[] = [];

// Generate 50 historical closed trades
for (let i = 0; i < 50; i++) {
  const symbol = HISTORICAL_SYMBOLS[Math.floor(rand() * HISTORICAL_SYMBOLS.length)];
  const horizon = HORIZONS[Math.floor(rand() * HORIZONS.length)];
  const entryPrice = pickPrice(symbol);
  // 62% win rate (above market, defensible for a good signal algorithm)
  const isWin = rand() < 0.62;
  const isBreakeven = !isWin && rand() < 0.15;

  // Time horizon affects hold duration
  const baseDays =
    horizon === "DAY" ? 1 :
    horizon === "SWING" ? 14 :
    horizon === "DIVIDEND" ? 180 :
    365;
  const holdDays = Math.max(1, Math.floor(baseDays * (0.5 + rand() * 1.5)));

  // Win/loss magnitude
  const winPct = horizon === "DAY" ? (2 + rand() * 4) :
                 horizon === "SWING" ? (5 + rand() * 8) :
                 (10 + rand() * 25);
  const lossPct = horizon === "DAY" ? (1 + rand() * 2) :
                  horizon === "SWING" ? (3 + rand() * 5) :
                  (5 + rand() * 12);

  const pnlPct = isBreakeven ? 0 : isWin ? winPct : -lossPct;
  const exitPrice = entryPrice * (1 + pnlPct / 100);
  const shares = Math.floor((50000 + rand() * 200000) / entryPrice);
  const pnlPkr = (exitPrice - entryPrice) * shares;

  const entryDateOffset = 30 + i * 7; // staggered entries over the past year
  const entryDate = daysAgo(entryDateOffset + holdDays);
  const exitDate = daysAgo(entryDateOffset);

  const status: TradeStatus = isBreakeven ? "CLOSED_BREAKEVEN" : isWin ? "CLOSED_WIN" : "CLOSED_LOSS";

  MOCK_TRADES.push({
    id: `trade_hist_${i}`,
    signalId: `signal_hist_${i}`,
    symbol,
    direction: "LONG",
    horizon,
    entryPrice: parseFloat(entryPrice.toFixed(2)),
    exitPrice: parseFloat(exitPrice.toFixed(2)),
    entryDate,
    exitDate,
    status,
    pnlPct: parseFloat(pnlPct.toFixed(2)),
    pnlPkr: parseFloat(pnlPkr.toFixed(0)),
    timeToCloseDays: holdDays,
  });
}

// Add open trades from active signals
for (const signal of MOCK_SIGNALS) {
  if (signal.status !== "TRIGGERED") continue;
  const entryPrice = signal.entryPrice;
  const currentPrice = signal.entryPrice * (1 + (rand() - 0.4) * 0.08);
  const pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
  const shares = Math.floor(150000 / entryPrice);
  const pnlPkr = (currentPrice - entryPrice) * shares;

  MOCK_TRADES.push({
    id: `trade_open_${signal.id}`,
    signalId: signal.id,
    symbol: signal.symbol,
    direction: signal.direction,
    horizon: signal.horizon,
    entryPrice: parseFloat(entryPrice.toFixed(2)),
    exitPrice: null,
    entryDate: daysAgo(Math.floor(rand() * 14) + 1),
    exitDate: null,
    status: "OPEN",
    pnlPct: parseFloat(pnlPct.toFixed(2)),
    pnlPkr: parseFloat(pnlPkr.toFixed(0)),
    timeToCloseDays: null,
  });
}
