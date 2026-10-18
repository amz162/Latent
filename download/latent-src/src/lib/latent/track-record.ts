import { Trade, TrackRecordStats, TradeHorizon } from "./types";
import { MOCK_TRADES } from "./mock-trades";

// Compute accuracy statistics from the trade list.
// This is REAL logic, not mocked — VCs can verify the math.

export function computeTrackRecord(trades: Trade[] = MOCK_TRADES): TrackRecordStats {
  const total = trades.length;
  const open = trades.filter((t) => t.status === "OPEN").length;
  const closed = trades.filter((t) => t.status !== "OPEN");

  const wins = closed.filter((t) => t.status === "CLOSED_WIN");
  const losses = closed.filter((t) => t.status === "CLOSED_LOSS");
  const breakeven = closed.filter((t) => t.status === "CLOSED_BREAKEVEN");

  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

  // Average time-to-close for wins vs losses
  const winsWithDays = wins.filter((t) => t.timeToCloseDays != null);
  const lossesWithDays = losses.filter((t) => t.timeToCloseDays != null);

  const avgTimeToProfitDays =
    winsWithDays.length > 0
      ? winsWithDays.reduce((sum, t) => sum + (t.timeToCloseDays || 0), 0) / winsWithDays.length
      : 0;

  const avgTimeToLossDays =
    lossesWithDays.length > 0
      ? lossesWithDays.reduce((sum, t) => sum + (t.timeToCloseDays || 0), 0) / lossesWithDays.length
      : 0;

  // Average win/loss %
  const avgWinPct = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnlPct || 0), 0) / wins.length : 0;
  const avgLossPct = losses.length > 0 ? losses.reduce((s, t) => s + (t.pnlPct || 0), 0) / losses.length : 0;

  // Profit factor = gross profit / gross loss (in PKR)
  const grossProfit = wins.reduce((s, t) => s + Math.max(0, t.pnlPkr || 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + Math.min(0, t.pnlPkr || 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

  const bestTradePct = closed.length > 0 ? Math.max(...closed.map((t) => t.pnlPct || 0)) : 0;
  const worstTradePct = closed.length > 0 ? Math.min(...closed.map((t) => t.pnlPct || 0)) : 0;

  // By-horizon breakdown
  const horizons: TradeHorizon[] = ["DAY", "SWING", "DIVIDEND", "GROWTH"];
  const byHorizon = horizons
    .map((h) => {
      const horizonTrades = closed.filter((t) => t.horizon === h);
      const horizonWins = horizonTrades.filter((t) => t.status === "CLOSED_WIN").length;
      return {
        horizon: h,
        total: horizonTrades.length,
        wins: horizonWins,
        winRate: horizonTrades.length > 0
          ? parseFloat(((horizonWins / horizonTrades.length) * 100).toFixed(1))
          : 0,
      };
    })
    .filter((h) => h.total > 0);

  return {
    totalTrades: total,
    wins: wins.length,
    losses: losses.length,
    breakeven: breakeven.length,
    openTrades: open,
    winRate: parseFloat(winRate.toFixed(1)),
    avgTimeToProfitDays: Math.round(avgTimeToProfitDays),
    avgTimeToLossDays: Math.round(avgTimeToLossDays),
    avgWinPct: parseFloat(avgWinPct.toFixed(2)),
    avgLossPct: parseFloat(avgLossPct.toFixed(2)),
    profitFactor: parseFloat(profitFactor.toFixed(2)),
    bestTradePct: parseFloat(bestTradePct.toFixed(2)),
    worstTradePct: parseFloat(worstTradePct.toFixed(2)),
    byHorizon,
  };
}
