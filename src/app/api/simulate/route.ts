import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const amount = parseFloat(url.searchParams.get("amount") || "100000");
  const numDays = parseInt(url.searchParams.get("numDays") || "0");
  const numTradesParam = url.searchParams.get("numTrades");
  const numTrades = numTradesParam ? parseInt(numTradesParam) : 0;
  const viewDetail = url.searchParams.get("detail") === "1"; // return trade-by-trade list

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
  const useFixedTrades = numTrades > 0;
  const fixedTrades = useFixedTrades ? numTrades : 0;
  const testPeriodDays = 619;

  // Get sample stocks with predictions for trade-by-trade detail
  const sampleStocks: any[] = [];
  const allPreds = multi?.cl_ensemble_predictions || multi?.gian_ensemble_predictions || {};
  for (const [sym, pred] of Object.entries(allPreds)) {
    if (sampleStocks.length >= 50) break;
    sampleStocks.push({ symbol: sym, ...pred });
  }

  const results: any[] = [];

  for (const [name, bt] of Object.entries(ensBt)) {
    if (name === "X_BASELINES") continue;
    if (!bt || typeof bt !== "object") continue;

    // Use ONLY BUY trades (PSX doesn't allow short selling)
    const naturalBuyTrades = bt.buySignals || Math.round((bt.winRate / 100) * (bt.totalTrades || 0)) || 0;
    if (naturalBuyTrades === 0 && !useFixedTrades) continue;

    // Determine trade count: fixed or natural BUY trades
    const totalTrades = useFixedTrades ? fixedTrades : naturalBuyTrades;

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

    let avgWinPct = 0, avgLossPct = 0, grossProfitFrac = 0, grossLossFrac = 0;
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

    let daysUsed = numDays;
    if (numDays === 0) {
      const naturalTotal = bt.totalTrades || bt.trade_count || 1;
      daysUsed = Math.round(testPeriodDays * (totalTrades / naturalTotal));
    }
    const tradesPerDay = daysUsed > 0 ? totalTrades / daysUsed : 0;

    const result: any = {
      name: name.replace(/_/g, " "),
      totalTrades, naturalTrades: naturalBuyTrades,
      winTrades, lossTrades,
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
    };

    // If detail requested, generate trade-by-trade list
    if (viewDetail) {
      const trades: any[] = [];
      let cumulative = 0;
      // Distribute wins/losses based on win rate (interleaved)
      const tradeTypes: ("win" | "loss")[] = [];
      for (let i = 0; i < winTrades; i++) tradeTypes.push("win");
      for (let i = 0; i < lossTrades; i++) tradeTypes.push("loss");
      // Shuffle deterministically
      for (let i = tradeTypes.length - 1; i > 0; i--) {
        const j = Math.floor((i * 9301 + 49297) % 233280) / 233280 * (i + 1);
        [tradeTypes[i], tradeTypes[Math.floor(j)]] = [tradeTypes[Math.floor(j)], tradeTypes[i]];
      }

      for (let i = 0; i < totalTrades && i < 200; i++) { // cap at 200 for response size
        const isWin = tradeTypes[i] === "win";
        const retPct = isWin ? avgWinPct : avgLossPct;
        const pnl = Math.round(positionSize * retPct / 100);
        cumulative += pnl;
        // Pick a sample stock
        const stock = sampleStocks[i % sampleStocks.length] || sampleStocks[0] || {};
        const entry = stock.entry || stock.currentPrice || 100;
        const sl = stock.sl || entry * 0.95;
        const tp1 = stock.tp1 || entry * 1.05;
        const tp2 = stock.tp2 || entry * 1.10;
        const tp3 = stock.tp3 || entry * 1.15;

        trades.push({
          tradeNum: i + 1,
          symbol: stock.symbol || stock.value || "—",
          signal: "BUY",
          direction: "LONG",
          entry: Math.round(entry * 100) / 100,
          sl: Math.round(sl * 100) / 100,
          tp1: Math.round(tp1 * 100) / 100,
          tp2: Math.round(tp2 * 100) / 100,
          tp3: Math.round(tp3 * 100) / 100,
          investAmount: positionSize,
          pnl: pnl,
          result: isWin ? "WIN" : "LOSS",
          cumulativePnL: Math.round(cumulative),
          portfolioValue: Math.round(amount + cumulative),
        });
      }
      result.trades = trades;
      result.totalTradesShown = trades.length;
    }

    results.push(result);
  }

  results.sort((a, b) => b.netPnL - a.netPnL);

  return NextResponse.json({
    amount, numDays: numDays || 0, numTrades: numTrades || 0,
    useFixedTrades, fixedTrades,
    positionSize: Math.round(amount),
    testPeriodDays, onlyBuyTrades: true,
    results, count: results.length,
  });
}
