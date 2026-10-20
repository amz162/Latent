"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calculator, Sparkles, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { toast } from "sonner";
import type { FairValueSummary, FairValueResult } from "@/lib/latent/fair-value";

interface FairValuePanelResponse {
  symbol: string;
  stockName: string;
  summary: FairValueSummary;
  dataSources: { financials: string; valuation: string; ratios: string };
}

export function FairValuePanel({ symbol }: { symbol: string }) {
  const [data, setData] = useState<FairValuePanelResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/fair-value/${encodeURIComponent(symbol)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load fair value");
    } finally {
      setLoading(false);
    }
  };

  // Auto-load on mount (since pattern panel loads automatically too)
  useEffect(() => {
    load();
  }, [symbol]);

  if (loading && !data) {
    return (
      <Card className="bg-[#131829] border-white/[0.08] mb-4">
        <CardHeader>
          <CardTitle className="text-base text-[#F4F7FB] flex items-center gap-2">
            <Calculator className="h-4 w-4 text-[#00E676]" />
            Fair Value Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-4 w-3/4 bg-white/[0.04] mb-2" />
          <Skeleton className="h-32 w-full bg-white/[0.04]" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-[#131829] border-[#FF5C5C]/20 mb-4">
        <CardContent className="p-4">
          <div className="text-xs text-[#FF5C5C] mb-2">Fair value failed: {error}</div>
          <Button size="sm" variant="outline" onClick={load} className="border-white/[0.12] text-[#94A3B8]">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const summary = data.summary;
  const verdictColor = summary.aboveOrBelowFair === "above" ? "text-[#FF5C5C]" : summary.aboveOrBelowFair === "below" ? "text-[#00E676]" : "text-[#94A3B8]";

  return (
    <Card className="bg-[#131829] border-white/[0.08] mb-4">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base text-[#F4F7FB] flex items-center gap-2">
            <Calculator className="h-4 w-4 text-[#00E676]" />
            Fair Value Analysis
          </CardTitle>
          <Button
            size="sm"
            variant="ghost"
            onClick={load}
            className="text-[#64748B] hover:text-[#F4F7FB] h-7"
          >
            Recalculate
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Headline */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="rounded-md bg-[#00E676]/[0.05] border border-[#00E676]/20 p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider text-[#64748B] mb-1">Our Algo Fair Value</div>
            <div className="text-2xl font-bold text-[#00E676] font-mono">PKR {summary.ourAlgoFairValue.toFixed(2)}</div>
          </div>
          <div className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider text-[#64748B] mb-1">Current Price</div>
            <div className="text-2xl font-bold text-[#F4F7FB] font-mono">PKR {summary.currentPrice.toFixed(2)}</div>
          </div>
        </div>

        {/* Verdict banner */}
        <div className={`rounded-md p-3 mb-4 border ${
          summary.aboveOrBelowFair === "above" ? "bg-[#FF5C5C]/[0.05] border-[#FF5C5C]/20" :
          summary.aboveOrBelowFair === "below" ? "bg-[#00E676]/[0.05] border-[#00E676]/20" :
          "bg-[#0A0E1A] border-white/[0.06]"
        }`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              {summary.aboveOrBelowFair === "above" ? <TrendingUp className="h-4 w-4 text-[#FF5C5C]" /> :
               summary.aboveOrBelowFair === "below" ? <TrendingDown className="h-4 w-4 text-[#00E676]" /> :
               <Minus className="h-4 w-4 text-[#94A3B8]" />}
              <span className={`text-sm font-semibold ${verdictColor}`}>
                {summary.aboveOrBelowFair === "above" ? "OVERVALUED" :
                 summary.aboveOrBelowFair === "below" ? "UNDERVALUED" : "FAIRLY VALUED"}
              </span>
              <span className="text-xs text-[#94A3B8]">
                {summary.percentVsFair > 0 ? "+" : ""}{summary.percentVsFair.toFixed(1)}% vs fair value
              </span>
            </div>
            <span className="text-[10px] text-[#64748B]">
              Range: {summary.range.replace("PKR ", "")} · Avg: {summary.average.toFixed(2)}
            </span>
          </div>
        </div>

        {/* All 6 methods */}
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold mb-1">
            6 valuation methods
          </div>
          {summary.results.map((r: FairValueResult, i: number) => {
            const isActive = Math.abs(r.fairValue - summary.ourAlgoFairValue) < 0.5;
            return (
              <div
                key={i}
                className={`rounded-md p-2.5 border ${
                  isActive ? "bg-[#00E676]/[0.05] border-[#00E676]/30" : "bg-[#0A0E1A] border-white/[0.06]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Badge variant="outline" className={`text-[9px] py-0 h-4 flex-shrink-0 ${
                      r.type === "intrinsic" ? "border-blue-400/40 text-blue-400" : "border-[#00E676]/40 text-[#00E676]"
                    }`}>
                      {r.type === "intrinsic" ? "I" : "R"}
                    </Badge>
                    <span className="text-xs font-semibold text-[#F4F7FB] truncate">{r.methodName}</span>
                    {isActive && (
                      <Badge className="bg-[#00E676] text-[#0A0E1A] text-[8px] py-0 h-3.5 flex-shrink-0">ALGO</Badge>
                    )}
                  </div>
                  <span className="text-xs font-mono font-bold text-[#F4F7FB] flex-shrink-0">
                    {r.fairValue > 0 ? `${r.fairValue.toFixed(2)}` : "n/a"}
                  </span>
                </div>
                <div className="text-[10px] text-[#64748B] mt-0.5">{r.rationale}</div>
              </div>
            );
          })}
        </div>

        {/* Disclaimer */}
        <div className="text-[10px] text-[#64748B] mt-3 leading-relaxed">
          Methodologies: R = Relative (sector comparison), I = Intrinsic (forward-looking). Our algo = most-repeated value across methods, or median if no mode exists.
        </div>
      </CardContent>
    </Card>
  );
}
