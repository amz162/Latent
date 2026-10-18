"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AppNav } from "./AppNav";
import { StockSearch } from "./StockSearch";
import {
  MOCK_COMPANY_RESULTS,
  detectPatterns,
  groupByCompany,
  computeCAGR,
  computeStdDev,
  computeSlope,
  generateQuarterlySummary,
  type QuarterlyResult,
  type DetectedPattern,
  type QuarterSummary,
} from "@/lib/latent/mock-company-results";
import { MOCK_STOCKS } from "@/lib/latent/mock-stocks";
import {
  Search,
  TrendingUp,
  TrendingDown,
  Activity,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Info,
  Coins,
  BarChart3,
  ArrowLeft,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";

const POPULAR_SUGGESTIONS = ["ENGRO", "HUBC", "LUCK", "SYS", "MEBL", "OGDC", "PPL", "PSO"];

const FY_PALETTE = ["#00E676", "#22E881", "#10B981", "#34D399", "#6EE7B7", "#A7F3D0", "#FBBF24", "#FB923C"];

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}B`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}M`;
  return n.toFixed(0);
}

function fyOf(period: string): string {
  const m = period.match(/FY\s?(\d+)/i);
  return m ? m[1] : period.slice(-2);
}

export function PatternFinder() {
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [results, setResults] = useState<QuarterlyResult[]>([]);
  const [company, setCompany] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = (symbol: string) => {
    if (!symbol) {
      setSelectedSymbol(null);
      setResults([]);
      setCompany("");
      setError(null);
      return;
    }
    setSelectedSymbol(symbol);
    setLoading(true);
    setError(null);
    setResults([]);
    fetch(`/api/psx/financial-results/${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        if (!d.results || d.results.length === 0) {
          throw new Error("No quarterly data available for this stock yet.");
        }
        setResults(d.results as QuarterlyResult[]);
        setCompany(d.company || symbol);
        toast.success(`Loaded ${d.results.length} quarters for ${symbol}`);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Unknown error";
        setError(msg);
        toast.error(`Could not load ${symbol}: ${msg}`);
      })
      .finally(() => setLoading(false));
  };

  const refresh = () => {
    if (selectedSymbol) handleSelect(selectedSymbol);
  };

  return (
    <div className="min-h-screen bg-[#0A0E1A]">
      <AppNav />
      <main className="px-4 md:px-6 py-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#F4F7FB]">Pattern Finder</h1>
            <p className="text-sm text-[#94A3B8] mt-1">
              Discover earnings, dividend, and margin patterns in quarterly results — explained in plain English.
            </p>
          </div>
          {selectedSymbol && (
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={loading}
              className="border-white/[0.12] text-[#94A3B8] hover:text-[#F4F7FB]"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          )}
        </div>

        {/* Search bar */}
        <Card className="bg-[#131829] border-white/[0.08] mb-4">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Search className="h-4 w-4 text-[#00E676]" />
              <span className="text-sm font-semibold text-[#F4F7FB]">Search any PSX-listed company</span>
              <Badge variant="outline" className="text-[9px] border-[#00E676]/40 text-[#00E676] ml-auto">
                361+ stocks
              </Badge>
            </div>
            <StockSearch
              value={selectedSymbol || ""}
              onChange={handleSelect}
              placeholder="Search by symbol or name — e.g. ENGRO, Hub Power, Systems..."
              className="w-full"
            />
            <div className="text-[10px] text-[#64748B] mt-2 flex items-center gap-1.5 flex-wrap">
              <span>Quick try:</span>
              {POPULAR_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSelect(s)}
                  className="font-mono text-[10px] text-[#94A3B8] hover:text-[#00E676] underline-offset-2 hover:underline"
                >
                  {s}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Loading state */}
        {loading && (
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2 text-sm text-[#94A3B8]">
                <RefreshCw className="h-4 w-4 animate-spin text-[#00E676]" />
                Fetching quarterly results for {selectedSymbol}...
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 bg-white/[0.04]" />
                ))}
              </div>
              <Skeleton className="h-64 w-full bg-white/[0.04]" />
            </CardContent>
          </Card>
        )}

        {/* Error state */}
        {!loading && error && results.length === 0 && (
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardContent className="p-6 text-center">
              <AlertTriangle className="h-8 w-8 text-[#FF5C5C] mx-auto mb-2" />
              <p className="text-sm font-semibold text-[#F4F7FB] mb-1">Could not load results</p>
              <p className="text-xs text-[#64748B] max-w-md mx-auto">{error}</p>
              <p className="text-[10px] text-[#64748B] mt-2">
                The askanalyst.com.pk upstream may be rate-limited. Try again or pick another stock.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Deep dive */}
        {!loading && !error && results.length > 0 && selectedSymbol && (
          <StockDeepDive
            results={results}
            symbol={selectedSymbol}
            company={company}
            onBack={() => handleSelect("")}
          />
        )}

        {/* Empty state — no symbol selected */}
        {!loading && !selectedSymbol && <EmptyState onPickSymbol={handleSelect} />}
      </main>
    </div>
  );
}

function EmptyState({ onPickSymbol }: { onPickSymbol: (s: string) => void }) {
  const groups = groupByCompany(MOCK_COMPANY_RESULTS);

  return (
    <Card className="bg-[#131829] border-white/[0.08]">
      <CardContent className="p-6">
        {groups.length === 0 ? (
          <div className="text-center py-10">
            <div className="h-12 w-12 rounded-full bg-[#00E676]/10 flex items-center justify-center mx-auto mb-3">
              <Search className="h-5 w-5 text-[#00E676]" />
            </div>
            <p className="text-base font-semibold text-[#F4F7FB] mb-1">Search any stock above</p>
            <p className="text-xs text-[#64748B] max-w-md mx-auto leading-relaxed">
              Pick any of 361 PSX-listed companies to see quarterly patterns, seasonality, growth rates,
              dividend trends, and margin trajectory — all explained in plain English.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-5 max-w-2xl mx-auto">
              {MOCK_STOCKS.slice(0, 8).map((s) => (
                <button
                  key={s.symbol}
                  onClick={() => onPickSymbol(s.symbol)}
                  className="rounded-md border border-white/[0.06] bg-[#0A0E1A] p-2 hover:border-[#00E676]/30 hover:bg-[#00E676]/[0.04] transition-colors text-left"
                >
                  <div className="text-xs font-mono font-semibold text-[#F4F7FB]">{s.symbol}</div>
                  <div className="text-[10px] text-[#64748B] truncate">{s.name}</div>
                  <div className="text-[9px] text-[#00E676] mt-0.5">{s.sector}</div>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-[#64748B] mt-4">
              Data fetched on-demand from askanalyst.com.pk income-statement endpoint.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-[10px] uppercase tracking-wider text-[#64748B]">
              {groups.length} companies with cached patterns
            </div>
            {groups.map((g) => (
              <button
                key={g.symbol}
                onClick={() => onPickSymbol(g.symbol)}
                className="w-full text-left rounded-lg border border-white/[0.06] bg-[#0A0E1A] p-3 hover:border-[#00E676]/30 transition-colors"
              >
                <div className="flex items-center gap-3 mb-1">
                  <span className="font-mono font-semibold text-sm text-[#F4F7FB]">{g.symbol}</span>
                  <span className="text-xs text-[#94A3B8] truncate">{g.company}</span>
                  <Badge variant="outline" className="text-[9px] border-white/[0.08] text-[#64748B] ml-auto">
                    {g.results.length} q
                  </Badge>
                </div>
                <div className="text-[10px] text-[#64748B]">
                  {detectPatterns(g.results).length} patterns detected
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StockDeepDive({
  results,
  symbol,
  company,
  onBack,
}: {
  results: QuarterlyResult[];
  symbol: string;
  company: string;
  onBack: () => void;
}) {
  const patterns = detectPatterns(results);
  const quarters = generateQuarterlySummary(results);
  const yearsBetween =
    results.length >= 2
      ? (new Date(results[results.length - 1].periodEnd).getTime() -
          new Date(results[0].periodEnd).getTime()) /
        (365 * 24 * 60 * 60 * 1000)
      : 0;
  const revCAGR = computeCAGR(results[0].metrics.revenue, results[results.length - 1].metrics.revenue, yearsBetween);
  const profCAGR = computeCAGR(
    results[0].metrics.profitAfterTax,
    results[results.length - 1].metrics.profitAfterTax,
    yearsBetween
  );
  const epsCAGR = computeCAGR(results[0].metrics.eps, results[results.length - 1].metrics.eps, yearsBetween);
  const totalDPS = results.reduce((s, r) => s + r.metrics.dividendPerShare, 0);
  const volatility = computeStdDev(results.map((r) => r.metrics.epsYoYGrowth));
  const marginSlope = computeSlope(results.map((r) => r.metrics.netMargin));

  const stats: { label: string; value: string; sub: string; tone?: "pos" | "neg" | "neutral" }[] = [
    { label: "Revenue CAGR", value: `${revCAGR.toFixed(1)}%`, sub: `${yearsBetween.toFixed(1)}y compound`, tone: revCAGR >= 0 ? "pos" : "neg" },
    { label: "Profit CAGR", value: `${profCAGR.toFixed(1)}%`, sub: "PAT growth", tone: profCAGR >= 0 ? "pos" : "neg" },
    { label: "EPS CAGR", value: `${epsCAGR.toFixed(1)}%`, sub: "per-share profit", tone: epsCAGR >= 0 ? "pos" : "neg" },
    { label: "Total DPS", value: `₹${totalDPS.toFixed(2)}`, sub: `${results.length} quarters`, tone: "neutral" },
    { label: "Volatility", value: `${volatility.toFixed(1)}pp`, sub: "EPS YoY std dev", tone: volatility > 15 ? "neg" : "neutral" },
    { label: "Margin slope", value: `${marginSlope >= 0 ? "+" : ""}${marginSlope.toFixed(2)}pp/q`, sub: "net margin trend", tone: marginSlope >= 0 ? "pos" : "neg" },
    { label: "Patterns", value: `${patterns.length}`, sub: "detected", tone: "neutral" },
    { label: "Quarters", value: `${results.length}`, sub: "analyzed", tone: "neutral" },
  ];

  return (
    <div className="space-y-4">
      {/* Header with back button */}
      <Card className="bg-[#131829] border-white/[0.08]">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={onBack}
              className="border-white/[0.12] text-[#94A3B8] hover:text-[#F4F7FB] shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back
            </Button>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-[#F4F7FB]">{symbol}</h2>
                <span className="text-sm text-[#94A3B8] truncate">{company}</span>
              </div>
              <p className="text-xs text-[#64748B] mt-1">
                Deep dive on {results.length} quarters ·{" "}
                {new Date(results[0].periodEnd).toLocaleDateString("en-PK", { year: "numeric", month: "short" })} →{" "}
                {new Date(results[results.length - 1].periodEnd).toLocaleDateString("en-PK", { year: "numeric", month: "short" })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 8 summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s, i) => (
          <SummaryStat key={i} label={s.label} value={s.value} sub={s.sub} tone={s.tone} />
        ))}
      </div>

      {/* Multi-line chart */}
      <Card className="bg-[#131829] border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-base text-[#F4F7FB] flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[#00E676]" />
            Revenue · Profit · EPS trend (normalized 0–100)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <MultiLineChart results={results} />
        </CardContent>
      </Card>

      {/* Quarterly seasonal pattern */}
      <Card className="bg-[#131829] border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-base text-[#F4F7FB] flex items-center gap-2">
            <Calendar className="h-4 w-4 text-[#00E676]" />
            Quarterly seasonal pattern
          </CardTitle>
        </CardHeader>
        <CardContent>
          {quarters.length === 0 ? (
            <p className="text-xs text-[#64748B]">
              Need at least 4 quarters (ideally spanning multiple FYs) to compute seasonality.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {quarters.map((q) => (
                <QuarterSummaryCard key={q.quarter} q={q} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revenue bar chart (CSS) */}
      <Card className="bg-[#131829] border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-base text-[#F4F7FB] flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[#00E676]" />
            Revenue by quarter (PKR, color-coded by FY)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RevenueBars results={results} />
        </CardContent>
      </Card>

      {/* EPS bars + net margin overlay */}
      <Card className="bg-[#131829] border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-base text-[#F4F7FB] flex items-center gap-2">
            <Coins className="h-4 w-4 text-[#00E676]" />
            EPS bars + net margin overlay
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EpsMarginChart results={results} />
        </CardContent>
      </Card>

      {/* YoY growth chart */}
      <Card className="bg-[#131829] border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-base text-[#F4F7FB] flex items-center gap-2">
            <Activity className="h-4 w-4 text-[#00E676]" />
            YoY growth — Revenue vs EPS
          </CardTitle>
        </CardHeader>
        <CardContent>
          <YoYGrowthChart results={results} />
        </CardContent>
      </Card>

      {/* Detected patterns */}
      <Card className="bg-[#131829] border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-base text-[#F4F7FB] flex items-center gap-2">
            <Info className="h-4 w-4 text-[#00E676]" />
            Detected patterns ({patterns.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {patterns.length === 0 ? (
            <p className="text-xs text-[#64748B]">
              No strong patterns detected yet — need more quarters or larger moves to trigger detection rules.
            </p>
          ) : (
            <div className="space-y-2">
              {patterns.map((p, i) => (
                <PatternRow key={i} pattern={p} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Full quarterly history table */}
      <Card className="bg-[#131829] border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-base text-[#F4F7FB]">Full quarterly history</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-y-auto custom-scroll rounded-md border border-white/[0.04]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#131829] z-10">
                <tr className="text-[#64748B] text-[10px] uppercase tracking-wider">
                  <th className="text-left p-2 font-medium">Period</th>
                  <th className="text-right p-2 font-medium">Revenue</th>
                  <th className="text-right p-2 font-medium">PAT</th>
                  <th className="text-right p-2 font-medium">EPS</th>
                  <th className="text-right p-2 font-medium">Rev YoY</th>
                  <th className="text-right p-2 font-medium">EPS YoY</th>
                  <th className="text-right p-2 font-medium">N. margin</th>
                  <th className="text-right p-2 font-medium">DPS</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i} className="border-t border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="p-2 text-[#F4F7FB] font-mono">{r.period}</td>
                    <td className="p-2 text-right text-[#94A3B8] font-mono">{fmtNum(r.metrics.revenue)}</td>
                    <td className="p-2 text-right text-[#94A3B8] font-mono">{fmtNum(r.metrics.profitAfterTax)}</td>
                    <td className="p-2 text-right text-[#94A3B8] font-mono">{r.metrics.eps.toFixed(2)}</td>
                    <td
                      className={`p-2 text-right font-mono ${
                        r.metrics.revenueYoYGrowth >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"
                      }`}
                    >
                      {r.metrics.revenueYoYGrowth >= 0 ? "+" : ""}
                      {r.metrics.revenueYoYGrowth.toFixed(1)}%
                    </td>
                    <td
                      className={`p-2 text-right font-mono ${
                        r.metrics.epsYoYGrowth >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"
                      }`}
                    >
                      {r.metrics.epsYoYGrowth >= 0 ? "+" : ""}
                      {r.metrics.epsYoYGrowth.toFixed(1)}%
                    </td>
                    <td className="p-2 text-right text-[#94A3B8] font-mono">{r.metrics.netMargin.toFixed(1)}%</td>
                    <td className="p-2 text-right text-[#94A3B8] font-mono">{r.metrics.dividendPerShare.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "pos" | "neg" | "neutral";
}) {
  const toneColor =
    tone === "pos" ? "text-[#00E676]" : tone === "neg" ? "text-[#FF5C5C]" : "text-[#F4F7FB]";
  return (
    <Card className="bg-[#131829] border-white/[0.08]">
      <CardContent className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-[#64748B] truncate">{label}</div>
        <div className={`text-lg font-bold font-mono mt-0.5 ${toneColor}`}>{value}</div>
        {sub && <div className="text-[10px] text-[#64748B] truncate">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function QuarterSummaryCard({ q }: { q: QuarterSummary }) {
  const tone = q.typicalPattern === "peak" ? "pos" : q.typicalPattern === "low" ? "neg" : "neutral";
  const toneColor =
    tone === "pos" ? "text-[#00E676]" : tone === "neg" ? "text-[#FF5C5C]" : "text-[#94A3B8]";
  return (
    <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold text-[#F4F7FB]">{q.quarterLabel}</span>
        <Badge variant="outline" className="text-[9px] border-white/[0.08] text-[#64748B]">
          {q.monthsLabel}
        </Badge>
      </div>
      <p className="text-xs text-[#94A3B8] leading-relaxed mb-2">{q.summary}</p>
      <div className="flex items-center justify-between text-[10px]">
        <div className="text-[#64748B]">
          Rev <span className={`font-mono ${toneColor}`}>{q.avgRevenuePctOfTotal.toFixed(1)}%</span>
        </div>
        <div className="text-[#64748B]">
          Margin <span className="font-mono text-[#F4F7FB]">{q.avgNetMargin.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

function PatternRow({ pattern }: { pattern: DetectedPattern }) {
  const isPositive = pattern.severity === "positive";
  const isNegative = pattern.severity === "negative";
  const icon = isPositive ? (
    <CheckCircle2 className="h-3.5 w-3.5 text-[#00E676]" />
  ) : isNegative ? (
    <AlertTriangle className="h-3.5 w-3.5 text-[#FF5C5C]" />
  ) : (
    <Info className="h-3.5 w-3.5 text-[#94A3B8]" />
  );
  const sevClass = isPositive
    ? "border-[#00E676]/30 text-[#00E676] bg-[#00E676]/[0.06]"
    : isNegative
    ? "border-[#FF5C5C]/30 text-[#FF5C5C] bg-[#FF5C5C]/[0.06]"
    : "border-white/[0.08] text-[#94A3B8] bg-white/[0.02]";
  const borderClass = isPositive
    ? "border-[#00E676]/20"
    : isNegative
    ? "border-[#FF5C5C]/20"
    : "border-white/[0.06]";

  return (
    <div className={`rounded-lg border ${borderClass} bg-[#0A0E1A] p-3`}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <span className="text-sm font-semibold text-[#F4F7FB] truncate">{pattern.label}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="outline" className={`text-[9px] uppercase ${sevClass}`}>
            {pattern.severity}
          </Badge>
          <Badge variant="outline" className="text-[9px] border-white/[0.08] text-[#64748B]">
            {pattern.confidence}% conf
          </Badge>
        </div>
      </div>
      <p className="text-xs text-[#94A3B8] mb-1.5 leading-relaxed">{pattern.detail}</p>
      {pattern.laymanSummary && (
        <p className="text-xs text-[#00E676] font-medium mb-1.5 flex items-start gap-1.5 leading-relaxed">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          {pattern.laymanSummary}
        </p>
      )}
      {pattern.affectedQuarters.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap mt-2 pt-2 border-t border-white/[0.04]">
          <span className="text-[10px] text-[#64748B]">Triggered:</span>
          {pattern.affectedQuarters.map((q, i) => (
            <Badge key={i} variant="outline" className="text-[9px] font-mono border-white/[0.08] text-[#64748B]">
              {q}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Pure-SVG multi-line chart: revenue (green), profit (blue dashed), EPS (yellow dotted)
function MultiLineChart({ results }: { results: QuarterlyResult[] }) {
  const W = 800;
  const H = 280;
  const P = { top: 20, right: 30, bottom: 36, left: 40 };
  const innerW = W - P.left - P.right;
  const innerH = H - P.top - P.bottom;

  const revs = results.map((r) => r.metrics.revenue);
  const profits = results.map((r) => r.metrics.profitAfterTax);
  const epss = results.map((r) => r.metrics.eps);

  const rangeOf = (arr: number[]) => {
    const mn = Math.min(...arr);
    const mx = Math.max(...arr);
    return { mn, mx: mx === mn ? mn + 1 : mx };
  };
  const revR = rangeOf(revs);
  const profR = rangeOf(profits);
  const epsR = rangeOf(epss);

  const norm = (v: number, r: { mn: number; mx: number }) =>
    r.mx === r.mn ? 0.5 : (v - r.mn) / (r.mx - r.mn);

  const xAt = (i: number) =>
    P.left + (results.length === 1 ? innerW / 2 : (i / (results.length - 1)) * innerW);
  const yAt = (n: number) => P.top + (1 - n) * innerH;

  const linePath = (vals: number[], r: { mn: number; mx: number }) =>
    vals
      .map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(norm(v, r)).toFixed(1)}`)
      .join(" ");

  const areaPath = (vals: number[], r: { mn: number; mx: number }) => {
    if (vals.length === 0) return "";
    const top = vals
      .map((v, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(norm(v, r)).toFixed(1)}`)
      .join(" ");
    return `${top} L ${xAt(vals.length - 1).toFixed(1)} ${(P.top + innerH).toFixed(1)} L ${xAt(0).toFixed(
      1
    )} ${(P.top + innerH).toFixed(1)} Z`;
  };

  const gridLines = Array.from({ length: 5 }, (_, i) => P.top + (i / 4) * innerH);
  const labelStep = Math.max(1, Math.ceil(results.length / 8));

  const lastRev = revs[revs.length - 1];
  const lastProf = profits[profits.length - 1];
  const lastEps = epss[epss.length - 1];

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00E676" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#00E676" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grid */}
        {gridLines.map((y, i) => (
          <line
            key={i}
            x1={P.left}
            y1={y}
            x2={P.left + innerW}
            y2={y}
            stroke="#1E2536"
            strokeWidth="1"
            strokeDasharray="2 4"
          />
        ))}
        {/* X-axis labels */}
        {results.map((r, i) =>
          i % labelStep === 0 ? (
            <text
              key={i}
              x={xAt(i)}
              y={H - 8}
              fill="#64748B"
              fontSize="9"
              textAnchor="middle"
              fontFamily="monospace"
            >
              {r.period}
            </text>
          ) : null
        )}
        {/* Filled area under revenue */}
        <path d={areaPath(revs, revR)} fill="url(#revFill)" />
        {/* Revenue line (green solid) */}
        <path d={linePath(revs, revR)} fill="none" stroke="#00E676" strokeWidth="2" />
        {/* Profit line (blue dashed) */}
        <path d={linePath(profits, profR)} fill="none" stroke="#3B82F6" strokeWidth="2" strokeDasharray="6 4" />
        {/* EPS line (yellow dotted) */}
        <path d={linePath(epss, epsR)} fill="none" stroke="#FBBF24" strokeWidth="2" strokeDasharray="2 3" />
        {/* Endpoint markers */}
        {revs.length > 0 && (
          <circle cx={xAt(revs.length - 1)} cy={yAt(norm(lastRev, revR))} r="3.5" fill="#00E676" />
        )}
        {profits.length > 0 && (
          <circle cx={xAt(profits.length - 1)} cy={yAt(norm(lastProf, profR))} r="3.5" fill="#3B82F6" />
        )}
        {epss.length > 0 && (
          <circle cx={xAt(epss.length - 1)} cy={yAt(norm(lastEps, epsR))} r="3.5" fill="#FBBF24" />
        )}
      </svg>
      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 text-[10px] text-[#94A3B8] flex-wrap justify-center">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-[#00E676] inline-block" />
          Revenue (PKR)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 inline-block" style={{ borderBottom: "2px dashed #3B82F6" }} />
          Profit after tax (PKR)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 inline-block" style={{ borderBottom: "2px dotted #FBBF24" }} />
          EPS (PKR)
        </span>
        <span className="text-[#64748B]">Each line scaled to its own min–max for trend comparison.</span>
      </div>
    </div>
  );
}

// ---- CSS-based revenue bars color-coded by FY year
function RevenueBars({ results }: { results: QuarterlyResult[] }) {
  const max = Math.max(...results.map((r) => r.metrics.revenue), 1);
  const fyList = Array.from(new Set(results.map((r) => fyOf(r.period))));
  const fyColor = (fy: string) => {
    const idx = fyList.indexOf(fy);
    return FY_PALETTE[idx % FY_PALETTE.length];
  };

  return (
    <div>
      <div className="flex items-end gap-1 h-48 overflow-x-auto custom-scroll pb-2">
        {results.map((r, i) => {
          const h = (r.metrics.revenue / max) * 100;
          const fy = fyOf(r.period);
          return (
            <div key={i} className="flex flex-col items-center gap-1 min-w-[28px] flex-1 h-full">
              <div className="text-[9px] font-mono text-[#64748B]">{fmtNum(r.metrics.revenue)}</div>
              <div className="w-full flex-1 flex items-end">
                <div
                  className="w-full rounded-t transition-all hover:opacity-80"
                  style={{
                    height: `${h}%`,
                    backgroundColor: fyColor(fy),
                    minHeight: "2px",
                  }}
                  title={`${r.period}: ${fmtNum(r.metrics.revenue)}`}
                />
              </div>
              <div className="text-[8px] font-mono text-[#64748B] whitespace-nowrap truncate w-full text-center">
                {r.period}
              </div>
            </div>
          );
        })}
      </div>
      {/* FY legend */}
      <div className="flex items-center gap-3 mt-3 text-[10px] text-[#94A3B8] flex-wrap">
        {fyList.map((fy) => (
          <span key={fy} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm inline-block" style={{ backgroundColor: fyColor(fy) }} />
            FY{fy}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---- EPS bars (SVG) + net margin line overlay (SVG)
function EpsMarginChart({ results }: { results: QuarterlyResult[] }) {
  const W = 800;
  const H = 240;
  const P = { top: 20, right: 40, bottom: 30, left: 40 };
  const innerW = W - P.left - P.right;
  const innerH = H - P.top - P.bottom;

  const maxAbsEps = Math.max(...results.map((r) => Math.abs(r.metrics.eps)), 0.01);
  const step = innerW / Math.max(1, results.length);
  const barW = step * 0.6;

  const margins = results.map((r) => r.metrics.netMargin);
  const mMin = Math.min(...margins);
  const mMax = Math.max(...margins);
  const mRange = mMax === mMin ? 1 : mMax - mMin;

  const yMargin = (m: number) => P.top + (1 - (m - mMin) / mRange) * innerH;
  const marginPath = margins
    .map((m, i) => `${i === 0 ? "M" : "L"} ${(P.left + step * i + step / 2).toFixed(1)} ${yMargin(m).toFixed(1)}`)
    .join(" ");

  const gridLines = Array.from({ length: 5 }, (_, i) => P.top + (i / 4) * innerH);
  const labelStep = Math.max(1, Math.ceil(results.length / 8));

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        {/* Grid */}
        {gridLines.map((y, i) => (
          <line
            key={i}
            x1={P.left}
            y1={y}
            x2={P.left + innerW}
            y2={y}
            stroke="#1E2536"
            strokeWidth="1"
            strokeDasharray="2 4"
          />
        ))}
        {/* EPS bars */}
        {results.map((r, i) => {
          const h = (Math.abs(r.metrics.eps) / maxAbsEps) * innerH;
          const x = P.left + step * i + (step - barW) / 2;
          const y = P.top + innerH - h;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                fill={r.metrics.eps >= 0 ? "#00E676" : "#FF5C5C"}
                opacity="0.85"
              />
              {i % labelStep === 0 && (
                <text
                  x={x + barW / 2}
                  y={H - 8}
                  fill="#64748B"
                  fontSize="9"
                  textAnchor="middle"
                  fontFamily="monospace"
                >
                  {r.period}
                </text>
              )}
            </g>
          );
        })}
        {/* Net margin overlay line */}
        <path d={marginPath} fill="none" stroke="#FBBF24" strokeWidth="2" />
        {margins.map((m, i) => (
          <circle
            key={i}
            cx={P.left + step * i + step / 2}
            cy={yMargin(m)}
            r="2.5"
            fill="#FBBF24"
          />
        ))}
      </svg>
      <div className="flex items-center gap-4 mt-3 text-[10px] text-[#94A3B8] flex-wrap justify-center">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm inline-block bg-[#00E676]" />
          EPS (PKR, positive)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm inline-block bg-[#FF5C5C]" />
          EPS (loss)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 inline-block" style={{ borderBottom: "2px solid #FBBF24" }} />
          Net margin (%)
        </span>
      </div>
    </div>
  );
}

// ---- YoY growth chart: revenue vs EPS bars (SVG, supports negative values)
function YoYGrowthChart({ results }: { results: QuarterlyResult[] }) {
  const items = results.filter(
    (r) => r.metrics.revenueYoYGrowth !== 0 || r.metrics.epsYoYGrowth !== 0
  );
  if (items.length === 0) {
    return <p className="text-xs text-[#64748B]">No YoY growth data available (need 4+ quarters).</p>;
  }

  const W = 800;
  const H = 240;
  const P = { top: 20, right: 30, bottom: 30, left: 40 };
  const innerW = W - P.left - P.right;
  const innerH = H - P.top - P.bottom;
  const zeroY = P.top + innerH / 2;

  const maxAbs = Math.max(
    ...items.flatMap((r) => [
      Math.abs(r.metrics.revenueYoYGrowth),
      Math.abs(r.metrics.epsYoYGrowth),
    ]),
    1
  );

  const step = innerW / Math.max(1, items.length);
  const barW = step * 0.3;
  const gap = step * 0.1;
  const labelStep = Math.max(1, Math.ceil(items.length / 8));

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        {/* Zero line */}
        <line
          x1={P.left}
          y1={zeroY}
          x2={P.left + innerW}
          y2={zeroY}
          stroke="#3A4256"
          strokeWidth="1"
        />
        {/* Grid */}
        {Array.from({ length: 5 }, (_, i) => P.top + (i / 4) * innerH).map((y, i) => (
          <line
            key={i}
            x1={P.left}
            y1={y}
            x2={P.left + innerW}
            y2={y}
            stroke="#1E2536"
            strokeWidth="1"
            strokeDasharray="2 4"
          />
        ))}
        {/* Bars */}
        {items.map((r, i) => {
          const cx = P.left + step * i + step / 2;
          const revH = (Math.abs(r.metrics.revenueYoYGrowth) / maxAbs) * (innerH / 2);
          const epsH = (Math.abs(r.metrics.epsYoYGrowth) / maxAbs) * (innerH / 2);
          const revY = r.metrics.revenueYoYGrowth >= 0 ? zeroY - revH : zeroY;
          const epsY = r.metrics.epsYoYGrowth >= 0 ? zeroY - epsH : zeroY;
          return (
            <g key={i}>
              <rect
                x={cx - barW - gap / 2}
                y={revY}
                width={barW}
                height={revH}
                fill={r.metrics.revenueYoYGrowth >= 0 ? "#00E676" : "#FF5C5C"}
                opacity="0.85"
              />
              <rect
                x={cx + gap / 2}
                y={epsY}
                width={barW}
                height={epsH}
                fill={r.metrics.epsYoYGrowth >= 0 ? "#FBBF24" : "#FF5C5C"}
                opacity="0.85"
              />
              {i % labelStep === 0 && (
                <text
                  x={cx}
                  y={H - 8}
                  fill="#64748B"
                  fontSize="9"
                  textAnchor="middle"
                  fontFamily="monospace"
                >
                  {r.period}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="flex items-center gap-4 mt-3 text-[10px] text-[#94A3B8] flex-wrap justify-center">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm inline-block bg-[#00E676]" />
          Revenue YoY
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm inline-block bg-[#FBBF24]" />
          EPS YoY
        </span>
        <span className="text-[#64748B]">Negative growth shown in red (below zero line).</span>
      </div>
    </div>
  );
}
