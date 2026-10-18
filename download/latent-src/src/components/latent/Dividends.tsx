"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppNav } from "./AppNav";
import { useLatentStore } from "@/lib/latent/store";
import { MOCK_STOCKS } from "@/lib/latent/mock-stocks";
import { Coins, ArrowRight, Bell } from "lucide-react";
import { toast } from "sonner";

// Synthetic dividend announcements based on mock stocks
const DIVIDENDS = [
  { symbol: "HUBC", company: "Hub Power Company", amount: 7, type: "Interim", yield: 5.6, exDate: "2026-01-15", status: "upcoming" },
  { symbol: "OGDC", company: "Oil & Gas Development", amount: 4.5, type: "Interim", yield: 3.2, exDate: "2026-01-20", status: "upcoming" },
  { symbol: "PPL", company: "Pakistan Petroleum", amount: 3.5, type: "Interim", yield: 3.0, exDate: "2026-01-22", status: "upcoming" },
  { symbol: "ENGRO", company: "Engro Corporation", amount: 12, type: "Final", yield: 4.2, exDate: "2026-01-25", status: "upcoming" },
  { symbol: "LUCK", company: "Lucky Cement", amount: 25, type: "Final", yield: 2.8, exDate: "2026-02-01", status: "upcoming" },
  { symbol: "MEBL", company: "Meezan Bank", amount: 6, type: "Interim", yield: 2.2, exDate: "2026-02-05", status: "upcoming" },
  { symbol: "PSO", company: "Pakistan State Oil", amount: 5, type: "Interim", yield: 2.5, exDate: "2026-02-08", status: "upcoming" },
  { symbol: "SYS", company: "Systems Limited", amount: 5, type: "Final", yield: 1.2, exDate: "2026-02-10", status: "upcoming" },
].sort((a, b) => b.yield - a.yield);

export function Dividends() {
  const setView = useLatentStore((s) => s.setView);
  const pushNotification = useLatentStore((s) => s.pushNotification);
  const addPosition = useLatentStore((s) => s.addPortfolioPosition);

  const handleAddToPortfolio = (d: typeof DIVIDENDS[0]) => {
    addPosition({
      symbol: d.symbol,
      name: d.company,
      buyPrice: null,
      shares: 0,
    });
    pushNotification({
      type: "info",
      title: "Added to watchlist",
      body: `${d.symbol} added to portfolio for dividend tracking`,
      linkView: "portfolio",
    });
    toast.success(`${d.symbol} added to watchlist`);
  };

  const handleSetAlert = (d: typeof DIVIDENDS[0]) => {
    pushNotification({
      type: "info",
      title: `Alert set: ${d.symbol} ex-date`,
      body: `We'll notify you before ${d.exDate} so you can position for the dividend.`,
    });
    toast.success(`Alert set for ${d.symbol} ex-dividend date`);
  };

  return (
    <div className="min-h-screen bg-[#0A0E1A]">
      <AppNav />
      <main className="px-4 md:px-6 py-6 max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[#F4F7FB]">Dividends</h1>
          <p className="text-sm text-[#94A3B8] mt-1">
            Top-to-bottom dividend announcements by PSX-listed companies — sorted by yield.
          </p>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardContent className="p-4">
              <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Upcoming dividends</div>
              <div className="text-2xl font-bold text-[#F4F7FB] font-mono">{DIVIDENDS.length}</div>
            </CardContent>
          </Card>
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardContent className="p-4">
              <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Highest yield</div>
              <div className="text-2xl font-bold text-[#00E676] font-mono">{DIVIDENDS[0]?.yield.toFixed(1)}%</div>
              <div className="text-[10px] text-[#94A3B8]">{DIVIDENDS[0]?.symbol}</div>
            </CardContent>
          </Card>
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardContent className="p-4">
              <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Avg yield</div>
              <div className="text-2xl font-bold text-[#F4F7FB] font-mono">
                {(DIVIDENDS.reduce((s, d) => s + d.yield, 0) / DIVIDENDS.length).toFixed(1)}%
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardContent className="p-4">
              <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Total payout (PKR)</div>
              <div className="text-2xl font-bold text-[#F4F7FB] font-mono">
                {DIVIDENDS.reduce((s, d) => s + d.amount, 0)}
              </div>
              <div className="text-[10px] text-[#94A3B8]">per share (declared)</div>
            </CardContent>
          </Card>
        </div>

        {/* Dividend list */}
        <div className="space-y-2">
          {DIVIDENDS.map((d) => {
            const stock = MOCK_STOCKS.find((s) => s.symbol === d.symbol);
            return (
              <Card key={d.symbol} className="bg-[#131829] border-white/[0.08] hover:border-[#00E676]/30 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    {/* Symbol */}
                    <div className="h-12 w-12 rounded-lg bg-[#00E676]/10 flex items-center justify-center font-mono font-bold text-[#00E676]">
                      {d.symbol.slice(0, 4)}
                    </div>

                    {/* Main */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-[#F4F7FB]">{d.symbol}</span>
                        <Badge variant="outline" className="text-[9px] py-0 h-4 border-[#00E676]/40 text-[#00E676] uppercase">
                          {d.type}
                        </Badge>
                        <Badge variant="outline" className="text-[9px] py-0 h-4 border-amber-400/40 text-amber-400 uppercase">
                          Ex-date: {new Date(d.exDate).toLocaleDateString("en-PK", { month: "short", day: "numeric" })}
                        </Badge>
                      </div>
                      <div className="text-xs text-[#94A3B8] mt-0.5 truncate">{d.company}</div>
                    </div>

                    {/* Amount */}
                    <div className="text-right shrink-0">
                      <div className="text-sm font-mono font-bold text-[#F4F7FB]">PKR {d.amount}</div>
                      <div className="text-[10px] text-[#64748B]">per share</div>
                    </div>

                    {/* Yield */}
                    <div className="text-right shrink-0">
                      <div className="text-sm font-mono font-bold text-[#00E676]">{d.yield.toFixed(1)}%</div>
                      <div className="text-[10px] text-[#64748B]">yield</div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleSetAlert(d)}
                        className="text-[#94A3B8] hover:text-[#F4F7FB] h-8 w-8 p-0"
                        title="Set ex-date alert"
                      >
                        <Bell className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleAddToPortfolio(d)}
                        className="text-[#94A3B8] hover:text-[#F4F7FB] h-8 text-xs"
                      >
                        + Watch
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setView("signals_v2")}
                        className="border-[#00E676]/40 text-[#00E676] hover:bg-[#00E676]/10 h-8 text-xs"
                      >
                        Signal
                        <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3 text-[11px] text-[#64748B] leading-relaxed mt-6">
          <span className="text-[#94A3B8] font-semibold">Dividends note:</span> Data shown is
          synthetic in this MVP. Real dividend announcements will be pulled from the
          askanalyst.com.pk /financialstatement/ endpoint + investify.pk/announcements scraper
          (filtered by type=&quot;dividend&quot;). Set alerts to be notified before ex-date — buy
          before ex-date to qualify for the dividend.
        </div>
      </main>
    </div>
  );
}
