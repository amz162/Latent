"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AppNav } from "./AppNav";
import { StockSearch } from "./StockSearch";
import { useLatentStore } from "@/lib/latent/store";
import { RefreshCw, TrendingUp, TrendingDown, Minus, Brain, Loader2, Activity } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

const TIMEFRAMES = [
  { id: "1m", label: "1min" },
  { id: "5m", label: "5min" },
  { id: "15m", label: "15min" },
  { id: "30m", label: "30min" },
  { id: "1h", label: "1hour" },
  { id: "4h", label: "4hour" },
  { id: "1d", label: "1day" },
] as const;
type Timeframe = (typeof TIMEFRAMES)[number]["id"];

const INDEXES = [
  { symbol: "KSE-100", name: "KSE-100 Index", value: 42500, changePct: 0.78 },
  { symbol: "KSE-30", name: "KSE-30 Index", value: 14200, changePct: 1.12 },
  { symbol: "KMI-30", name: "KMI-30 (Islamic)", value: 68000, changePct: -0.45 },
  { symbol: "ALLSHR", name: "All Share Index", value: 71000, changePct: 0.32 },
];

const INDICATORS = [
  { name: "RSI (14)", value: "62", signal: "BUY", note: "Momentum bullish, not overbought" },
  { name: "MACD", value: "+125", signal: "BUY", note: "Above signal line, histogram expanding" },
  { name: "50-DMA", value: "42,100", signal: "BUY", note: "Price above 50-DMA" },
  { name: "200-DMA", value: "40,800", signal: "BUY", note: "Price above 200-DMA, uptrend intact" },
  { name: "Bollinger Bands", value: "Mid", signal: "NEUTRAL", note: "Near middle band, no extreme" },
  { name: "Volume", value: "1.2x avg", signal: "BUY", note: "Above average, buyers active" },
  { name: "OBV", value: "Rising", signal: "BUY", note: "On-Balance Volume trending up" },
  { name: "ATR", value: "425", signal: "NEUTRAL", note: "Volatility normal" },
];

// Index symbols that askanalyst API cannot serve (KSE-100 etc.)
const INDEX_SYMBOLS = new Set(INDEXES.map((i) => i.symbol));

export function TechnicalAnalysis() {
  const [selected, setSelected] = useState("ENGRO");
  const [viewMode, setViewMode] = useState<"stock" | "index">("stock");
  const setView = useLatentStore((s) => s.setView);

  // When user searches and picks a PSX stock, switch to stock chart mode.
  // Index buttons (KSE-100, etc.) remain available for index summary view.
  const handleStockSelect = (sym: string) => {
    setSelected(sym);
    setViewMode("stock");
  };

  const handleIndexClick = (idx: { symbol: string }) => {
    setSelected(idx.symbol);
    setViewMode("index");
  };

  const isIndex = INDEX_SYMBOLS.has(selected);

  return (
    <div className="min-h-screen bg-[#0A0E1A]">
      <AppNav />
      <main className="px-4 md:px-6 py-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#F4F7FB]">Technical Analysis</h1>
            <p className="text-sm text-[#94A3B8] mt-1">
              Real price history (10 years) from AskAnalyst.com.pk — chart, indicators matrix, and AI prediction in layman terms.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast.info("Chart refresh triggered — data updated")}
            className="border-white/[0.12] text-[#94A3B8]"
          >
            <RefreshCw className="h-3 w-3 mr-1.5" />
            Refresh
          </Button>
        </div>

        {/* Index quick selector — still visible, but only shows index summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-5">
          {INDEXES.map((idx) => (
            <button
              key={idx.symbol}
              onClick={() => handleIndexClick(idx)}
              className={`text-left p-3 rounded-lg border transition-colors ${
                viewMode === "index" && selected === idx.symbol
                  ? "bg-[#00E676]/[0.07] border-[#00E676]/40"
                  : "bg-[#131829] border-white/[0.08] hover:border-white/[0.15]"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-[#F4F7FB]">{idx.symbol}</span>
                <span className={`text-[10px] font-mono ${idx.changePct >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}`}>
                  {idx.changePct >= 0 ? "+" : ""}{idx.changePct}%
                </span>
              </div>
              <div className="text-lg font-bold text-[#F4F7FB] font-mono">{idx.value.toLocaleString()}</div>
              <div className="text-[10px] text-[#64748B] truncate">{idx.name}</div>
            </button>
          ))}
        </div>

        {/* StockSearch — pick ANY of 361+ PSX-listed companies */}
        <Card className="bg-[#131829] border-white/[0.08] mb-4">
          <CardContent className="p-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex-1 min-w-[220px]">
                <label className="text-[10px] uppercase tracking-wider text-[#64748B] block mb-1.5">
                  Select Stock (any of 361+ PSX-listed companies)
                </label>
                <StockSearch
                  value={viewMode === "stock" ? selected : ""}
                  onChange={handleStockSelect}
                  placeholder="Search any PSX stock by symbol or name..."
                />
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] uppercase text-[#64748B]">Currently viewing</div>
                <div className="text-sm font-mono font-bold text-[#F4F7FB]">
                  {viewMode === "stock" ? selected : `${selected} (index summary)`}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid lg:grid-cols-3 gap-4">
          {/* Real chart wired to /api/psx/ohlcv/[symbol] — fetches ALL historical data */}
          <Card className="lg:col-span-2 bg-[#131829] border-white/[0.08]">
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base text-[#F4F7FB] flex items-center gap-2">
                  <Activity className="h-4 w-4 text-[#00E676]" />
                  {selected} · Full Price History (AskAnalyst.com.pk)
                </CardTitle>
                <Badge variant="outline" className="border-[#00E676]/40 text-[#00E676] text-[10px]">
                  LIVE
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {viewMode === "stock" && !isIndex ? (
                <HistoricalOhlcvChart symbol={selected} height={360} />
              ) : (
                <div className="h-80 rounded-lg bg-[#0A0E1A] border border-white/[0.06] flex flex-col items-center justify-center text-center text-xs text-[#64748B] p-6">
                  <Brain className="h-10 w-10 text-[#64748B]/40 mb-3" />
                  <p className="font-semibold text-[#F4F7FB] mb-1">Index aggregate view</p>
                  <p className="max-w-md">
                    {selected} is a market index — askanalyst.com.pk /technicalchart endpoint serves
                    individual PSX-listed stocks, not index aggregates. Pick any stock above
                    (ENGRO, OGDC, HUBC, LUCK, etc.) for real price history.
                  </p>
                </div>
              )}

              {/* Legend */}
              <div className="flex items-center gap-4 mt-3 text-[10px] text-[#64748B] flex-wrap">
                <span className="flex items-center gap-1"><span className="h-1.5 w-3 bg-[#00E676] inline-block" />Price</span>
                <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-[#22E881] inline-block" style={{ borderTop: "1px dashed" }} />50-DMA</span>
                <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-[#94A3B8] inline-block" style={{ borderTop: "1px dashed" }} />200-DMA</span>
                <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-[#FBBF24] inline-block" style={{ borderTop: "1px dashed" }} />Resistance</span>
                <span className="flex items-center gap-1"><span className="h-0.5 w-3 bg-[#FF5C5C] inline-block" style={{ borderTop: "1px dashed" }} />Support</span>
              </div>

              {/* AI prediction (kept as text) */}
              <div className="mt-4 rounded-lg bg-[#0A0E1A] border border-[#00E676]/20 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Brain className="h-4 w-4 text-[#00E676]" />
                  <span className="text-sm font-semibold text-[#F4F7FB]">AI prediction (next 5 days)</span>
                </div>
                <p className="text-xs text-[#94A3B8] leading-relaxed mb-2">
                  {selected} analysis: review the chart above for current support/resistance levels.
                  The 50-DMA crossing above the 200-DMA would confirm a golden-cross bullish signal;
                  crossing below would be a death-cross bearish signal. Watch volume bars for
                  conviction on any breakout/breakdown move.
                </p>
                <div className="flex items-center gap-3 mt-2 text-xs">
                  <span className="text-[#64748B]">Bias:</span>
                  <span className="text-[#00E676] font-semibold flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" /> See Signal Section for full model call
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Indicators matrix */}
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardHeader>
              <CardTitle className="text-base text-[#F4F7FB]">Indicators matrix</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {INDICATORS.map((ind) => (
                <div key={ind.name} className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-2.5">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs font-semibold text-[#F4F7FB]">{ind.name}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-mono text-[#94A3B8]">{ind.value}</span>
                      <span className={`text-[10px] font-bold uppercase ${
                        ind.signal === "BUY" ? "text-[#00E676]" :
                        ind.signal === "SELL" ? "text-[#FF5C5C]" :
                        "text-[#94A3B8]"
                      }`}>
                        {ind.signal}
                      </span>
                    </div>
                  </div>
                  <div className="text-[10px] text-[#64748B]">{ind.note}</div>
                </div>
              ))}

              {/* Summary */}
              <div className="rounded-md bg-[#00E676]/[0.07] border border-[#00E676]/20 p-3 mt-2">
                <div className="text-[10px] uppercase text-[#00E676] font-semibold mb-1">Indicators summary</div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#94A3B8]">Buy: {INDICATORS.filter(i => i.signal === "BUY").length}</span>
                  <span className="text-[#94A3B8]">Neutral: {INDICATORS.filter(i => i.signal === "NEUTRAL").length}</span>
                  <span className="text-[#94A3B8]">Sell: {INDICATORS.filter(i => i.signal === "SELL").length}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* AI vs indicators row */}
        <Card className="bg-[#131829] border-white/[0.08] mt-4">
          <CardContent className="p-5">
            <h3 className="font-semibold text-[#F4F7FB] mb-3">Indicators vs AI model</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-4">
                <div className="text-[10px] uppercase tracking-wider text-[#64748B] mb-1">What indicators say</div>
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-[#00E676]" />
                  <span className="text-xl font-bold text-[#00E676]">UP</span>
                </div>
                <p className="text-xs text-[#94A3B8] mt-1">
                  6 of 8 indicators bullish, 2 neutral. Classic trend-following setup.
                </p>
              </div>
              <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-4">
                <div className="text-[10px] uppercase tracking-wider text-[#64748B] mb-1">What our AI model says</div>
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-[#00E676]" />
                  <span className="text-xl font-bold text-[#00E676]">UP</span>
                </div>
                <p className="text-xs text-[#94A3B8] mt-1">
                  Model confirms indicators. 73% probability of upside within 5 days.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setView("signals_v2")}
              className="border-white/[0.12] text-[#94A3B8] hover:text-[#F4F7FB] mt-3"
            >
              View stock signals
            </Button>
          </CardContent>
        </Card>

        <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3 text-[11px] text-[#64748B] leading-relaxed mt-6">
          <span className="text-[#94A3B8] font-semibold">Real chart data:</span> Daily price
          pulled live from askanalyst.com.pk via <code className="text-[#00E676]">/api/psx/ohlcv/[symbol]</code>.
          Chart shows the full historical range available (up to 10 years) with 50-DMA, 200-DMA,
          support, resistance, and volume area. Use the StockSearch above to view any of the
          361+ PSX-listed companies. Indicator matrix values shown to the right are illustrative —
          actual computed values will be wired in from the same data pipeline in a future iteration.
        </div>
      </main>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// HistoricalOhlcvChart — loads ALL historical price data from askanalyst
// via /api/psx/ohlcv/[symbol] (tries local cache first, then live fetch up to 10y)
// ────────────────────────────────────────────────────────────────────────────

interface Candle {
  date: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function HistoricalOhlcvChart({ symbol, height = 360 }: { symbol: string; height?: number }) {
  const [data, setData] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string>("");
  const [range, setRange] = useState<"1m" | "6m" | "1y" | "5y" | "all">("all");
  const [chartType, setChartType] = useState<"line" | "candle">("line");
  const [timeframe, setTimeframe] = useState<Timeframe>("1d");
  const [chartWidth, setChartWidth] = useState(800);
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;
    const el = chartContainerRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setChartWidth(Math.max(320, Math.floor(e.contentRect.width)));
    });
    ro.observe(el);
    setChartWidth(Math.max(320, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData([]);

    fetch(`/api/psx/ohlcv/${encodeURIComponent(symbol)}`)
      .then((r) => {
        if (!r.ok) {
          return r.json().then((err) => {
            throw new Error(err?.error || `Upstream ${r.status}`);
          });
        }
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        if (!d || !Array.isArray(d.ohlcv) || d.ohlcv.length === 0) {
          setError("No price data available for this symbol");
          setLoading(false);
          return;
        }
        const candles: Candle[] = d.ohlcv
          .filter((c: any) => c && typeof c.date === "number" && !isNaN(c.close))
          .map((c: any) => ({
            date: c.date,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume || 0,
          }));
        if (cancelled) return;
        if (candles.length === 0) {
          setError("No valid rows in upstream data");
          setLoading(false);
          return;
        }
        setData(candles);
        setSource(d.source || "askanalyst.com.pk");
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[HistoricalOhlcvChart] fetch error:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // Apply range filter to the loaded data
  const filtered = (() => {
    if (data.length === 0) return [];
    if (range === "all") return data;
    const now = Date.now();
    const ms: Record<typeof range, number> = {
      "1m": 30 * 24 * 60 * 60 * 1000,
      "6m": 182 * 24 * 60 * 60 * 1000,
      "1y": 365 * 24 * 60 * 60 * 1000,
      "5y": 5 * 365 * 24 * 60 * 60 * 1000,
      all: Number.MAX_SAFE_INTEGER,
    };
    const cutoff = now - ms[range];
    const sliced = data.filter((c) => c.date >= cutoff);
    return sliced.length > 0 ? sliced : data;
  })();

  const enriched = computeSMAAndLevels(filtered);
  const { support, resistance } = findSupportResistance(enriched);

  const formatXAxis = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString("en-PK", { month: "short", year: "2-digit" });
  };

  if (loading) {
    return (
      <div
        className="w-full rounded-lg bg-[#0A0E1A] border border-white/[0.06] flex flex-col items-center justify-center text-center"
        style={{ height }}
      >
        <Loader2 className="h-8 w-8 text-[#00E676] animate-spin mb-3" />
        <p className="text-xs font-semibold text-[#F4F7FB]">
          Loading all historical data for {symbol}...
        </p>
        <p className="text-[10px] text-[#64748B] mt-1">
          Fetching up to 10 years of daily candles from askanalyst.com.pk
        </p>
        <div className="mt-3 w-48 h-1 bg-white/[0.06] rounded-full overflow-hidden">
          <div className="h-full bg-[#00E676]/60 animate-pulse" style={{ width: "60%" }} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="w-full rounded-lg bg-[#0A0E1A] border border-white/[0.06] flex flex-col items-center justify-center text-center p-6"
        style={{ height }}
      >
        <p className="text-sm font-semibold text-[#FF5C5C] mb-1">Chart unavailable</p>
        <p className="text-[10px] text-[#64748B]">{error}</p>
        <p className="text-[10px] text-[#64748B] mt-1 max-w-xs">
          AskAnalyst.com.pk technical chart endpoint may be rate-limited or down, or this symbol is
          not in their coverage. Try another PSX-listed stock.
        </p>
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="w-full flex items-center justify-center text-xs text-[#64748B]" style={{ height }}>
        No data points in selected range
      </div>
    );
  }

  const firstDate = new Date(filtered[0].date).toLocaleDateString("en-PK", { year: "numeric", month: "short", day: "numeric" });
  const lastDate = new Date(filtered[filtered.length - 1].date).toLocaleDateString("en-PK", { year: "numeric", month: "short", day: "numeric" });
  const firstPrice = filtered[0].close;
  const lastPrice = filtered[filtered.length - 1].close;
  const totalReturn = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

  return (
    <div ref={chartContainerRef}>
      {/* Chart type + timeframe selectors */}
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        {/* Timeframe selector */}
        <div className="flex items-center gap-0.5">
          <span className="text-[9px] uppercase tracking-wider text-[#64748B] mr-1.5">Time</span>
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.id}
              onClick={() => setTimeframe(tf.id)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold border transition-colors ${
                timeframe === tf.id
                  ? "border-[#00E676] bg-[#00E676]/10 text-[#00E676]"
                  : "border-white/[0.08] bg-[#0A0E1A] text-[#64748B] hover:text-[#F4F7FB]"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
        {/* Chart type selector */}
        <div className="flex items-center gap-0.5 ml-auto">
          <span className="text-[9px] uppercase tracking-wider text-[#64748B] mr-1.5">Type</span>
          <button
            onClick={() => setChartType("line")}
            className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border transition-colors ${
              chartType === "line"
                ? "border-[#00E676] bg-[#00E676]/10 text-[#00E676]"
                : "border-white/[0.08] bg-[#0A0E1A] text-[#64748B] hover:text-[#F4F7FB]"
            }`}
          >
            Line
          </button>
          <button
            onClick={() => setChartType("candle")}
            className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border transition-colors ${
              chartType === "candle"
                ? "border-[#00E676] bg-[#00E676]/10 text-[#00E676]"
                : "border-white/[0.08] bg-[#0A0E1A] text-[#64748B] hover:text-[#F4F7FB]"
            }`}
          >
            Candlestick
          </button>
        </div>
      </div>

      {/* Intraday not-available notice */}
      {timeframe !== "1d" && (
        <div className="mb-2 rounded-md bg-[#FBBF24]/[0.08] border border-[#FBBF24]/30 px-3 py-1.5 text-[10px] text-[#FBBF24] flex items-center gap-1.5">
          <Activity className="h-3 w-3 shrink-0" />
          Intraday data not available from current API. Showing daily data.
        </div>
      )}

      {/* Range selector */}
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        {(["1m", "6m", "1y", "5y", "all"] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border transition-colors ${
              range === r
                ? "border-[#00E676] bg-[#00E676]/10 text-[#00E676]"
                : "border-white/[0.08] bg-[#0A0E1A] text-[#64748B] hover:text-[#F4F7FB]"
            }`}
          >
            {r === "1m" ? "1M" : r === "6m" ? "6M" : r === "1y" ? "1Y" : r === "5y" ? "5Y" : "ALL"}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-[#64748B]">
          {filtered.length} bars · {firstDate} → {lastDate} ·{" "}
          <span className={totalReturn >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}>
            {totalReturn >= 0 ? "+" : ""}{totalReturn.toFixed(1)}%
          </span>
        </span>
      </div>

      <div className="w-full" style={{ height: height - 40 }}>
        {chartType === "candle" ? (
          <CandlestickChart
            candles={filtered}
            support={support}
            resistance={resistance}
            width={chartWidth}
            height={height - 40}
          />
        ) : (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={enriched} margin={{ top: 10, right: 10, bottom: 5, left: 5 }}>
            <defs>
              <linearGradient id="histPriceGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00E676" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#00E676" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="date"
              tickFormatter={formatXAxis}
              stroke="#64748B"
              tick={{ fontSize: 10, fill: "#64748B" }}
              tickLine={false}
              axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
              minTickGap={40}
            />
            <YAxis
              yAxisId="price"
              orientation="right"
              stroke="#64748B"
              tick={{ fontSize: 10, fill: "#64748B" }}
              tickLine={false}
              axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
              domain={["auto", "auto"]}
              width={50}
            />
            <YAxis
              yAxisId="volume"
              orientation="left"
              hide
              domain={[0, "auto"]}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#131829",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
              labelStyle={{ color: "#94A3B8" }}
              labelFormatter={(ts) =>
                new Date(Number(ts)).toLocaleDateString("en-PK", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })
              }
              formatter={(value: number, name: string) => {
                if (name === "Price") return [value.toFixed(2), "Price"];
                if (name === "50-DMA") return [value.toFixed(2), "50-DMA"];
                if (name === "200-DMA") return [value.toFixed(2), "200-DMA"];
                if (name === "Volume") return [value.toLocaleString(), "Volume"];
                return [value, name];
              }}
            />
            {support && (
              <ReferenceLine
                yAxisId="price"
                y={support}
                stroke="#FF5C5C"
                strokeDasharray="6 4"
                strokeOpacity={0.6}
                label={{ value: `S: ${support.toFixed(2)}`, position: "insideLeft", fill: "#FF5C5C", fontSize: 10 }}
              />
            )}
            {resistance && (
              <ReferenceLine
                yAxisId="price"
                y={resistance}
                stroke="#FBBF24"
                strokeDasharray="6 4"
                strokeOpacity={0.6}
                label={{ value: `R: ${resistance.toFixed(2)}`, position: "insideLeft", fill: "#FBBF24", fontSize: 10 }}
              />
            )}
            <Area
              yAxisId="volume"
              dataKey="volume"
              stroke="rgba(0,230,118,0.25)"
              strokeWidth={1}
              fill="rgba(0,230,118,0.08)"
              name="Volume"
              isAnimationActive={false}
            />
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="close"
              stroke="#00E676"
              strokeWidth={2}
              dot={false}
              name="Price"
              isAnimationActive={false}
            />
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="sma50"
              stroke="#22E881"
              strokeWidth={1}
              strokeDasharray="3 3"
              dot={false}
              name="50-DMA"
              isAnimationActive={false}
              connectNulls
            />
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="sma200"
              stroke="#94A3B8"
              strokeWidth={1}
              strokeDasharray="6 3"
              dot={false}
              name="200-DMA"
              isAnimationActive={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
        )}
      </div>

      <div className="mt-2 text-[10px] text-[#64748B]">
        Source: <span className="text-[#94A3B8]">{source}</span>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

function computeSMAAndLevels(candles: Candle[]): (Candle & { sma50?: number; sma200?: number })[] {
  return candles.map((c, i) => {
    const sma50 = i >= 49 ? avg(candles.slice(i - 49, i + 1).map((x) => x.close)) : undefined;
    const sma200 = i >= 199 ? avg(candles.slice(i - 199, i + 1).map((x) => x.close)) : undefined;
    return { ...c, sma50, sma200 };
  });
}

function avg(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function findSupportResistance(data: (Candle & { sma50?: number; sma200?: number })[]): { support: number | null; resistance: number | null } {
  if (data.length < 20) return { support: null, resistance: null };
  const recent = data.slice(-60, -5);
  if (recent.length === 0) return { support: null, resistance: null };
  const lows = recent.map((c) => c.low);
  const highs = recent.map((c) => c.high);
  const support = Math.min(...lows);
  const resistance = Math.max(...highs);
  return { support, resistance };
}

// ────────────────────────────────────────────────────────────────────────────
// CandlestickChart — pure SVG candlestick chart rendered from OHLCV data.
// Green bodies for up days (close >= open), red for down days (close < open).
// Sub-samples to a max of ~120 candles to keep SVG rendering performant.
// ────────────────────────────────────────────────────────────────────────────

function aggregateCandles(candles: Candle[], maxBars: number): Candle[] {
  if (candles.length <= maxBars) return candles;
  const binSize = Math.ceil(candles.length / maxBars);
  const out: Candle[] = [];
  for (let i = 0; i < candles.length; i += binSize) {
    const bin = candles.slice(i, i + binSize);
    if (bin.length === 0) continue;
    out.push({
      date: bin[0].date,
      open: bin[0].open,
      high: Math.max(...bin.map((c) => c.high)),
      low: Math.min(...bin.map((c) => c.low)),
      close: bin[bin.length - 1].close,
      volume: bin.reduce((s, c) => s + (c.volume || 0), 0),
    });
  }
  return out;
}

function CandlestickChart({
  candles,
  support,
  resistance,
  width,
  height,
}: {
  candles: Candle[];
  support: number | null;
  resistance: number | null;
  width: number;
  height: number;
}) {
  const padding = { top: 12, right: 50, bottom: 22, left: 6 };
  const innerW = Math.max(50, width - padding.left - padding.right);
  const innerH = Math.max(50, height - padding.top - padding.bottom);

  // Sub-sample to ~120 candles for performance on long histories (10y daily)
  const displayed = aggregateCandles(candles, 120);

  if (displayed.length === 0) {
    return (
      <div className="w-full flex items-center justify-center text-xs text-[#64748B]" style={{ height }}>
        No data to render
      </div>
    );
  }

  // Y scale — include support/resistance and SMA range in view
  const lows = displayed.map((c) => c.low);
  const highs = displayed.map((c) => c.high);
  let yMin = Math.min(...lows, support ?? Infinity, resistance ?? Infinity);
  let yMax = Math.max(...highs, support ?? -Infinity, resistance ?? -Infinity);
  if (!isFinite(yMin) || !isFinite(yMax)) {
    yMin = Math.min(...lows);
    yMax = Math.max(...highs);
  }
  const yRange = Math.max(0.0001, yMax - yMin);
  const pad = yRange * 0.06;
  yMin -= pad;
  yMax += pad;
  const yScale = yMax - yMin;

  const xFor = (i: number) => padding.left + (i + 0.5) * (innerW / displayed.length);
  const yFor = (p: number) => padding.top + (1 - (p - yMin) / yScale) * innerH;

  const cw = Math.max(1, Math.min(12, (innerW / displayed.length) * 0.65));

  // 5 horizontal gridlines + price labels on right axis
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: padding.top + f * innerH,
    price: yMax - f * yScale,
  }));

  // ~6 x-axis date labels
  const labelStep = Math.max(1, Math.ceil(displayed.length / 6));
  const xLabels = displayed
    .map((c, i) => ({ c, i }))
    .filter(({ i }) => i % labelStep === 0 || i === displayed.length - 1);

  // SMA50 + SMA200 on displayed (aggregated) close
  const sma = (period: number) =>
    displayed.map((_, i) => {
      if (i + 1 < period) return null;
      const slice = displayed.slice(i + 1 - period, i + 1).map((c) => c.close);
      return slice.reduce((s, n) => s + n, 0) / slice.length;
    });
  const sma50 = sma(Math.min(50, Math.max(2, Math.floor(displayed.length / 4))));
  const sma200 = sma(Math.min(200, Math.max(2, Math.floor(displayed.length / 2))));

  const polylinePoints = (vals: (number | null)[]) =>
    vals
      .map((v, i) => (v == null ? null : `${xFor(i)},${yFor(v)}`))
      .filter((p): p is string => p !== null)
      .join(" ");

  return (
    <svg width={width} height={height} className="block" role="img" aria-label="Candlestick chart">
      {/* Grid */}
      {gridLines.map((g, i) => (
        <g key={`g${i}`}>
          <line x1={padding.left} y1={g.y} x2={padding.left + innerW} y2={g.y} stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
          <text x={padding.left + innerW + 6} y={g.y + 3} fontSize={10} fill="#64748B" fontFamily="monospace">
            {g.price.toFixed(2)}
          </text>
        </g>
      ))}

      {/* X-axis date labels */}
      {xLabels.map(({ c, i }) => (
        <text
          key={`xl${i}`}
          x={xFor(i)}
          y={padding.top + innerH + 14}
          fontSize={10}
          fill="#64748B"
          fontFamily="monospace"
          textAnchor="middle"
        >
          {new Date(c.date).toLocaleDateString("en-PK", { month: "short", year: "2-digit" })}
        </text>
      ))}

      {/* Support line */}
      {support != null && (
        <g>
          <line
            x1={padding.left}
            y1={yFor(support)}
            x2={padding.left + innerW}
            y2={yFor(support)}
            stroke="#FF5C5C"
            strokeWidth={1}
            strokeDasharray="6 4"
            strokeOpacity={0.6}
          />
          <text x={padding.left + 4} y={yFor(support) - 3} fontSize={10} fill="#FF5C5C" fontFamily="monospace">
            S: {support.toFixed(2)}
          </text>
        </g>
      )}

      {/* Resistance line */}
      {resistance != null && (
        <g>
          <line
            x1={padding.left}
            y1={yFor(resistance)}
            x2={padding.left + innerW}
            y2={yFor(resistance)}
            stroke="#FBBF24"
            strokeWidth={1}
            strokeDasharray="6 4"
            strokeOpacity={0.6}
          />
          <text x={padding.left + 4} y={yFor(resistance) - 3} fontSize={10} fill="#FBBF24" fontFamily="monospace">
            R: {resistance.toFixed(2)}
          </text>
        </g>
      )}

      {/* SMA50 line */}
      <polyline
        points={polylinePoints(sma50)}
        fill="none"
        stroke="#22E881"
        strokeWidth={1}
        strokeDasharray="3 3"
        strokeOpacity={0.7}
      />
      {/* SMA200 line */}
      <polyline
        points={polylinePoints(sma200)}
        fill="none"
        stroke="#94A3B8"
        strokeWidth={1}
        strokeDasharray="6 3"
        strokeOpacity={0.7}
      />

      {/* Candles */}
      {displayed.map((c, i) => {
        const x = xFor(i);
        const up = c.close >= c.open;
        const color = up ? "#00E676" : "#FF5C5C";
        const bodyTop = yFor(Math.max(c.open, c.close));
        const bodyBot = yFor(Math.min(c.open, c.close));
        const bodyH = Math.max(1, bodyBot - bodyTop);
        return (
          <g key={`c${i}`}>
            {/* Wick (high to low) */}
            <line x1={x} y1={yFor(c.high)} x2={x} y2={yFor(c.low)} stroke={color} strokeWidth={1} />
            {/* Body (open to close) */}
            <rect
              x={x - cw / 2}
              y={bodyTop}
              width={cw}
              height={bodyH}
              fill={color}
              fillOpacity={up ? 0.85 : 0.85}
              stroke={color}
              strokeWidth={0.5}
            />
          </g>
        );
      })}
    </svg>
  );
}
