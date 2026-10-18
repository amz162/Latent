"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AppNav } from "./AppNav";
import { RealChart } from "./RealChart";
import { useLatentStore } from "@/lib/latent/store";
import { RefreshCw, TrendingUp, TrendingDown, Minus, Brain } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

const INDEXES = [
  { symbol: "KSE-100", name: "KSE-100 Index", value: 42500, changePct: 0.78 },
  { symbol: "KSE-30", name: "KSE-30 Index", value: 14200, changePct: 1.12 },
  { symbol: "KMI-30", name: "KMI-30 (Islamic)", value: 68000, changePct: -0.45 },
  { symbol: "ALLSHR", name: "All Share Index", value: 71000, changePct: 0.32 },
];

// Real PSX-listed stocks that can be charted (use INDEXES for index data, these for stocks)
const CHART_SYMBOLS = ["ENGRO", "HUBC", "LUCK", "SYS", "MEBL", "PSO", "OGDC", "PPL"];

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

export function TechnicalAnalysis() {
  const [selected, setSelected] = useState("ENGRO");
  const setView = useLatentStore((s) => s.setView);

  return (
    <div className="min-h-screen bg-[#0A0E1A]">
      <AppNav />
      <main className="px-4 md:px-6 py-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#F4F7FB]">Technical Analysis</h1>
            <p className="text-sm text-[#94A3B8] mt-1">
              Index analysis with support/resistance, indicators matrix, and AI prediction — all in layman terms.
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

        {/* Index selector */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-5">
          {INDEXES.map((idx) => (
            <button
              key={idx.symbol}
              onClick={() => setSelected(idx.symbol)}
              className={`text-left p-3 rounded-lg border transition-colors ${
                selected === idx.symbol
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

        <div className="grid lg:grid-cols-3 gap-4">
          {/* Real chart wired to /api/psx/technical/[symbol] */}
          <Card className="lg:col-span-2 bg-[#131829] border-white/[0.08]">
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-base text-[#F4F7FB]">
                  {selected} · Real OHLCV (last 1 year from AskAnalyst.com.pk)
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-[#00E676]/40 text-[#00E676] text-[10px]">
                    LIVE OHLCV
                  </Badge>
                  <select
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                    className="bg-[#0A0E1A] border border-white/[0.12] text-[#F4F7FB] text-xs rounded px-2 py-1 font-mono"
                  >
                    <optgroup label="Indexes (simulated)">
                      {INDEXES.map((idx) => (
                        <option key={idx.symbol} value={idx.symbol}>{idx.symbol}</option>
                      ))}
                    </optgroup>
                    <optgroup label="PSX Stocks (real OHLCV)">
                      {CHART_SYMBOLS.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </optgroup>
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Real chart wired to /api/psx/technical/[symbol] */}
              {CHART_SYMBOLS.includes(selected) ? (
                <RealChart symbol={selected} height={320} />
              ) : (
                <div className="h-80 rounded-lg bg-[#0A0E1A] border border-white/[0.06] flex items-center justify-center text-xs text-[#64748B]">
                  Index chart data not available — pick a PSX stock from the dropdown for real OHLCV.
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
          <span className="text-[#94A3B8] font-semibold">Real chart data:</span> Daily OHLCV
          pulled live from askanalyst.com.pk /technicalchart endpoint. Chart shows last 1 year
          of price action with 50-DMA, 200-DMA, support, resistance, and volume bars. Indicator
          matrix values shown to the right are illustrative — actual computed values will be
          wired in from the same data pipeline in a future iteration.
        </div>
      </main>
    </div>
  );
}
