"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AppNav } from "./AppNav";
import { useLatentStore } from "@/lib/latent/store";
import {
  Newspaper,
  Building2,
  FileText,
  Link2,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowRight,
  RefreshCw,
  Globe,
  Loader2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

interface NewsItem {
  title: string;
  link: string;
  source: string;
  publishedAt: string | null;
  summary: string;
  category: "national" | "international" | "market" | "company";
}

interface Announcement {
  id: string;
  company: string;
  symbol: string;
  title: string;
  type: "news" | "result" | "dividend" | "agm" | "other";
  pdfLink: string | null;
  link: string;
  publishedAt: string | null;
  summary: string;
}

// LLM interpretation result shape (mirrors /api/llm/interpret-news response)
interface InterpretResult {
  impact: "positive" | "negative" | "neutral";
  impactStrength: "weak" | "moderate" | "strong";
  affectedStocks: string[];
  sectorBreakdown: { sector: string; stocks: string[] }[];
  laymanExplanation: string;
  shortTermOutlook: string;
  riskFactors: string[];
  model: string;
  latencyMs: number;
  cached?: boolean;
}

export function FundamentalNews() {
  const [tab, setTab] = useState("general");
  const [news, setNews] = useState<NewsItem[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [interpretUrl, setInterpretUrl] = useState("");
  const [interpretHeadline, setInterpretHeadline] = useState("");
  const [interpretSummary, setInterpretSummary] = useState("");
  const [interpretResult, setInterpretResult] = useState<InterpretResult | null>(null);
  const [interpreting, setInterpreting] = useState(false);

  const selectSignal = useLatentStore((s) => s.selectSignal);
  const pushNotification = useLatentStore((s) => s.pushNotification);
  const setView = useLatentStore((s) => s.setView);

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/scrape/news").then((r) => r.json()).catch(() => ({ news: [] })),
      fetch("/api/scrape/announcements").then((r) => r.json()).catch(() => ({ announcements: [] })),
    ])
      .then(([n, a]) => {
        setNews(n.news || []);
        setAnnouncements(a.announcements || []);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const companyNews = announcements.filter((a) => a.type === "news");
  const companyResults = announcements.filter((a) => a.type === "result");

  const handleInterpret = async () => {
    if (!interpretUrl.trim() && !interpretHeadline.trim()) {
      toast.error("Paste a news URL or headline first");
      return;
    }
    setInterpreting(true);
    setInterpretResult(null);
    try {
      const res = await fetch("/api/llm/interpret-news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headline: interpretHeadline || undefined,
          summary: interpretSummary || undefined,
          link: interpretUrl || undefined,
        }),
      });
      // Non-2xx: try to surface the structured error from the backend
      if (!res.ok) {
        let errMsg = `LLM call failed (${res.status})`;
        try {
          const err = await res.json();
          // Backend returns { error, detail } — prefer detail, then error
          errMsg = err.detail || err.error || errMsg;
        } catch {
          // Response wasn't JSON (e.g., proxy 502). Surface the status text.
          errMsg = `${res.status} ${res.statusText}`.trim() || errMsg;
        }
        throw new Error(errMsg);
      }
      const data = await res.json();
      setInterpretResult(data);
      pushNotification({
        type: "news",
        title: "News interpreted by LLM",
        body: `${data.impact} impact · ${data.affectedStocks?.length || 0} stocks affected · ${data.latencyMs}ms`,
        linkView: "fundamental_news",
      });
    } catch (err) {
      // Network error (fetch threw) vs. server error (thrown above)
      const msg =
        err instanceof TypeError
          ? "Could not reach the LLM service. Check your connection and try again."
          : err instanceof Error
            ? err.message
            : "Interpretation failed";
      toast.error(msg);
    } finally {
      setInterpreting(false);
    }
  };

  const impactColor = (i: string) =>
    i === "positive" ? "text-[#00E676]" : i === "negative" ? "text-[#FF5C5C]" : "text-[#94A3B8]";
  const ImpactIcon = ({ i }: { i: string }) =>
    i === "positive" ? <TrendingUp className="h-3 w-3" /> : i === "negative" ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />;

  return (
    <div className="min-h-screen bg-[#0A0E1A]">
      <AppNav />
      <main className="px-4 md:px-6 py-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#F4F7FB]">Fundamental News</h1>
            <p className="text-sm text-[#94A3B8] mt-1">
              International + national news, company announcements & results — each interpreted in layman terms with stock-impact analysis.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
            className="border-white/[0.12] text-[#94A3B8]"
          >
            <RefreshCw className={`h-3 w-3 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* News link interpreter */}
        <Card className="bg-[#131829] border-[#00E676]/20 mb-4">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-8 w-8 rounded-md bg-[#00E676]/10 flex items-center justify-center">
                <Link2 className="h-4 w-4 text-[#00E676]" />
              </div>
              <div>
                <h3 className="font-semibold text-[#F4F7FB]">Interpret a news link</h3>
                <p className="text-xs text-[#94A3B8]">Paste any news article URL to get an AI interpretation of its stock impact</p>
              </div>
            </div>
            <div className="space-y-2">
              <Input
                value={interpretUrl}
                onChange={(e) => setInterpretUrl(e.target.value)}
                placeholder="Paste news article URL: https://www.dawn.com/news/..."
                className="bg-[#0A0E1A] border-white/[0.12] text-[#F4F7FB] font-mono text-sm"
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Input
                  value={interpretHeadline}
                  onChange={(e) => setInterpretHeadline(e.target.value)}
                  placeholder="...or paste just the headline (optional)"
                  className="bg-[#0A0E1A] border-white/[0.12] text-[#F4F7FB] text-sm h-9"
                />
                <Input
                  value={interpretSummary}
                  onChange={(e) => setInterpretSummary(e.target.value)}
                  placeholder="Summary text (optional)"
                  className="bg-[#0A0E1A] border-white/[0.12] text-[#F4F7FB] text-sm h-9"
                />
              </div>
              <p className="text-[11px] text-[#64748B]">
                Powered by GLM-4 (Z.ai open-weights model) — not ChatGPT or Claude. To swap to a self-hosted LLM in production (Ollama + Llama 3.2), see the comment in <code className="text-[#94A3B8]">/api/llm/interpret-news/route.ts</code>.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <Button
                  onClick={handleInterpret}
                  disabled={interpreting || (!interpretUrl.trim() && !interpretHeadline.trim())}
                  className="bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold"
                >
                  {interpreting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      Analyzing with GLM-4...
                    </>
                  ) : (
                    <>
                      Interpret with LLM
                      <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                    </>
                  )}
                </Button>
              </div>
            </div>
            {interpretResult && (
              <div className="mt-4 rounded-lg bg-[#0A0E1A] border border-[#00E676]/20 p-4 space-y-3">
                {/* Impact header */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <div className={`flex items-center gap-1.5 ${impactColor(interpretResult.impact)} capitalize font-semibold text-sm`}>
                      <ImpactIcon i={interpretResult.impact} />
                      {interpretResult.impact} impact
                    </div>
                    <Badge variant="outline" className={`text-[9px] h-4 uppercase ${
                      interpretResult.impactStrength === "strong" ? "border-[#FF5C5C]/40 text-[#FF5C5C]" :
                      interpretResult.impactStrength === "moderate" ? "border-amber-400/40 text-amber-400" :
                      "border-white/[0.12] text-[#94A3B8]"
                    }`}>
                      {interpretResult.impactStrength}
                    </Badge>
                  </div>
                  <span className="text-[10px] text-[#64748B] font-mono">
                    {interpretResult.model} · {interpretResult.latencyMs}ms
                  </span>
                </div>

                {/* Layman explanation */}
                <div className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-3">
                  <div className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold mb-1">
                    Why this matters (in plain words)
                  </div>
                  <p className="text-xs text-[#F4F7FB] leading-relaxed">{interpretResult.laymanExplanation}</p>
                </div>

                {/* Short-term outlook */}
                <div className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-3">
                  <div className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold mb-1">
                    Short-term outlook
                  </div>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">{interpretResult.shortTermOutlook}</p>
                </div>

                {/* Affected stocks + sectors */}
                {interpretResult.affectedStocks.length > 0 && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold mb-1.5">
                      Affected stocks ({interpretResult.affectedStocks.length})
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap mb-3">
                      {interpretResult.affectedStocks.map((s) => (
                        <button
                          key={s}
                          onClick={() => {
                            setView("signals_v2");
                            toast.info(`Looking up signal for ${s}...`);
                          }}
                          className="text-[10px] font-mono text-[#00E676] hover:underline border border-[#00E676]/40 rounded px-2 py-0.5"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                    {interpretResult.sectorBreakdown && interpretResult.sectorBreakdown.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10px] uppercase tracking-wider text-[#64748B]">
                          By sector
                        </div>
                        {interpretResult.sectorBreakdown.map((sb) => (
                          <div key={sb.sector} className="text-xs">
                            <span className="text-[#94A3B8]">{sb.sector}:</span>{" "}
                            <span className="font-mono text-[#F4F7FB]">{sb.stocks.join(", ")}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Risk factors */}
                {interpretResult.riskFactors && interpretResult.riskFactors.length > 0 && (
                  <div className="rounded-md bg-[#FF5C5C]/[0.05] border border-[#FF5C5C]/15 p-3">
                    <div className="text-[10px] uppercase tracking-wider text-[#FF5C5C] font-semibold mb-1">
                      Risk factors
                    </div>
                    <ul className="text-xs text-[#94A3B8] leading-relaxed space-y-0.5">
                      {interpretResult.riskFactors.map((r, i) => (
                        <li key={i}>• {r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 3-tab sub-navigation */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="bg-[#131829] border border-white/[0.08] p-1 h-auto">
            <TabsTrigger value="general" className="data-[state=active]:bg-[#00E676]/10 data-[state=active]:text-[#00E676] text-[#94A3B8] text-xs">
              <Globe className="h-3 w-3 mr-1.5" /> International & National
            </TabsTrigger>
            <TabsTrigger value="company_news" className="data-[state=active]:bg-[#00E676]/10 data-[state=active]:text-[#00E676] text-[#94A3B8] text-xs">
              <Building2 className="h-3 w-3 mr-1.5" /> Company News
            </TabsTrigger>
            <TabsTrigger value="company_results" className="data-[state=active]:bg-[#00E676]/10 data-[state=active]:text-[#00E676] text-[#94A3B8] text-xs">
              <FileText className="h-3 w-3 mr-1.5" /> Company Results
            </TabsTrigger>
          </TabsList>

          {/* International & National News */}
          <TabsContent value="general" className="mt-4">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 bg-white/[0.04]" />)}
              </div>
            ) : news.length === 0 ? (
              <EmptyState message="No news items scraped. Try refreshing, or scraper upstream may be down." />
            ) : (
              <div className="space-y-3">
                {news.map((n) => {
                  return (
                    <Card key={n.link} className="bg-[#131829] border-white/[0.08] hover:border-white/[0.15] transition-colors">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1.5">
                              <Badge variant="outline" className={`text-[9px] py-0 h-4 uppercase ${
                                n.category === "international" ? "border-blue-400/40 text-blue-400" :
                                n.category === "national" ? "border-amber-400/40 text-amber-400" :
                                "border-white/[0.12] text-[#94A3B8]"
                              }`}>
                                {n.category}
                              </Badge>
                              {n.publishedAt && (
                                <span className="text-[10px] text-[#64748B] font-mono">{n.publishedAt}</span>
                              )}
                            </div>
                            <h3 className="font-semibold text-[#F4F7FB] text-sm leading-snug mb-1.5">
                              {n.title}
                            </h3>
                            {n.summary && (
                              <p className="text-xs text-[#94A3B8] leading-relaxed mb-2 line-clamp-2">
                                {n.summary}
                              </p>
                            )}
                            {/* AI Interpretation (on-demand LLM) */}
                            <AiInterpretationSection
                              title={n.title}
                              summary={n.summary}
                              link={n.link}
                              onOpenStock={(s) => {
                                setView("signals_v2");
                                toast.info(`Looking up signal for ${s}...`);
                              }}
                            />
                          </div>
                          <a
                            href={n.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#64748B] hover:text-[#F4F7FB] shrink-0"
                            title="Read full article"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Company News */}
          <TabsContent value="company_news" className="mt-4">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 bg-white/[0.04]" />)}
              </div>
            ) : companyNews.length === 0 ? (
              <EmptyState message="No company announcements scraped. Try refreshing." />
            ) : (
              <div className="space-y-3">
                {companyNews.map((a) => (
                  <AnnouncementCard key={a.id} announcement={a} onOpenSignal={(symbol) => {
                    setView("signals_v2");
                    toast.info(`Opening signal for ${symbol}...`);
                  }} />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Company Results */}
          <TabsContent value="company_results" className="mt-4">
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 bg-white/[0.04]" />)}
              </div>
            ) : companyResults.length === 0 ? (
              <EmptyState message="No company results scraped. Try refreshing." />
            ) : (
              <div className="space-y-3">
                {companyResults.map((a) => (
                  <ResultCard key={a.id} announcement={a} onOpenSignal={(symbol) => {
                    setView("signals_v2");
                    toast.info(`Opening signal for ${symbol}...`);
                  }} />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Disclaimer */}
        <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3 text-[11px] text-[#64748B] leading-relaxed mt-6">
          <span className="text-[#94A3B8] font-semibold">Scraper:</span> News + announcements scraped from investify.pk Mon–Fri 09:00–17:00 PKT. AI remarks are template-based in this MVP — will be replaced with RAG-grounded LLM call once your API key is configured.
        </div>
      </main>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-12">
      <Newspaper className="h-10 w-10 text-[#00E676]/30 mx-auto mb-3" />
      <p className="text-sm text-[#94A3B8]">{message}</p>
    </div>
  );
}

function AnnouncementCard({ announcement, onOpenSignal }: {
  announcement: Announcement;
  onOpenSignal: (symbol: string) => void;
}) {
  return (
    <Card className="bg-[#131829] border-white/[0.08] hover:border-white/[0.15] transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <Badge variant="outline" className="text-[9px] py-0 h-4 border-[#00E676]/40 text-[#00E676] font-mono">
                {announcement.symbol || "—"}
              </Badge>
              {announcement.publishedAt && (
                <span className="text-[10px] text-[#64748B] font-mono">{announcement.publishedAt}</span>
              )}
            </div>
            <h3 className="font-semibold text-[#F4F7FB] text-sm leading-snug mb-2">
              {announcement.title}
            </h3>
            {/* AI Interpretation (on-demand LLM) */}
            <AiInterpretationSection
              title={announcement.title}
              summary={announcement.summary}
              link={announcement.link}
              symbol={announcement.symbol || undefined}
              onOpenStock={onOpenSignal}
            />
            {announcement.symbol && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onOpenSignal(announcement.symbol)}
                className="text-[#00E676] hover:bg-[#00E676]/10 h-7 text-xs"
              >
                Open signal for {announcement.symbol}
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            )}
          </div>
          {announcement.pdfLink && (
            <a
              href={announcement.pdfLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#64748B] hover:text-[#F4F7FB] shrink-0 flex flex-col items-center gap-1"
              title="View PDF"
            >
              <FileText className="h-5 w-5" />
              <span className="text-[10px] font-mono">PDF</span>
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ResultCard({ announcement, onOpenSignal }: {
  announcement: Announcement;
  onOpenSignal: (symbol: string) => void;
}) {
  return (
    <Card className="bg-[#131829] border-white/[0.08] hover:border-white/[0.15] transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <Badge variant="outline" className="text-[9px] py-0 h-4 border-amber-400/40 text-amber-400 uppercase">
                Result
              </Badge>
              {announcement.symbol && (
                <Badge variant="outline" className="text-[9px] py-0 h-4 border-[#00E676]/40 text-[#00E676] font-mono">
                  {announcement.symbol}
                </Badge>
              )}
              {announcement.publishedAt && (
                <span className="text-[10px] text-[#64748B] font-mono">{announcement.publishedAt}</span>
              )}
            </div>
            <h3 className="font-semibold text-[#F4F7FB] text-sm leading-snug mb-2">
              {announcement.title}
            </h3>
            {/* Layman term glossary */}
            <div className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-2.5 mb-2">
              <div className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold mb-2">
                Result terms — what they mean
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                {[
                  { term: "EPS", meaning: "Earning Per Share. How much profit company made per share. Higher = better. EPS 17 means PKR 17 earned per share." },
                  { term: "Revenue", meaning: "Total sales/income from operations. Growth = good (company selling more). Decline = concern." },
                  { term: "Profit after tax", meaning: "Final profit after all expenses + taxes. The bottom line. Higher = healthier." },
                  { term: "Dividend per share", meaning: "Cash distribution to shareholders from profit. Steady/increasing = confidence signal." },
                ].map((t) => (
                  <div key={t.term} className="text-xs">
                    <span className="font-mono font-semibold text-[#00E676]">{t.term}</span>
                    <span className="text-[#94A3B8] ml-1.5">{t.meaning}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* AI Interpretation (on-demand LLM) */}
            <AiInterpretationSection
              title={announcement.title}
              summary={announcement.summary}
              link={announcement.link}
              symbol={announcement.symbol || undefined}
              onOpenStock={onOpenSignal}
            />
            {announcement.symbol && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onOpenSignal(announcement.symbol)}
                className="text-[#00E676] hover:bg-[#00E676]/10 h-7 text-xs mt-2"
              >
                Open signal for {announcement.symbol}
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            )}
          </div>
          {announcement.pdfLink && (
            <a
              href={announcement.pdfLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#64748B] hover:text-[#F4F7FB] shrink-0 flex flex-col items-center gap-1"
              title="View PDF"
            >
              <FileText className="h-5 w-5" />
              <span className="text-[10px] font-mono">PDF</span>
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function deriveAffectedStocks(title: string): string[] {
  const t = title.toLowerCase();
  if (/cement/.test(t)) return ["LUCK", "DGKC", "MLCF"];
  if (/fertilizer|urea|dap/.test(t)) return ["ENGRO", "FFBL", "FATIMA"];
  if (/bank| islamic/.test(t)) return ["MEBL", "BAFL", "MCB"];
  if (/oil|gas|energy|crude|petrol/.test(t)) return ["OGDC", "PPL", "PSO"];
  if (/power|electric/.test(t)) return ["HUBC", "KAPCO", "NPL"];
  if (/tech|software|it /.test(t)) return ["SYS", "AVN", "TRSM"];
  if (/imf|dollar|currency|exchange/.test(t)) return ["MEBL", "HUBC", "OGDC"];
  if (/rate|policy|sbp/.test(t)) return ["MEBL", "HUBC", "LUCK"];
  return [];
}

// AI Interpretation section — an inline, on-demand LLM interpretation for an
// auto-fetched news card. Renders a button when no interpretation has been
// loaded yet; once clicked, fetches /api/llm/interpret-news and displays:
//   • Layman explanation (1-2 sentences)
//   • Market sentiment badge (Bullish / Bearish / Neutral)
//   • Stock impact (which stocks are affected + direction)
//   • Short-term outlook + sector breakdown (when present)
//
// Props:
//   title    — news headline (always available on scraped cards)
//   summary  — scraped summary (optional)
//   link     — source URL (optional — passed to LLM for context)
//   symbol   — for company announcements, the ticker (so we can pre-seed the
//              "stocks impacted" list before the LLM call returns)
//   onOpenStock — click handler when a user taps an affected stock symbol
function AiInterpretationSection({
  title,
  summary,
  link,
  symbol,
  onOpenStock,
}: {
  title: string;
  summary?: string;
  link?: string;
  symbol?: string;
  onOpenStock: (symbol: string) => void;
}) {
  const [interpreting, setInterpreting] = useState(false);
  const [result, setResult] = useState<InterpretResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pre-LLM defaults: derived from the headline (keyword matching) + optional
  // company symbol. These show until the user clicks "Interpret with LLM".
  const defaultStocks = deriveAffectedStocks(title);
  const defaultAffectedStocks = symbol
    ? Array.from(new Set([symbol, ...defaultStocks]))
    : defaultStocks;

  const handleInterpret = async () => {
    setInterpreting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/llm/interpret-news", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headline: title,
          summary: summary || undefined,
          link: link || undefined,
        }),
      });
      if (!res.ok) {
        let errMsg = `LLM call failed (${res.status})`;
        try {
          const err = await res.json();
          errMsg = err.detail || err.error || errMsg;
        } catch {
          errMsg = `${res.status} ${res.statusText}`.trim() || errMsg;
        }
        throw new Error(errMsg);
      }
      const data: InterpretResult = await res.json();
      setResult(data);
    } catch (err) {
      const msg =
        err instanceof TypeError
          ? "Could not reach the LLM service. Try again."
          : err instanceof Error
            ? err.message
            : "Interpretation failed";
      setError(msg);
    } finally {
      setInterpreting(false);
    }
  };

  // impact → sentiment label + colors
  const sentimentLabel = (impact: string) =>
    impact === "positive" ? "Bullish" : impact === "negative" ? "Bearish" : "Neutral";
  const sentimentBadgeClass = (impact: string) =>
    impact === "positive"
      ? "border-[#00E676]/40 text-[#00E676]"
      : impact === "negative"
        ? "border-[#FF5C5C]/40 text-[#FF5C5C]"
        : "border-white/[0.12] text-[#94A3B8]";
  const impactColor = (i: string) =>
    i === "positive" ? "text-[#00E676]" : i === "negative" ? "text-[#FF5C5C]" : "text-[#94A3B8]";

  const affectedStocks = result?.affectedStocks ?? defaultAffectedStocks;
  const impact = result?.impact ?? "neutral";

  return (
    <div className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-2.5 mt-2">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-[#00E676]" />
          <span className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold">
            AI Interpretation
          </span>
        </div>
        {result && (
          <Badge
            variant="outline"
            className={`text-[9px] py-0 h-4 uppercase ${sentimentBadgeClass(result.impact)}`}
          >
            {sentimentLabel(result.impact)}
          </Badge>
        )}
      </div>

      {/* Idle state: show CTA button + hint */}
      {!result && !interpreting && !error && (
        <>
          <p className="text-[11px] text-[#64748B] mb-2 leading-relaxed">
            Get a plain-English interpretation of this news: what it means in
            simple language, market sentiment, and which stocks are affected.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={handleInterpret}
            className="border-[#00E676]/40 text-[#00E676] hover:bg-[#00E676]/10 h-7 text-xs"
          >
            <Sparkles className="h-3 w-3 mr-1.5" />
            Interpret with LLM
          </Button>
        </>
      )}

      {/* Loading state */}
      {interpreting && (
        <div className="flex items-center gap-1.5 text-xs text-[#94A3B8] py-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Analyzing with GLM-4…
        </div>
      )}

      {/* Error state */}
      {error && !interpreting && (
        <div className="text-xs text-[#FF5C5C] flex items-center gap-2 flex-wrap">
          <span>{error}</span>
          <button
            onClick={handleInterpret}
            className="underline hover:text-[#FF5C5C]/80 text-[11px]"
          >
            Retry
          </button>
        </div>
      )}

      {/* Success state */}
      {result && (
        <div className="space-y-2">
          {/* Layman explanation */}
          <p className="text-xs text-[#F4F7FB] leading-relaxed">
            {result.laymanExplanation}
          </p>

          {/* Stock impact */}
          {affectedStocks.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider text-[#64748B]">
                Stocks impacted:
              </span>
              {affectedStocks.map((s) => (
                <button
                  key={s}
                  onClick={() => onOpenStock(s)}
                  className={`text-[10px] font-mono ${impactColor(impact)} hover:underline border border-white/[0.12] rounded px-2 py-0.5`}
                >
                  {s}
                </button>
              ))}
              <span className={`text-[10px] uppercase font-semibold ${impactColor(impact)}`}>
                · {sentimentLabel(impact)}
              </span>
            </div>
          )}

          {/* Sector breakdown */}
          {result.sectorBreakdown && result.sectorBreakdown.length > 0 && (
            <div className="space-y-1 pt-1">
              <div className="text-[10px] uppercase tracking-wider text-[#64748B]">
                By sector
              </div>
              {result.sectorBreakdown.map((sb) => (
                <div key={sb.sector} className="text-[11px]">
                  <span className="text-[#94A3B8]">{sb.sector}:</span>{" "}
                  <span className="font-mono text-[#F4F7FB]">{sb.stocks.join(", ")}</span>
                </div>
              ))}
            </div>
          )}

          {/* Short-term outlook */}
          {result.shortTermOutlook && (
            <div className="text-[11px] text-[#94A3B8] italic leading-relaxed">
              <span className="text-[#64748B] not-italic font-semibold uppercase tracking-wider">
                Outlook:{" "}
              </span>
              {result.shortTermOutlook}
            </div>
          )}

          {/* Meta + re-interpret */}
          <div className="flex items-center justify-between pt-1 border-t border-white/[0.06]">
            <span className="text-[9px] text-[#64748B] font-mono">
              {result.model}
              {result.cached ? " · cached" : ""}
              {" · "}
              {result.latencyMs}ms
            </span>
            <button
              onClick={handleInterpret}
              className="text-[10px] text-[#64748B] hover:text-[#94A3B8] flex items-center gap-1"
            >
              <RefreshCw className="h-2.5 w-2.5" />
              Re-interpret
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
