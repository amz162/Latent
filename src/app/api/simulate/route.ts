import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const amount = parseFloat(url.searchParams.get("amount") || "100000");
  const numDays = parseInt(url.searchParams.get("numDays") || "0"); // 0 = all
  const numTradesParam = url.searchParams.get("numTrades"); // optional
  const numTrades = numTradesParam ? parseInt(numTradesParam) : 0; // 0 = use each ensemble's natural trade count

  if (amount <= 0) {
    return NextResponse.json({ error: "Amount must be > 0" }, { status: 400 });
  }

  let multi: any = null;
  try {
    multi = JSON.parse(
      await fs.readFile(path.join(process.cwd(), "data", "ml_predictions_multi.json"), "utf-8")
    );
  } catch {
    return NextResponse.json({ error: "Predictions file not found" }, { status: 503 });
  }

  const ensBt = multi?.ensemble_backtesting || {};

  // If numTrades is specified, ALL ensembles use the SAME number of trades
  // (scaled proportionally from their natural trade count)
  // If numTrades is 0, each ensemble uses its own natural trade count
  const useFixedTrades = numTrades > 0;
  const fixedTrades = useFixedTrades ? numTrades : 0;

  // Compute the number of days from the test period
  // Test period = last 25% of ~2475 bars per stock = ~619 trading days
  // But the actual number depends on the ensemble's trade frequency
  const testPeriodDays = 619; // approximate: 25% of 2475 daily bars

  const results: any[] = [];

  for (const [name, bt] of Object.entries(ensBt)) {
    if (name === "X_BASELINES") continue;
    if (!bt || typeof bt !== "object") continue;

    const naturalTrades = bt.totalTrades || bt.trade_count || 0;
    if (naturalTrades === 0 && !useFixedTrades) continue;

    // Determine trade count: fixed or natural
    const totalTrades = useFixedTrades ? fixedTrades : naturalTrades;

    const winRate = bt.winRate || 0;
    const winTrades = Math.round((winRate / 100) * totalTrades);
    const lossTrades = totalTrades - winTrades;
    const avgReturnPct = bt.avgReturnPct || bt.net_expectancy_pct || 0;
    const pf = bt.profitFactor || bt.profit_factor || 0;
    const sharpe = bt.sharpe || 0;
    const sortino = bt.sortino || 0;
    const maxDDpct = bt.maxDrawdownPct || bt.max_drawdown_pct || 0;
    const costBps = bt.costBps || 50;
    const stars = bt.stars || 0;

    // Derive avg win / avg loss from PF and avgReturn
    let avgWinPct = 0;
    let avgLossPct = 0;
    let grossProfitFrac = 0;
    let grossLossFrac = 0;

    if (pf > 0 && pf !== 1) {
      const avgReturnFrac = avgReturnPct / 100;
      grossLossFrac = (avgReturnFrac * totalTrades) / (1 - pf);
      grossProfitFrac = -pf * grossLossFrac;
      avgWinPct = winTrades > 0 ? (grossProfitFrac / winTrades) * 100 : 0;
      avgLossPct = lossTrades > 0 ? (grossLossFrac / lossTrades) * 100 : 0;
    } else if (pf === 1) {
      avgWinPct = Math.abs(avgReturnPct) * 2;
      avgLossPct = -Math.abs(avgReturnPct) * 2;
      grossProfitFrac = (avgWinPct / 100) * winTrades;
      grossLossFrac = (avgLossPct / 100) * lossTrades;
    }

    // User puts full amount — position size = full amount per trade
    // (user uses ALL the amount, not a fraction)
    const positionSize = amount;

    const grossProfitPKR = grossProfitFrac * positionSize;
    const grossLossPKR = Math.abs(grossLossFrac) * positionSize;
    const netPnL = grossProfitPKR - grossLossPKR;
    const finalValue = amount + netPnL;
    const roiPct = (netPnL / amount) * 100;
    const costPerTradePKR = (costBps / 10000) * positionSize;
    const totalCostsPKR = costPerTradePKR * totalTrades;
    const grossBeforeCosts = netPnL + totalCostsPKR;
    const maxDDPKR = Math.abs(maxDDpct / 100) * (amount + Math.max(0, netPnL));

    // Calculate days: if numDays specified, use it; otherwise estimate from trade frequency
    let daysUsed = numDays;
    if (numDays === 0) {
      // Estimate: test period is ~619 trading days. Scale by trade ratio.
      // If ensemble did naturalTrades trades in 619 days, and we're doing totalTrades trades,
      // then days = 619 * (totalTrades / naturalTrades) — but cap at 619
      if (naturalTrades > 0) {
        daysUsed = Math.round(testPeriodDays * (totalTrades / naturalTrades));
      } else {
        daysUsed = testPeriodDays;
      }
    }

    // Trades per day
    const tradesPerDay = daysUsed > 0 ? totalTrades / daysUsed : 0;

    results.push({
      name: name.replace(/_/g, " "),
      totalTrades,
      naturalTrades,
      winTrades,
      lossTrades,
      winRate: Math.round(winRate * 10) / 10,
      avgReturnPct: Math.round(avgReturnPct * 100) / 100,
      avgWinPct: Math.round(avgWinPct * 100) / 100,
      avgLossPct: Math.round(avgLossPct * 100) / 100,
      profitFactor: Math.round(pf * 1000) / 1000,
      sharpe: Math.round(sharpe * 100) / 100,
      sortino: Math.round(sortino * 100) / 100,
      stars,
      startingCapital: Math.round(amount),
      positionSize: Math.round(positionSize),
      grossProfitPKR: Math.round(grossProfitPKR),
      grossLossPKR: Math.round(grossLossPKR),
      netPnL: Math.round(netPnL),
      grossBeforeCosts: Math.round(grossBeforeCosts),
      totalCostsPKR: Math.round(totalCostsPKR),
      costPerTradePKR: Math.round(costPerTradePKR),
      finalValue: Math.round(finalValue),
      roiPct: Math.round(roiPct * 100) / 100,
      maxDDpct: Math.round(maxDDpct * 100) / 100,
      maxDDPKR: Math.round(maxDDPKR),
      costBps,
      daysUsed,
      tradesPerDay: Math.round(tradesPerDay * 100) / 100,
      testPeriodDays,
    });
  }

  // Sort by netPnL descending
  results.sort((a, b) => b.netPnL - a.netPnL);

  return NextResponse.json({
    amount,
    numDays: numDays || 0,
    numTrades: numTrades || 0,
    useFixedTrades,
    fixedTrades,
    positionSize: Math.round(amount),
    testPeriodDays,
    results,
    count: results.length,
  });
}
