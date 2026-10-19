"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AppNav } from "./AppNav";
import { useLatentStore } from "@/lib/latent/store";
import { TrackRecordStats } from "@/lib/latent/types";
import { TrendingUp, Target, Activity, Zap, ArrowRight, Sparkles, LineChart } from "lucide-react";

// Shape returned by /api/signals/all (batch endpoint that filters the CL
// Ensemble consensus across all 361 PSX stocks to BUY/SELL signals with
// R:R ≥ 1:2 — same source of truth the SignalSection uses).
interface DashboardSignal {
  symbol: string;
  stockName: string;
  signal: "BUY" | "SELL";
  direction: "LONG" | "SHORT";
  confidence: number;
  currentPrice: number;
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  tp3: number;
  riskReward: number;
  avgReturn: number;
}

export function Dashboard() {
  const setView = useLatentStore((s) => s.setView);
  const selectSymbol = useLatentStore((s) => s.selectSymbol);
  const plan = useLatentStore((s) => s.plan);
  const userName = useLatentStore((s) => s.userName);
  const riskProfile = useLatentStore((s) => s.riskProfile);
  const [signals, setSignals] = useState<DashboardSignal[]>([]);
  const [stats, setStats] = useState<TrackRecordStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      // Same data source as SignalSection → counts always match (Issue 1)
      fetch("/api/signals/all").then((r) => r.json()),
      fetch("/api/track-record").then((r) => r.json()),
    ])
      .then(([sigs, track]) => {
        setSignals(sigs.signals || []);
        setStats(track.stats);
      })
      .finally(() => setLoading(false));
  }, []);

  // Build a symbol→signal lookup so the Plan card can show "See Signal" only
  // when a signal actually exists for that stock (Issue 4).
  const signalBySymbol = useMemo(() => {
    const m = new Map<string, DashboardSignal>();
    for (const s of signals) m.set(s.symbol, s);
    return m;
  }, [signals]);

  const activeSignals = signals;
  const firstNames = (userName || "investor").split(" ")[0];

  return (
    <div className="min-h-screen bg-[#0A0E1A]">
      <AppNav />

      <main className="px-4 md:px-6 py-6 max-w-7xl mx-auto">
        {/* Greeting */}
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-[#F4F7FB]">
            Assalam-o-Alaikum, {firstNames} 👋
          </h1>
          <p className="text-sm text-[#94A3B8] mt-1">
            {plan
              ? `Your ${plan.profileBucket} plan is on track. ${activeSignals.length} active signal${activeSignals.length === 1 ? "" : "s"} to review.`
              : "No plan yet. Build one to start receiving personalized signals."}
          </p>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Portfolio value</span>
                <TrendingUp className="h-3 w-3 text-[#00E676]" />
              </div>
              {loading ? (
                <Skeleton className="h-8 w-24 bg-white/[0.04]" />
              ) : (
                <div className="text-2xl font-bold text-[#F4F7FB] font-mono">PKR 0</div>
              )}
              <div className="text-[10px] text-[#64748B] mt-1">No positions yet — execute your first signal</div>
            </CardContent>
          </Card>
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Active signals</span>
                <Zap className="h-3 w-3 text-[#00E676]" />
              </div>
              {loading ? (
                <Skeleton className="h-8 w-12 bg-white/[0.04]" />
              ) : (
                <div className="text-2xl font-bold text-[#00E676] font-mono">{activeSignals.length}</div>
              )}
              <div className="text-[10px] text-[#64748B] mt-1">Across 4 trade horizons</div>
            </CardContent>
          </Card>
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Plan bucket</span>
                <Target className="h-3 w-3 text-[#00E676]" />
              </div>
              {plan ? (
                <>
                  <div className="text-2xl font-bold text-[#F4F7FB] capitalize">{plan.profileBucket}</div>
                  <div className="text-[10px] text-[#64748B] mt-1">{plan.expectedReturnPct}% target annualized</div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-bold text-[#64748B]">—</div>
                  <Button
                    size="sm"
                    variant="link"
                    className="h-auto p-0 text-[10px] text-[#00E676]"
                    onClick={() => setView("onboarding")}
                  >
                    Build plan →
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Win rate</span>
                <Activity className="h-3 w-3 text-[#00E676]" />
              </div>
              {loading || !stats ? (
                <Skeleton className="h-8 w-16 bg-white/[0.04]" />
              ) : (
                <div className="text-2xl font-bold text-[#F4F7FB] font-mono">{stats.winRate}%</div>
              )}
              <div className="text-[10px] text-[#64748B] mt-1">
                {stats ? `${stats.wins}/${stats.wins + stats.losses} closed trades` : ""}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 2-column main content */}
        <div className="grid lg:grid-cols-3 gap-4">
          {/* Active signals (left, 2 cols) */}
          <Card className="lg:col-span-2 bg-[#131829] border-white/[0.08]">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-[#F4F7FB]">Active signals</h2>
                  <p className="text-xs text-[#94A3B8]">Latest recommendations from your plan</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setView("signals_v2")}
                  className="border-white/[0.12] text-[#94A3B8] hover:text-[#F4F7FB]"
                >
                  See all
                  <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </div>

              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-16 w-full bg-white/[0.04]" />
                  ))}
                </div>
              ) : activeSignals.length === 0 ? (
                <div className="text-center py-8">
                  <Zap className="h-8 w-8 text-[#00E676]/30 mx-auto mb-2" />
                  <p className="text-xs text-[#94A3B8]">
                    No actionable signals right now — the CL Ensemble consensus across
                    361 PSX stocks didn&apos;t surface any BUY/SEL setups with R:R ≥ 1:2.
                  </p>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => setView("signals_v2")}
                    className="text-[10px] text-[#00E676] mt-2"
                  >
                    Open Signal Section →
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {activeSignals.slice(0, 4).map((sig) => {
                    const isBuy = sig.signal === "BUY";
                    const accent = isBuy ? "text-[#00E676]" : "text-[#FF5C5C]";
                    const accentBg = isBuy
                      ? "bg-[#00E676]/10 border-[#00E676]/40 text-[#00E676]"
                      : "bg-[#FF5C5C]/10 border-[#FF5C5C]/40 text-[#FF5C5C]";
                    const upsidePct = sig.entry > 0
                      ? ((sig.tp2 - sig.entry) / sig.entry) * 100
                      : 0;
                    return (
                      <button
                        key={sig.symbol}
                        onClick={() => {
                          selectSymbol(sig.symbol);
                          setView("ai_model_signals");
                        }}
                        className="w-full flex items-center gap-4 p-3 rounded-lg bg-[#0A0E1A] border border-white/[0.06] hover:border-[#00E676]/30 hover:bg-white/[0.02] transition-colors text-left"
                      >
                        <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-[#00E676]/10 flex items-center justify-center font-mono font-bold text-[#00E676] text-sm">
                          {sig.symbol.slice(0, 4)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[#F4F7FB] text-sm">{sig.symbol}</span>
                            <Badge variant="outline" className={`text-[9px] py-0 h-4 ${accentBg}`}>
                              {sig.signal}
                            </Badge>
                            <Badge variant="outline" className="text-[9px] py-0 h-4 border-white/[0.08] text-[#64748B]">
                              R:R 1:{sig.riskReward.toFixed(1)}
                            </Badge>
                          </div>
                          <div className="text-xs text-[#94A3B8] truncate mt-0.5">
                            Entry {sig.entry.toFixed(2)} · Target {sig.tp2.toFixed(2)} · SL {sig.sl.toFixed(2)}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className={`text-sm font-mono font-bold ${accent}`}>
                            {isBuy ? "+" : ""}{upsidePct.toFixed(1)}%
                          </div>
                          <div className="text-[10px] text-[#64748B]">
                            conf {sig.confidence}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Right column: Plan summary + Track record teaser */}
          <div className="space-y-4">
            <Card className="bg-[#131829] border-white/[0.08]">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-semibold text-[#F4F7FB]">Your plan</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setView("plan")}
                    className="h-7 text-[#00E676] hover:bg-[#00E676]/10"
                  >
                    View →
                  </Button>
                </div>
                {plan ? (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Badge className="bg-[#00E676]/15 text-[#00E676] border-[#00E676]/30 capitalize">
                        {plan.profileBucket}
                      </Badge>
                      <span className="text-xs text-[#94A3B8]">{plan.allocation.length} positions</span>
                    </div>
                    <div className="space-y-1.5">
                      {plan.allocation.slice(0, 5).map((a) => {
                        // Issue 4: only show "See Signal" if a signal actually
                        // exists for this stock in the signals list (the same
                        // /api/signals/all source the SignalSection uses).
                        const sig = signalBySymbol.get(a.symbol);
                        const sigColor = sig
                          ? sig.signal === "BUY"
                            ? "text-[#00E676]"
                            : "text-[#FF5C5C]"
                          : "text-[#64748B]";
                        return (
                          <div key={a.symbol} className="flex items-center justify-between text-xs">
                            <span className="font-mono text-[#F4F7FB]">{a.symbol}</span>
                            <div className="flex items-center gap-2 flex-1 mx-3">
                              <div className="h-1.5 bg-white/[0.06] rounded-full flex-1 overflow-hidden">
                                <div
                                  className="h-full bg-[#00E676]"
                                  style={{ width: `${a.allocationPct}%` }}
                                />
                              </div>
                            </div>
                            <span className="font-mono text-[#94A3B8] w-10 text-right">
                              {a.allocationPct.toFixed(1)}%
                            </span>
                            {sig ? (
                              <button
                                onClick={() => {
                                  selectSymbol(a.symbol);
                                  setView("signals_v2");
                                }}
                                className={`ml-2 flex items-center gap-1 text-[10px] font-semibold ${sigColor} hover:underline shrink-0`}
                                title={`${sig.signal} · R:R 1:${sig.riskReward.toFixed(1)}`}
                              >
                                <LineChart className="h-3 w-3" />
                                {sig.signal}
                              </button>
                            ) : (
                              <span
                                className="ml-2 text-[10px] text-[#64748B] shrink-0"
                                title="No actionable signal for this stock"
                              >
                                No signal
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6">
                    <Sparkles className="h-8 w-8 text-[#00E676]/40 mx-auto mb-2" />
                    <p className="text-xs text-[#94A3B8] mb-3">
                      Take 4 quick steps to generate your personalized PSX investment plan.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => setView("onboarding")}
                      className="bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881]"
                    >
                      Build my plan
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-[#131829] border-white/[0.08]">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-semibold text-[#F4F7FB]">Track record</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setView("track_record")}
                    className="h-7 text-[#00E676] hover:bg-[#00E676]/10"
                  >
                    View →
                  </Button>
                </div>
                {stats && (
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-2.5">
                      <div className="text-lg font-bold text-[#00E676] font-mono">{stats.winRate}%</div>
                      <div className="text-[10px] text-[#64748B] uppercase">Win rate</div>
                    </div>
                    <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-2.5">
                      <div className="text-lg font-bold text-[#F4F7FB] font-mono">{stats.totalTrades}</div>
                      <div className="text-[10px] text-[#64748B] uppercase">Total trades</div>
                    </div>
                    <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-2.5">
                      <div className="text-lg font-bold text-[#F4F7FB] font-mono">{stats.avgWinPct.toFixed(1)}%</div>
                      <div className="text-[10px] text-[#64748B] uppercase">Avg win</div>
                    </div>
                    <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-2.5">
                      <div className="text-lg font-bold text-[#F4F7FB] font-mono">{stats.profitFactor}</div>
                      <div className="text-[10px] text-[#64748B] uppercase">Profit factor</div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {riskProfile && (
              <Card className="bg-[#131829] border-white/[0.08]">
                <CardContent className="p-5">
                  <h3 className="text-base font-semibold text-[#F4F7FB] mb-3">Your goal</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[#94A3B8]">Goal</span>
                      <span className="text-[#F4F7FB]">{riskProfile.goalLabel}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#94A3B8]">Target</span>
                      <span className="text-[#F4F7FB] font-mono">PKR {riskProfile.goalTargetAmount.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#94A3B8]">By</span>
                      <span className="text-[#F4F7FB]">
                        {new Date(riskProfile.goalDate).toLocaleDateString("en-PK", { year: "numeric", month: "short" })}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#94A3B8]">Monthly</span>
                      <span className="text-[#00E676] font-mono">PKR {riskProfile.monthlyContribution.toLocaleString()}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
