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
  Wallet,
  Play,
  RotateCcw,
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

  // Issue 18: fetch /api/psx/companies once on mount so we can look up each
  // portfolio position's sector for the pie chart. Positions added before the
  // store had a sector field (legacy localStorage entries) won't have sector
  // info — this map fills the gap.
  const [sectorMap, setSectorMap] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    fetch("/api/psx/companies")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.companies) return;
        const m: Record<string, string> = {};
        for (const c of d.companies) {
          if (c?.value && c?.sector) m[String(c.value).toUpperCase()] = c.sector;
        }
        setSectorMap(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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

  // TIMEFRAMES const retained for timeframe state default + API param.
  // (The Backtest timeframe selector UI was removed in this version — the
  // user now picks a time horizon in the Investment Simulator instead.)

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

  // ─── Investment simulation across trades (Issue 22, upgraded with SIP) ───
  // Calls /api/simulate which generates synthetic BUY trades from the
  // ensemble backtesting stats, runs COMPOUNDING (each trade reinvests the
  // full current portfolio), and (optionally) injects monthly SIP rows.
  // The user picks a TIME HORIZON (value + Year/Month/Day dropdown); the
  // API scales the trade count to that horizon. SIP is optional.
  type TimeUnit = "day" | "month" | "year";
  const TIME_UNITS: { value: TimeUnit; label: string; days: number }[] = [
    { value: "day", label: "Days", days: 1 },
    { value: "month", label: "Months", days: 30.44 },
    { value: "year", label: "Years", days: 365 },
  ];

  const [simAmount, setSimAmount] = useState<string>("100000");
  const [simSip, setSimSip] = useState<string>(""); // optional SIP per month
  const [simTimeValue, setSimTimeValue] = useState<string>("1");
  const [simTimeUnit, setSimTimeUnit] = useState<TimeUnit>("year");
  const [simResult, setSimResult] = useState<any>(null);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);

  const runSimulation = async () => {
    setSimLoading(true);
    setSimError(null);
    try {
      const initial = parseFloat(simAmount.replace(/[,\s]/g, ""));
      if (!Number.isFinite(initial) || initial <= 0) {
        toast.error("Enter a valid investment amount");
        setSimLoading(false);
        return;
      }
      const timeVal = parseFloat(simTimeValue.replace(/[,\s]/g, "")) || 0;
      if (timeVal <= 0) {
        toast.error("Enter a valid time period");
        setSimLoading(false);
        return;
      }
      const unitDef = TIME_UNITS.find((u) => u.value === simTimeUnit)!;
      const numDays = Math.max(1, Math.round(timeVal * unitDef.days));
      const sip = simSip.trim() ? parseFloat(simSip.replace(/[,\s]/g, "")) || 0 : 0;
      if (sip < 0) {
        toast.error("SIP must be ≥ 0");
        setSimLoading(false);
        return;
      }
      // Use FINAL CONSENSUS ensemble (default) — covers all 8 PSX stocks.
      const params = new URLSearchParams({
        amount: String(initial),
        numDays: String(numDays),
        detail: "1",
      });
      if (sip > 0) params.set("sip", String(sip));
      const r = await fetch(`/api/simulate?${params.toString()}`);
      if (!r.ok) throw new Error("API failed");
      const d = await r.json();
      // Pick FINAL CONSENSUS ensemble; if not present, take top-1 by netPnL
      const found =
        d.results?.find((x: any) => x.name === "FINAL CONSENSUS") ||
        d.results?.[0] ||
        null;
      if (!found) {
        toast.error("No ensemble results");
        setSimLoading(false);
        return;
      }
      setSimResult({ ...found, numDays, timeValue: timeVal, timeUnit: simTimeUnit });
      toast.success(
        `Simulated ${found.totalTrades} trades over ${timeVal} ${unitDef.label.toLowerCase()}${sip > 0 ? ` · SIP ${fmtPkr(sip)}/mo` : ""}`
      );
    } catch (e) {
      setSimError("Simulation failed — try again");
      toast.error("Simulation failed");
    } finally {
      setSimLoading(false);
    }
  };

  const resetSimulation = () => {
    setSimResult(null);
    setSimError(null);
  };


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
    let hasLiveForOpen = false;
    let hasAnyPnl = false;

    // Open positions (from portfolio store, shares > 0)
    for (const p of portfolioPositions) {
      const buy = (p.buyPrice as number) || 0;
      const invested = buy * p.shares;
      totalInvested += invested;
      openCount++;
      const live = livePriceMap[p.symbol];
      if (typeof live === "number") {
        const val = live * p.shares;
        totalValue += val;
        totalPnl += val - invested;
        hasLiveForOpen = true;
        hasAnyPnl = true;
      }
    }

    // Issue 18: closed trades from the close flow (closedTrades in store)
    // add their net P&L to the totals. They have no remaining market value
    // (shares were sold), but their net P&L contributes to total P&L.
    let closedCount = 0;
    let closedWins = 0;
    let closedNetPnl = 0;
    for (const t of closedTrades) {
      closedCount++;
      closedNetPnl += t.netPnl;
      if (t.netPnl > 0) closedWins++;
    }
    totalPnl += closedNetPnl;
    if (closedCount > 0) hasAnyPnl = true;

    const roiPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
    const winRate = closedCount > 0 ? (closedWins / closedCount) * 100 : null;

    return {
      total: openCount + closedCount,
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
  }, [portfolioPositions, livePriceMap, closedTrades]);

  // Issue 18: sector-wise holding distribution for the pie chart.
  // For each open position: value = (livePrice || buyPrice) × shares.
  // Sector is taken from position.sector (stored at add-time) or from the
  // sectorMap fetched on mount, else falls back to "Other".
  const sectorData = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of portfolioPositions) {
      const live = livePriceMap[p.symbol];
      const buy = (p.buyPrice as number) || 0;
      const price = typeof live === "number" ? live : buy;
      if (price <= 0 || p.shares <= 0) continue;
      const value = price * p.shares;
      const sector =
        (p.sector && p.sector.trim()) ||
        sectorMap[p.symbol] ||
        "Other";
      m.set(sector, (m.get(sector) || 0) + value);
    }
    const total = Array.from(m.values()).reduce((s, v) => s + v, 0);
    if (total <= 0) return [] as { sector: string; value: number; pct: number }[];
    return Array.from(m.entries())
      .map(([sector, value]) => ({ sector, value, pct: (value / total) * 100 }))
      .sort((a, b) => b.value - a.value);
  }, [portfolioPositions, livePriceMap, sectorMap]);

  const handleDownload = () => {
    const lines = [
      "Latent.pk — Tracker Report",
      "Generated: " + new Date().toISOString(),
      "Sources: /api/ai-model-signals/[symbol]?refresh=1 · /api/simulate",
      "Covered: " + COVERED_SYMBOLS.join(", "),
      "",
      "=== INVESTMENT SIMULATOR (FINAL CONSENSUS · BUY-ONLY · COMPOUNDING) ===",
      simResult
        ? `Initial: ${fmtPkr(simResult.startingCapital)} | Time: ${simResult.timeValue || ""} ${simResult.timeUnit || ""} | SIP/mo: ${simResult.sipPerMonth ? fmtPkr(simResult.sipPerMonth) : "none"}`
        : "(no simulation run yet)",
      simResult
        ? `Total trades: ${simResult.totalTrades} | Wins: ${simResult.winTrades} | Losses: ${simResult.lossTrades}`
        : "",
      simResult
        ? `Total SIP added: ${simResult.totalSipContributed ? fmtPkr(simResult.totalSipContributed) : "—"} | Total invested: ${fmtPkr(simResult.startingCapital + (simResult.totalSipContributed || 0))}`
        : "",
      simResult
        ? `Final value: ${fmtPkr(simResult.finalValue)} | Net P&L: ${simResult.netPnL >= 0 ? "+" : ""}${fmtPkr(simResult.netPnL)} | ROI: ${simResult.roiPct >= 0 ? "+" : ""}${simResult.roiPct.toFixed(2)}%`
        : "",
      "",
      "=== PER-STOCK LIVE SIGNALS (FINAL CONSENSUS) ===",
      ...(stockSignals.length > 0
        ? stockSignals.map((s) => `${s.symbol} ${s.signal} entry=${s.entry} target=${s.target} ret=${fmtPct(s.retPct, true)} conf=${s.confidence}%`)
        : ["(no actionable signals right now)"]),
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
              <>
                {/* ─── Investment Simulator (with optional SIP + time horizon) ─── */}
                <Card className="bg-[#131829] border-[#00E676]/20 mb-5">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Wallet className="h-3.5 w-3.5 text-[#00E676]" />
                      <h3 className="font-semibold text-[#F4F7FB] text-sm">Investment simulator</h3>
                      <Badge variant="outline" className="text-[8px] py-0 h-3.5 border-[#00E676]/30 text-[#00E676]/80 ml-1">
                        SIP + COMPOUNDING
                      </Badge>
                    </div>
                    <p className="text-xs text-[#94A3B8] mb-3">
                      Pick a time horizon, optionally add a monthly SIP (Systematic Investment Plan),
                      and we&apos;ll run ALL BUY signals from the FINAL CONSENSUS ensemble through a
                      compounding portfolio. Trades with identical entry/SL/TP prices are skipped
                      (useless duplicates). Losses are subtracted; wins are compounded into the next trade.
                    </p>

                    {/* Input row 1: Investment amount + Time period (value + unit dropdown) */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
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
                            className="h-7 w-full border-0 bg-transparent p-0 text-sm font-mono text-[#F4F7FB] focus-visible:ring-0"
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase tracking-wider text-[#64748B]">
                          Time period
                        </label>
                        <div className="flex items-stretch gap-1.5">
                          <Input
                            value={simTimeValue}
                            onChange={(e) => setSimTimeValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") runSimulation();
                            }}
                            placeholder="1"
                            inputMode="decimal"
                            className="h-9 w-20 bg-[#0A0E1A] border border-white/[0.08] rounded-md px-3 text-sm font-mono text-[#F4F7FB] focus-visible:border-[#00E676]/40 focus-visible:ring-0"
                          />
                          <select
                            value={simTimeUnit}
                            onChange={(e) => setSimTimeUnit(e.target.value as TimeUnit)}
                            className="h-9 flex-1 bg-[#0A0E1A] border border-white/[0.08] rounded-md px-2 text-xs font-mono text-[#F4F7FB] focus-visible:border-[#00E676]/40 focus-visible:ring-0 cursor-pointer"
                          >
                            {TIME_UNITS.map((u) => (
                              <option key={u.value} value={u.value} className="bg-[#0A0E1A]">
                                {u.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase tracking-wider text-[#64748B]">
                          Monthly SIP (PKR) — optional
                        </label>
                        <div className="flex items-center gap-1.5 bg-[#0A0E1A] border border-white/[0.08] rounded-md px-3 py-2 focus-within:border-[#FBBF24]/40">
                          <span className="text-xs text-[#64748B] font-mono">Rs.</span>
                          <Input
                            value={simSip}
                            onChange={(e) => setSimSip(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") runSimulation();
                            }}
                            placeholder="0 (no SIP)"
                            inputMode="decimal"
                            className="h-7 w-full border-0 bg-transparent p-0 text-sm font-mono text-[#FBBF24] placeholder:text-[#64748B]/60 focus-visible:ring-0"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mb-4">
                      <Button
                        onClick={runSimulation}
                        disabled={simLoading}
                        className="bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold h-9"
                      >
                        <Play className="h-3.5 w-3.5 mr-1.5" />
                        {simLoading ? "Simulating..." : "Simulate"}
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
                        FINAL CONSENSUS · BUY-only · compounded
                        {simResult?.sipPerMonth ? ` · SIP ${fmtPkr(simResult.sipPerMonth)}/mo` : ""}
                      </div>
                    </div>

                    {simError && (
                      <div className="rounded-md border border-[#FF5C5C]/40 bg-[#FF5C5C]/[0.05] p-2 mb-3 text-xs text-[#FF5C5C]">
                        {simError}
                      </div>
                    )}

                    {simResult && simResult.trades && (
                      <>
                        {/* Summary bar */}
                        <div className="rounded-lg border border-white/[0.06] bg-[#0A0E1A] p-3 mb-3">
                          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                            <div>
                              <div className="text-[10px] uppercase text-[#64748B]">Initial investment</div>
                              <div className="font-mono font-bold text-[#F4F7FB]">{fmtPkr(simResult.startingCapital)}</div>
                            </div>
                            {simResult.sipPerMonth > 0 ? (
                              <>
                                <div>
                                  <div className="text-[10px] uppercase text-[#64748B]">SIP / month</div>
                                  <div className="font-mono font-bold text-[#FBBF24]">{fmtPkr(simResult.sipPerMonth)}</div>
                                </div>
                                <div>
                                  <div className="text-[10px] uppercase text-[#64748B]">Total SIP added</div>
                                  <div className="font-mono font-bold text-[#FBBF24]">{fmtPkr(simResult.totalSipContributed)}</div>
                                </div>
                              </>
                            ) : null}
                            <div>
                              <div className="text-[10px] uppercase text-[#64748B]">Total invested</div>
                              <div className="font-mono font-bold text-[#F4F7FB]">
                                {fmtPkr(simResult.startingCapital + (simResult.totalSipContributed || 0))}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] uppercase text-[#64748B]">Net P&amp;L</div>
                              <div className={`font-mono font-bold ${simResult.netPnL >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}`}>
                                {simResult.netPnL >= 0 ? "+" : ""}{fmtPkr(simResult.netPnL)}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] uppercase text-[#64748B]">Final value</div>
                              <div className={`font-mono font-bold ${simResult.finalValue >= simResult.startingCapital ? "text-[#00E676]" : "text-[#FF5C5C]"}`}>
                                {fmtPkr(simResult.finalValue)}
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-4 mt-2 text-[11px] pt-2 border-t border-white/[0.04]">
                            <span className="text-[#94A3B8]">
                              Trades: <span className="font-mono text-[#F4F7FB]">{simResult.totalTradesShown}</span>
                            </span>
                            <span className="text-[#94A3B8]">
                              Wins: <span className="font-mono text-[#00E676]">{simResult.winTrades}</span>
                            </span>
                            <span className="text-[#94A3B8]">
                              Losses: <span className="font-mono text-[#FF5C5C]">{simResult.lossTrades}</span>
                            </span>
                            <span className="text-[#94A3B8]">
                              ROI:{" "}
                              <span className={`font-mono font-semibold ${simResult.roiPct >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}`}>
                                {simResult.roiPct >= 0 ? "+" : ""}{simResult.roiPct.toFixed(2)}%
                              </span>
                            </span>
                            {simResult.sipCount > 0 && (
                              <span className="text-[#94A3B8]">
                                SIPs: <span className="font-mono text-[#FBBF24]">{simResult.sipCount}</span>
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Trade-by-trade table — SIP rows highlighted in gold */}
                        <div className="overflow-x-auto max-h-96 overflow-y-auto rounded-md border border-white/[0.06]">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-[#131829]">
                              <tr className="text-[10px] uppercase tracking-wider text-[#64748B] border-b border-white/[0.06]">
                                <th className="text-left py-2 px-2 font-semibold">#</th>
                                <th className="text-left py-2 px-2 font-semibold">Type</th>
                                <th className="text-left py-2 px-2 font-semibold">Symbol</th>
                                <th className="text-right py-2 px-2 font-semibold">Entry</th>
                                <th className="text-right py-2 px-2 font-semibold">Close</th>
                                <th className="text-right py-2 px-2 font-semibold">SL</th>
                                <th className="text-center py-2 px-2 font-semibold">Best TP</th>
                                <th className="text-right py-2 px-2 font-semibold">Invested</th>
                                <th className="text-right py-2 px-2 font-semibold">P&amp;L</th>
                                <th className="text-right py-2 px-2 font-semibold">Portfolio</th>
                              </tr>
                            </thead>
                            <tbody>
                              {simResult.trades.map((t: any, i: number) => {
                                const isSip = !!t.isSip;
                                return (
                                  <tr
                                    key={i}
                                    className={`border-b border-white/[0.04] ${
                                      isSip
                                        ? "bg-[#FBBF24]/[0.06]"
                                        : t.result === "WIN"
                                          ? "bg-[#00E676]/[0.03]"
                                          : "bg-[#FF5C5C]/[0.03]"
                                    }`}
                                  >
                                    <td className="py-1.5 px-2 font-mono text-[#64748B]">{t.tradeNum}</td>
                                    <td className="py-1.5 px-2">
                                      {isSip ? (
                                        <Badge variant="outline" className="text-[9px] py-0 h-4 border-[#FBBF24]/40 text-[#FBBF24]">
                                          SIP
                                        </Badge>
                                      ) : (
                                        <Badge variant="outline" className="text-[9px] py-0 h-4 border-[#00E676]/40 text-[#00E676]">
                                          BUY
                                        </Badge>
                                      )}
                                    </td>
                                    <td className="py-1.5 px-2 font-mono font-semibold text-[#F4F7FB]">
                                      {isSip ? "—" : t.symbol}
                                    </td>
                                    <td className="py-1.5 px-2 text-right font-mono text-[#94A3B8]">
                                      {isSip ? "—" : t.entry.toFixed(2)}
                                    </td>
                                    <td className="py-1.5 px-2 text-right font-mono text-[#94A3B8]">
                                      {isSip ? "—" : t.close.toFixed(2)}
                                    </td>
                                    <td className="py-1.5 px-2 text-right font-mono text-[#FF5C5C]/80">
                                      {isSip ? "—" : t.sl.toFixed(2)}
                                    </td>
                                    <td className="py-1.5 px-2 text-center">
                                      <span className={`text-[9px] font-bold ${isSip ? "text-[#64748B]" : t.bestTP === "TP3" ? "text-[#00E676]" : t.bestTP === "TP2" ? "text-[#00E676]" : "text-[#94A3B8]"}`}>
                                        {isSip ? "—" : (t.bestTP || "TP1")}
                                      </span>
                                    </td>
                                    <td className={`py-1.5 px-2 text-right font-mono ${isSip ? "text-[#FBBF24]" : "text-[#94A3B8]"}`}>
                                      {fmtPkr(t.investAmount)}
                                    </td>
                                    <td className={`py-1.5 px-2 text-right font-mono font-bold ${isSip ? "text-[#FBBF24]" : t.pnl >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}`}>
                                      {isSip ? "+" : t.pnl >= 0 ? "+" : ""}{fmtPkr(t.pnl)}
                                    </td>
                                    <td className={`py-1.5 px-2 text-right font-mono font-bold ${isSip ? "text-[#FBBF24]" : "text-[#F4F7FB]"}`}>
                                      {fmtPkr(t.portfolioValue)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <p className="text-[10px] text-[#64748B] mt-2 leading-relaxed">
                          Note: COMPOUNDING — each BUY trade reinvests the FULL current portfolio (including
                          previous SIP deposits). Losses subtract from portfolio; wins grow it.{" "}
                          <span className="text-[#FBBF24]">Gold rows = SIP deposits</span> (cash injected monthly,
                          not investment returns). Net P&amp;L = final value − (initial + total SIP). Trades where
                          entry≈SL≈TP are skipped (no signal). Past performance does not guarantee future returns.
                        </p>
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* ─── LIVE indicator + covered stocks summary ─── */}
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <div className="flex items-center gap-2 text-[11px] text-[#64748B] ml-auto flex-wrap">
                    <Badge variant="outline" className="text-[9px] py-0 h-4 border-[#00E676]/40 text-[#00E676]">
                      LIVE
                    </Badge>
                    <span>
                      {aiSignals.length} covered PSX stocks · final consensus ensemble · {stockSignals.length} actionable signals
                    </span>
                  </div>
                </div>

                {/* Per-stock signals table */}
                <Card className="bg-[#131829] border-white/[0.08] mb-5">
                  <CardContent className="p-0">
                    <div className="p-4 border-b border-white/[0.06]">
                      <h3 className="font-semibold text-[#F4F7FB]">Live signals — current</h3>
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
                                No actionable BUY/SELL signals right now.
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
          </TabsContent>

          {/* Portfolio Tracker */}
          <TabsContent value="portfolio" className="mt-4">
            {portfolioPositions.length === 0 && closedTrades.length === 0 ? (
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

                {/* Issue 18: SVG pie chart — sector-wise holding distribution */}
                <Card className="bg-[#131829] border-white/[0.08] mb-5">
                  <CardContent className="p-5">
                    <div className="flex items-center gap-1.5 mb-3">
                      <PieChartIcon className="h-4 w-4 text-[#00E676]" />
                      <h3 className="font-semibold text-[#F4F7FB] text-sm">Sector-wise holding distribution</h3>
                    </div>
                    <p className="text-xs text-[#94A3B8] mb-4">
                      Breakdown of your open positions by sector, weighted by current market value
                      (live price × shares). Useful for spotting concentration risk (e.g., 80% Cement, 20% Oil &amp; Gas).
                    </p>
                    {sectorData.length === 0 ? (
                      <div className="text-center py-8 text-xs text-[#64748B]">
                        No open positions with a market value yet — add buy prices + share counts to populate the chart.
                      </div>
                    ) : (
                      <div className="flex flex-col md:flex-row items-center gap-6">
                        <SectorPieChart data={sectorData} />
                        <div className="flex-1 w-full space-y-2">
                          {sectorData.map((d, i) => (
                            <div key={d.sector} className="flex items-center justify-between text-xs gap-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className="h-3 w-3 rounded-sm shrink-0"
                                  style={{ background: SECTOR_COLORS[i % SECTOR_COLORS.length] }}
                                />
                                <span className="text-[#F4F7FB] font-semibold truncate">{d.sector}</span>
                              </div>
                              <div className="flex items-center gap-3 font-mono shrink-0">
                                <span className="text-[#94A3B8]">{fmtPkr(d.value)}</span>
                                <span className="text-[#00E676] font-semibold w-14 text-right">
                                  {d.pct.toFixed(1)}%
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Issue 18: Open positions card (Close/Reopen removed — closing is now done from PortfolioTab) */}
                <Card className="bg-[#131829] border-white/[0.08] mb-5">
                  <CardContent className="p-0">
                    <div className="p-4 border-b border-white/[0.06]">
                      <h3 className="font-semibold text-[#F4F7FB]">Open positions ({portfolioPositions.length})</h3>
                      <p className="text-xs text-[#94A3B8] mt-0.5">
                        Live P&amp;L based on current PSX prices for covered stocks · to close a position, use the
                        wallet-icon close flow in the <span className="text-[#00E676]">Portfolio</span> tab.
                      </p>
                    </div>
                    <div className="divide-y divide-white/[0.04]">
                      {portfolioPositions.length === 0 ? (
                        <div className="p-6 text-center text-xs text-[#64748B]">
                          No open positions yet. Add stocks with shares &gt; 0 to start tracking.
                        </div>
                      ) : (
                        portfolioPositions.map((p) => (
                          <PortfolioRow
                            key={p.symbol}
                            position={p}
                            livePrice={livePriceMap[p.symbol]}
                            sectorLabel={
                              (p.sector && p.sector.trim()) ||
                              sectorMap[p.symbol] ||
                              undefined
                            }
                          />
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Issue 18: Closed trades card (from close flow in PortfolioTab) */}
                <Card className="bg-[#131829] border-white/[0.08]">
                  <CardContent className="p-0">
                    <div className="p-4 border-b border-white/[0.06]">
                      <h3 className="font-semibold text-[#F4F7FB]">Closed trades ({closedTrades.length})</h3>
                      <p className="text-xs text-[#94A3B8] mt-0.5">
                        Each row is a trade closed via the Portfolio tab&apos;s close flow — recorded with buy/sell
                        prices, broker commission (0.15% × sell × 2), CGT (15% if ≤12mo, 0% if &gt;12mo),
                        and net P&amp;L.
                      </p>
                    </div>
                    <div className="divide-y divide-white/[0.04]">
                      {closedTrades.length === 0 ? (
                        <div className="p-6 text-center text-xs text-[#64748B]">
                          No closed trades yet. Close a position from the Portfolio tab to see it here.
                        </div>
                      ) : (
                        closedTrades.map((t) => <ClosedTradeRow key={t.id} trade={t} />)
                      )}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>

        <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3 text-[11px] text-[#64748B] leading-relaxed mt-6">
          <span className="text-[#94A3B8] font-semibold">Tracker note:</span> Investment simulator
          runs synthetic BUY trades from the FINAL CONSENSUS ensemble via <code className="text-[#00E676]">/api/simulate</code> —
          compounding portfolio with optional monthly SIP. Trade count scales to your chosen time horizon (Days / Months / Years).
          Trades with identical entry≈SL≈TP are skipped. Losses subtract; wins grow the portfolio; SIP rows (gold) inject
          cash monthly. Live per-stock signals come from {COVERED_SYMBOLS.length} covered PSX stocks&apos; final consensus.
          Portfolio tracker shows open positions + closed trades from the Portfolio tab close flow.
        </div>
      </main>
    </div>
  );
}

// ─── Issue 18: SVG-based donut pie chart for sector distribution ──────────
const SECTOR_COLORS = [
  "#00E676", "#FBBF24", "#FF5C5C", "#22E881", "#4ADE80",
  "#94A3B8", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6",
  "#3B82F6", "#EC4899", "#14B8A6", "#A855F7", "#6366F1",
];

function SectorPieChart({ data }: { data: { sector: string; value: number; pct: number }[] }) {
  const size = 160;
  const cx = size / 2;
  const cy = size / 2;
  const r = 65;
  const innerR = 30; // donut hole

  // SVG arc paths for each sector slice. Cumulative angle is computed
  // functionally from the preceding slices' percentages (no mutation) to
  // satisfy react-hooks/immutability.
  const slices = data.map((d, i) => {
    const cumulativeBeforePct = data.slice(0, i).reduce((s, x) => s + x.pct, 0);
    const startAngle = -Math.PI / 2 + (cumulativeBeforePct / 100) * 2 * Math.PI;
    const angleSpan = (d.pct / 100) * 2 * Math.PI;
    const endAngle = startAngle + angleSpan;

    // Outer arc endpoints
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    // Inner arc endpoints (donut)
    const xi1 = cx + innerR * Math.cos(startAngle);
    const yi1 = cy + innerR * Math.sin(startAngle);
    const xi2 = cx + innerR * Math.cos(endAngle);
    const yi2 = cy + innerR * Math.sin(endAngle);

    const largeArc = angleSpan > Math.PI ? 1 : 0;
    // Donut slice path: outer arc forward + line in + inner arc backward + close
    const path = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${innerR} ${innerR} 0 ${largeArc} 0 ${xi1} ${yi1} Z`;
    return { path, color: SECTOR_COLORS[i % SECTOR_COLORS.length], ...d };
  });

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className="shrink-0"
      role="img"
      aria-label={`Sector distribution: ${data.map((d) => `${d.sector} ${d.pct.toFixed(0)}%`).join(", ")}`}
    >
      {slices.map((s, i) => (
        <path
          key={i}
          d={s.path}
          fill={s.color}
          stroke="#0A0E1A"
          strokeWidth={1.5}
        >
          <title>{`${s.sector}: ${s.pct.toFixed(1)}% (${fmtPkr(s.value)})`}</title>
        </path>
      ))}
    </svg>
  );
}

// ─── Issue 18: Open position row (no Close/Reopen buttons) ──────────────────
// Closing is now done from PortfolioTab.tsx (Issue 13's close flow). This row
// just shows the position info + live P&L (when available).
interface PortfolioRowProps {
  position: {
    symbol: string;
    name: string;
    sector?: string | null;
    buyPrice: number | null;
    shares: number;
    status: "open" | "closed";
    closePrice?: number | null;
    closedAt?: string | null;
  };
  livePrice?: number;
  sectorLabel?: string;
}

function PortfolioRow({ position, livePrice, sectorLabel }: PortfolioRowProps) {
  const buy = (position.buyPrice as number) || 0;
  const referencePrice: number | null = typeof livePrice === "number" ? livePrice : null;
  const positionValue = referencePrice !== null ? referencePrice * position.shares : null;
  const invested = buy * position.shares;
  const pnl = positionValue !== null ? positionValue - invested : null;
  const pnlPct = pnl !== null && invested > 0 ? (pnl / invested) * 100 : null;
  const isWin = pnl !== null && pnl > 0;
  const isLoss = pnl !== null && pnl < 0;

  return (
    <div className="p-4 hover:bg-white/[0.02]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg flex items-center justify-center font-mono font-bold text-xs shrink-0 bg-[#00E676]/10 text-[#00E676]">
            {position.symbol.slice(0, 4)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[#F4F7FB] text-sm">{position.symbol}</span>
              <Badge variant="outline" className="text-[9px] py-0 h-4 border-amber-500/40 text-amber-400">
                OPEN
              </Badge>
              {sectorLabel && (
                <Badge variant="outline" className="text-[8px] py-0 h-3.5 border-white/[0.12] text-[#94A3B8] uppercase">
                  {sectorLabel}
                </Badge>
              )}
            </div>
            <div className="text-[11px] text-[#94A3B8] mt-0.5 truncate">
              Buy: {buy > 0 ? buy.toFixed(2) : "—"} · {position.shares.toLocaleString()} shares
              {typeof livePrice === "number" && (
                <span className="text-[#64748B]"> · Live: {livePrice.toFixed(2)}</span>
              )}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          {pnl !== null ? (
            <>
              <div className={`text-sm font-mono font-semibold ${isWin ? "text-[#00E676]" : isLoss ? "text-[#FF5C5C]" : "text-[#94A3B8]"}`}>
                {pnl >= 0 ? "+" : ""}{fmtPkr(pnl)}
              </div>
              <div className="text-[10px] text-[#94A3B8] font-mono">
                {pnlPct !== null ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%` : "—"}
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-mono text-[#64748B]">—</div>
              <div className="text-[10px] text-[#64748B]">no live price</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Issue 18: Closed trade row (from the Portfolio close flow) ────────────
interface ClosedTradeRowProps {
  trade: {
    id: string;
    symbol: string;
    name: string;
    buyPrice: number;
    shares: number;
    sellPrice: number;
    buyCost: number;
    sellValue: number;
    commission: number;
    cgt: number;
    grossPnl: number;
    netPnl: number;
    netPnlPct: number;
    holdingDays: number;
    taxRate: number;
    closedAt: string;
  };
}

function ClosedTradeRow({ trade }: ClosedTradeRowProps) {
  const isWin = trade.netPnl > 0;
  const isLoss = trade.netPnl < 0;
  return (
    <div className="p-4 hover:bg-white/[0.02]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg flex items-center justify-center font-mono font-bold text-xs shrink-0 bg-white/[0.04] text-[#94A3B8]">
            {trade.symbol.slice(0, 4)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[#F4F7FB] text-sm">{trade.symbol}</span>
              <Badge variant="outline" className="text-[9px] py-0 h-4 border-white/[0.16] text-[#94A3B8] bg-white/[0.04]">
                CLOSED
              </Badge>
            </div>
            <div className="text-[11px] text-[#94A3B8] mt-0.5 truncate">
              Buy {trade.buyPrice.toFixed(2)} × {trade.shares.toLocaleString()} → Sell {trade.sellPrice.toFixed(2)} · held {trade.holdingDays}d
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-sm font-mono font-semibold ${isWin ? "text-[#00E676]" : isLoss ? "text-[#FF5C5C]" : "text-[#94A3B8]"}`}>
            {trade.netPnl >= 0 ? "+" : ""}{fmtPkr(trade.netPnl)}
          </div>
          <div className={`text-[10px] font-mono ${isWin ? "text-[#00E676]" : isLoss ? "text-[#FF5C5C]" : "text-[#94A3B8]"}`}>
            {trade.netPnlPct >= 0 ? "+" : ""}{trade.netPnlPct.toFixed(2)}% net
          </div>
        </div>
      </div>
      {/* Inline breakdown */}
      <div className="mt-2 text-[10px] text-[#64748B] flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          Gross:{" "}
          <span className={`font-mono ${trade.grossPnl >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}`}>
            {trade.grossPnl >= 0 ? "+" : ""}{fmtPkr(trade.grossPnl)}
          </span>
        </span>
        <span>
          Commission: <span className="text-[#FF5C5C] font-mono">-{fmtPkr(trade.commission)}</span>
        </span>
        <span>
          CGT ({(trade.taxRate * 100).toFixed(0)}%):{" "}
          <span className="text-[#FF5C5C] font-mono">-{fmtPkr(trade.cgt)}</span>
        </span>
        <span className="text-[#475569]">
          · closed {new Date(trade.closedAt).toLocaleDateString("en-PK", { month: "short", day: "numeric", year: "numeric" })}
        </span>
      </div>
    </div>
  );
}
