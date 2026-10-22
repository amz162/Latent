import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const amount = parseFloat(url.searchParams.get("amount") || "100000");
  const positionPct = parseFloat(url.searchParams.get("positionPct") || "2");

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
  const positionSize = amount * (positionPct / 100);

  const results: any[] = [];

  for (const [name, bt] of Object.entries(ensBt)) {
    if (name === "X_BASELINES") continue;
    if (!bt || typeof bt !== "object") continue;

    const totalTrades = bt.totalTrades || bt.trade_count || 0;
    if (totalTrades === 0) continue;

    const winTrades = bt.winTrades || Math.round((bt.winRate / 100) * totalTrades) || 0;
    const lossTrades = bt.lossTrades || (totalTrades - winTrades) || 0;
    const winRate = bt.winRate || (winTrades / totalTrades * 100) || 0;
    const avgReturnPct = bt.avgReturnPct || bt.net_expectancy_pct || 0;
    const pf = bt.profitFactor || bt.profit_factor || 0;
    const sharpe = bt.sharpe || 0;
    const sortino = bt.sortino || 0;
    const maxDDpct = bt.maxDrawdownPct || bt.max_drawdown_pct || 0;
    const costBps = bt.costBps || 50;
    const stars = bt.stars || 0;

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
      grossProfitFrac = avgWinPct / 100 * winTrades;
      grossLossFrac = avgLossPct / 100 * lossTrades;
    }

    const grossProfitPKR = grossProfitFrac * positionSize;
    const grossLossPKR = Math.abs(grossLossFrac) * positionSize;
    const netPnL = grossProfitPKR - grossLossPKR;
    const finalValue = amount + netPnL;
    const roiPct = (netPnL / amount) * 100;
    const costPerTradePKR = (costBps / 10000) * positionSize;
    const totalCostsPKR = costPerTradePKR * totalTrades;
    const grossBeforeCosts = netPnL + totalCostsPKR;
    const maxDDPKR = Math.abs(maxDDpct / 100) * (amount + Math.max(0, netPnL));

    results.push({
      name: name.replace(/_/g, " "),
      totalTrades, winTrades, lossTrades,
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
    });
  }

  results.sort((a, b) => b.netPnL - a.netPnL);

  return NextResponse.json({
    amount, positionPct,
    positionSize: Math.round(positionSize),
    results, count: results.length,
  });
}
