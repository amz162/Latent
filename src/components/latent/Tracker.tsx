"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { AppNav } from "./AppNav";
import { useLatentStore } from "@/lib/latent/store";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Trophy,
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
  Briefcase,
  Download,
  Brain,
  Target,
  Wallet,
  Play,
  RotateCcw,
  Check,
  X,
  Unlock,
  Clock,
  PieChart as PieChartIcon,
} from "lucide-react";
import { toast } from "sonner";

// The 8 PSX stocks covered by our AI model signal engine.
const COVERED_SYMBOLS = ["ENGRO", "HUBC", "LUCK", "SYS", "MEBL", "PSO", "OGDC", "PPL"];

// Issue 17: timeframe selector for the signal tracker (previously only 30 days).
// The model-training script (`scripts/train_all_with_backtesting.py`) currently
// bakes a 30-day backtest window into ml_predictions_multi.json — the API will
// ignore the `timeframe` query param for now, but we pass it through so future
// retraining can support different windows without UI changes.
type TimeframeKey = "1m" | "3m" | "6m" | "1y";
const TIMEFRAMES: { key: TimeframeKey; label: string; short: string; days: number }[] = [
  { key: "1m", label: "1 month", short: "1M", days: 30 },
  { key: "3m", label: "3 months", short: "3M", days: 90 },
  { key: "6m", label: "6 months", short: "6M", days: 180 },
  { key: "1y", label: "1 year", short: "1Y", days: 365 },
];
const TIMEFRAME_DEFAULT: TimeframeKey = "1m";

// Subset of /api/ai-model-signals/[symbol] response shape that we consume.
interface BacktestStats {
  totalTrades?: number;
  wins?: number;
  winRate?: number;
  avgReturnPct?: number;
  maxReturnPct?: number;
  minReturnPct?: number;
  stars?: number;
  buySignals?: number;
  sellSignals?: number;
  correctBuys?: number;
  correctSells?: number;
}

interface FinalConsensus {
  signal: "BUY" | "SELL" | "HOLD";
  direction: "LONG" | "SHORT";
  confidence: number;
  agreement: number;
  predictedPriceRange: { min: number; max: number };
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
}

interface AiSignalResponse {
  symbol: string;
  stockName: string;
  currentPrice: number;
  finalConsensus: FinalConsensus;
  backtesting: Record<string, BacktestStats>;
  ensembleBacktesting: Record<string, BacktestStats>;
  trainedModelCount: number;
  totalModelCount: number;
  trainedAt: string;
  cached: boolean;
}

interface StockSignal {
  symbol: string;
  stockName: string;
  direction: "LONG" | "SHORT";
  signal: "BUY" | "SELL" | "HOLD";
  entry: number;
  target: number;
  sl: number;
  retPct: number;
  confidence: number;
  agreement: number;
  currentPrice: number;
}

function fmtPct(v: number, withSign = false): string {
  const sign = withSign && v > 0 ? "+" : "";
  return `${sign}${Number(v).toFixed(2)}%`;
}

function fmtPkr(v: number): string {
  return `Rs. ${Math.round(v).toLocaleString("en-PK")}`;
}

export function Tracker() {
  const [aiSignals, setAiSignals] = useState<AiSignalResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<TimeframeKey>(TIMEFRAME_DEFAULT);
  const portfolio = useLatentStore((s) => s.portfolio);
  const closedTrades = useLatentStore((s) => s.closedTrades);
  const closePortfolioPosition = useLatentStore((s) => s.closePortfolioPosition);
  const reopenPortfolioPosition = useLatentStore((s) => s.reopenPortfolioPosition);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      COVERED_SYMBOLS.map((sym) =>
        fetch(`/api/ai-model-signals/${sym}?refresh=1&timeframe=${timeframe}`)
          .then((r) => r.json())
          .catch(() => null)
      )
    )
      .then((results) => {
        if (cancelled) return;
        const valid = (results.filter(Boolean) as AiSignalResponse[]);
        setAiSignals(valid);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [timeframe]);

  // Lookup helper for human-readable timeframe label
  const timeframeLabel = TIMEFRAMES.find((t) => t.key === timeframe)?.label || "1 month";
  const timeframeShort = TIMEFRAMES.find((t) => t.key === timeframe)?.short || "1M";

  // Ensemble-level backtesting stats — these are global (same across symbols)
  // so we just use the first available response as the source of truth.
  const ensStats = useMemo(() => {
    if (aiSignals.length === 0) return null;
    const eb = aiSignals[0]?.ensembleBacktesting || {};
    return {
      fc: (eb["FINAL_CONSENSUS"] || {}) as BacktestStats,
      mv: (eb["MAJORITY_VOTE"] || {}) as BacktestStats,
      pw: (eb["PROBABILITY_WEIGHTED"] || {}) as BacktestStats,
      tw: (eb["TIER_WEIGHTED"] || {}) as BacktestStats,
    };
  }, [aiSignals]);

  // Per-model backtesting rows — top 6 by win rate.
  const modelBacktest = useMemo(() => {
    if (aiSignals.length === 0) return [];
    const bt = aiSignals[0]?.backtesting || {};
    return Object.entries(bt)
      .map(([name, s]) => ({ name, ...s }))
      .filter((m) => typeof m.winRate === "number")
      .sort((a, b) => (b.winRate || 0) - (a.winRate || 0))
      .slice(0, 6);
  }, [aiSignals]);

  // Per-stock signals from finalConsensus (only actionable BUY/SELL).
  const stockSignals: StockSignal[] = useMemo(() => {
    return aiSignals
      .map((s) => {
        const fc = s.finalConsensus;
        if (!fc || !fc.entry || fc.signal === "HOLD") return null;
        const target = fc.predictedPriceRange?.max || fc.tp3 || fc.entry;
        const retPct = ((target - fc.entry) / fc.entry) * 100;
        return {
          symbol: s.symbol,
          stockName: s.stockName,
          direction: fc.direction,
          signal: fc.signal as "BUY" | "SELL" | "HOLD",
          entry: fc.entry,
          target,
          sl: fc.sl,
          retPct,
          confidence: fc.confidence,
          agreement: fc.agreement,
          currentPrice: s.currentPrice,
        } as StockSignal;
      })
      .filter(Boolean) as StockSignal[];
  }, [aiSignals]);

  // ─── Investment simulation across trades (Issue 22) ───
  // Each "trade" is a per-stock final consensus signal. The predicted return %
  // (retPct) serves as the avgReturnPct for that trade.
  interface SimRow {
    tradeNo: number;
    symbol: string;
    side: "BUY" | "SELL";
    entryAmount: number;
    returnPct: number;
    pnl: number;
    exitAmount: number;
    isWin: boolean;
  }
  interface SimResult {
    rows: SimRow[];
    initialAmount: number;
    finalAmount: number;
    totalPnl: number;
    totalReturnPct: number;
    wins: number;
    losses: number;
  }

  const [simAmount, setSimAmount] = useState<string>("100000");
  const [simResult, setSimResult] = useState<SimResult | null>(null);

  const runSimulation = () => {
    const initial = parseFloat(simAmount.replace(/[,\s]/g, ""));
    if (!Number.isFinite(initial) || initial <= 0) {
      toast.error("Enter a valid investment amount");
      return;
    }
    if (stockSignals.length === 0) {
      toast.error("No actionable signals to simulate");
      return;
    }
    let amount = initial;
    let wins = 0;
    let losses = 0;
    const rows: SimRow[] = stockSignals.map((s, i) => {
      const entryAmount = amount;
      const returnPct = s.retPct;
      const pnl = entryAmount * (returnPct / 100);
      const exitAmount = entryAmount + pnl;
      const isWin = pnl > 0;
      if (isWin) wins++;
      else if (pnl < 0) losses++;
      amount = exitAmount;
      return {
        tradeNo: i + 1,
        symbol: s.symbol,
        side: s.signal,
        entryAmount,
        returnPct,
        pnl,
        exitAmount,
        isWin,
      };
    });
    const finalAmount = amount;
    const totalPnl = finalAmount - initial;
    const totalReturnPct = (totalPnl / initial) * 100;
    setSimResult({
      rows,
      initialAmount: initial,
      finalAmount,
      totalPnl,
      totalReturnPct,
      wins,
      losses,
    });
    toast.success(`Simulated ${rows.length} trades — final ${fmtPkr(finalAmount)}`);
  };

  const resetSimulation = () => {
    setSimResult(null);
  };

  // Aggregate top-card stats — uses ensembleBacktesting.FINAL_CONSENSUS.
  const signalStats = useMemo(() => {
    const fc = ensStats?.fc;
    if (!fc) return null;
    const total = fc.totalTrades ?? 0;
    const wins = fc.wins ?? Math.round((total * (fc.winRate || 0)) / 100);
    const losses = total - wins;
    const winRate = fc.winRate ?? 0;
    const avgReturn = fc.avgReturnPct ?? 0;
    const best = fc.maxReturnPct ?? 0;
    const worst = fc.minReturnPct ?? 0;
    return { total, wins, losses, winRate, avgReturn, best, worst };
  }, [ensStats]);

  // Portfolio tracker — only positions with buyPrice != null && shares > 0
  // are tracked. Closed positions remain in the list and contribute to P&L.
  // Issue 23: keep closed trades visible + reflect them in top card stats.
  const livePriceMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of aiSignals) {
      if (s.symbol && typeof s.currentPrice === "number") m[s.symbol] = s.currentPrice;
    }
    return m;
  }, [aiSignals]);

  const portfolioPositions = useMemo(
    () => portfolio.filter((p) => p.buyPrice !== null && p.shares > 0),
    [portfolio]
  );

  const portfolioStats = useMemo(() => {
    let totalValue = 0;
    let totalInvested = 0;
    let totalPnl = 0;
    let openCount = 0;
    let closedCount = 0;
    let closedWins = 0;
    let hasLiveForOpen = false;
    let hasAnyPnl = false;

    for (const p of portfolioPositions) {
      const buy = (p.buyPrice as number) || 0;
      const invested = buy * p.shares;
      totalInvested += invested;

      const isOpen = (p.status || "open") === "open";
      if (isOpen) {
        openCount++;
        const live = livePriceMap[p.symbol];
        if (typeof live === "number") {
          const val = live * p.shares;
          totalValue += val;
          totalPnl += val - invested;
          hasLiveForOpen = true;
          hasAnyPnl = true;
        }
      } else {
        closedCount++;
        const close = typeof p.closePrice === "number" ? (p.closePrice as number) : null;
        if (close !== null) {
          const val = close * p.shares;
          totalValue += val;
          const pnl = val - invested;
          totalPnl += pnl;
          if (pnl > 0) closedWins++;
          hasAnyPnl = true;
        }
      }
    }

    const roiPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
    const closedTotalForWinRate = closedCount;
    const winRate = closedTotalForWinRate > 0 ? (closedWins / closedTotalForWinRate) * 100 : null;

    return {
      total: portfolioPositions.length,
      totalValue,
      totalInvested,
      totalPnl,
      roiPct,
      openCount,
      closedCount,
      closedWins,
      winRate,
      hasLiveForOpen,
      hasAnyPnl,
    };
  }, [portfolioPositions, livePriceMap]);

  const handleDownload = () => {
    if (!signalStats) return;
    const lines = [
      "Latent.pk — Tracker Report (Real Backtest Data)",
      "Generated: " + new Date().toISOString(),
      "Source: /api/ai-model-signals/[symbol]?refresh=1",
      "Covered: " + COVERED_SYMBOLS.join(", "),
      `Timeframe: ${timeframeLabel}`,
      "",
      `=== SIGNAL TRACKER (Last ${timeframeLabel} Backtest) ===`,
      `Total signals: ${signalStats.total}`,
      `Win rate: ${signalStats.winRate}%`,
      `Avg return: ${fmtPct(signalStats.avgReturn, true)}`,
      `Best trade: ${fmtPct(signalStats.best, true)}`,
      `Worst trade: ${fmtPct(signalStats.worst)}`,
      "",
      "=== PER-STOCK SIGNALS (FINAL CONSENSUS) ===",
      ...stockSignals.map((s) => `${s.symbol} ${s.signal} entry=${s.entry} target=${s.target} ret=${fmtPct(s.retPct, true)} conf=${s.confidence}%`),
      "",
      "=== PORTFOLIO TRACKER (OPEN POSITIONS) ===",
      ...portfolioPositions.map((p) => {
        const side = (p.status || "open") === "open" ? "open" : "closed";
        const close = typeof p.closePrice === "number" ? p.closePrice : null;
        return `${p.symbol} | ${side} | buy: ${p.buyPrice || "—"} | shares: ${p.shares}${close !== null ? ` | close: ${close}` : ""}`;
      }),
      "",
      "=== CLOSED TRADES (FROM PORTFOLIO CLOSE FLOW) ===",
      ...closedTrades.map(
        (t) =>
          `${t.symbol} | buy: ${t.buyPrice} × ${t.shares} = ${Math.round(t.buyCost)} | sell: ${t.sellPrice.toFixed(2)} × ${t.shares} = ${Math.round(t.sellValue)} | commission: ${Math.round(t.commission)} | CGT: ${Math.round(t.cgt)} (${(t.taxRate * 100).toFixed(0)}%) | net P&L: ${Math.round(t.netPnl)} (${t.netPnlPct >= 0 ? "+" : ""}${t.netPnlPct.toFixed(2)}%) | holding: ${t.holdingDays}d | closed: ${t.closedAt}`
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `latent-tracker-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Tracker report downloaded");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0E1A]">
        <AppNav />
        <div className="max-w-6xl mx-auto p-6 space-y-4">
          <Skeleton className="h-10 w-48 bg-white/[0.04]" />
          <Skeleton className="h-32 w-full bg-white/[0.04]" />
          <Skeleton className="h-64 w-full bg-white/[0.04]" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0E1A]">
      <AppNav />
      <main className="px-4 md:px-6 py-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#F4F7FB]">Tracker</h1>
            <p className="text-sm text-[#94A3B8] mt-1">
              Real backtest stats across {COVERED_SYMBOLS.length} PSX stocks — signal tracker (model performance) + portfolio tracker (your P&amp;L).
            </p>
          </div>
          <Button
            onClick={handleDownload}
            className="bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold"
          >
            <Download className="h-4 w-4 mr-1.5" />
            Generate report
          </Button>
        </div>

        <Tabs defaultValue="signal">
          <TabsList className="bg-[#131829] border border-white/[0.08] p-1 h-auto">
            <TabsTrigger value="signal" className="data-[state=active]:bg-[#00E676]/10 data-[state=active]:text-[#00E676] text-[#94A3B8] text-xs gap-1.5">
              <Zap className="h-3 w-3" /> Signal Tracker
            </TabsTrigger>
            <TabsTrigger value="portfolio" className="data-[state=active]:bg-[#00E676]/10 data-[state=active]:text-[#00E676] text-[#94A3B8] text-xs gap-1.5">
              <Briefcase className="h-3 w-3" /> Portfolio Tracker
            </TabsTrigger>
          </TabsList>

          {/* Signal Tracker */}
          <TabsContent value="signal" className="mt-4">
            {!signalStats ? (
              <Card className="bg-[#131829] border-white/[0.08]">
                <CardContent className="p-12 text-center">
                  <Brain className="h-12 w-12 text-[#00E676]/30 mx-auto mb-3" />
                  <h3 className="font-semibold text-[#F4F7FB] mb-1">Backtest data unavailable</h3>
                  <p className="text-xs text-[#94A3B8]">
                    Run <code className="text-[#00E676]">python3 scripts/train_all_with_backtesting.py</code> to populate model predictions.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* ─── Issue 17: Investment simulator moved to the TOP ─── */}
                <Card className="bg-[#131829] border-[#00E676]/20 mb-5">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Wallet className="h-3.5 w-3.5 text-[#00E676]" />
                      <h3 className="font-semibold text-[#F4F7FB] text-sm">Investment simulator</h3>
                      <Badge variant="outline" className="text-[8px] py-0 h-3.5 border-[#00E676]/30 text-[#00E676]/80 ml-1">
                        TOP
                      </Badge>
                    </div>
                    <p className="text-xs text-[#94A3B8] mb-3">
                      Enter a starting amount — we&apos;ll roll it through each actionable signal
                      ({stockSignals.length} trades) using the predicted return %, compounding trade-over-trade.
                    </p>

                    <div className="flex flex-wrap items-end gap-2 mb-4">
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase tracking-wider text-[#64748B]">
                          Investment amount (PKR)
                        </label>
                        <div className="flex items-center gap-1.5 bg-[#0A0E1A] border border-white/[0.08] rounded-md px-3 py-2 focus-within:border-[#00E676]/40">
                          <span className="text-xs text-[#64748B] font-mono">Rs.</span>
                          <Input
                            value={simAmount}
                            onChange={(e) => setSimAmount(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") runSimulation();
                            }}
                            placeholder="100000"
                            inputMode="decimal"
                            className="h-7 w-40 border-0 bg-transparent p-0 text-sm font-mono text-[#F4F7FB] focus-visible:ring-0"
                          />
                        </div>
                      </div>
                      <Button
                        onClick={runSimulation}
                        className="bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold h-9"
                      >
                        <Play className="h-3.5 w-3.5 mr-1.5" />
                        Simulate
                      </Button>
                      {simResult && (
                        <Button
                          onClick={resetSimulation}
                          variant="outline"
                          className="border-white/[0.12] text-[#94A3B8] hover:text-[#F4F7FB] h-9"
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                          Reset
                        </Button>
                      )}
                      <div className="text-[10px] text-[#64748B] ml-auto self-center">
                        {stockSignals.length} trades · compounded
                      </div>
                    </div>

                    {simResult && (
                      <>
                        {/* Summary line */}
                        <div className="rounded-lg border border-white/[0.06] bg-[#0A0E1A] p-3 mb-3">
                          <p className="text-sm text-[#F4F7FB] leading-relaxed">
                            If you invested{" "}
                            <span className="font-mono font-bold text-[#00E676]">{fmtPkr(simResult.initialAmount)}</span>{" "}
                            across{" "}
                            <span className="font-mono font-bold text-[#F4F7FB]">{simResult.rows.length} trades</span>, your
                            final amount would be{" "}
                            <span className={`font-mono font-bold ${simResult.totalPnl >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}`}>
                              {fmtPkr(simResult.finalAmount)}
                            </span>{" "}
                            (
                            <span className={`font-mono font-bold ${simResult.totalPnl >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}`}>
                              {simResult.totalPnl >= 0 ? "+" : ""}
                              {simResult.totalReturnPct.toFixed(2)}% {simResult.totalPnl >= 0 ? "gain" : "loss"}
                            </span>
                            )
                          </p>
                          <div className="flex flex-wrap items-center gap-4 mt-2 text-[11px]">
                            <span className="text-[#94A3B8]">
                              Total P&amp;L:{" "}
                              <span className={`font-mono font-semibold ${simResult.totalPnl >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}`}>
                                {simResult.totalPnl >= 0 ? "+" : ""}{fmtPkr(simResult.totalPnl)}
                              </span>
                            </span>
                            <span className="text-[#94A3B8]">
                              Wins: <span className="font-mono text-[#00E676]">{simResult.wins}</span>
                            </span>
                            <span className="text-[#94A3B8]">
                              Losses: <span className="font-mono text-[#FF5C5C]">{simResult.losses}</span>
                            </span>
                            <span className="text-[#94A3B8]">
                              Win rate:{" "}
                              <span className="font-mono text-[#F4F7FB]">
                                {simResult.rows.length > 0
                                  ? ((simResult.wins / simResult.rows.length) * 100).toFixed(1)
                                  : 0}
                                %
                              </span>
                            </span>
                          </div>
                        </div>

                        {/* Trade-by-trade table */}
                        <div className="overflow-x-auto max-h-80 overflow-y-auto rounded-md border border-white/[0.06]">
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-[#131829]">
                              <tr className="text-[10px] uppercase tracking-wider text-[#64748B] border-b border-white/[0.06]">
                                <th className="text-left py-2 px-3 font-semibold">#</th>
                                <th className="text-left py-2 px-3 font-semibold">Symbol</th>
                                <th className="text-left py-2 px-3 font-semibold">Side</th>
                                <th className="text-right py-2 px-3 font-semibold">Entry amount</th>
                                <th className="text-right py-2 px-3 font-semibold">Return %</th>
                                <th className="text-right py-2 px-3 font-semibold">P&amp;L</th>
                                <th className="text-right py-2 px-3 font-semibold">Exit amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {simResult.rows.map((r) => (
                                <tr key={r.tradeNo} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                                  <td className="py-2 px-3 font-mono text-[#64748B]">{r.tradeNo}</td>
                                  <td className="py-2 px-3 font-mono font-semibold text-[#F4F7FB]">{r.symbol}</td>
                                  <td className="py-2 px-3">
                                    <Badge
                                      variant="outline"
                                      className={`text-[9px] py-0 h-4 ${r.side === "BUY" ? "border-[#00E676]/40 text-[#00E676]" : "border-[#FF5C5C]/40 text-[#FF5C5C]"}`}
                                    >
                                      {r.side}
                                    </Badge>
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono text-[#94A3B8]">
                                    {fmtPkr(r.entryAmount)}
                                  </td>
                                  <td className={`py-2 px-3 text-right font-mono font-semibold ${r.returnPct >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}`}>
                                    {fmtPct(r.returnPct, true)}
                                  </td>
                                  <td className={`py-2 px-3 text-right font-mono font-semibold ${r.pnl >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}`}>
                                    {r.pnl >= 0 ? "+" : ""}{fmtPkr(r.pnl)}
                                  </td>
                                  <td className={`py-2 px-3 text-right font-mono font-semibold ${r.pnl >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}`}>
                                    {fmtPkr(r.exitAmount)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* ─── Issue 17: timeframe selector (1m / 3m / 6m / 1y) ─── */}
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <div className="flex items-center gap-1.5 text-[11px] text-[#64748B]">
                    <Clock className="h-3 w-3" />
                    <span className="uppercase tracking-wider font-semibold">Backtest:</span>
                  </div>
                  <div className="flex bg-[#131829] border border-white/[0.08] rounded-md p-0.5">
                    {TIMEFRAMES.map((tf) => (
                      <button
                        key={tf.key}
                        onClick={() => setTimeframe(tf.key)}
                        className={`px-2.5 py-1 text-[11px] font-mono font-semibold rounded transition-colors ${
                          timeframe === tf.key
                            ? "bg-[#00E676]/15 text-[#00E676]"
                            : "text-[#94A3B8] hover:text-[#F4F7FB]"
                        }`}
                        title={`${tf.label} backtest window`}
                      >
                        {tf.short}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-[#64748B] ml-auto flex-wrap">
                    <Badge variant="outline" className="text-[9px] py-0 h-4 border-[#00E676]/40 text-[#00E676]">
                      LIVE
                    </Badge>
                    <span>
                      Last {timeframeLabel} backtest · {aiSignals.length} stocks · final consensus ensemble · {stockSignals.length} actionable signals
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  <Card className="bg-gradient-to-br from-[#00E676]/[0.07] to-[#131829] border-[#00E676]/20">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Total signals</span>
                        <Zap className="h-3 w-3 text-[#00E676]" />
                      </div>
                      <div className="text-3xl font-bold text-[#F4F7FB] font-mono">{signalStats.total}</div>
                      <div className="text-[10px] text-[#94A3B8] mt-1">
                        {signalStats.wins}W / {signalStats.losses}L · ensemble final consensus
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="bg-[#131829] border-white/[0.08]">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Win rate</span>
                        <Trophy className="h-3 w-3 text-[#00E676]" />
                      </div>
                      <div className="text-3xl font-bold text-[#00E676] font-mono">{signalStats.winRate}%</div>
                      <div className="text-[10px] text-[#94A3B8] mt-1">across {signalStats.total} closed trades</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-[#131829] border-white/[0.08]">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Avg return</span>
                        <TrendingUp className="h-3 w-3 text-[#00E676]" />
                      </div>
                      <div className={`text-3xl font-bold font-mono ${signalStats.avgReturn >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}`}>
                        {fmtPct(signalStats.avgReturn, true)}
                      </div>
                      <div className="text-[10px] text-[#94A3B8] mt-1">per trade, last {timeframeLabel}</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-[#131829] border-white/[0.08]">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Best / worst</span>
                        <Target className="h-3 w-3 text-[#00E676]" />
                      </div>
                      <div className="flex items-baseline gap-2 font-mono">
                        <span className="text-lg font-bold text-[#00E676]">{fmtPct(signalStats.best, true)}</span>
                        <span className="text-[#64748B] text-xs">/</span>
                        <span className="text-lg font-bold text-[#FF5C5C]">{fmtPct(signalStats.worst)}</span>
                      </div>
                      <div className="text-[10px] text-[#94A3B8] mt-1">best trade / worst trade</div>
                    </CardContent>
                  </Card>
                </div>

                {/* Per-stock signals table */}
                <Card className="bg-[#131829] border-white/[0.08] mb-5">
                  <CardContent className="p-0">
                    <div className="p-4 border-b border-white/[0.06]">
                      <h3 className="font-semibold text-[#F4F7FB]">Live signals — last {timeframeLabel}</h3>
                      <p className="text-xs text-[#94A3B8] mt-0.5">
                        Per-stock final consensus from {aiSignals.length} covered PSX stocks · entry / target / predicted return
                      </p>
                    </div>
                    <div className="overflow-x-auto max-h-96 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-[#131829]">
                          <tr className="text-[10px] uppercase tracking-wider text-[#64748B] border-b border-white/[0.06]">
                            <th className="text-left py-2 px-3 font-semibold">Symbol</th>
                            <th className="text-left py-2 px-3 font-semibold">Side</th>
                            <th className="text-right py-2 px-3 font-semibold">Entry</th>
                            <th className="text-right py-2 px-3 font-semibold">Target</th>
                            <th className="text-right py-2 px-3 font-semibold">SL</th>
                            <th className="text-right py-2 px-3 font-semibold">Return %</th>
                            <th className="text-right py-2 px-3 font-semibold">Conf.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stockSignals.length === 0 && (
                            <tr>
                              <td colSpan={7} className="py-6 text-center text-[#64748B] text-xs">
                                No actionable BUY/SELL signals in the last {timeframeLabel} window.
                              </td>
                            </tr>
                          )}
                          {stockSignals.map((s) => {
                            const isBuy = s.signal === "BUY";
                            return (
                              <tr key={s.symbol} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                                <td className="py-2.5 px-3 font-mono font-semibold text-[#F4F7FB]">{s.symbol}</td>
                                <td className="py-2.5 px-3">
                                  <Badge variant="outline" className={`text-[9px] py-0 h-4 ${isBuy ? "border-[#00E676]/40 text-[#00E676]" : "border-[#FF5C5C]/40 text-[#FF5C5C]"}`}>
                                    {s.signal}
                                  </Badge>
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono text-[#94A3B8]">{s.entry.toFixed(2)}</td>
                                <td className="py-2.5 px-3 text-right font-mono text-[#F4F7FB]">{s.target.toFixed(2)}</td>
                                <td className="py-2.5 px-3 text-right font-mono text-[#FF5C5C]/80">{s.sl.toFixed(2)}</td>
                                <td className={`py-2.5 px-3 text-right font-mono font-semibold ${s.retPct >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}`}>
                                  {fmtPct(s.retPct, true)}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono text-[#94A3B8]">{s.confidence}%</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* Portfolio Tracker */}
          <TabsContent value="portfolio" className="mt-4">
            {portfolioPositions.length === 0 ? (
              <Card className="bg-[#131829] border-white/[0.08]">
                <CardContent className="p-12 text-center">
                  <Briefcase className="h-12 w-12 text-[#00E676]/30 mx-auto mb-3" />
                  <h3 className="font-semibold text-[#F4F7FB] mb-1">No portfolio positions yet</h3>
                  <p className="text-xs text-[#94A3B8]">
                    Add stocks with buy prices and share counts to see your live P&amp;L, win rate, and ROI% here.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  <Card className="bg-[#131829] border-white/[0.08]">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Total value</span>
                        <Briefcase className="h-3 w-3 text-[#00E676]" />
                      </div>
                      <div className="text-2xl font-bold text-[#F4F7FB] font-mono">
                        {portfolioStats.hasAnyPnl ? fmtPkr(portfolioStats.totalValue) : "—"}
                      </div>
                      <div className="text-[10px] text-[#94A3B8] mt-1">
                        invested {fmtPkr(portfolioStats.totalInvested)}
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="bg-[#131829] border-white/[0.08]">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Total P&amp;L</span>
                        {portfolioStats.totalPnl >= 0 ? (
                          <TrendingUp className="h-3 w-3 text-[#00E676]" />
                        ) : (
                          <TrendingDown className="h-3 w-3 text-[#FF5C5C]" />
                        )}
                      </div>
                      <div className={`text-2xl font-bold font-mono ${portfolioStats.totalPnl >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}`}>
                        {portfolioStats.hasAnyPnl ? `${portfolioStats.totalPnl >= 0 ? "+" : ""}${fmtPkr(portfolioStats.totalPnl)}` : "—"}
                      </div>
                      <div className="text-[10px] text-[#94A3B8] mt-1">
                        ROI{" "}
                        <span className={portfolioStats.roiPct >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}>
                          {portfolioStats.hasAnyPnl ? `${portfolioStats.roiPct >= 0 ? "+" : ""}${portfolioStats.roiPct.toFixed(2)}%` : "—"}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="bg-[#131829] border-white/[0.08]">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Win rate</span>
                        <Trophy className="h-3 w-3 text-[#00E676]" />
                      </div>
                      {portfolioStats.winRate !== null ? (
                        <div className="text-2xl font-bold text-[#00E676] font-mono">
                          {portfolioStats.winRate.toFixed(1)}%
                        </div>
                      ) : (
                        <div className="text-2xl font-bold text-[#94A3B8] font-mono">—</div>
                      )}
                      <div className="text-[10px] text-[#94A3B8] mt-1">
                        {portfolioStats.closedCount > 0
                          ? `${portfolioStats.closedWins}/${portfolioStats.closedCount} closed`
                          : "no closed trades yet"}
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="bg-[#131829] border-white/[0.08]">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Positions</span>
                        <Activity className="h-3 w-3 text-[#00E676]" />
                      </div>
                      <div className="text-2xl font-bold text-[#F4F7FB] font-mono">{portfolioStats.total}</div>
                      <div className="text-[10px] text-[#94A3B8] mt-1">
                        <span className="text-amber-400">{portfolioStats.openCount} open</span>
                        {" · "}
                        <span className="text-[#94A3B8]">{portfolioStats.closedCount} closed</span>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card className="bg-[#131829] border-white/[0.08]">
                  <CardContent className="p-0">
                    <div className="p-4 border-b border-white/[0.06]">
                      <h3 className="font-semibold text-[#F4F7FB]">Your trades</h3>
                      <p className="text-xs text-[#94A3B8] mt-0.5">
                        Live P&amp;L based on current PSX prices for covered stocks · close a trade to lock in P&amp;L (closed trades stay visible).
                      </p>
                    </div>
                    <div className="divide-y divide-white/[0.04]">
                      {portfolioPositions.map((p) => (
                        <PortfolioRow
                          key={p.symbol}
                          position={p}
                          livePrice={livePriceMap[p.symbol]}
                          onClose={(price) => {
                            closePortfolioPosition(p.symbol, price);
                            toast.success(`${p.symbol} closed at ${price.toFixed(2)} — P&L locked in`);
                          }}
                          onReopen={() => {
                            reopenPortfolioPosition(p.symbol);
                            toast(`${p.symbol} reopened`, { icon: "↺" });
                          }}
                        />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>

        <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3 text-[11px] text-[#64748B] leading-relaxed mt-6">
          <span className="text-[#94A3B8] font-semibold">Tracker note:</span> Signal tracker
          stats are sourced live from <code className="text-[#00E676]">/api/ai-model-signals/[symbol]?refresh=1</code> —
          the ensemble final consensus backtest across {COVERED_SYMBOLS.length} covered PSX stocks. Notifications fire
          when a tracked signal hits TP or SL.
        </div>
      </main>
    </div>
  );
}

// ─── Portfolio row with inline Close flow (Issue 23) ─────────────────────────
// Open positions show live P&L (if a live price is available) and a "Close"
// button that reveals an inline close-price input. Closed positions stay
// visible with a "CLOSED" badge and final P&L locked in green/red.
interface PortfolioRowProps {
  position: {
    symbol: string;
    name: string;
    buyPrice: number | null;
    shares: number;
    status: "open" | "closed";
    closePrice?: number | null;
    closedAt?: string | null;
  };
  livePrice?: number;
  onClose: (closePrice: number) => void;
  onReopen: () => void;
}

function PortfolioRow({ position, livePrice, onClose, onReopen }: PortfolioRowProps) {
  const [editing, setEditing] = useState(false);
  const [draftPrice, setDraftPrice] = useState<string>("");

  const buy = (position.buyPrice as number) || 0;
  const isOpen = (position.status || "open") === "open";

  // Reference price for the row's display:
  //   open  -> live price (if covered stock) — otherwise null
  //   closed -> close price (always set when status === "closed")
  const referencePrice: number | null = isOpen
    ? typeof livePrice === "number"
      ? livePrice
      : null
    : typeof position.closePrice === "number"
      ? (position.closePrice as number)
      : null;

  const positionValue = referencePrice !== null ? referencePrice * position.shares : null;
  const invested = buy * position.shares;
  const pnl = positionValue !== null ? positionValue - invested : null;
  const pnlPct = pnl !== null && invested > 0 ? (pnl / invested) * 100 : null;
  const isWin = pnl !== null && pnl > 0;
  const isLoss = pnl !== null && pnl < 0;

  const startEdit = () => {
    const initial = typeof livePrice === "number" ? livePrice.toFixed(2) : buy > 0 ? buy.toFixed(2) : "";
    setDraftPrice(initial);
    setEditing(true);
  };

  const confirmClose = () => {
    const price = parseFloat(draftPrice.replace(/[,\s]/g, ""));
    if (!Number.isFinite(price) || price <= 0) {
      toast.error("Enter a valid close price");
      return;
    }
    onClose(price);
    setEditing(false);
    setDraftPrice("");
  };

  return (
    <div className="p-4 hover:bg-white/[0.02]">
      <div className="flex items-center justify-between gap-3">
        {/* Left: avatar + symbol + meta */}
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`h-9 w-9 rounded-lg flex items-center justify-center font-mono font-bold text-xs shrink-0 ${
              isOpen
                ? "bg-[#00E676]/10 text-[#00E676]"
                : "bg-white/[0.04] text-[#94A3B8]"
            }`}
          >
            {position.symbol.slice(0, 4)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[#F4F7FB] text-sm">{position.symbol}</span>
              {!isOpen && (
                <Badge variant="outline" className="text-[9px] py-0 h-4 border-white/[0.16] text-[#94A3B8] bg-white/[0.04]">
                  CLOSED
                </Badge>
              )}
              {isOpen && (
                <Badge variant="outline" className="text-[9px] py-0 h-4 border-amber-500/40 text-amber-400">
                  OPEN
                </Badge>
              )}
            </div>
            <div className="text-[11px] text-[#94A3B8] mt-0.5 truncate">
              Buy: {buy > 0 ? buy.toFixed(2) : "—"} · {position.shares.toLocaleString()} shares
              {!isOpen && position.closePrice !== null && typeof position.closePrice === "number" && (
                <span className="text-[#64748B]"> · Close: {(position.closePrice as number).toFixed(2)}</span>
              )}
            </div>
          </div>
        </div>

        {/* Right: P&L + action */}
        <div className="flex items-center gap-4 shrink-0">
          {pnl !== null ? (
            <div className="text-right">
              <div className={`text-sm font-mono font-semibold ${isWin ? "text-[#00E676]" : isLoss ? "text-[#FF5C5C]" : "text-[#94A3B8]"}`}>
                {pnl >= 0 ? "+" : ""}{fmtPkr(pnl)}
              </div>
              <div className="text-[10px] text-[#94A3B8] font-mono">
                {pnlPct !== null ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%` : "—"}
              </div>
            </div>
          ) : (
            <div className="text-right">
              <div className="text-sm font-mono text-[#64748B]">—</div>
              <div className="text-[10px] text-[#64748B]">no live price</div>
            </div>
          )}

          {isOpen && !editing && (
            <Button
              onClick={startEdit}
              size="sm"
              variant="outline"
              className="h-7 text-[11px] border-white/[0.12] text-[#94A3B8] hover:text-[#F4F7FB] hover:border-[#00E676]/40"
            >
              Close
            </Button>
          )}
          {!isOpen && (
            <Button
              onClick={onReopen}
              size="sm"
              variant="outline"
              className="h-7 text-[11px] border-white/[0.12] text-[#94A3B8] hover:text-[#F4F7FB]"
            >
              <Unlock className="h-3 w-3 mr-1" />
              Reopen
            </Button>
          )}
        </div>
      </div>

      {/* Inline close form */}
      {isOpen && editing && (
        <div className="mt-3 pt-3 border-t border-white/[0.06] flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-[#64748B]">
              Close price (PKR)
            </label>
            <div className="flex items-center gap-1.5 bg-[#0A0E1A] border border-white/[0.08] rounded-md px-3 py-1.5 focus-within:border-[#00E676]/40">
              <span className="text-xs text-[#64748B] font-mono">Rs.</span>
              <Input
                value={draftPrice}
                onChange={(e) => setDraftPrice(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmClose();
                  if (e.key === "Escape") setEditing(false);
                }}
                placeholder="0.00"
                inputMode="decimal"
                autoFocus
                className="h-6 w-32 border-0 bg-transparent p-0 text-sm font-mono text-[#F4F7FB] focus-visible:ring-0"
              />
            </div>
          </div>
          <Button
            onClick={confirmClose}
            size="sm"
            className="h-8 bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold"
          >
            <Check className="h-3.5 w-3.5 mr-1" />
            Confirm close
          </Button>
          <Button
            onClick={() => setEditing(false)}
            size="sm"
            variant="outline"
            className="h-8 border-white/[0.12] text-[#94A3B8] hover:text-[#F4F7FB]"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Cancel
          </Button>
          {typeof livePrice === "number" && (
            <span className="text-[10px] text-[#64748B] ml-auto self-center">
              Live: <span className="font-mono text-[#94A3B8]">{livePrice.toFixed(2)}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
