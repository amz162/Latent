"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BrandMark } from "./BrandMark";
import { useLatentStore } from "@/lib/latent/store";
import { ArrowRight, Brain, Target, Activity } from "lucide-react";

export function Landing() {
  const setView = useLatentStore((s) => s.setView);

  return (
    <div className="min-h-screen latent-grid-bg relative overflow-hidden">
      {/* Decorative glow orbs */}
      <div
        aria-hidden
        className="absolute -top-40 -right-40 w-[480px] h-[480px] rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(0,230,118,0.35) 0%, rgba(0,230,118,0) 70%)", filter: "blur(60px)" }}
      />
      <div
        aria-hidden
        className="absolute -bottom-32 -left-32 w-[360px] h-[360px] rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(50,90,200,0.3) 0%, rgba(50,90,200,0) 70%)", filter: "blur(60px)" }}
      />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-6 md:px-10 py-5 border-b border-white/[0.06]">
        <BrandMark size="md" />
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="border-[#00E676]/40 text-[#00E676] font-mono text-xs">
            PRE-SEED · 2026
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setView("dashboard")}
            className="text-[#94A3B8] hover:text-[#F4F7FB] hover:bg-white/[0.05]"
          >
            Sign in
          </Button>
          <Button
            size="sm"
            onClick={() => setView("onboarding")}
            className="bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold"
          >
            Get Started
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {/* Hero */}
      <main className="relative z-10 px-6 md:px-10 py-14 md:py-20 max-w-5xl">
        <Badge variant="outline" className="border-[#00E676]/30 bg-[#00E676]/10 text-[#00E676] uppercase tracking-wider text-xs mb-6">
          AI-Driven Investment Intelligence · PSX
        </Badge>
        <h1 className="text-4xl md:text-6xl lg:text-7xl font-extrabold tracking-tight text-[#F4F7FB] leading-[1.05] mb-6">
          Turning <span className="text-[#94A3B8] italic">"what stock should I buy"</span> into{" "}
          <span className="text-[#00E676]">"here&apos;s the plan to reach your goal."</span>
        </h1>
        <p className="text-base md:text-lg text-[#94A3B8] max-w-2xl mb-10 leading-relaxed">
          Latent.pk is a deep-analytical, AI-driven investment platform that cuts through market noise
          using predictive algorithms to generate goal-based investment plans tailored to your risk
          profile and financial targets. Built for salaried Pakistanis who want exposure to PSX without
          the financial literacy or time to analyze it themselves.
        </p>

        <div className="flex flex-wrap items-center gap-3 mb-12">
          <Button
            size="lg"
            onClick={() => setView("onboarding")}
            className="bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold px-6"
          >
            Build my plan
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => setView("dashboard")}
            className="border-white/[0.12] text-[#F4F7FB] hover:bg-white/[0.05]"
          >
            Explore demo dashboard
          </Button>
        </div>

        {/* Three pillars */}
        <div className="grid md:grid-cols-3 gap-4 mt-12">
          <Card className="bg-[#131829] border-white/[0.08] hover:border-[#00E676]/30 transition-colors">
            <CardContent className="p-5">
              <div className="h-10 w-10 rounded-lg bg-[#00E676]/10 flex items-center justify-center mb-3">
                <Brain className="h-5 w-5 text-[#00E676]" />
              </div>
              <h3 className="text-base font-semibold text-[#F4F7FB] mb-2">Signal over noise</h3>
              <p className="text-sm text-[#94A3B8] leading-relaxed">
                ML + LLM pipeline digests 200+ data sources per stock — filings, technicals, macro,
                sentiment. Noise is filtered before you ever see it.
              </p>
            </CardContent>
          </Card>
          <Card className="bg-[#131829] border-white/[0.08] hover:border-[#00E676]/30 transition-colors">
            <CardContent className="p-5">
              <div className="h-10 w-10 rounded-lg bg-[#00E676]/10 flex items-center justify-center mb-3">
                <Target className="h-5 w-5 text-[#00E676]" />
              </div>
              <h3 className="text-base font-semibold text-[#F4F7FB] mb-2">Plan over tip</h3>
              <p className="text-sm text-[#94A3B8] leading-relaxed">
                Every output is a goal-based, time-bound, risk-calibrated plan — not a single-stock
                tip. Allocation, entry ladder, rebalancing rules, exit triggers all built in.
              </p>
            </CardContent>
          </Card>
          <Card className="bg-[#131829] border-white/[0.08] hover:border-[#00E676]/30 transition-colors">
            <CardContent className="p-5">
              <div className="h-10 w-10 rounded-lg bg-[#00E676]/10 flex items-center justify-center mb-3">
                <Activity className="h-5 w-5 text-[#00E676]" />
              </div>
              <h3 className="text-base font-semibold text-[#F4F7FB] mb-2">Track record, not rumors</h3>
              <p className="text-sm text-[#94A3B8] leading-relaxed">
                Every signal is tracked. Win rate, time-to-profit, open-trade duration —
                downloadable accuracy report. WhatsApp groups hide losses. We publish them.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Trust strip */}
        <div className="mt-12 pt-8 border-t border-white/[0.06] flex flex-wrap items-center gap-x-8 gap-y-2 text-xs text-[#64748B] uppercase tracking-wider">
          <span className="font-mono">240M population</span>
          <span className="font-mono">&lt;100K active PSX traders</span>
          <span className="font-mono">27% FinLit rate</span>
          <span className="font-mono">$7B+ RDA inflows</span>
        </div>
      </main>
    </div>
  );
}
