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
  const viewDetail = url.searchParams.get("detail") === "1";
  // NEW: detail_summary mode — runs the trade-by-trade simulation so the
  // summary fields (netPnL, finalValue, grossProfitPKR, etc.) reflect the
  // ACTUAL compounding results (matching what ?detail=1 returns), but does
  // NOT include the trades array in the response. Used by the AI Models
  // summary call so the table values match View-in-Depth values without
  // downloading the full trade list for every ensemble.
  const detailSummary = url.searchParams.get("detail_summary") === "1";
  // Simulation runs when either detail flag is set.
  const runSim = viewDetail || detailSummary;
  // Trades array is only included in the response when ?detail=1 is set.
  const includeTrades = viewDetail;
  // NEW: SIP (Systematic Investment Plan) — PKR added to portfolio every month.
  // Optional; default 0 (no SIP). When > 0, SIP rows are injected into the
  // trade-by-trade list at regular intervals (every N trades, where N is
  // totalTrades / monthsInPeriod).
  const sip = parseFloat(url.searchParams.get("sip") || "0");

  if (amount <= 0) return NextResponse.json({ error: "Amount must be > 0" }, { status: 400 });
  if (sip < 0) return NextResponse.json({ error: "SIP must be >= 0" }, { status: 400 });

  let multi: any = null;
  try {
    multi = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "ml_predictions_multi.json"), "utf-8"));
  } catch { return NextResponse.json({ error: "Predictions file not found" }, { status: 503 }); }

  const ensBt = multi?.ensemble_backtesting || {};
  const useFixedTrades = numTrades > 0;
  const fixedTrades = useFixedTrades ? numTrades : 0;
  const testPeriodDays = 619;

  // Get sample stocks — filter out ones where entry==sl==tp1 (useless)
  const sampleStocks: any[] = [];
  const allPreds = multi?.cl_ensemble_predictions || multi?.gian_ensemble_predictions || {};
  for (const [sym, pred] of Object.entries(allPreds)) {
    const p: any = pred;
    const entry = p.entry || p.currentPrice || 0;
    const sl = p.sl || 0;
    const tp1 = p.tp1 || 0;
    const tp2 = p.tp2 || 0;
    const tp3 = p.tp3 || 0;
    // Skip stocks where all values are the same (useless for simulation)
    if (entry > 0 && sl > 0 && tp1 > 0 && tp2 > 0 && tp3 > 0) {
      const allDifferent = !(Math.abs(entry - sl) < 0.01 && Math.abs(sl - tp1) < 0.01 && Math.abs(tp1 - tp2) < 0.01 && Math.abs(tp2 - tp3) < 0.01);
      if (allDifferent) {
        sampleStocks.push({ symbol: sym, entry, sl, tp1, tp2, tp3, currentPrice: p.currentPrice || entry });
      }
    }
    if (sampleStocks.length >= 80) break;
  }

  const results: any[] = [];

  for (const [name, btAny] of Object.entries(ensBt)) {
    if (name === "X_BASELINES") continue;
    if (!btAny || typeof btAny !== "object") continue;
    const bt: any = btAny;

    const naturalBuyTrades = bt.buySignals || Math.round((bt.winRate / 100) * (bt.totalTrades || 0)) || 0;
    if (naturalBuyTrades === 0 && !useFixedTrades) continue;

    // Determine total trades based on parameters:
    // - If numTrades is fixed (from UI), use that directly.
    // - Else if numDays > 0 (time horizon mode), scale natural buy trades by
    //   numDays / testPeriodDays (e.g., 365/619 → ~59% of natural trades).
    // - Else fall back to natural buy trades.
    let totalTrades: number;
    if (useFixedTrades) {
      totalTrades = fixedTrades;
    } else if (numDays > 0) {
      totalTrades = Math.max(1, Math.round(naturalBuyTrades * (numDays / testPeriodDays)));
    } else {
      totalTrades = naturalBuyTrades;
    }
    // Cap to prevent runaway compounding (with SIP enabled, allow higher cap
    // to accommodate longer time horizons up to 1 year of monthly SIPs).
    const TRADE_CAP = sip > 0 ? 600 : 200;
    totalTrades = Math.min(Math.max(1, totalTrades), TRADE_CAP);
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
    const tp1Rate = bt.tp1HitRate || bt.tp1_hit_rate || 0;
    const tp2Rate = bt.tp2HitRate || bt.tp2_hit_rate || 0;
    const tp3Rate = bt.tp3HitRate || bt.tp3_hit_rate || 0;

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

    const positionSizeInit = amount;
    const grossProfitPKR = grossProfitFrac * positionSizeInit;
    const grossLossPKR = Math.abs(grossLossFrac) * positionSizeInit;
    const netPnL = grossProfitPKR - grossLossPKR;
    const finalValue = amount + netPnL;
    const roiPct = (netPnL / amount) * 100;
    const costPerTradePKR = (costBps / 10000) * positionSizeInit;
    const totalCostsPKR = costPerTradePKR * totalTrades;
    const grossBeforeCosts = netPnL + totalCostsPKR;
    const maxDDPKR = Math.abs(maxDDpct / 100) * (amount + Math.max(0, netPnL));

    let daysUsed = numDays;
    if (numDays === 0) {
      const naturalTotal = bt.totalTrades || bt.trade_count || 1;
      daysUsed = Math.round(testPeriodDays * (totalTrades / naturalTotal));
    }
    const tradesPerDay = daysUsed > 0 ? totalTrades / daysUsed : 0;
    // Compute the number of months in this period — used for SIP injection.
    // A "month" is 30.44 days (365 / 12). For numDays=365 → 12 months.
    const monthsInPeriod = Math.max(1, Math.ceil((daysUsed || testPeriodDays) / 30.44));

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
      positionSize: Math.round(positionSizeInit),
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

    if (runSim) {
      const trades: any[] = [];
      let portfolio = amount;

      // Distribute win/loss based on win rate
      const tradeTypes: ("win" | "loss")[] = [];
      for (let i = 0; i < winTrades; i++) tradeTypes.push("win");
      for (let i = 0; i < lossTrades; i++) tradeTypes.push("loss");
      for (let i = tradeTypes.length - 1; i > 0; i--) {
        const j = Math.floor((i * 9301 + 49297) % 233280) / 233280 * (i + 1);
        [tradeTypes[i], tradeTypes[Math.floor(j)]] = [tradeTypes[Math.floor(j)], tradeTypes[i]];
      }

      // For winning trades: determine which TP was hit (TP3 > TP2 > TP1)
      // Use the ensemble's TP hit rates to distribute
      const tp3Count = Math.round(tp3Rate * totalTrades);
      const tp2Count = Math.round(tp2Rate * totalTrades);
      const tp1Count = winTrades - tp3Count - tp2Count;
      const winExitTypes: ("TP3" | "TP2" | "TP1")[] = [];
      for (let i = 0; i < Math.max(0, tp1Count); i++) winExitTypes.push("TP1");
      for (let i = 0; i < Math.max(0, tp2Count); i++) winExitTypes.push("TP2");
      for (let i = 0; i < Math.max(0, tp3Count); i++) winExitTypes.push("TP3");
      // Shuffle exit types
      for (let i = winExitTypes.length - 1; i > 0; i--) {
        const j = Math.floor((i * 7919 + 104729) % 233280) / 233280 * (i + 1);
        [winExitTypes[i], winExitTypes[Math.floor(j)]] = [winExitTypes[Math.floor(j)], winExitTypes[i]];
      }
      let winExitIdx = 0;

      let stockIdx = 0;
      // NEW: SIP injection — every `sipInterval` trades, inject a SIP row that
      // adds `sip` PKR to the portfolio. SIP rows have no entry/sl/tp; they're
      // cash deposits. `sipsAdded` caps at monthsInPeriod so we don't exceed
      // the time horizon.
      const sipInterval = sip > 0 ? Math.max(1, Math.floor(totalTrades / monthsInPeriod)) : 0;
      let sipsAdded = 0;
      const sipRows: any[] = []; // track SIP row indices for display
      for (let i = 0; i < totalTrades && i < TRADE_CAP; i++) {
        // Inject SIP at the start of each "month" (every sipInterval trades)
        // — but skip the very first iteration (initial investment covers month 0).
        if (sip > 0 && i > 0 && sipInterval > 0 && i % sipInterval === 0 && sipsAdded < monthsInPeriod) {
          portfolio += sip;
          const sipRow = {
            tradeNum: trades.length + 1,
            symbol: "—",
            signal: "SIP",
            entry: 0,
            close: 0,
            sl: 0,
            bestTP: "—",
            tp1: 0, tp2: 0, tp3: 0,
            investAmount: Math.round(sip),
            pnl: Math.round(sip),
            result: "SIP",
            portfolioValue: Math.round(portfolio),
            isSip: true,
            sipAmount: Math.round(sip),
          };
          trades.push(sipRow);
          sipRows.push(sipRow);
          sipsAdded++;
        }

        const isWin = tradeTypes[i] === "win";

        // Pick a stock with DIFFERENT entry/sl/tp values (skip useless ones)
        let stock: any = null;
        let attempts = 0;
        while (attempts < sampleStocks.length) {
          const candidate = sampleStocks[stockIdx % sampleStocks.length];
          stockIdx++;
          attempts++;
          if (candidate && candidate.entry > 0 && candidate.sl > 0 && candidate.tp1 > 0 &&
              candidate.tp2 > 0 && candidate.tp3 > 0) {
            // Check that values are different (not all same)
            const allSame = Math.abs(candidate.entry - candidate.sl) < 0.01 &&
                           Math.abs(candidate.sl - candidate.tp1) < 0.01 &&
                           Math.abs(candidate.tp1 - candidate.tp2) < 0.01;
            if (!allSame) {
              stock = candidate;
              break;
            }
          }
        }
        if (!stock) continue; // skip if no good stock found

        const entry = stock.entry;
        const sl = stock.sl;
        const tp1 = stock.tp1;
        const tp2 = stock.tp2;
        const tp3 = stock.tp3;

        // Determine BEST TP for winning trades (check TP3 first, then TP2, then TP1)
        let bestTP = "TP1";
        let close = tp1;
        let retPct = avgWinPct;

        if (isWin) {
          const exitType = winExitTypes[winExitIdx % winExitTypes.length] || "TP1";
          winExitIdx++;
          if (exitType === "TP3") {
            bestTP = "TP3";
            close = tp3;
            // Calculate actual return based on TP3 vs entry
            retPct = ((tp3 - entry) / entry) * 100;
          } else if (exitType === "TP2") {
            bestTP = "TP2";
            close = tp2;
            retPct = ((tp2 - entry) / entry) * 100;
          } else {
            bestTP = "TP1";
            close = tp1;
            retPct = ((tp1 - entry) / entry) * 100;
          }
        } else {
          // Loss: exit at SL. Use the ACTUAL return based on SL vs entry
          // (so losses actually subtract from the portfolio — not 0 even if
          // the ensemble's avgLossPct is 0 / undefined).
          close = sl;
          retPct = ((sl - entry) / entry) * 100;
        }

        // Compounding
        const investAmount = Math.round(portfolio);
        const pnl = Math.round(investAmount * retPct / 100);
        portfolio += pnl;

        trades.push({
          tradeNum: trades.length + 1,
          symbol: stock.symbol,
          signal: "BUY",
          entry: Math.round(entry * 100) / 100,
          close: Math.round(close * 100) / 100,
          sl: Math.round(sl * 100) / 100,
          bestTP,
          tp1: Math.round(tp1 * 100) / 100,
          tp2: Math.round(tp2 * 100) / 100,
          tp3: Math.round(tp3 * 100) / 100,
          investAmount,
          pnl,
          result: isWin ? "WIN" : "LOSS",
          portfolioValue: Math.round(portfolio),
        });
      }
      // Inject any remaining SIPs at the end of the period
      while (sip > 0 && sipsAdded < monthsInPeriod) {
        portfolio += sip;
        const sipRow = {
          tradeNum: trades.length + 1,
          symbol: "—",
          signal: "SIP",
          entry: 0, close: 0, sl: 0,
          bestTP: "—",
          tp1: 0, tp2: 0, tp3: 0,
          investAmount: Math.round(sip),
          pnl: Math.round(sip),
          result: "SIP",
          portfolioValue: Math.round(portfolio),
          isSip: true,
          sipAmount: Math.round(sip),
        };
        trades.push(sipRow);
        sipRows.push(sipRow);
        sipsAdded++;
      }

      // Only include the trades array in the response when ?detail=1 is set.
      // In ?detail_summary=1 mode we still run the full simulation so the
      // summary values are accurate, but we strip the (potentially huge) trades
      // array to keep the response size small for the AI Models summary table.
      if (includeTrades) {
        result.trades = trades;
      }
      result.totalTradesShown = trades.length;
      result.sipCount = sipsAdded;
      result.sipPerMonth = Math.round(sip);
      result.totalSipContributed = Math.round(sip * sipsAdded);
      result.totalInvestedWithSip = Math.round(amount + sip * sipsAdded);
      // OVERRIDE netPnL, finalValue, roiPct with the ACTUAL compounding results
      // Net P&L = (last trade's portfolio value) - (starting investment amount) - (total SIP added)
      // Because SIP deposits aren't investment returns — they're external cash injections.
      const lastPortfolio = trades.length > 0 ? trades[trades.length - 1].portfolioValue : amount;
      const totalSipAdded = sip * sipsAdded;
      result.finalValue = Math.round(lastPortfolio);
      result.netPnL = Math.round(lastPortfolio - amount - totalSipAdded);
      result.roiPct = amount > 0 ? Math.round(((lastPortfolio - totalSipAdded) / amount - 1) * 10000) / 100 : 0;
      result.compoundingFinalValue = Math.round(lastPortfolio);
      result.compoundingROI = result.roiPct;
      // Recompute gross profit/loss from actual trades (sum of winning P&Ls and losing P&Ls)
      // EXCLUDE SIP rows — those are deposits, not trade returns.
      let actualGrossProfit = 0, actualGrossLoss = 0;
      for (const t of trades) {
        if (t.isSip) continue;
        if (t.pnl >= 0) actualGrossProfit += t.pnl;
        else actualGrossLoss += Math.abs(t.pnl);
      }
      result.grossProfitPKR = Math.round(actualGrossProfit);
      result.grossLossPKR = Math.round(actualGrossLoss);
      // Recompute maxDD in PKR based on the peak-to-trough drawdown across trades
      // EXCLUDE SIP-only rows from the peak-tracking — they're deposits, not
      // market-driven equity growth. (A deposit inflates portfolio but isn't a "peak".)
      let peak = amount, maxDDPKR = 0;
      for (const t of trades) {
        if (t.isSip) continue;
        if (t.portfolioValue > peak) peak = t.portfolioValue;
        const dd = peak - t.portfolioValue;
        if (dd > maxDDPKR) maxDDPKR = dd;
      }
      result.maxDDPKR = Math.round(maxDDPKR);
      result.maxDDpct = amount > 0 ? Math.round((maxDDPKR / amount) * 10000) / 100 : 0;
    }

    results.push(result);
  }

  results.sort((a, b) => b.netPnL - a.netPnL);

  return NextResponse.json({
    amount, numDays: numDays || 0, numTrades: numTrades || 0,
    useFixedTrades, fixedTrades,
    positionSize: Math.round(amount),
    sip: Math.round(sip),
    testPeriodDays, onlyBuyTrades: true, compounding: true,
    detail: viewDetail, detail_summary: detailSummary,
    results, count: results.length,
  });
}
