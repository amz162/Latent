"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Sparkles, RefreshCw, Brain, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";

interface QuarterData {
  period: string;
  revenue: number;
  eps: number;
  profitMargin: number;
  yoyGrowth: number | null;
  qoqGrowth: number | null;
}

interface PatternData {
  patternLabel: string;
  patternScore: number;
  trendSlope: number;
  coefficientOfVariation: number;
  avgYoYGrowth: number | null;
  avgQoQGrowth: number | null;
  totalRevenueGrowth: number | null;
  bestQuarter: QuarterData | null;
  worstQuarter: QuarterData | null;
  quarterlySeasonality: { quarter: string; avgGrowth: number }[];
}

interface LlmAnalysis {
  laymanSummary: string;
  quarterByQuarterAnalysis: {
    period: string;
    whatHappened: string;
    whyItMatters: string;
    impactOnStock: "positive" | "negative" | "neutral";
  }[];
  bestQuarterExplanation: string;
  worstQuarterExplanation: string;
  seasonalityInsight: string;
  forwardLookingConcern: string;
}

interface PatternRecognitionResponse {
  symbol: string;
  stockName: string;
  quarters: QuarterData[];
  pattern: PatternData;
  summary: string;
  llm: LlmAnalysis;
  cached: boolean;
  latencyMs: number;
}

export function PatternRecognitionPanel({ symbol }: { symbol: string }) {
  const [data, setData] = useState<PatternRecognitionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pattern-recognition/${encodeURIComponent(symbol)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed (${res.status})`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pattern recognition");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [symbol]);

  if (loading) {
    return (
      <Card className="bg-[#131829] border-white/[0.08] mb-4">
        <CardHeader>
          <CardTitle className="text-base text-[#F4F7FB] flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#00E676]" />
            Pattern Recognition (Quarterly Results Analysis)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-4 w-3/4 bg-white/[0.04] mb-2" />
          <Skeleton className="h-4 w-full bg-white/[0.04] mb-2" />
          <Skeleton className="h-4 w-5/6 bg-white/[0.04] mb-3" />
          <Skeleton className="h-48 w-full bg-white/[0.04]" />
          <p className="text-xs text-[#64748B] mt-2 flex items-center gap-1.5">
            <Brain className="h-3 w-3 animate-pulse text-[#00E676]" />
            Fetching 5-year financials from AskAnalyst + GLM-4 analyzing patterns...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-[#131829] border-[#FF5C5C]/20 mb-4">
        <CardContent className="p-4">
          <div className="text-xs text-[#FF5C5C] mb-2">Pattern recognition failed: {error}</div>
          <Button size="sm" variant="outline" onClick={load} className="border-white/[0.12] text-[#94A3B8]">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const pattern = data.pattern;
  const llm = data.llm;

  // Pattern score color
  const scoreColor = pattern.patternScore >= 75 ? "text-[#00E676]" : pattern.patternScore >= 50 ? "text-[#FBBF24]" : "text-[#94A3B8]";

  // Chart data
  const chartData = data.quarters.map((q) => ({
    period: q.period,
    revenue: q.revenue,
    eps: q.eps,
    margin: q.profitMargin,
    yoyGrowth: q.yoyGrowth ?? 0,
  }));

  return (
    <Card className="bg-[#131829] border-white/[0.08] mb-4">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base text-[#F4F7FB] flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#00E676]" />
            Pattern Recognition (Quarterly Results Analysis)
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={`text-[10px] py-0 h-5 ${scoreColor} border-current`}>
              {pattern.patternLabel} · {pattern.patternScore}/100
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              onClick={load}
              className="text-[#64748B] hover:text-[#F4F7FB] h-7 w-7 p-0"
              title="Refresh"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <p className="text-xs text-[#94A3B8] mt-1">
          Analyzing {data.quarters.length} quarters of financials from AskAnalyst. Cached for 24 hours.
        </p>
      </CardHeader>
      <CardContent>
        {/* Pattern metrics strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          <Metric label="Avg YoY growth" value={pattern.avgYoYGrowth !== null ? `${pattern.avgYoYGrowth.toFixed(1)}%` : "n/a"} tone={pattern.avgYoYGrowth && pattern.avgYoYGrowth > 0 ? "positive" : "negative"} />
          <Metric label="EPS volatility" value={`${(pattern.coefficientOfVariation * 100).toFixed(1)}%`} tone={pattern.coefficientOfVariation < 0.4 ? "positive" : "warning"} />
          <Metric label="Revenue growth (total)" value={pattern.totalRevenueGrowth !== null ? `${pattern.totalRevenueGrowth.toFixed(1)}%` : "n/a"} tone={pattern.totalRevenueGrowth && pattern.totalRevenueGrowth > 0 ? "positive" : "negative"} />
          <Metric label="Trend slope" value={`${pattern.trendSlope.toFixed(2)} PKR/q`} tone={pattern.trendSlope > 0 ? "positive" : "negative"} />
        </div>

        {/* Layman summary */}
        <div className="rounded-md bg-[#0A0E1A] border border-[#00E676]/15 p-3 mb-4">
          <div className="text-[10px] uppercase tracking-wider text-[#00E676] font-semibold mb-1">
            Pattern summary (in plain words)
          </div>
          <p className="text-sm text-[#F4F7FB] leading-relaxed">{llm.laymanSummary || data.summary}</p>
        </div>

        {/* Chart */}
        {chartData.length > 1 && (
          <div className="mb-4">
            <div className="text-[10px] uppercase tracking-wider text-[#64748B] mb-2">
              Quarterly Revenue + EPS + YoY Growth
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 5, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis
                    dataKey="period"
                    stroke="#64748B"
                    tick={{ fontSize: 9, fill: "#64748B" }}
                    tickLine={false}
                    axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
                  />
                  <YAxis
                    yAxisId="left"
                    orientation="left"
                    stroke="#64748B"
                    tick={{ fontSize: 9, fill: "#64748B" }}
                    tickLine={false}
                    axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    stroke="#64748B"
                    tick={{ fontSize: 9, fill: "#64748B" }}
                    tickLine={false}
                    axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#131829",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: "8px",
                      fontSize: "11px",
                    }}
                    labelStyle={{ color: "#94A3B8" }}
                  />
                  <Bar
                    yAxisId="left"
                    dataKey="revenue"
                    fill="rgba(0,230,118,0.4)"
                    name="Revenue"
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="eps"
                    stroke="#00E676"
                    strokeWidth={2}
                    dot={false}
                    name="EPS"
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="yoyGrowth"
                    stroke="#FBBF24"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    dot={false}
                    name="YoY Growth %"
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-4 mt-2 text-[10px] text-[#64748B]">
              <span className="flex items-center gap-1">
                <span className="h-1.5 w-3 bg-[#00E676]/40 inline-block" /> Revenue
              </span>
              <span className="flex items-center gap-1">
                <span className="h-0.5 w-3 bg-[#00E676] inline-block" /> EPS
              </span>
              <span className="flex items-center gap-1">
                <span className="h-0.5 w-3 bg-[#FBBF24] inline-block" style={{ borderTop: "1px dashed" }} /> YoY growth %
              </span>
            </div>
          </div>
        )}

        {/* Best + worst quarter */}
        <div className="grid md:grid-cols-2 gap-3 mb-4">
          {pattern.bestQuarter && (
            <div className="rounded-md bg-[#00E676]/[0.05] border border-[#00E676]/20 p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <TrendingUp className="h-3 w-3 text-[#00E676]" />
                <span className="text-[10px] uppercase text-[#00E676] font-semibold">Best quarter</span>
              </div>
              <div className="text-sm font-mono text-[#F4F7FB]">
                {pattern.bestQuarter.period}: {pattern.bestQuarter.yoyGrowth?.toFixed(1)}% YoY
              </div>
              {llm.bestQuarterExplanation && (
                <p className="text-[11px] text-[#94A3B8] mt-1 leading-relaxed">{llm.bestQuarterExplanation}</p>
              )}
            </div>
          )}
          {pattern.worstQuarter && (
            <div className="rounded-md bg-[#FF5C5C]/[0.05] border border-[#FF5C5C]/20 p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <TrendingDown className="h-3 w-3 text-[#FF5C5C]" />
                <span className="text-[10px] uppercase text-[#FF5C5C] font-semibold">Worst quarter</span>
              </div>
              <div className="text-sm font-mono text-[#F4F7FB]">
                {pattern.worstQuarter.period}: {pattern.worstQuarter.yoyGrowth?.toFixed(1)}% YoY
              </div>
              {llm.worstQuarterExplanation && (
                <p className="text-[11px] text-[#94A3B8] mt-1 leading-relaxed">{llm.worstQuarterExplanation}</p>
              )}
            </div>
          )}
        </div>

        {/* Seasonality */}
        {pattern.quarterlySeasonality.length > 0 && llm.seasonalityInsight && (
          <div className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-3 mb-4">
            <div className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold mb-1">
              Seasonality insight
            </div>
            <p className="text-xs text-[#94A3B8] leading-relaxed">{llm.seasonalityInsight}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {pattern.quarterlySeasonality.map((s, i) => (
                <Badge key={i} variant="outline" className={`text-[10px] py-0 h-4 ${
                  s.avgGrowth > 10 ? "border-[#00E676]/40 text-[#00E676]" :
                  s.avgGrowth < 0 ? "border-[#FF5C5C]/40 text-[#FF5C5C]" :
                  "border-white/[0.12] text-[#94A3B8]"
                }`}>
                  {s.quarter} avg: {s.avgGrowth.toFixed(1)}%
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Quarter-by-quarter LLM analysis */}
        {llm.quarterByQuarterAnalysis.length > 0 && (
          <div className="mb-3">
            <div className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold mb-2">
              Quarter-by-quarter analysis
            </div>
            <div className="space-y-2">
              {llm.quarterByQuarterAnalysis.map((q, i) => (
                <div key={i} className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-2.5">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-xs font-semibold text-[#F4F7FB]">{q.period}</span>
                    <Badge variant="outline" className={`text-[9px] py-0 h-4 ${
                      q.impactOnStock === "positive" ? "border-[#00E676]/40 text-[#00E676]" :
                      q.impactOnStock === "negative" ? "border-[#FF5C5C]/40 text-[#FF5C5C]" :
                      "border-white/[0.12] text-[#94A3B8]"
                    }`}>
                      {q.impactOnStock}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-[#94A3B8] leading-relaxed mb-0.5">{q.whatHappened}</p>
                  <p className="text-[11px] text-[#64748B] italic">{q.whyItMatters}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Forward-looking concern */}
        {llm.forwardLookingConcern && (
          <div className="rounded-md bg-[#FBBF24]/[0.05] border border-[#FBBF24]/20 p-3">
            <div className="text-[10px] uppercase tracking-wider text-[#FBBF24] font-semibold mb-1">
              What to watch for next
            </div>
            <p className="text-xs text-[#94A3B8] leading-relaxed">{llm.forwardLookingConcern}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" | "warning" }) {
  const color = tone === "positive" ? "text-[#00E676]" : tone === "negative" ? "text-[#FF5C5C]" : tone === "warning" ? "text-[#FBBF24]" : "text-[#F4F7FB]";
  return (
    <div className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-2">
      <div className="text-[10px] uppercase text-[#64748B]">{label}</div>
      <div className={`text-sm font-mono font-bold ${color}`}>{value}</div>
    </div>
  );
}
