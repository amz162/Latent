"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { AppNav } from "./AppNav";
import { useLatentStore } from "@/lib/latent/store";
import { MOCK_STOCKS } from "@/lib/latent/mock-stocks";
import type { FairValueSummary, FairValueResult } from "@/lib/latent/fair-value";
import { Calculator, TrendingUp, TrendingDown, Minus, Sparkles, Target } from "lucide-react";
import { toast } from "sonner";

interface FairValueResponse {
  symbol: string;
  stockName: string;
  summary: FairValueSummary;
  inputs: Record<string, number>;
  dataSources: {
    financials: "fetched" | "fallback";
    valuation: "fetched" | "fallback";
    ratios: "fetched" | "fallback";
  };
}

export function FairValueCalculator() {
  const [symbol, setSymbol] = useState("ENGRO");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FairValueResponse | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const calculate = async () => {
    setLoading(true);
    setResult(null);
    try {
      const params = new URLSearchParams();
      Object.entries(overrides).forEach(([k, v]) => {
        if (v) params.append(k, v);
      });
      const res = await fetch(`/api/fair-value/${symbol}?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      const data = await res.json();
      setResult(data);
      toast.success(`Fair value calculated for ${symbol}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Calculation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0E1A]">
      <AppNav />
      <main className="px-4 md:px-6 py-6 max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[#F4F7FB] flex items-center gap-2">
            <Calculator className="h-6 w-6 text-[#00E676]" />
            Fair Value Calculator
          </h1>
          <p className="text-sm text-[#94A3B8] mt-1">
            6 valuation methods (4 relative + 2 intrinsic). Average + range + our algo (most-repeated value). All from real PSX data fetched from AskAnalyst.com.pk.
          </p>
        </div>

        {/* Stock picker + Calculate button */}
        <Card className="bg-[#131829] border-white/[0.08] mb-4">
          <CardContent className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
              <div>
                <Label className="text-[#94A3B8] text-xs">Select Stock</Label>
                <select
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="w-full bg-[#0A0E1A] border border-white/[0.12] text-[#F4F7FB] text-sm rounded-md px-3 py-2 mt-1"
                >
                  {MOCK_STOCKS.map((s) => (
                    <option key={s.symbol} value={s.symbol}>{s.symbol} — {s.name}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2 flex gap-2">
                <Button
                  onClick={calculate}
                  disabled={loading}
                  className="bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold flex-1"
                >
                  {loading ? (
                    <>
                      <Skeleton className="h-4 w-4 mr-1.5 bg-white/20" />
                      Calculating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-1.5" />
                      Calculate Fair Value
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="border-white/[0.12] text-[#94A3B8]"
                >
                  {showAdvanced ? "Hide" : "Advanced"}
                </Button>
              </div>
            </div>

            {/* Advanced overrides */}
            {showAdvanced && (
              <div className="mt-4 pt-4 border-t border-white/[0.06]">
                <div className="text-xs uppercase tracking-wider text-[#64748B] mb-2">
                  Override defaults (optional) — leave blank to use fetched values
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    { key: "eps", label: "EPS (PKR)" },
                    { key: "bookValuePerShare", label: "Book Value/share" },
                    { key: "dividendPerShare", label: "Dividend/share" },
                    { key: "sectorPE", label: "Sector P/E" },
                    { key: "sectorPB", label: "Sector P/B" },
                    { key: "growthRate", label: "Growth Rate %" },
                    { key: "pakistanBondYield", label: "PK Bond Yield %" },
                    { key: "wacc", label: "WACC %" },
                    { key: "shortTermGrowth", label: "ST Growth %" },
                    { key: "terminalGrowth", label: "Terminal Growth %" },
                    { key: "fcf", label: "Free Cash Flow" },
                    { key: "sharesOutstanding", label: "Shares Out." },
                    { key: "dividendGrowthRate", label: "Div Growth %" },
                    { key: "requiredReturn", label: "Req. Return %" },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <Label className="text-[10px] text-[#64748B]">{label}</Label>
                      <Input
                        type="number"
                        value={overrides[key] || ""}
                        onChange={(e) => setOverrides({ ...overrides, [key]: e.target.value })}
                        placeholder="auto"
                        className="bg-[#0A0E1A] border-white/[0.12] text-[#F4F7FB] font-mono text-xs h-8"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Result */}
        {result && (
          <>
            {/* Headline: fair value + current price comparison */}
            <Card className="bg-gradient-to-br from-[#00E676]/[0.07] to-[#131829] border-[#00E676]/20 mb-4">
              <CardContent className="p-5">
                <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[#64748B] mb-1">{result.stockName}</div>
                    <div className="text-3xl font-bold text-[#00E676] font-mono">
                      PKR {result.summary.ourAlgoFairValue.toFixed(2)}
                    </div>
                    <div className="text-xs text-[#94A3B8] mt-1">Our algo fair value</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-[#64748B] mb-1">Current Price</div>
                    <div className="text-3xl font-bold text-[#F4F7FB] font-mono">
                      PKR {result.summary.currentPrice.toFixed(2)}
                    </div>
                    <div className="flex items-center justify-end gap-1.5 mt-1">
                      {result.summary.aboveOrBelowFair === "above" ? (
                        <TrendingUp className="h-3.5 w-3.5 text-[#FF5C5C]" />
                      ) : result.summary.aboveOrBelowFair === "below" ? (
                        <TrendingDown className="h-3.5 w-3.5 text-[#00E676]" />
                      ) : (
                        <Minus className="h-3.5 w-3.5 text-[#94A3B8]" />
                      )}
                      <span className={`text-sm font-bold ${
                        result.summary.aboveOrBelowFair === "above" ? "text-[#FF5C5C]" :
                        result.summary.aboveOrBelowFair === "below" ? "text-[#00E676]" : "text-[#94A3B8]"
                      }`}>
                        {result.summary.percentVsFair > 0 ? "+" : ""}{result.summary.percentVsFair.toFixed(1)}% vs fair value
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-2">
                    <div className="text-[9px] uppercase text-[#64748B]">Average</div>
                    <div className="text-sm font-mono font-bold text-[#F4F7FB]">{result.summary.average.toFixed(2)}</div>
                  </div>
                  <div className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-2">
                    <div className="text-[9px] uppercase text-[#64748B]">Range</div>
                    <div className="text-xs font-mono text-[#94A3B8]">{result.summary.range.replace("PKR ", "")}</div>
                  </div>
                  <div className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-2">
                    <div className="text-[9px] uppercase text-[#64748B]">Verdict</div>
                    <div className={`text-xs font-bold uppercase ${
                      result.summary.aboveOrBelowFair === "above" ? "text-[#FF5C5C]" :
                      result.summary.aboveOrBelowFair === "below" ? "text-[#00E676]" : "text-[#94A3B8]"
                    }`}>
                      {result.summary.aboveOrBelowFair === "above" ? "Overvalued" :
                       result.summary.aboveOrBelowFair === "below" ? "Undervalued" : "Fairly valued"}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* All 6 methods breakdown */}
            <Card className="bg-[#131829] border-white/[0.08] mb-4">
              <CardHeader>
                <CardTitle className="text-base text-[#F4F7FB]">All 6 Valuation Methods</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {result.summary.results.map((r: FairValueResult, i: number) => {
                    const isActive = r.fairValue === result.summary.ourAlgoFairValue;
                    return (
                      <div
                        key={i}
                        className={`rounded-md p-3 border ${
                          isActive ? "bg-[#00E676]/[0.05] border-[#00E676]/30" : "bg-[#0A0E1A] border-white/[0.06]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3 mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-[#F4F7FB]">{r.methodName}</span>
                            <Badge variant="outline" className={`text-[9px] py-0 h-4 ${
                              r.type === "intrinsic" ? "border-blue-400/40 text-blue-400" : "border-[#00E676]/40 text-[#00E676]"
                            }`}>
                              {r.type}
                            </Badge>
                            {isActive && (
                              <Badge className="bg-[#00E676] text-[#0A0E1A] text-[9px] py-0 h-4">
                                OUR ALGO
                              </Badge>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="text-sm font-mono font-bold text-[#F4F7FB]">
                              {r.fairValue > 0 ? `PKR ${r.fairValue.toFixed(2)}` : "n/a"}
                            </div>
                          </div>
                        </div>
                        <div className="text-[11px] text-[#94A3B8] font-mono mb-1">{r.formula}</div>
                        <div className="text-[11px] text-[#64748B] italic">{r.rationale}</div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Data sources */}
            <Card className="bg-[#131829] border-white/[0.08]">
              <CardContent className="p-4">
                <div className="text-[10px] uppercase tracking-wider text-[#64748B] mb-2">Data sources</div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${result.dataSources.financials === "fetched" ? "bg-[#00E676]" : "bg-[#FBBF24]"}`} />
                    <span className="text-[#94A3B8]">Financials:</span>
                    <span className="font-mono text-[#F4F7FB]">{result.dataSources.financials}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${result.dataSources.valuation === "fetched" ? "bg-[#00E676]" : "bg-[#FBBF24]"}`} />
                    <span className="text-[#94A3B8]">Valuation:</span>
                    <span className="font-mono text-[#F4F7FB]">{result.dataSources.valuation}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${result.dataSources.ratios === "fetched" ? "bg-[#00E676]" : "bg-[#FBBF24]"}`} />
                    <span className="text-[#94A3B8]">Ratios:</span>
                    <span className="font-mono text-[#F4F7FB]">{result.dataSources.ratios}</span>
                  </div>
                </div>
                <div className="text-[10px] text-[#64748B] mt-2">
                  "fetched" = real data from AskAnalyst.com.pk · "fallback" = conservative default (use Advanced panel to override)
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
