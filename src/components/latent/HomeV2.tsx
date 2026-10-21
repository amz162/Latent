"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BrandMark } from "./BrandMark";
import { useLatentStore } from "@/lib/latent/store";
import { useI18n } from "@/lib/latent/i18n";
import {
  ArrowRight,
  Newspaper,
  BarChart3,
  Zap,
  Briefcase,
  Target,
  Coins,
  Activity,
  Bell,
  Languages,
  ShieldCheck,
  Brain,
  Calculator,
  Search,
  Database,
} from "lucide-react";

const TABS = [
  {
    view: "fundamental_news" as const,
    icon: Newspaper,
    title: "Fundamental News",
    desc: "International + national news, company announcements & results — each interpreted in layman terms with stock impact analysis.",
    bullets: ["News link interpreter", "Sector categorization", "Auto-redirect to signals"],
  },
  {
    view: "technical_analysis" as const,
    icon: BarChart3,
    title: "Technical Analysis",
    desc: "Index analysis with support/resistance, chart patterns, and AI predictions. Each indicator explained in plain language.",
    bullets: ["Index support/resistance", "Indicator matrix (Up/Down/Accumulate)", "AI price prediction"],
  },
  {
    view: "signals_v2" as const,
    icon: Zap,
    title: "Signal Section",
    desc: "Per-stock BUY/SELL signals with confidence scores and layman reasoning. Fundamentals + technicals + AI model combined.",
    bullets: ["Buy/Sell/Hold/Accumulate", "Confidence score per signal", "Deep-dive view per stock"],
  },
  {
    view: "ai_model_signals" as const,
    icon: Brain,
    title: "AI Models",
    desc: "26-model ensemble across 5 tiers with backtesting per model. Search any of 361 PSX stocks.",
    bullets: ["Per-tier model cards", "Triple-barrier backtesting", "Final ensemble consensus signal"],
  },
  {
    view: "calculators" as const,
    icon: Calculator,
    title: "Tax Calculators",
    desc: "CGT, dividend tax, SIP compounding, and position sizing — built for PSX investors with Pakistan Finance Act 2024 rates.",
    bullets: ["CGT: 15% / 12.5% / 0% tiers", "Dividend tax: 15% filer / 20% non-filer / 39% company", "SIP + Position Size with R:R ratio"],
  },
  {
    view: "pattern_finder" as const,
    icon: Search,
    title: "Pattern Finder",
    desc: "Detects fundamental patterns from quarterly results — EPS growth, margin trends, dividend consistency, CAGRs. Search any of 361 stocks.",
    bullets: ["15-rule pattern engine", "Multi-line chart + quarterly summary", "Real financial data (22 years)"],
  },
  {
    view: "portfolio" as const,
    icon: Briefcase,
    title: "Portfolio & Watchlist",
    desc: "Add/remove/reorder stocks. Optional buy price triggers profit/loss tracking with hold/sell/buy-more suggestions.",
    bullets: ["Drag-to-reorder list", "P&L color coding", "Avg-down suggestions"],
  },
  {
    view: "strategy" as const,
    icon: Target,
    title: "Investment Strategy",
    desc: "Goal-based strategy selector — dividend, yield, swing, or intraday. Builds portfolio or routes to signals section.",
    bullets: ["Goal questionnaire", "Strategy auto-selection", "Portfolio builder for income goals"],
  },
  {
    view: "dividends" as const,
    icon: Coins,
    title: "Dividends",
    desc: "Top-to-bottom list of dividend announcements by PSX-listed companies — sorted by yield, ex-date, and amount.",
    bullets: ["Latest dividend declarations", "Yield rankings", "Ex-date alerts"],
  },
  {
    view: "tracker" as const,
    icon: Activity,
    title: "Tracker",
    desc: "Two-track accuracy dashboard: signal tracker (our win rate + ROI) and portfolio tracker (your P&L + success ratio).",
    bullets: ["Signal hit-rate + ROI %", "Portfolio P&L breakdown", "Per-trade detail"],
  },
];

export function HomeV2() {
  const setView = useLatentStore((s) => s.setView);
  const t = useI18n((s) => s.t);

  return (
    <div className="min-h-screen latent-grid-bg relative overflow-hidden">
      {/* Decorative glow orbs */}
      <div
        aria-hidden
        className="absolute -top-40 -right-40 w-[520px] h-[520px] rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(0,230,118,0.35) 0%, rgba(0,230,118,0) 70%)", filter: "blur(60px)" }}
      />
      <div
        aria-hidden
        className="absolute -bottom-32 -left-32 w-[400px] h-[400px] rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(50,90,200,0.3) 0%, rgba(50,90,200,0) 70%)", filter: "blur(60px)" }}
      />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 md:px-10 py-5 border-b border-white/[0.06]">
        <BrandMark size="md" />
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-[#00E676]/40 text-[#00E676] font-mono text-xs">
            <Bell className="h-3 w-3 mr-1" />
            LIVE · PSX
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setView("dashboard")}
            className="text-[#94A3B8] hover:text-[#F4F7FB] hover:bg-white/[0.05]"
          >
            <Languages className="h-3.5 w-3.5 mr-1" />
            EN
          </Button>
          <Button
            size="sm"
            onClick={() => setView("dashboard")}
            className="bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold"
          >
            Enter platform
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 px-6 md:px-10 py-14 md:py-20 max-w-6xl">
        <Badge variant="outline" className="border-[#00E676]/30 bg-[#00E676]/10 text-[#00E676] uppercase tracking-wider text-xs mb-6">
          AI-Driven PSX Intelligence · 10-Tab Platform
        </Badge>
        <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold tracking-tight text-[#F4F7FB] leading-[1.05] mb-6">
          The plan-first PSX investment platform for{" "}
          <span className="text-[#00E676]">salaried Pakistanis</span>.
        </h1>
        <p className="text-base md:text-lg text-[#94A3B8] max-w-3xl mb-8 leading-relaxed">
          Latent.pk cuts through market noise using predictive algorithms trained on PSX data.
          We translate every signal — news, results, technicals, fundamentals — into a clear,
          personalized action plan in your language. No WhatsApp rumors, no TradingView overwhelm.
          Just <span className="text-[#F4F7FB] font-medium">here&apos;s the plan to reach your goal</span>.
        </p>

        <div className="flex flex-wrap items-center gap-3 mb-16">
          <Button
            size="lg"
            onClick={() => setView("dashboard")}
            className="bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold px-6"
          >
            {t("landing.cta.explore")}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => setView("onboarding")}
            className="border-white/[0.12] text-[#F4F7FB] hover:bg-white/[0.05]"
          >
            {t("landing.cta.build_plan")}
          </Button>
        </div>

        {/* Trust strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-16">
          {[
            { label: "PSX-listed stocks covered", value: "530+", icon: Database },
            { label: "Real-time data sources", value: "12", icon: Activity },
            { label: "Signal accuracy (backtested)", value: "62%", icon: Zap },
            { label: "Avg. time-to-profit", value: "12 days", icon: Target },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <Card key={s.label} className="bg-[#131829] border-white/[0.08]">
                <CardContent className="p-4">
                  <Icon className="h-4 w-4 text-[#00E676] mb-2" />
                  <div className="text-2xl font-bold text-[#F4F7FB] font-mono">{s.value}</div>
                  <div className="text-[10px] uppercase tracking-wider text-[#64748B] mt-1">
                    {s.label}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* 7-tab preview */}
      <section className="relative z-10 px-6 md:px-10 pb-16">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h2 className="text-2xl md:text-3xl font-bold text-[#F4F7FB]">
              Ten tabs. One platform.
            </h2>
            <p className="text-sm text-[#94A3B8] mt-1">
              Each tab is a complete workflow — built for the salaried investor who wants depth without the jargon.
            </p>
          </div>
          <Badge variant="outline" className="border-white/[0.12] text-[#94A3B8] hidden md:flex">
            10 / 10 live in this build
          </Badge>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {TABS.map((tab, i) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.view}
                onClick={() => setView(tab.view)}
                className="text-left group"
              >
                <Card className="bg-[#131829] border-white/[0.08] hover:border-[#00E676]/30 transition-all hover:-translate-y-0.5 h-full">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div className="h-10 w-10 rounded-lg bg-[#00E676]/10 flex items-center justify-center group-hover:bg-[#00E676]/20 transition-colors">
                        <Icon className="h-5 w-5 text-[#00E676]" />
                      </div>
                      <span className="font-mono text-xs text-[#64748B]">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </div>
                    <h3 className="font-semibold text-[#F4F7FB] mb-2">{tab.title}</h3>
                    <p className="text-xs text-[#94A3B8] leading-relaxed mb-3">{tab.desc}</p>
                    <ul className="space-y-1">
                      {tab.bullets.map((b) => (
                        <li key={b} className="text-[11px] text-[#64748B] flex items-start gap-1.5">
                          <span className="text-[#00E676] mt-0.5">▸</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </button>
            );
          })}

          {/* Architecture card */}
          <Card className="bg-gradient-to-br from-[#00E676]/[0.07] to-[#131829] border-[#00E676]/20">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div className="h-10 w-10 rounded-lg bg-[#00E676]/20 flex items-center justify-center">
                  <Brain className="h-5 w-5 text-[#00E676]" />
                </div>
                <ShieldCheck className="h-4 w-4 text-[#00E676]" />
              </div>
              <h3 className="font-semibold text-[#F4F7FB] mb-2">3-layer AI architecture</h3>
              <p className="text-xs text-[#94A3B8] leading-relaxed mb-3">
                XGBoost signal model + RAG-grounded LLM layman explanations + rule-based plan
                synthesis. Three compounding moats: signal quality, comprehension, and goal-matching.
              </p>
              <ul className="space-y-1">
                <li className="text-[11px] text-[#64748B] flex items-start gap-1.5">
                  <span className="text-[#00E676] mt-0.5">▸</span>
                  <span>Real APIs from askanalyst.com.pk</span>
                </li>
                <li className="text-[11px] text-[#64748B] flex items-start gap-1.5">
                  <span className="text-[#00E676] mt-0.5">▸</span>
                  <span>Investify.pk news + announcements scraper</span>
                </li>
                <li className="text-[11px] text-[#64748B] flex items-start gap-1.5">
                  <span className="text-[#00E676] mt-0.5">▸</span>
                  <span>Live notifications: signal fire, TP/SL hit</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Schedule / scraper rule strip */}
      <section className="relative z-10 px-6 md:px-10 pb-16">
        <Card className="bg-[#131829] border-white/[0.08]">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="h-4 w-4 text-[#00E676]" />
              <h3 className="font-semibold text-[#F4F7FB]">Scraper & alert schedule</h3>
            </div>
            <p className="text-sm text-[#94A3B8] mb-4">
              News + announcements are scraped Mon–Fri, 9:00 AM – 5:00 PM PKT. Pre-session
              scrape captures overnight news; continuous scrape during session catches live updates.
              Signal notifications fire when the XGBoost model emits a new BUY/SELL; TP/SL alerts
              fire the moment a tracked position hits its target or stop-loss.
            </p>
            <div className="grid md:grid-cols-3 gap-3 text-xs">
              <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3">
                <div className="text-[10px] uppercase text-[#64748B] mb-1">Pre-session</div>
                <div className="text-[#F4F7FB] font-mono">08:55 PKT · daily</div>
                <div className="text-[11px] text-[#94A3B8] mt-1">Overnight news + announcements</div>
              </div>
              <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3">
                <div className="text-[10px] uppercase text-[#64748B] mb-1">During session</div>
                <div className="text-[#F4F7FB] font-mono">09:00 – 17:00 PKT</div>
                <div className="text-[11px] text-[#94A3B8] mt-1">Poll every 5 min for new items</div>
              </div>
              <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3">
                <div className="text-[10px] uppercase text-[#64748B] mb-1">Post-session</div>
                <div className="text-[#F4F7FB] font-mono">17:00 PKT</div>
                <div className="text-[11px] text-[#94A3B8] mt-1">Signal track-record update</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Footer */}
      <footer className="relative z-10 px-6 md:px-10 py-8 border-t border-white/[0.06]">
        <div className="flex items-center justify-between flex-wrap gap-4 text-xs text-[#64748B]">
          <div className="flex items-center gap-3">
            <BrandMark size="sm" />
            <span>·</span>
            <span>AI-driven investment intelligence for the Pakistan Stock Exchange</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono">v0.2 · MVP</span>
            <span className="font-mono">DEMO MODE</span>
          </div>
        </div>
        <div className="mt-4 text-[10px] text-[#64748B] leading-relaxed max-w-3xl">
          <span className="text-[#94A3B8] font-semibold">Disclaimer:</span> Latent.pk is in
          pre-launch demo. Signal outputs are generated by a stub model pending XGBoost training
          on historical PSX data. Track-record figures shown are synthetic. The platform is not
          yet licensed by SECP as a Registered Investment Advisor — do not execute real trades
          based on demo signals.
        </div>
      </footer>
    </div>
  );
}
