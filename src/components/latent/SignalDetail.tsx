"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AppNav } from "./AppNav";
import { useLatentStore } from "@/lib/latent/store";
import { Signal } from "@/lib/latent/types";
import {
  ArrowLeft,
  Brain,
  BookOpen,
  Newspaper,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Loader2,
  Sparkles,
  Target,
  Eye,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

// LLM-enriched explanation type (matches /api/llm/explain-signal/[symbol] response)
interface LlmExplanation {
  summary: string;
  technicalLayman: string;
  fundamentalContext: string;
  newsContext: string;
  actionLayman: string;
  riskFactors: string[];
  watchLevels: { level: string; price: number; significance: string }[];
  confidenceInterpretation: string;
  symbol: string;
  direction: string;
  horizon: string;
  confidence: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  model: string;
  latencyMs: number;
  cached: boolean;
  cachedUntil: string;
}

export function SignalDetail() {
  const selectedSignalId = useLatentStore((s) => s.selectedSignalId);
  const selectedSymbol = useLatentStore((s) => s.selectedSymbol);
  const setView = useLatentStore((s) => s.setView);
  const userId = useLatentStore((s) => s.userId);

  const [signal, setSignal] = useState<Signal | null>(null);
  const [loading, setLoading] = useState(true);
  const [llmExplanation, setLlmExplanation] = useState<LlmExplanation | null>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);

  // Determine the source of the signal:
  // - If selectedSymbol is set (route from SignalSection "View in depth"), fetch XGBoost signal
  // - Else if selectedSignalId is set (legacy mock path), fetch by ID
  useEffect(() => {
    let cancelled = false;

    // Reset state
    setSignal(null);
    setLlmExplanation(null);
    setLlmError(null);
    setLoading(true);

    if (selectedSymbol) {
      // XGBoost-backed flow — fetch from /api/ml/signal/[symbol]
      fetch(`/api/ml/signal/${encodeURIComponent(selectedSymbol)}`)
        .then((r) => {
          if (!r.ok) throw new Error(`Failed to load signal: ${r.status}`);
          return r.json();
        })
        .then((d) => {
          if (cancelled) return;
          if (d.signal) {
            setSignal(d.signal);
            setLoading(false);
          } else {
            setLoading(false);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          console.error("Signal fetch error:", err);
          setLoading(false);
        });
    } else if (selectedSignalId) {
      // Legacy mock signal flow
      fetch(`/api/signals/${selectedSignalId}`)
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          setSignal(d.signal || null);
          setLoading(false);
        })
        .catch(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      // No selection — go back to signals list
      setView("signals_v2");
      setLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [selectedSignalId, selectedSymbol, setView]);

  // LLM enrichment — triggered on demand via "Generate with LLM" button
  const handleGenerateLlm = async () => {
    if (!selectedSymbol && !signal?.symbol) {
      toast.error("No symbol selected for LLM analysis");
      return;
    }
    const symbol = selectedSymbol || signal!.symbol;
    setLlmLoading(true);
    setLlmError(null);
    setLlmExplanation(null);
    try {
      const res = await fetch(`/api/llm/explain-signal/${encodeURIComponent(symbol)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || err.error || `LLM call failed (${res.status})`);
      }
      const data = await res.json();
      setLlmExplanation(data);
      toast.success(
        `LLM analysis generated in ${data.latencyMs}ms${data.cached ? " (cached)" : ""}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "LLM call failed";
      setLlmError(msg);
      toast.error(msg);
    } finally {
      setLlmLoading(false);
    }
  };


  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A0E1A]">
        <AppNav />
        <div className="max-w-4xl mx-auto p-6 space-y-4">
          <Skeleton className="h-10 w-32 bg-white/[0.04]" />
          <Skeleton className="h-32 w-full bg-white/[0.04]" />
          <Skeleton className="h-64 w-full bg-white/[0.04]" />
        </div>
      </div>
    );
  }

  if (!signal) {
    return (
      <div className="min-h-screen bg-[#0A0E1A]">
        <AppNav />
        <div className="max-w-4xl mx-auto p-6 text-center">
          <p className="text-sm text-[#94A3B8]">Signal not found.</p>
          <Button onClick={() => setView("signals_v2")} className="mt-4">
            Back to signals
          </Button>
        </div>
      </div>
    );
  }

  const upside = ((signal.targetPrice - signal.entryPrice) / signal.entryPrice) * 100;
  const downside = ((signal.entryPrice - signal.stopLoss) / signal.entryPrice) * 100;
  const riskReward = upside / Math.abs(downside);

  const impactColor = (i: string) =>
    i === "positive" ? "text-[#00E676]" : i === "negative" ? "text-[#FF5C5C]" : "text-[#94A3B8]";

  const impactIcon = (i: string) =>
    i === "positive" ? <TrendingUp className="h-3 w-3" /> : i === "negative" ? <TrendingDown className="h-3 w-3" /> : null;

  const handleExecute = () => {
    if (!userId) {
      toast.info("Demo mode — execute flow shows the simulated broker experience.");
    }
    setView("execute");
  };

  return (
    <div className="min-h-screen bg-[#0A0E1A]">
      <AppNav />

      <main className="max-w-4xl mx-auto px-4 md:px-6 py-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setView("signals_v2")}
          className="text-[#94A3B8] hover:text-[#F4F7FB] mb-4 -ml-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to signals
        </Button>

        {/* Header */}
        <Card className="bg-[#131829] border-white/[0.08] mb-4">
          <CardContent className="p-5">
            <div className="flex items-start gap-4 mb-4">
              <div className="h-14 w-14 rounded-lg bg-[#00E676]/10 flex items-center justify-center font-mono font-bold text-[#00E676] text-lg">
                {signal.symbol.slice(0, 4)}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold text-[#F4F7FB]">{signal.symbol}</h1>
                  <Badge variant="outline" className="border-[#00E676]/40 text-[#00E676] text-[10px]">
                    {signal.horizon}
                  </Badge>
                  <Badge variant="outline" className="border-white/[0.12] text-[#94A3B8] text-[10px]">
                    {signal.direction}
                  </Badge>
                  {signal.status === "TRIGGERED" && (
                    <Badge variant="outline" className="border-amber-500/40 text-amber-400 text-[10px]">
                      ENTRY CLOSED
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-[#94A3B8] mt-1">{signal.stockName}</p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-[#00E676] font-mono">+{upside.toFixed(1)}%</div>
                <div className="text-[10px] text-[#64748B] uppercase">To target</div>
              </div>
            </div>

            {/* Trade parameters */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3">
                <div className="text-[10px] uppercase text-[#64748B] mb-0.5">Entry price</div>
                <div className="text-lg font-mono font-bold text-[#F4F7FB]">{signal.entryPrice}</div>
              </div>
              <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3">
                <div className="text-[10px] uppercase text-[#64748B] mb-0.5">Target</div>
                <div className="text-lg font-mono font-bold text-[#00E676]">{signal.targetPrice}</div>
              </div>
              <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3">
                <div className="text-[10px] uppercase text-[#64748B] mb-0.5">Stop-loss</div>
                <div className="text-lg font-mono font-bold text-[#FF5C5C]">{signal.stopLoss}</div>
              </div>
              <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3">
                <div className="text-[10px] uppercase text-[#64748B] mb-0.5">Risk/reward</div>
                <div className="text-lg font-mono font-bold text-[#F4F7FB]">{riskReward.toFixed(1)}:1</div>
              </div>
            </div>

            {/* Confidence + Action button */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="text-xs text-[#94A3B8]">
                  Confidence: <span className="text-[#00E676] font-mono font-bold">{signal.confidenceScore}/100</span>
                </div>
                <div className="text-xs text-[#94A3B8]">
                  Setup score: <span className="text-[#F4F7FB] font-mono">{signal.setupScore}</span>
                </div>
              </div>
              <Button
                onClick={handleExecute}
                disabled={signal.status === "TRIGGERED"}
                className={`font-semibold ${
                  signal.status === "TRIGGERED"
                    ? "bg-white/[0.05] text-[#64748B] cursor-not-allowed"
                    : "bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881]"
                }`}
              >
                {signal.status === "TRIGGERED" ? "Entry closed" : "Execute this trade"}
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Summary card */}
        <Card className="bg-gradient-to-br from-[#00E676]/[0.07] to-[#131829] border-[#00E676]/20 mb-4">
          <CardContent className="p-5">
            <div className="text-[10px] uppercase tracking-wider text-[#00E676] mb-2 font-semibold">
              The signal in one paragraph
            </div>
            <p className="text-sm text-[#F4F7FB] leading-relaxed">{signal.explanation.summary}</p>
          </CardContent>
        </Card>

        {/* Technical analysis (layman) */}
        <Card className="bg-[#131829] border-white/[0.08] mb-4">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-md bg-[#00E676]/10 flex items-center justify-center">
                <Brain className="h-3.5 w-3.5 text-[#00E676]" />
              </div>
              <CardTitle className="text-base text-[#F4F7FB]">Technical analysis in plain words</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-[#94A3B8] leading-relaxed mb-4">
              {signal.explanation.technicalLayman}
            </p>
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold mb-1">
                Term glossary
              </div>
              {signal.explanation.technicalTerms.map((t) => (
                <div key={t.term} className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-[#00E676]">{t.term}</span>
                    <span className="text-xs text-[#94A3B8] font-mono">{t.current}</span>
                  </div>
                  <div className="text-xs text-[#94A3B8] mb-1.5">{t.meaning}</div>
                  <div className="text-[11px] text-[#64748B] italic">
                    <span className="text-[#94A3B8]">Impact:</span> {t.impact}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Fundamental analysis (layman) */}
        <Card className="bg-[#131829] border-white/[0.08] mb-4">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-md bg-[#00E676]/10 flex items-center justify-center">
                <BookOpen className="h-3.5 w-3.5 text-[#00E676]" />
              </div>
              <CardTitle className="text-base text-[#F4F7FB]">Fundamentals in plain words</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-[#94A3B8] leading-relaxed mb-4">
              {signal.explanation.fundamentalLayman}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {signal.explanation.fundamentalFactors.map((f) => (
                <div
                  key={f.label}
                  className="flex items-center justify-between rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3"
                >
                  <span className="text-xs text-[#94A3B8]">{f.label}</span>
                  <div className={`flex items-center gap-1.5 ${impactColor(f.impact)}`}>
                    {impactIcon(f.impact)}
                    <span className="text-xs font-mono font-semibold">{f.value}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* News impact */}
        <Card className="bg-[#131829] border-white/[0.08] mb-4">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-md bg-[#00E676]/10 flex items-center justify-center">
                  <Newspaper className="h-3.5 w-3.5 text-[#00E676]" />
                </div>
                <CardTitle className="text-base text-[#F4F7FB]">News & its impact</CardTitle>
              </div>
              <Button size="sm" variant="outline" onClick={() => { setView("fundamental_news"); }}
                className="border-[#00E676]/30 text-[#00E676] text-[10px]">
                View All News →
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-[#94A3B8] leading-relaxed mb-4">
              {signal.explanation.newsLayman}
            </p>
            <div className="space-y-2">
              {signal.explanation.newsItems.slice(0, 5).map((n, i) => (
                <div key={i} className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3">
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className="text-sm font-medium text-[#F4F7FB]">{n.headline}</span>
                    <div className={`flex items-center gap-1 ${impactColor(n.impact)} flex-shrink-0`}>
                      {impactIcon(n.impact)}
                      <span className="text-[10px] uppercase font-semibold">{n.impact}</span>
                    </div>
                  </div>
                  <div className="text-[11px] text-[#64748B] flex items-center gap-2">
                    <span className="font-mono">{n.source}</span>
                    <span>·</span>
                    <span>Affects: {n.affectedStocks.join(", ")}</span>
                  </div>
                </div>
              ))}
            </div>
            {signal.explanation.newsItems.length > 5 && (
              <div className="mt-3 text-center">
                <Button size="sm" variant="ghost" onClick={() => setView("fundamental_news")}
                  className="text-[#00E676] text-xs">
                  + {signal.explanation.newsItems.length - 5} more news — View All →
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action plan */}
        <Card className="bg-[#131829] border-[#00E676]/30 mb-4">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-md bg-[#00E676]/10 flex items-center justify-center">
                <CheckCircle2 className="h-3.5 w-3.5 text-[#00E676]" />
              </div>
              <CardTitle className="text-base text-[#F4F7FB]">Your action</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-[#F4F7FB] leading-relaxed mb-4 font-medium">
              {signal.explanation.actionLayman}
            </p>
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold mb-1">
                Risk factors to know
              </div>
              {signal.explanation.riskFactors.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-[#94A3B8]">
                  <AlertTriangle className="h-3 w-3 text-amber-400 flex-shrink-0 mt-0.5" />
                  <span>{r}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* LLM-enriched analysis panel */}
        <Card className="bg-gradient-to-br from-[#00E676]/[0.07] to-[#131829] border-[#00E676]/20 mb-4">
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-md bg-[#00E676]/15 flex items-center justify-center">
                  <Sparkles className="h-3.5 w-3.5 text-[#00E676]" />
                </div>
                <CardTitle className="text-base text-[#F4F7FB]">
                  LLM-Enriched Analysis
                </CardTitle>
                <Badge variant="outline" className="text-[9px] py-0 h-4 border-[#00E676]/40 text-[#00E676]">
                  GLM-4
                </Badge>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleGenerateLlm}
                disabled={llmLoading}
                className="border-[#00E676]/40 text-[#00E676] hover:bg-[#00E676]/10 h-7"
              >
                {llmLoading ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                    Generating...
                  </>
                ) : llmExplanation ? (
                  <>
                    <RefreshCw className="h-3 w-3 mr-1.5" />
                    Regenerate
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3 w-3 mr-1.5" />
                    Generate with LLM
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-[#94A3B8] mt-1">
              GLM-4 takes the XGBoost model output above and explains it in richer plain language.
              Cached for 1 hour per symbol.
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            {llmError && (
              <div className="rounded-md bg-[#FF5C5C]/[0.07] border border-[#FF5C5C]/20 p-3 text-xs text-[#FF5C5C]">
                <span className="font-semibold">LLM error:</span> {llmError}
              </div>
            )}

            {llmLoading && !llmExplanation && (
              <div className="space-y-3">
                <Skeleton className="h-4 w-3/4 bg-white/[0.04]" />
                <Skeleton className="h-4 w-full bg-white/[0.04]" />
                <Skeleton className="h-4 w-5/6 bg-white/[0.04]" />
                <p className="text-xs text-[#64748B] flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  GLM-4 analyzing technical + fundamental readings...
                </p>
              </div>
            )}

            {llmExplanation && (
              <div className="space-y-4">
                {/* Meta */}
                <div className="flex items-center justify-between flex-wrap gap-2 text-[10px] font-mono text-[#64748B]">
                  <div className="flex items-center gap-3">
                    <span>{llmExplanation.model}</span>
                    <span>·</span>
                    <span>{llmExplanation.latencyMs}ms</span>
                    {llmExplanation.cached && (
                      <>
                        <span>·</span>
                        <span className="text-[#00E676]">cached</span>
                      </>
                    )}
                  </div>
                  <span>Cached until {new Date(llmExplanation.cachedUntil).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}</span>
                </div>

                {/* Summary */}
                <div className="rounded-md bg-[#0A0E1A] border border-[#00E676]/15 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-[#00E676] font-semibold mb-1">
                    Summary
                  </div>
                  <p className="text-sm text-[#F4F7FB] leading-relaxed">{llmExplanation.summary}</p>
                </div>

                {/* Technical layman */}
                <div className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Brain className="h-3 w-3 text-[#00E676]" />
                    <span className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold">
                      Technicals in plain words
                    </span>
                  </div>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">{llmExplanation.technicalLayman}</p>
                </div>

                {/* Fundamental context */}
                <div className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <BookOpen className="h-3 w-3 text-[#00E676]" />
                    <span className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold">
                      Fundamental context
                    </span>
                  </div>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">{llmExplanation.fundamentalContext}</p>
                </div>

                {/* News context */}
                {llmExplanation.newsContext && (
                  <div className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Newspaper className="h-3 w-3 text-[#00E676]" />
                      <span className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold">
                        News to watch
                      </span>
                    </div>
                    <p className="text-xs text-[#94A3B8] leading-relaxed">{llmExplanation.newsContext}</p>
                  </div>
                )}

                {/* Action plan */}
                <div className="rounded-md bg-[#00E676]/[0.07] border border-[#00E676]/20 p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <CheckCircle2 className="h-3 w-3 text-[#00E676]" />
                    <span className="text-[10px] uppercase tracking-wider text-[#00E676] font-semibold">
                      Action plan (plain English)
                    </span>
                  </div>
                  <p className="text-xs text-[#F4F7FB] leading-relaxed font-medium">{llmExplanation.actionLayman}</p>
                </div>

                {/* Confidence interpretation */}
                <div className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-3">
                  <div className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold mb-1">
                    What the confidence score means
                  </div>
                  <p className="text-xs text-[#94A3B8] leading-relaxed italic">{llmExplanation.confidenceInterpretation}</p>
                </div>

                {/* Watch levels */}
                {llmExplanation.watchLevels.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Eye className="h-3 w-3 text-[#00E676]" />
                      <span className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold">
                        Price levels to watch
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {llmExplanation.watchLevels.slice(0, 3).map((lvl, i) => (
                        <div key={i} className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-2.5">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-[10px] uppercase text-[#64748B]">{lvl.level}</span>
                            <Target className="h-3 w-3 text-[#00E676]" />
                          </div>
                          <div className="text-sm font-mono font-bold text-[#F4F7FB]">{lvl.price}</div>
                          <div className="text-[10px] text-[#94A3B8] mt-0.5">{lvl.significance}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* LLM-specific risk factors */}
                {llmExplanation.riskFactors.length > 0 && (
                  <div className="rounded-md bg-[#FF5C5C]/[0.05] border border-[#FF5C5C]/15 p-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <AlertTriangle className="h-3 w-3 text-[#FF5C5C]" />
                      <span className="text-[10px] uppercase tracking-wider text-[#FF5C5C] font-semibold">
                        Setup-specific risks (LLM)
                      </span>
                    </div>
                    <ul className="space-y-1">
                      {llmExplanation.riskFactors.map((r, i) => (
                        <li key={i} className="text-xs text-[#94A3B8] flex items-start gap-2">
                          <span className="text-[#FF5C5C]">•</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {!llmLoading && !llmExplanation && !llmError && (
              <div className="text-center py-6">
                <Sparkles className="h-8 w-8 text-[#00E676]/30 mx-auto mb-2" />
                <p className="text-xs text-[#94A3B8] mb-3">
                  Click <span className="text-[#00E676]">Generate with LLM</span> to get a
                  richer plain-English explanation of the signal above, including
                  fundamental context, watch levels, and setup-specific risks.
                </p>
                <p className="text-[10px] text-[#64748B]">
                  GLM-4 takes ~3 seconds. Cached for 1 hour per symbol.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Disclaimer */}
        <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3 text-[11px] text-[#64748B] leading-relaxed">
          <span className="text-[#94A3B8] font-semibold">Disclaimer:</span> This signal is
          generated by Latent.pk&apos;s predictive algorithm and is for informational purposes
          only. It is not licensed investment advice under SECP rules. Trading on the PSX carries
          risk — past performance does not guarantee future returns. Always do your own research
          and consult a licensed advisor before making investment decisions.
        </div>
      </main>
    </div>
  );
}
