"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AppNav } from "./AppNav";
import { Trade, TrackRecordStats } from "@/lib/latent/types";
import {
  BarChart3,
  Trophy,
  TrendingUp,
  TrendingDown,
  Clock,
  Target,
  Download,
  Activity,
} from "lucide-react";
import { toast } from "sonner";

export function TrackRecord() {
  const [stats, setStats] = useState<TrackRecordStats | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

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
      "=== SUMMARY ===",
      `Total trades: ${stats.totalTrades}`,
      `Wins: ${stats.wins}`,
      `Losses: ${stats.losses}`,
      `Breakeven: ${stats.breakeven}`,
      `Open trades: ${stats.openTrades}`,
      `Win rate: ${stats.winRate}%`,
      `Avg win: +${stats.avgWinPct}%`,
      `Avg loss: ${stats.avgLossPct}%`,
      `Avg time to profit: ${stats.avgTimeToProfitDays} days`,
      `Avg time to loss: ${stats.avgTimeToLossDays} days`,
      `Profit factor: ${stats.profitFactor}`,
      `Best trade: +${stats.bestTradePct}%`,
      `Worst trade: ${stats.worstTradePct}%`,
      "",
      "=== BY HORIZON ===",
      ...stats.byHorizon.map(
        (h) => `${h.horizon}: ${h.wins}/${h.total} (${h.winRate}%)`
      ),
      "",
      "=== RECENT TRADES ===",
      ...trades.map((t) =>
        `${t.symbol} | ${t.horizon} | ${t.status} | PnL: ${t.pnlPct ?? 0}% | Entry: ${t.entryPrice} | Exit: ${t.exitPrice ?? "—"} | Days: ${t.timeToCloseDays ?? "—"}`
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `latent-track-record-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Track record downloaded.");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0E1A]">
        <AppNav />
        <div className="max-w-5xl mx-auto p-6 space-y-4">
          <Skeleton className="h-10 w-48 bg-white/[0.04]" />
          <Skeleton className="h-32 w-full bg-white/[0.04]" />
          <Skeleton className="h-64 w-full bg-white/[0.04]" />
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="min-h-screen bg-[#0A0E1A]">
      <AppNav />
      <main className="max-w-5xl mx-auto px-4 md:px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#F4F7FB]">Track record</h1>
            <p className="text-sm text-[#94A3B8] mt-1">
              Every tracked signal, every win, every loss. Downloadable accuracy report.
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

        {/* Headline stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card className="bg-gradient-to-br from-[#00E676]/[0.07] to-[#131829] border-[#00E676]/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Win rate</span>
                <Trophy className="h-3 w-3 text-[#00E676]" />
              </div>
              <div className="text-3xl font-bold text-[#00E676] font-mono">{stats.winRate}%</div>
              <div className="text-[10px] text-[#94A3B8] mt-1">
                {stats.wins}W / {stats.losses}L / {stats.breakeven}BE · {stats.openTrades} open
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
              <div className="text-[10px] text-[#94A3B8] mt-1">in {stats.avgTimeToProfitDays} days avg</div>
            </CardContent>
          </Card>
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Avg loss</span>
                <TrendingDown className="h-3 w-3 text-[#FF5C5C]" />
              </div>
              <div className="text-2xl font-bold text-[#FF5C5C] font-mono">{stats.avgLossPct}%</div>
              <div className="text-[10px] text-[#94A3B8] mt-1">in {stats.avgTimeToLossDays} days avg</div>
            </CardContent>
          </Card>
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Profit factor</span>
                <Activity className="h-3 w-3 text-[#00E676]" />
              </div>
              <div className="text-2xl font-bold text-[#F4F7FB] font-mono">{stats.profitFactor}</div>
              <div className="text-[10px] text-[#94A3B8] mt-1">gross profit / gross loss</div>
            </CardContent>
          </Card>
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          {/* By horizon */}
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-[#00E676]" />
                <CardTitle className="text-base text-[#F4F7FB]">By horizon</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-3">
                {stats.byHorizon.map((h) => (
                  <div key={h.horizon}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-[#F4F7FB]">{h.horizon}</span>
                      <span className="text-xs font-mono text-[#94A3B8]">
                        {h.wins}/{h.total} ({h.winRate}%)
                      </span>
                    </div>
                    <div className="h-2 bg-white/[0.04] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#00E676]"
                        style={{ width: `${h.winRate}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Best/worst */}
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-[#00E676]" />
                <CardTitle className="text-base text-[#F4F7FB]">Best &amp; worst</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-3">
                <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3">
                  <div className="text-[10px] uppercase text-[#64748B] mb-1">Best single trade</div>
                  <div className="text-2xl font-bold text-[#00E676] font-mono">+{stats.bestTradePct}%</div>
                </div>
                <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3">
                  <div className="text-[10px] uppercase text-[#64748B] mb-1">Worst single trade</div>
                  <div className="text-2xl font-bold text-[#FF5C5C] font-mono">{stats.worstTradePct}%</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Time stats */}
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-[#00E676]" />
                <CardTitle className="text-base text-[#F4F7FB]">Time-to-close</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-3">
                <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3">
                  <div className="text-[10px] uppercase text-[#64748B] mb-1">Avg time to profit</div>
                  <div className="text-2xl font-bold text-[#00E676] font-mono">{stats.avgTimeToProfitDays} days</div>
                </div>
                <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3">
                  <div className="text-[10px] uppercase text-[#64748B] mb-1">Avg time to loss</div>
                  <div className="text-2xl font-bold text-[#FF5C5C] font-mono">{stats.avgTimeToLossDays} days</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent trades table */}
        <Card className="bg-[#131829] border-white/[0.08] mt-4">
          <CardHeader>
            <CardTitle className="text-base text-[#F4F7FB]">Recent trades</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-[#64748B] border-b border-white/[0.06]">
                    <th className="text-left py-2 px-2 font-semibold">Symbol</th>
                    <th className="text-left py-2 px-2 font-semibold">Horizon</th>
                    <th className="text-right py-2 px-2 font-semibold">Entry</th>
                    <th className="text-right py-2 px-2 font-semibold">Exit</th>
                    <th className="text-right py-2 px-2 font-semibold">PnL %</th>
                    <th className="text-right py-2 px-2 font-semibold">Days</th>
                    <th className="text-right py-2 px-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.slice(0, 15).map((t) => {
                    const isOpen = t.status === "OPEN";
                    const isWin = t.status === "CLOSED_WIN";
                    const isLoss = t.status === "CLOSED_LOSS";
                    return (
                      <tr key={t.id} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                        <td className="py-2.5 px-2 font-mono font-semibold text-[#F4F7FB]">{t.symbol}</td>
                        <td className="py-2.5 px-2">
                          <Badge variant="outline" className="text-[9px] py-0 h-4 border-[#00E676]/40 text-[#00E676]">
                            {t.horizon}
                          </Badge>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-[#94A3B8]">{t.entryPrice}</td>
                        <td className="py-2.5 px-2 text-right font-mono text-[#94A3B8]">
                          {t.exitPrice ?? "—"}
                        </td>
                        <td
                          className={`py-2.5 px-2 text-right font-mono font-semibold ${
                            isOpen ? "text-[#94A3B8]" : isWin ? "text-[#00E676]" : isLoss ? "text-[#FF5C5C]" : "text-[#94A3B8]"
                          }`}
                        >
                          {t.pnlPct != null ? `${t.pnlPct > 0 ? "+" : ""}${t.pnlPct}%` : "—"}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-[#64748B]">
                          {t.timeToCloseDays ?? "open"}
                        </td>
                        <td className="py-2.5 px-2 text-right">
                          <Badge
                            variant="outline"
                            className={`text-[9px] py-0 h-4 ${
                              isOpen ? "border-amber-500/40 text-amber-400" :
                              isWin ? "border-[#00E676]/40 text-[#00E676]" :
                              isLoss ? "border-[#FF5C5C]/40 text-[#FF5C5C]" :
                              "border-white/[0.12] text-[#94A3B8]"
                            }`}
                          >
                            {t.status.replace("CLOSED_", "").replace("_", " ")}
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

        {/* Disclaimer */}
        <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3 text-[11px] text-[#64748B] leading-relaxed mt-4">
          <span className="text-[#94A3B8] font-semibold">Track record disclosure:</span> Past
          performance does not guarantee future returns. Latent.pk&apos;s signal algorithm is
          continuously improved; current track record reflects the current model&apos;s outputs
          and may differ from future performance. Trading on PSX carries risk of capital loss.
        </div>
      </main>
    </div>
  );
}
