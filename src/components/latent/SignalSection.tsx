"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AppNav } from "./AppNav";
import { StockSearch } from "./StockSearch";
import { useLatentStore } from "@/lib/latent/store";
import { MOCK_STOCKS } from "@/lib/latent/mock-stocks";
import {
  Zap,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  RefreshCw,
  Scale,
} from "lucide-react";
import { toast } from "sonner";

type Direction = "BUY" | "SELL";

interface StockSignal {
  symbol: string;
  name: string;
  direction: Direction;
  confidence: number;
  price: number;
  targetPrice: number;
  stopLoss: number;
  horizon: string;
  reason: string;
  fundamentalCall: "BUY" | "SELL" | "NEUTRAL";
  technicalCall: "BUY" | "SELL" | "NEUTRAL";
  aiCall: Direction;
  riskReward: number; // |target-entry| / |entry-stopLoss|
}

// Only keep signals that are BUY or SELL (no HOLD/ACCUMULATE)
// and have R:R >= 2 (i.e., reward >= 2x risk — "1:2" minimum)
const MIN_RISK_REWARD = 2;

function computeRiskReward(entry: number, target: number, stop: number): number {
  const reward = Math.abs(target - entry);
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return 0;
  return reward / risk;
}

export function SignalSection() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | Direction>("ALL");
  const [signals, setSignals] = useState<StockSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [singleLoading, setSingleLoading] = useState(false);
  const [singleSignal, setSingleSignal] = useState<StockSignal | null>(null);
  const selectSignal = useLatentStore((s) => s.selectSignal);
  const selectSymbol = useLatentStore((s) => s.selectSymbol);
  const pushNotification = useLatentStore((s) => s.pushNotification);
  const setView = useLatentStore((s) => s.setView);

  const loadAll = async () => {
    setLoading(true);
    await fetchAllSignals();
  };

  const fetchAllSignals = async () => {
    const results = await Promise.all(
      MOCK_STOCKS.map(async (stock) => {
        try {
          const res = await fetch(`/api/ml/signal/${stock.symbol}`);
          if (!res.ok) return null;
          const data = await res.json();
          const sig = data.signal;
          if (!sig) return null;
          // Strict BUY/SELL mapping — no HOLD/ACCUMULATE produced
          const direction = mapCallStrict(sig.direction, sig.confidenceScore);
          if (direction !== "BUY" && direction !== "SELL") return null;
          const rr = computeRiskReward(sig.entryPrice, sig.targetPrice, sig.stopLoss);
          if (rr < MIN_RISK_REWARD) return null; // skip sub-1:2 setups
          return {
            symbol: stock.symbol,
            name: stock.name,
            direction,
            confidence: sig.confidenceScore,
            price: sig.entryPrice,
            targetPrice: sig.targetPrice,
            stopLoss: sig.stopLoss,
            horizon: sig.horizon,
            reason: sig.explanation.summary,
            fundamentalCall: deriveCall(sig.explanation.fundamentalFactors),
            technicalCall: deriveCall(sig.explanation.technicalTerms, true),
            aiCall: direction,
            riskReward: rr,
          } as StockSignal;
        } catch {
          return null;
        }
      })
    );
    const valid = results.filter((r): r is StockSignal => r !== null);
    setSignals(valid);
    setLoading(false);
    if (valid.length > 0) {
      pushNotification({
        type: "signal",
        title: `${valid.length} actionable signals loaded`,
        body: `${valid.filter((s) => s.direction === "BUY").length} BUY · ${valid.filter((s) => s.direction === "SELL").length} SELL — all ≥ 1:2 R:R`,
        linkView: "signals_v2",
      });
    }
  };

  // Fetch single-stock signal when user picks one via StockSearch (extends beyond MOCK_STOCKS)
  useEffect(() => {
    if (!search) return;
    let cancelled = false;
    Promise.resolve().then(() => setSingleLoading(true));
    fetch(`/api/ml/signal/${encodeURIComponent(search)}`)
      .then((r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (!data?.signal) {
          Promise.resolve().then(() => setSingleLoading(false));
          return;
        }
        const sig = data.signal;
        const direction = mapCallStrict(sig.direction, sig.confidenceScore);
        if (direction !== "BUY" && direction !== "SELL") {
          Promise.resolve().then(() => setSingleLoading(false));
          return;
        }
        const rr = computeRiskReward(sig.entryPrice, sig.targetPrice, sig.stopLoss);
        if (rr < MIN_RISK_REWARD) {
          Promise.resolve().then(() => setSingleLoading(false));
          return;
        }
        setSingleSignal({
          symbol: sig.symbol,
          name: sig.stockName || sig.symbol,
          direction,
          confidence: sig.confidenceScore,
          price: sig.entryPrice,
          targetPrice: sig.targetPrice,
          stopLoss: sig.stopLoss,
          horizon: sig.horizon,
          reason: sig.explanation.summary,
          fundamentalCall: deriveCall(sig.explanation.fundamentalFactors),
          technicalCall: deriveCall(sig.explanation.technicalTerms, true),
          aiCall: direction,
          riskReward: rr,
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSingleLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [search]);

  useEffect(() => {
    fetchAllSignals();
  }, []);

  // When user selects a single stock via StockSearch, show ONLY that signal.
  // Guard against stale data: only show singleSignal if it matches the current search.
  const visible = search
    ? (singleSignal && singleSignal.symbol === search.toUpperCase() ? [singleSignal] : [])
    : signals.filter((s) => {
        if (filter !== "ALL" && s.direction !== filter) return false;
        return true;
      });

  const directionColor = (d: Direction) =>
    d === "BUY" ? "text-[#00E676]" : "text-[#FF5C5C]";
  const directionBg = (d: Direction) =>
    d === "BUY"
      ? "bg-[#00E676]/10 border-[#00E676]/40 text-[#00E676]"
      : "bg-[#FF5C5C]/10 border-[#FF5C5C]/40 text-[#FF5C5C]";

  return (
    <div className="min-h-screen bg-[#0A0E1A]">
      <AppNav />
      <main className="px-4 md:px-6 py-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#F4F7FB]">Signal Section</h1>
            <p className="text-sm text-[#94A3B8] mt-1">
              Actionable BUY/SELL signals only — filtered to setups with R:R ≥ 1:2 (reward ≥ 2× risk).
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadAll}
            disabled={loading}
            className="border-white/[0.12] text-[#94A3B8]"
          >
            <RefreshCw className={`h-3 w-3 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh signals
          </Button>
        </div>

        {/* KPI summary — only BUY + SELL counts now */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardContent className="p-4">
              <div className="text-[10px] uppercase tracking-wider text-[#64748B]">BUY signals</div>
              <div className="text-2xl font-bold text-[#00E676] font-mono">
                {signals.filter((s) => s.direction === "BUY").length}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardContent className="p-4">
              <div className="text-[10px] uppercase tracking-wider text-[#64748B]">SELL signals</div>
              <div className="text-2xl font-bold text-[#FF5C5C] font-mono">
                {signals.filter((s) => s.direction === "SELL").length}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardContent className="p-4">
              <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Min R:R filter</div>
              <div className="text-2xl font-bold text-[#F4F7FB] font-mono">1:2</div>
            </CardContent>
          </Card>
        </div>

        {/* StockSearch + filters */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="flex-1 min-w-[240px]">
            <label className="text-[10px] uppercase tracking-wider text-[#64748B] block mb-1">
              Search any PSX stock (361+ companies)
            </label>
            <StockSearch
              value={search}
              onChange={(sym) => setSearch(sym)}
              placeholder="Search stock by symbol or name to view its signal..."
            />
          </div>
          {!search && (
            <div className="flex items-center gap-1 overflow-x-auto latent-no-scrollbar self-end">
              {(["ALL", "BUY", "SELL"] as const).map((f) => (
                <Button
                  key={f}
                  variant={filter === f ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilter(f)}
                  className={`shrink-0 h-9 text-xs ${
                    filter === f
                      ? "bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881]"
                      : "border-white/[0.12] text-[#94A3B8]"
                  }`}
                >
                  {f}
                </Button>
              ))}
            </div>
          )}
        </div>

        {/* Signals grid */}
        {search && singleLoading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Skeleton className="h-48 bg-white/[0.04]" />
          </div>
        ) : loading && !search ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-48 bg-white/[0.04]" />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center py-16">
            <Zap className="h-10 w-10 text-[#00E676]/30 mx-auto mb-3" />
            <p className="text-sm text-[#94A3B8]">
              {search
                ? `No actionable BUY/SELL signal (≥ 1:2 R:R) for ${search}.`
                : "No signals match your filter (need BUY/SELL with R:R ≥ 1:2)."}
            </p>
            {search && (
              <p className="text-[11px] text-[#64748B] mt-1 max-w-md mx-auto">
                Either the model hasn't been trained on this symbol, or its current setup doesn't
                meet the 1:2 risk:reward minimum. Try another stock.
              </p>
            )}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visible.map((s) => (
              <Card key={s.symbol} className="bg-[#131829] border-white/[0.08] hover:border-[#00E676]/30 transition-colors">
                <CardContent className="p-5">
                  {/* Top: symbol + direction */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="h-10 w-10 rounded-lg bg-[#00E676]/10 flex items-center justify-center font-mono font-bold text-[#00E676] text-sm">
                        {s.symbol.slice(0, 4)}
                      </div>
                      <div>
                        <div className="font-bold text-[#F4F7FB]">{s.symbol}</div>
                        <div className="text-[11px] text-[#94A3B8] truncate max-w-[140px]">{s.name}</div>
                      </div>
                    </div>
                    <Badge variant="outline" className={`${directionBg(s.direction)} text-xs font-bold`}>
                      {s.direction}
                    </Badge>
                  </div>

                  {/* Confidence */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Confidence</span>
                    <span className={`font-mono font-bold ${directionColor(s.direction)}`}>
                      {s.confidence}/100
                    </span>
                  </div>
                  <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden mb-3">
                    <div
                      className={`h-full ${s.direction === "BUY" ? "bg-[#00E676]" : "bg-[#FF5C5C]"}`}
                      style={{ width: `${s.confidence}%` }}
                    />
                  </div>

                  {/* Trade params */}
                  <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                    <div>
                      <div className="text-[9px] uppercase text-[#64748B]">Entry</div>
                      <div className="text-sm font-mono font-semibold text-[#F4F7FB]">{s.price}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase text-[#64748B]">Target</div>
                      <div className="text-sm font-mono font-semibold text-[#00E676]">{s.targetPrice}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase text-[#64748B]">Stop</div>
                      <div className="text-sm font-mono font-semibold text-[#FF5C5C]">{s.stopLoss}</div>
                    </div>
                  </div>

                  {/* R:R badge — prominently displayed */}
                  <div className="rounded-md bg-[#0A0E1A] border border-[#00E676]/20 p-2 mb-3 flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-[#64748B] flex items-center gap-1">
                      <Scale className="h-3 w-3" /> Risk : Reward
                    </span>
                    <span className="text-xs font-mono font-bold text-[#00E676]">
                      1 : {s.riskReward.toFixed(2)}
                    </span>
                  </div>

                  {/* Reason */}
                  <p className="text-xs text-[#94A3B8] leading-relaxed line-clamp-2 mb-3">
                    {s.reason}
                  </p>

                  {/* Three calls */}
                  <div className="grid grid-cols-3 gap-1.5 mb-3 pt-3 border-t border-white/[0.06]">
                    <div className="text-center">
                      <div className="text-[9px] uppercase text-[#64748B]">Fundamental</div>
                      <div className={`text-xs font-bold ${callColor(s.fundamentalCall)}`}>{s.fundamentalCall}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[9px] uppercase text-[#64748B]">Technical</div>
                      <div className={`text-xs font-bold ${callColor(s.technicalCall)}`}>{s.technicalCall}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-[9px] uppercase text-[#64748B]">AI Model</div>
                      <div className={`text-xs font-bold ${directionColor(s.aiCall)}`}>{s.aiCall}</div>
                    </div>
                  </div>

                  {/* CTA */}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      selectSymbol(s.symbol);
                      setView("signal_detail");
                      toast.info(`Opening AI analysis for ${s.symbol}...`);
                    }}
                    className="w-full border-white/[0.12] text-[#94A3B8] hover:text-[#F4F7FB] h-8"
                  >
                    View in depth
                    <ArrowRight className="h-3 w-3 ml-1.5" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Disclaimer */}
        <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3 text-[11px] text-[#64748B] leading-relaxed mt-6">
          <span className="text-[#94A3B8] font-semibold">Filter policy:</span> Only
          actionable BUY and SELL signals are shown — HOLD and ACCUMULATE are suppressed.
          Signals are further filtered to setups with a Risk:Reward ratio of <span className="text-[#00E676] font-mono">≥ 1:2</span> (reward ≥ 2× risk).
          The XGBoost scaffold is trained on real PSX OHLCV; past performance does not guarantee future returns.
        </div>
      </main>
    </div>
  );
}

// Strict mapping — only BUY or SELL produced (no HOLD/ACCUMULATE)
function mapCallStrict(direction: string, confidence: number): Direction {
  if (direction !== "LONG") return "SELL";
  if (confidence >= 50) return "BUY";
  return "SELL";
}

function deriveCall(factors: { impact: string }[], isTechnical = false): "BUY" | "SELL" | "NEUTRAL" {
  const positive = factors.filter((f) => f.impact === "positive").length;
  const negative = factors.filter((f) => f.impact === "negative").length;
  if (positive > negative + 1) return "BUY";
  if (negative > positive + 1) return "SELL";
  return "NEUTRAL";
}

function callColor(call: "BUY" | "SELL" | "NEUTRAL") {
  return call === "BUY" ? "text-[#00E676]" : call === "SELL" ? "text-[#FF5C5C]" : "text-[#94A3B8]";
}
