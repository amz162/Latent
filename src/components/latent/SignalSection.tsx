"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AppNav } from "./AppNav";
import { StockSearch } from "./StockSearch";
import { useLatentStore } from "@/lib/latent/store";
import {
  Zap,
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
  riskReward: number; // |tp2-entry| / |entry-sl|
}

// Filter policy:
//   - Only BUY and SELL signals (HOLD suppressed)
//   - R:R ≥ 1:2 (reward ≥ 2× risk), using TP2 as the reward target
// The batch endpoint /api/signals/all applies this filter server-side, so the
// SignalSection list and the Dashboard's "active signals" KPI always agree.
const MIN_RISK_REWARD = 2;

function computeRiskReward(entry: number, target: number, stop: number): number {
  const reward = Math.abs(target - entry);
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return 0;
  return reward / risk;
}

// Build a one-line layman summary from the ensemble consensus fields.
function buildReason(
  symbol: string,
  direction: Direction,
  confidence: number,
  rr: number,
  avgReturn?: number
): string {
  const verb = direction === "BUY" ? "Bullish" : "Bearish";
  const ret =
    typeof avgReturn === "number" && isFinite(avgReturn)
      ? ` · projected ${avgReturn >= 0 ? "+" : ""}${(avgReturn * 100).toFixed(1)}% avg return`
      : "";
  return `${verb} ensemble consensus on ${symbol} — confidence ${confidence}/100, R:R 1:${rr.toFixed(2)} (TP2 target).${ret}`;
}

export function SignalSection() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | Direction>("ALL");
  const [signals, setSignals] = useState<StockSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [singleLoading, setSingleLoading] = useState(false);
  const [singleSignal, setSingleSignal] = useState<StockSignal | null>(null);
  const selectSymbol = useLatentStore((s) => s.selectSymbol);
  const pushNotification = useLatentStore((s) => s.pushNotification);
  const setView = useLatentStore((s) => s.setView);

  // Fetch ALL actionable signals from the batch endpoint (single API call).
  // The endpoint iterates all 361 stocks in cl_ensemble_predictions and
  // filters server-side by BUY/SELL with R:R ≥ 1:2.
  const fetchAllSignals = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/signals/all");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list: StockSignal[] = (data.signals || []).map((s: any) => ({
        symbol: s.symbol,
        name: s.stockName || s.symbol,
        direction: s.signal as Direction,
        confidence: s.confidence ?? 0,
        price: s.currentPrice ?? s.entry,
        targetPrice: s.tp2,
        stopLoss: s.sl,
        horizon: "SWING",
        reason: buildReason(s.symbol, s.signal, s.confidence, s.riskReward, s.avgReturn),
        fundamentalCall: "NEUTRAL",
        technicalCall: "NEUTRAL",
        aiCall: s.signal as Direction,
        riskReward: s.riskReward,
      }));
      setSignals(list);
      if (list.length > 0) {
        pushNotification({
          type: "signal",
          title: `${list.length} actionable signals loaded`,
          body: `${list.filter((s) => s.direction === "BUY").length} BUY · ${list.filter((s) => s.direction === "SELL").length} SELL — all ≥ 1:2 R:R`,
          linkView: "signals_v2",
        });
      }
    } catch {
      setSignals([]);
    } finally {
      setLoading(false);
    }
  };

  const loadAll = async () => {
    setLoading(true);
    await fetchAllSignals();
  };

  // Single-stock search — fetch the per-symbol AI Model Signals endpoint and
  // use its `finalConsensus` field (per Issue 6: "use the final ensemble
  // consensus"). Same BUY/SELL + R:R ≥ 1:2 filter as the batch endpoint.
  useEffect(() => {
    if (!search) {
      setSingleSignal(null);
      return;
    }
    let cancelled = false;
    setSingleLoading(true);
    fetch(`/api/ai-model-signals/${encodeURIComponent(search)}`)
      .then((r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        const fc = data?.finalConsensus;
        if (!fc) {
          setSingleSignal(null);
          return;
        }
        // Only BUY/SELL signals pass (HOLD is suppressed per filter policy)
        if (fc.signal !== "BUY" && fc.signal !== "SELL") {
          setSingleSignal(null);
          return;
        }
        const rr = computeRiskReward(fc.entry, fc.tp2, fc.sl);
        if (rr < MIN_RISK_REWARD) {
          setSingleSignal(null);
          return;
        }
        setSingleSignal({
          symbol: data.symbol,
          name: data.stockName || data.symbol,
          direction: fc.signal as Direction,
          confidence: fc.confidence ?? 0,
          price: data.currentPrice ?? fc.entry,
          targetPrice: fc.tp2,
          stopLoss: fc.sl,
          horizon: "SWING",
          reason: buildReason(data.symbol, fc.signal, fc.confidence, rr),
          fundamentalCall: "NEUTRAL",
          technicalCall: "NEUTRAL",
          aiCall: fc.signal as Direction,
          riskReward: rr,
        });
      })
      .catch(() => {
        if (!cancelled) setSingleSignal(null);
      })
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
              Actionable BUY/SELL signals only — filtered to setups with R:R ≥ 1:2 (reward ≥ 2× risk, TP2 target).
              Sourced from the CL Ensemble consensus across all 361 PSX-listed stocks.
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
                Either the ensemble consensus is HOLD, or the current setup&apos;s TP2 doesn&apos;t
                offer 2× the risk. Try another stock.
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
                      style={{ width: `${Math.min(100, Math.max(0, s.confidence))}%` }}
                    />
                  </div>

                  {/* Trade params */}
                  <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                    <div>
                      <div className="text-[9px] uppercase text-[#64748B]">Entry</div>
                      <div className="text-sm font-mono font-semibold text-[#F4F7FB]">{s.price.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase text-[#64748B]">Target (TP2)</div>
                      <div className="text-sm font-mono font-semibold text-[#00E676]">{s.targetPrice.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase text-[#64748B]">Stop</div>
                      <div className="text-sm font-mono font-semibold text-[#FF5C5C]">{s.stopLoss.toFixed(2)}</div>
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

                  {/* CTA — View in depth (opens the AI Model Signals view for
                      the full ensemble breakdown, which works for any of 361
                      stocks, not just the 8 in ml_predictions.json). */}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      selectSymbol(s.symbol);
                      setView("ai_model_signals");
                      toast.info(`Opening AI model breakdown for ${s.symbol}...`);
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
          actionable BUY and SELL signals are shown — HOLD is suppressed. Signals are further
          filtered to setups with a Risk:Reward ratio of <span className="text-[#00E676] font-mono">≥ 1:2</span> (reward ≥ 2× risk,
          using TP2 as the reward target). Consensus comes from the CL Ensemble (LGB70 + Log30)
          trained on real PSX OHLCV across 361 stocks. Past performance does not guarantee future returns.
        </div>
      </main>
    </div>
  );
}

function callColor(call: "BUY" | "SELL" | "NEUTRAL") {
  return call === "BUY" ? "text-[#00E676]" : call === "SELL" ? "text-[#FF5C5C]" : "text-[#94A3B8]";
}
