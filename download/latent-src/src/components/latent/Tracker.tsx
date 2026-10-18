"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AppNav } from "./AppNav";
import { useLatentStore } from "@/lib/latent/store";
import { Trade, TrackRecordStats } from "@/lib/latent/types";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Trophy,
  TrendingUp,
  TrendingDown,
  Activity,
  Target,
  Clock,
  Zap,
  Briefcase,
  Download,
} from "lucide-react";
import { toast } from "sonner";

export function Tracker() {
  const [stats, setStats] = useState<TrackRecordStats | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const portfolio = useLatentStore((s) => s.portfolio);

  useEffect(() => {
    fetch("/api/track-record")
      .then((r) => r.json())
      .then((d) => {
        setStats(d.stats);
        setTrades(d.trades || []);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleDownload = () => {
    if (!stats) return;
    const lines = [
      "Latent.pk — Track Record Report",
      "Generated: " + new Date().toISOString(),
      "",
      "=== SIGNAL TRACKER ===",
      `Total signals: ${stats.totalTrades}`,
      `Wins: ${stats.wins}`,
      `Losses: ${stats.losses}`,
      `Win rate: ${stats.winRate}%`,
      `Avg win: +${stats.avgWinPct}%`,
      `Avg loss: ${stats.avgLossPct}%`,
      `Profit factor: ${stats.profitFactor}`,
      "",
      "=== BY HORIZON ===",
      ...stats.byHorizon.map((h) => `${h.horizon}: ${h.wins}/${h.total} (${h.winRate}%)`),
      "",
      "=== PORTFOLIO TRACKER ===",
      ...portfolio.map((p) => `${p.symbol} | buy: ${p.buyPrice || "—"} | shares: ${p.shares}`),
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
        </div>
      </div>
    );
  }

  if (!stats) return null;

  // Portfolio tracker derived from current portfolio state
  const portfolioStats = portfolio.reduce(
    (acc, p) => {
      if (p.buyPrice !== null && p.shares > 0) {
        acc.total++;
      }
      return acc;
    },
    { total: 0 }
  );

  return (
    <div className="min-h-screen bg-[#0A0E1A]">
      <AppNav />
      <main className="px-4 md:px-6 py-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#F4F7FB]">Tracker</h1>
            <p className="text-sm text-[#94A3B8] mt-1">
              Two-track accuracy dashboard — signal tracker (our model&apos;s performance) + portfolio tracker (your P&L).
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <Card className="bg-gradient-to-br from-[#00E676]/[0.07] to-[#131829] border-[#00E676]/20">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Win rate</span>
                    <Trophy className="h-3 w-3 text-[#00E676]" />
                  </div>
                  <div className="text-3xl font-bold text-[#00E676] font-mono">{stats.winRate}%</div>
                  <div className="text-[10px] text-[#94A3B8] mt-1">
                    {stats.wins}W / {stats.losses}L · {stats.openTrades} open
                  </div>
                </CardContent>
              </Card>
              <Card className="bg-[#131829] border-white/[0.08]">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Avg win</span>
                    <TrendingUp className="h-3 w-3 text-[#00E676]" />
                  </div>
                  <div className="text-2xl font-bold text-[#00E676] font-mono">+{stats.avgWinPct}%</div>
                  <div className="text-[10px] text-[#94A3B8] mt-1">in {stats.avgTimeToProfitDays} days</div>
                </CardContent>
              </Card>
              <Card className="bg-[#131829] border-white/[0.08]">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Avg loss</span>
                    <TrendingDown className="h-3 w-3 text-[#FF5C5C]" />
                  </div>
                  <div className="text-2xl font-bold text-[#FF5C5C] font-mono">{stats.avgLossPct}%</div>
                  <div className="text-[10px] text-[#94A3B8] mt-1">in {stats.avgTimeToLossDays} days</div>
                </CardContent>
              </Card>
              <Card className="bg-[#131829] border-white/[0.08]">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Profit factor</span>
                    <Activity className="h-3 w-3 text-[#00E676]" />
                  </div>
                  <div className="text-2xl font-bold text-[#F4F7FB] font-mono">{stats.profitFactor}</div>
                  <div className="text-[10px] text-[#94A3B8] mt-1">gross profit / loss</div>
                </CardContent>
              </Card>
            </div>

            {/* Signal list */}
            <Card className="bg-[#131829] border-white/[0.08]">
              <CardContent className="p-0">
                <div className="p-4 border-b border-white/[0.06]">
                  <h3 className="font-semibold text-[#F4F7FB]">All signals</h3>
                  <p className="text-xs text-[#94A3B8] mt-0.5">
                    Open trades show live P&L · closed trades show final outcome
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-[#64748B] border-b border-white/[0.06]">
                        <th className="text-left py-2 px-3 font-semibold">Symbol</th>
                        <th className="text-left py-2 px-3 font-semibold">Horizon</th>
                        <th className="text-right py-2 px-3 font-semibold">Entry</th>
                        <th className="text-right py-2 px-3 font-semibold">Exit</th>
                        <th className="text-right py-2 px-3 font-semibold">P&L %</th>
                        <th className="text-right py-2 px-3 font-semibold">Days</th>
                        <th className="text-right py-2 px-3 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades.slice(0, 20).map((t) => {
                        const isOpen = t.status === "OPEN";
                        const isWin = t.status === "CLOSED_WIN";
                        const isLoss = t.status === "CLOSED_LOSS";
                        return (
                          <tr key={t.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                            <td className="py-2.5 px-3 font-mono font-semibold text-[#F4F7FB]">{t.symbol}</td>
                            <td className="py-2.5 px-3">
                              <Badge variant="outline" className="text-[9px] py-0 h-4 border-[#00E676]/40 text-[#00E676]">
                                {t.horizon}
                              </Badge>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-[#94A3B8]">{t.entryPrice}</td>
                            <td className="py-2.5 px-3 text-right font-mono text-[#94A3B8]">{t.exitPrice ?? "—"}</td>
                            <td className={`py-2.5 px-3 text-right font-mono font-semibold ${
                              isOpen ? "text-[#94A3B8]" : isWin ? "text-[#00E676]" : isLoss ? "text-[#FF5C5C]" : "text-[#94A3B8]"
                            }`}>
                              {t.pnlPct != null ? `${t.pnlPct > 0 ? "+" : ""}${t.pnlPct}%` : "—"}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-[#64748B]">
                              {t.timeToCloseDays ?? "open"}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <Badge variant="outline" className={`text-[9px] py-0 h-4 ${
                                isOpen ? "border-amber-500/40 text-amber-400" :
                                isWin ? "border-[#00E676]/40 text-[#00E676]" :
                                isLoss ? "border-[#FF5C5C]/40 text-[#FF5C5C]" :
                                "border-white/[0.12] text-[#94A3B8]"
                              }`}>
                                {isOpen ? "OPEN" : t.status.replace("CLOSED_", "")}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Portfolio Tracker */}
          <TabsContent value="portfolio" className="mt-4">
            {portfolio.length === 0 ? (
              <Card className="bg-[#131829] border-white/[0.08]">
                <CardContent className="p-12 text-center">
                  <Briefcase className="h-12 w-12 text-[#00E676]/30 mx-auto mb-3" />
                  <h3 className="font-semibold text-[#F4F7FB] mb-1">No portfolio positions yet</h3>
                  <p className="text-xs text-[#94A3B8]">
                    Add stocks with buy prices to see your P&L, success ratio, and ROI% here.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                  <Card className="bg-[#131829] border-white/[0.08]">
                    <CardContent className="p-4">
                      <div className="text-[10px] uppercase tracking-wider text-[#64748B] mb-1">Positions</div>
                      <div className="text-2xl font-bold text-[#F4F7FB] font-mono">{portfolioStats.total}</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-[#131829] border-white/[0.08]">
                    <CardContent className="p-4">
                      <div className="text-[10px] uppercase tracking-wider text-[#64748B] mb-1">Win rate</div>
                      <div className="text-2xl font-bold text-[#00E676] font-mono">—</div>
                      <div className="text-[10px] text-[#94A3B8]">no closed trades yet</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-[#131829] border-white/[0.08]">
                    <CardContent className="p-4">
                      <div className="text-[10px] uppercase tracking-wider text-[#64748B] mb-1">ROI %</div>
                      <div className="text-2xl font-bold text-[#F4F7FB] font-mono">—</div>
                      <div className="text-[10px] text-[#94A3B8]">add buy prices to compute</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-[#131829] border-white/[0.08]">
                    <CardContent className="p-4">
                      <div className="text-[10px] uppercase tracking-wider text-[#64748B] mb-1">Open trades</div>
                      <div className="text-2xl font-bold text-[#F4F7FB] font-mono">{portfolio.length}</div>
                    </CardContent>
                  </Card>
                </div>

                <Card className="bg-[#131829] border-white/[0.08]">
                  <CardContent className="p-0">
                    <div className="p-4 border-b border-white/[0.06]">
                      <h3 className="font-semibold text-[#F4F7FB]">Your trades</h3>
                      <p className="text-xs text-[#94A3B8] mt-0.5">
                        Live P&L based on current PSX prices · refresh to update
                      </p>
                    </div>
                    <div className="divide-y divide-white/[0.04]">
                      {portfolio.map((p, i) => (
                        <div key={i} className="flex items-center justify-between p-4 hover:bg-white/[0.02]">
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-lg bg-[#00E676]/10 flex items-center justify-center font-mono font-bold text-[#00E676] text-xs">
                              {p.symbol.slice(0, 4)}
                            </div>
                            <div>
                              <div className="font-semibold text-[#F4F7FB] text-sm">{p.symbol}</div>
                              <div className="text-[11px] text-[#94A3B8]">
                                Buy: {p.buyPrice || "—"} · {p.shares} shares
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <Badge variant="outline" className="text-[9px] py-0 h-4 border-amber-500/40 text-amber-400">
                              OPEN
                            </Badge>
                          </div>
                        </div>
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
          numbers shown are based on synthetic backtested data. Once you start tracking real
          signals against real PSX executions, these numbers update live. Notifications fire
          when a tracked signal hits TP or SL.
        </div>
      </main>
    </div>
  );
}
