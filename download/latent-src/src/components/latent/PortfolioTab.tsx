"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AppNav } from "./AppNav";
import { useLatentStore } from "@/lib/latent/store";
import { MOCK_STOCKS } from "@/lib/latent/mock-stocks";
import {
  Plus,
  X,
  ArrowUp,
  ArrowDown,
  TrendingUp,
  TrendingDown,
  Loader2,
  RefreshCw,
  Briefcase,
  Minus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

export function PortfolioTab() {
  const portfolio = useLatentStore((s) => s.portfolio);
  const addPosition = useLatentStore((s) => s.addPortfolioPosition);
  const removePosition = useLatentStore((s) => s.removePortfolioPosition);
  const reorder = useLatentStore((s) => s.reorderPortfolio);
  const setView = useLatentStore((s) => s.setView);
  const pushNotification = useLatentStore((s) => s.pushNotification);

  const [addOpen, setAddOpen] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [buyPrice, setBuyPrice] = useState<string>("");
  const [shares, setShares] = useState<string>("");

  const handleAdd = () => {
    if (!selectedSymbol) {
      toast.error("Pick a stock first");
      return;
    }
    const stock = MOCK_STOCKS.find((s) => s.symbol === selectedSymbol);
    if (!stock) return;
    addPosition({
      symbol: stock.symbol,
      name: stock.name,
      buyPrice: buyPrice ? parseFloat(buyPrice) : null,
      shares: shares ? parseInt(shares) : 0,
    });
    pushNotification({
      type: "info",
      title: "Stock added to portfolio",
      body: `${stock.symbol} added${buyPrice ? ` @ PKR ${buyPrice}` : " (watch only)"}`,
      linkView: "portfolio",
    });
    toast.success(`${stock.symbol} added to portfolio`);
    setAddOpen(false);
    setSelectedSymbol("");
    setBuyPrice("");
    setShares("");
  };

  const sorted = [...portfolio].sort((a, b) => a.order - b.order);

  const totalValue = sorted.reduce((sum, p) => {
    if (!p.buyPrice || !p.shares) return sum;
    const stock = MOCK_STOCKS.find((s) => s.symbol === p.symbol);
    if (!stock) return sum;
    return sum + p.shares * stock.price;
  }, 0);

  const totalCost = sorted.reduce((sum, p) => {
    if (!p.buyPrice || !p.shares) return sum;
    return sum + p.shares * p.buyPrice;
  }, 0);

  const totalPnL = totalValue - totalCost;
  const totalPnLPct = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    reorder(idx, idx - 1);
  };
  const moveDown = (idx: number) => {
    if (idx === sorted.length - 1) return;
    reorder(idx, idx + 1);
  };

  return (
    <div className="min-h-screen bg-[#0A0E1A]">
      <AppNav />
      <main className="px-4 md:px-6 py-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#F4F7FB]">Portfolio & Watchlist</h1>
            <p className="text-sm text-[#94A3B8] mt-1">
              Add stocks, drag-to-reorder, optional buy price triggers P&L tracking + suggestions.
            </p>
          </div>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold">
                <Plus className="h-4 w-4 mr-1.5" />
                Add stock
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#131829] border-white/[0.12]">
              <DialogHeader>
                <DialogTitle className="text-[#F4F7FB]">Add to portfolio</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label className="text-[#94A3B8]">Select stock</Label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 max-h-48 overflow-y-auto">
                    {MOCK_STOCKS.map((s) => (
                      <button
                        key={s.symbol}
                        onClick={() => {
                          setSelectedSymbol(s.symbol);
                          setBuyPrice(String(s.price));
                        }}
                        className={`p-2 rounded-md text-xs font-mono font-semibold border transition-colors ${
                          selectedSymbol === s.symbol
                            ? "border-[#00E676] bg-[#00E676]/10 text-[#00E676]"
                            : "border-white/[0.06] bg-[#0A0E1A] text-[#94A3B8] hover:border-white/[0.15]"
                        }`}
                      >
                        {s.symbol}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-[#94A3B8]">Buy price (optional)</Label>
                    <Input
                      value={buyPrice}
                      onChange={(e) => setBuyPrice(e.target.value)}
                      placeholder="e.g. 285"
                      type="number"
                      className="bg-[#0A0E1A] border-white/[0.12] text-[#F4F7FB] font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[#94A3B8]">Shares (optional)</Label>
                    <Input
                      value={shares}
                      onChange={(e) => setShares(e.target.value)}
                      placeholder="e.g. 100"
                      type="number"
                      className="bg-[#0A0E1A] border-white/[0.12] text-[#F4F7FB] font-mono"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-[#64748B]">
                  Leaving buy price empty adds the stock as a watch-only item (no P&L tracking).
                </p>
                <Button
                  onClick={handleAdd}
                  disabled={!selectedSymbol}
                  className="w-full bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold"
                >
                  Add to portfolio
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Portfolio summary */}
        {sorted.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <Card className="bg-[#131829] border-white/[0.08]">
              <CardContent className="p-4">
                <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Holdings</div>
                <div className="text-xl font-bold text-[#F4F7FB] font-mono">{sorted.length}</div>
              </CardContent>
            </Card>
            <Card className="bg-[#131829] border-white/[0.08]">
              <CardContent className="p-4">
                <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Cost basis</div>
                <div className="text-xl font-bold text-[#F4F7FB] font-mono">PKR {totalCost.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card className="bg-[#131829] border-white/[0.08]">
              <CardContent className="p-4">
                <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Market value</div>
                <div className="text-xl font-bold text-[#F4F7FB] font-mono">PKR {totalValue.toLocaleString()}</div>
              </CardContent>
            </Card>
            <Card className={`bg-[#131829] ${totalPnL >= 0 ? "border-[#00E676]/30" : "border-[#FF5C5C]/30"}`}>
              <CardContent className="p-4">
                <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Total P&L</div>
                <div className={`text-xl font-bold font-mono ${totalPnL >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}`}>
                  {totalPnL >= 0 ? "+" : ""}{totalPnL.toLocaleString()} ({totalPnLPct.toFixed(2)}%)
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Portfolio list */}
        {sorted.length === 0 ? (
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardContent className="p-12 text-center">
              <Briefcase className="h-12 w-12 text-[#00E676]/30 mx-auto mb-3" />
              <h3 className="font-semibold text-[#F4F7FB] mb-1">No stocks in your portfolio yet</h3>
              <p className="text-xs text-[#94A3B8] mb-4">
                Add stocks to track them. Optionally add your buy price to enable P&L tracking and hold/sell/buy-more suggestions.
              </p>
              <Button
                onClick={() => setAddOpen(true)}
                className="bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881]"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Add your first stock
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {sorted.map((p, idx) => {
              const stock = MOCK_STOCKS.find((s) => s.symbol === p.symbol);
              if (!stock) return null;
              const currentPrice = stock.price;
              const hasBuyPrice = p.buyPrice !== null && p.shares > 0;
              const pnl = hasBuyPrice ? (currentPrice - (p.buyPrice as number)) * p.shares : 0;
              const pnlPct = hasBuyPrice && p.buyPrice ? ((currentPrice - p.buyPrice) / p.buyPrice) * 100 : 0;
              const isProfit = pnl > 0;
              const isLoss = pnl < 0;

              const suggestion = !hasBuyPrice ? null :
                isProfit && pnlPct > 15 ? "Take partial profit — book 30-50% of position" :
                isProfit ? "Hold — trend still intact" :
                isLoss && pnlPct < -10 ? "Consider averaging down on next dip — improve cost basis" :
                isLoss ? "Hold — within normal volatility. Stop-loss not hit." :
                "Hold — at breakeven";

              return (
                <Card
                  key={p.symbol}
                  className={`bg-[#131829] border-white/[0.08] ${hasBuyPrice && isProfit ? "border-l-[#00E676]/60" : hasBuyPrice && isLoss ? "border-l-[#FF5C5C]/60" : ""}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      {/* Reorder controls */}
                      <div className="flex flex-col gap-0.5">
                        <button
                          onClick={() => moveUp(idx)}
                          disabled={idx === 0}
                          className={`text-[#64748B] hover:text-[#F4F7FB] ${idx === 0 ? "opacity-30 cursor-not-allowed" : ""}`}
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => moveDown(idx)}
                          disabled={idx === sorted.length - 1}
                          className={`text-[#64748B] hover:text-[#F4F7FB] ${idx === sorted.length - 1 ? "opacity-30 cursor-not-allowed" : ""}`}
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Symbol */}
                      <div className="h-10 w-10 rounded-lg bg-[#00E676]/10 flex items-center justify-center font-mono font-bold text-[#00E676] text-sm">
                        {p.symbol.slice(0, 4)}
                      </div>

                      {/* Main */}
                      <button
                        onClick={() => {
                          setView("signals_v2");
                          toast.info(`Opening analysis for ${p.symbol}...`);
                        }}
                        className="flex-1 text-left hover:opacity-80"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#F4F7FB]">{p.symbol}</span>
                          {hasBuyPrice && (
                            <Badge variant="outline" className={`text-[9px] py-0 h-4 ${isProfit ? "border-[#00E676]/40 text-[#00E676]" : isLoss ? "border-[#FF5C5C]/40 text-[#FF5C5C]" : "border-white/[0.12] text-[#94A3B8]"}`}>
                              {isProfit ? "PROFIT" : isLoss ? "LOSS" : "BREAK EVEN"}
                            </Badge>
                          )}
                          {!hasBuyPrice && (
                            <Badge variant="outline" className="text-[9px] py-0 h-4 border-white/[0.12] text-[#64748B]">
                              WATCHING
                            </Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-[#94A3B8] truncate max-w-[300px]">{p.name}</div>
                        {hasBuyPrice && (
                          <div className="text-[10px] text-[#64748B] mt-0.5 font-mono">
                            Buy: {p.buyPrice} × {p.shares} = PKR {((p.buyPrice as number) * p.shares).toLocaleString()}
                          </div>
                        )}
                      </button>

                      {/* Price + P&L */}
                      <div className="text-right shrink-0">
                        <div className="text-sm font-mono font-bold text-[#F4F7FB]">{currentPrice}</div>
                        <div className="text-[10px] text-[#64748B]">current</div>
                        {hasBuyPrice && (
                          <div className={`text-xs font-mono font-bold ${isProfit ? "text-[#00E676]" : isLoss ? "text-[#FF5C5C]" : "text-[#94A3B8]"}`}>
                            {pnl >= 0 ? "+" : ""}{pnl.toLocaleString()} ({pnlPct.toFixed(1)}%)
                          </div>
                        )}
                      </div>

                      {/* Remove */}
                      <button
                        onClick={() => {
                          removePosition(p.symbol);
                          toast.info(`${p.symbol} removed from portfolio`);
                        }}
                        className="text-[#64748B] hover:text-[#FF5C5C] shrink-0 ml-2"
                        title="Remove from portfolio"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Suggestion */}
                    {suggestion && (
                      <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-start gap-2">
                        {isProfit ? <TrendingUp className="h-3 w-3 text-[#00E676] mt-0.5" /> :
                         isLoss ? <TrendingDown className="h-3 w-3 text-[#FF5C5C] mt-0.5" /> :
                         <Minus className="h-3 w-3 text-[#94A3B8] mt-0.5" />}
                        <div>
                          <span className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold">
                            Suggestion:
                          </span>
                          <span className="text-xs text-[#94A3B8] ml-1.5">{suggestion}</span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3 text-[11px] text-[#64748B] leading-relaxed mt-6">
          <span className="text-[#94A3B8] font-semibold">Tip:</span> Click any stock in your portfolio to open its full analysis (fundamentals + technicals + AI model call). Drag the up/down arrows to reorder your list. Buy price is optional — leave empty for watch-only stocks.
        </div>

        {/* Auto-News Digest — fetched from AskAnalyst + interpreted by GLM-4 */}
        <PortfolioNewsDigest
          symbols={
            portfolio.length > 0
              ? portfolio.map((p) => p.symbol)
              : MOCK_STOCKS.slice(0, 4).map((s) => s.symbol)
          }
        />
      </main>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Per-Stock News Digest panel (auto-fetched + LLM-interpreted news for portfolio)
// ────────────────────────────────────────────────────────────────────────────

interface InterpretedNewsItem {
  title?: string;
  link?: string;
  source?: string;
  publishedAt?: string;
  summary?: string;
  symbol: string;
  impact: "positive" | "negative" | "neutral";
  impactStrength: "weak" | "moderate" | "strong";
  laymanExplanation: string;
  shortTermOutlook: string;
  affectedStocks: string[];
}

interface NewsDigestEntry {
  symbol: string;
  stockName: string;
  newsCount: number;
  interpretedItems: InterpretedNewsItem[];
}

function PortfolioNewsDigest({ symbols }: { symbols: string[] }) {
  const [digest, setDigest] = useState<NewsDigestEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setView = useLatentStore((s) => s.setView);
  const pushNotification = useLatentStore((s) => s.pushNotification);

  const loadDigest = async () => {
    if (symbols.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/portfolio/news-digest?symbols=${symbols.join(",")}&limit=2`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || err.error || `Failed (${res.status})`);
      }
      const data = await res.json();
      setDigest(data.digest || []);
      const total = data.totalInterpreted || 0;
      if (total > 0) {
        pushNotification({
          type: "news",
          title: `${total} news items interpreted`,
          body: `Auto-analyzed news for ${symbols.length} portfolio stock${symbols.length === 1 ? "" : "s"}`,
          linkView: "portfolio",
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load news digest");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDigest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(",")]);

  const impactColor = (i: string) =>
    i === "positive" ? "text-[#00E676]" : i === "negative" ? "text-[#FF5C5C]" : "text-[#94A3B8]";

  return (
    <Card className="bg-[#131829] border-white/[0.08] mt-4">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-[#F4F7FB] flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[#00E676]" />
              Auto-News Digest for Your Portfolio
            </h3>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              For each stock below: news fetched from AskAnalyst + GLM-4 interprets impact in layman terms.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadDigest}
            disabled={loading}
            className="border-white/[0.12] text-[#94A3B8] h-7"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3 mr-1.5" />
            )}
            Refresh
          </Button>
        </div>

        {loading && digest.length === 0 && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full bg-white/[0.04]" />)}
          </div>
        )}

        {error && (
          <div className="rounded-md bg-[#FF5C5C]/[0.07] border border-[#FF5C5C]/20 p-3 text-xs text-[#FF5C5C]">
            <span className="font-semibold">Error:</span> {error}
          </div>
        )}

        {!loading && !error && digest.length > 0 && (
          <div className="space-y-4">
            {digest.map((entry) => (
              <div key={entry.symbol} className="border-l-2 border-[#00E676]/30 pl-3">
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-7 w-7 rounded-md bg-[#00E676]/10 flex items-center justify-center font-mono font-bold text-[#00E676] text-[10px]">
                    {entry.symbol.slice(0, 4)}
                  </div>
                  <span className="font-semibold text-[#F4F7FB] text-sm">{entry.symbol}</span>
                  <span className="text-[11px] text-[#94A3B8] truncate flex-1">{entry.stockName}</span>
                  <Badge variant="outline" className="text-[9px] py-0 h-4 border-white/[0.12] text-[#64748B]">
                    {entry.newsCount} news
                  </Badge>
                </div>

                {entry.interpretedItems.length === 0 ? (
                  <p className="text-xs text-[#64748B] italic ml-9">
                    No recent news from AskAnalyst for {entry.symbol}.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {entry.interpretedItems.map((item, i) => (
                      <div key={i} className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-3">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="text-xs font-semibold text-[#F4F7FB] line-clamp-2 flex-1">
                            {item.title || "(no headline)"}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`text-[10px] uppercase font-bold ${impactColor(item.impact)}`}>
                              {item.impact}
                            </span>
                            <Badge variant="outline" className={`text-[9px] py-0 h-4 ${
                              item.impactStrength === "strong" ? "border-[#FF5C5C]/40 text-[#FF5C5C]" :
                              item.impactStrength === "moderate" ? "border-amber-400/40 text-amber-400" :
                              "border-white/[0.12] text-[#94A3B8]"
                            }`}>
                              {item.impactStrength}
                            </Badge>
                          </div>
                        </div>
                        <p className="text-[11px] text-[#94A3B8] leading-relaxed mb-1.5">
                          {item.laymanExplanation}
                        </p>
                        {item.shortTermOutlook && (
                          <p className="text-[11px] text-[#64748B] italic">
                            Outlook: {item.shortTermOutlook}
                          </p>
                        )}
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/[0.04]">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] text-[#64748B] uppercase">Affected:</span>
                            {item.affectedStocks.slice(0, 3).map((s) => (
                              <button
                                key={s}
                                onClick={() => setView("signals_v2")}
                                className="text-[10px] font-mono text-[#00E676] hover:underline"
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                          {item.link && (
                            <a
                              href={item.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-[#64748B] hover:text-[#F4F7FB]"
                            >
                              Source ↗
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-2.5 mt-3 text-[10px] text-[#64748B]">
          <span className="text-[#94A3B8] font-semibold">Manual URL paste:</span> For
          ultra-fast news from any source, paste the URL in the Fundamental News tab — that
          feature stays as an extra layer on top of this auto-digest.
        </div>
      </CardContent>
    </Card>
  );
}
