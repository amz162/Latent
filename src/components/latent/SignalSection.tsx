"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { AppNav } from "./AppNav";
import { useLatentStore } from "@/lib/latent/store";
import { MOCK_STOCKS } from "@/lib/latent/mock-stocks";
import {
  Zap,
  Search,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
  RefreshCw,
  Filter,
} from "lucide-react";
import { toast } from "sonner";

type Direction = "BUY" | "SELL" | "HOLD" | "ACCUMULATE";

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
}

export function SignalSection() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | Direction>("ALL");
  const [signals, setSignals] = useState<StockSignal[]>([]);
  const [loading, setLoading] = useState(true);
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
          return {
            symbol: stock.symbol,
            name: stock.name,
            direction: mapCall(sig.direction, sig.confidenceScore),
            confidence: sig.confidenceScore,
            price: sig.entryPrice,
            targetPrice: sig.targetPrice,
            stopLoss: sig.stopLoss,
            horizon: sig.horizon,
            reason: sig.explanation.summary,
            fundamentalCall: deriveCall(sig.explanation.fundamentalFactors),
            technicalCall: deriveCall(sig.explanation.technicalTerms, true),
            aiCall: mapCall(sig.direction, sig.confidenceScore),
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
        title: `${valid.length} signals loaded`,
        body: `${valid.filter((s) => s.direction === "BUY").length} BUY · ${valid.filter((s) => s.direction === "SELL").length} SELL · ${valid.filter((s) => s.direction === "HOLD").length} HOLD`,
        linkView: "signals_v2",
      });
    }
  };

  useEffect(() => {
    fetchAllSignals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = signals.filter((s) => {
    if (filter !== "ALL" && s.direction !== filter) return false;
    if (search && !s.symbol.toLowerCase().includes(search.toLowerCase()) && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const directionColor = (d: Direction) =>
    d === "BUY" ? "text-[#00E676]" : d === "SELL" ? "text-[#FF5C5C]" : d === "ACCUMULATE" ? "text-amber-400" : "text-[#94A3B8]";
  const directionBg = (d: Direction) =>
    d === "BUY" ? "bg-[#00E676]/10 border-[#00E676]/40 text-[#00E676]" :
    d === "SELL" ? "bg-[#FF5C5C]/10 border-[#FF5C5C]/40 text-[#FF5C5C]" :
    d === "ACCUMULATE" ? "bg-amber-400/10 border-amber-400/40 text-amber-400" :
    "bg-white/[0.04] border-white/[0.12] text-[#94A3B8]";

  return (
    <div className="min-h-screen bg-[#0A0E1A]">
      <AppNav />
      <main className="px-4 md:px-6 py-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#F4F7FB]">Signal Section</h1>
            <p className="text-sm text-[#94A3B8] mt-1">
              Per-stock BUY/SELL/HOLD signals from ML model — combined fundamental + technical + AI call.
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

        {/* KPI summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[
            { label: "BUY", count: signals.filter((s) => s.direction === "BUY").length, color: "text-[#00E676]" },
            { label: "SELL", count: signals.filter((s) => s.direction === "SELL").length, color: "text-[#FF5C5C]" },
            { label: "HOLD", count: signals.filter((s) => s.direction === "HOLD").length, color: "text-[#94A3B8]" },
            { label: "ACCUMULATE", count: signals.filter((s) => s.direction === "ACCUMULATE").length, color: "text-amber-400" },
          ].map((s) => (
            <Card key={s.label} className="bg-[#131829] border-white/[0.08]">
              <CardContent className="p-4">
                <div className="text-[10px] uppercase tracking-wider text-[#64748B] mb-1">{s.label}</div>
                <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.count}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Search + filters */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#64748B]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by symbol or company name..."
              className="pl-9 bg-[#131829] border-white/[0.12] text-[#F4F7FB] h-9"
            />
          </div>
          <div className="flex items-center gap-1 overflow-x-auto latent-no-scrollbar">
            <Filter className="h-3.5 w-3.5 text-[#64748B] flex-shrink-0 mr-1" />
            {(["ALL", "BUY", "SELL", "HOLD", "ACCUMULATE"] as const).map((f) => (
              <Button
                key={f}
                variant={filter === f ? "default" : "outline"}
                size="sm"
                onClick={() => setFilter(f)}
                className={`shrink-0 h-8 text-xs ${
                  filter === f
                    ? "bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881]"
                    : "border-white/[0.12] text-[#94A3B8]"
                }`}
              >
                {f}
              </Button>
            ))}
          </div>
        </div>

        {/* Signals grid */}
        {loading ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-48 bg-white/[0.04]" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Zap className="h-10 w-10 text-[#00E676]/30 mx-auto mb-3" />
            <p className="text-sm text-[#94A3B8]">No signals match your filter.</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((s) => (
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
                      className={`h-full ${s.direction === "BUY" ? "bg-[#00E676]" : s.direction === "SELL" ? "bg-[#FF5C5C]" : "bg-amber-400"}`}
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
                      // Route to detail view with the XGBoost signal symbol
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
          <span className="text-[#94A3B8] font-semibold">Model:</span> Signals are generated by a stub XGBoost scaffold — real model training requires historical PSX OHLCV data + labeled setups. The signal direction (BUY/SELL/HOLD/ACCUMULATE) is derived from confidence score thresholds.
        </div>
      </main>
    </div>
  );
}

function mapCall(direction: string, confidence: number): Direction {
  if (direction !== "LONG") return "SELL";
  if (confidence >= 80) return "BUY";
  if (confidence >= 65) return "ACCUMULATE";
  if (confidence >= 50) return "HOLD";
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
