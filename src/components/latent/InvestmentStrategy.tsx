"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { AppNav } from "./AppNav";
import { useLatentStore } from "@/lib/latent/store";
import { Target, ArrowRight, Coins, TrendingUp, Zap, Activity, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const GOALS = [
  {
    id: "income",
    label: "Regular monthly income",
    icon: Coins,
    strategy: "Dividend + Yield based",
    desc: "Stable, high-dividend stocks that pay you cash 2-4 times a year. Lower risk, lower volatility. Best for retirees or those who want passive cash flow.",
    allocation: { DIVIDEND: 60, GROWTH: 15, SWING: 5, CASH: 20 },
    expectedReturn: "12-15% (incl. 8-10% cash yield)",
    riskLevel: "Low",
    callToAction: "Build dividend portfolio",
  },
  {
    id: "growth",
    label: "Long-term wealth building (5-10y)",
    icon: TrendingUp,
    strategy: "Growth + Accumulation",
    desc: "Buy fundamentally strong companies at cyclical lows. Hold 3-10 years. Compound wealth. Higher volatility but highest expected returns.",
    allocation: { DIVIDEND: 20, GROWTH: 55, SWING: 15, CASH: 10 },
    expectedReturn: "20-25% annualized",
    riskLevel: "High",
    callToAction: "Build growth portfolio",
  },
  {
    id: "swing",
    label: "Active swing trading (2-6 weeks)",
    icon: Activity,
    strategy: "Swing trading",
    desc: "Capture multi-week moves using technical breakouts + fundamental catalysts. Higher time commitment, requires discipline on stops. Suitable for those who can monitor markets weekly.",
    allocation: { DIVIDEND: 10, GROWTH: 20, SWING: 60, CASH: 10 },
    expectedReturn: "30-50% annualized (high variance)",
    riskLevel: "Very High",
    callToAction: "Follow signal section",
  },
  {
    id: "intraday",
    label: "Daily / intraday trading",
    icon: Zap,
    strategy: "Intraday momentum",
    desc: "Day trades on news catalysts + technical setups. Exit same day. Highest time commitment, highest skill required. Most retail investors lose here — proceed with extreme caution.",
    allocation: { DIVIDEND: 0, GROWTH: 10, SWING: 30, CASH: 60 },
    expectedReturn: "Variable (50%+ or capital loss)",
    riskLevel: "Maximum",
    callToAction: "Follow signal section",
  },
];

export function InvestmentStrategy() {
  const [selectedGoal, setSelectedGoal] = useState<string>("");
  const setView = useLatentStore((s) => s.setView);
  const setPlan = useLatentStore((s) => s.setPlan);
  const pushNotification = useLatentStore((s) => s.pushNotification);

  const goal = GOALS.find((g) => g.id === selectedGoal);

  const handleConfirm = () => {
    if (!goal) return;
    pushNotification({
      type: "info",
      title: `Strategy selected: ${goal.strategy}`,
      body: `Goal: ${goal.label} · Expected: ${goal.expectedReturn} · Risk: ${goal.riskLevel}`,
      linkView: goal.id === "swing" || goal.id === "intraday" ? "signals_v2" : "portfolio",
    });
    if (goal.id === "swing" || goal.id === "intraday") {
      toast.success(`Strategy set. Redirecting to signal section for ${goal.strategy}...`);
      setTimeout(() => setView("signals_v2"), 800);
    } else {
      toast.success(`Strategy set. Redirecting to portfolio builder for ${goal.strategy}...`);
      setTimeout(() => setView("portfolio"), 800);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0E1A]">
      <AppNav />
      <main className="px-4 md:px-6 py-6 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[#F4F7FB]">Investment Strategy</h1>
          <p className="text-sm text-[#94A3B8] mt-1">
            Pick your goal. We&apos;ll recommend the best PSX strategy — and either build you a portfolio or route you to live signals.
          </p>
        </div>

        {/* Goal selector */}
        <Card className="bg-[#131829] border-white/[0.08] mb-4">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-[#00E676]" />
              <CardTitle className="text-base text-[#F4F7FB]">What&apos;s your investment goal?</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <RadioGroup value={selectedGoal} onValueChange={setSelectedGoal} className="space-y-2">
              {GOALS.map((g) => {
                const Icon = g.icon;
                return (
                  <Label
                    key={g.id}
                    htmlFor={`goal-${g.id}`}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedGoal === g.id
                        ? "border-[#00E676] bg-[#00E676]/[0.05]"
                        : "border-white/[0.08] bg-[#0A0E1A] hover:border-white/[0.15]"
                    }`}
                  >
                    <RadioGroupItem value={g.id} id={`goal-${g.id}`} className="mt-1 text-[#00E676]" />
                    <Icon className={`h-5 w-5 mt-0.5 ${selectedGoal === g.id ? "text-[#00E676]" : "text-[#94A3B8]"}`} />
                    <div className="flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-[#F4F7FB] text-sm">{g.label}</span>
                        <Badge variant="outline" className={`text-[9px] py-0 h-4 ${
                          g.riskLevel === "Low" ? "border-[#00E676]/40 text-[#00E676]" :
                          g.riskLevel === "High" ? "border-amber-400/40 text-amber-400" :
                          g.riskLevel === "Very High" ? "border-orange-500/40 text-orange-400" :
                          "border-[#FF5C5C]/40 text-[#FF5C5C]"
                        }`}>
                          {g.riskLevel} risk
                        </Badge>
                      </div>
                      <p className="text-xs text-[#94A3B8] mt-1 leading-relaxed">{g.desc}</p>
                    </div>
                  </Label>
                );
              })}
            </RadioGroup>
          </CardContent>
        </Card>

        {/* Selected strategy */}
        {goal && (
          <Card className="bg-gradient-to-br from-[#00E676]/[0.07] to-[#131829] border-[#00E676]/20">
            <CardHeader>
              <CardTitle className="text-base text-[#F4F7FB]">Recommended strategy</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#00E676] font-semibold mb-1">
                  Strategy
                </div>
                <div className="text-lg font-bold text-[#F4F7FB]">{goal.strategy}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3">
                  <div className="text-[10px] uppercase text-[#64748B] mb-1">Expected return</div>
                  <div className="text-sm font-mono font-bold text-[#00E676]">{goal.expectedReturn}</div>
                </div>
                <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3">
                  <div className="text-[10px] uppercase text-[#64748B] mb-1">Risk level</div>
                  <div className="text-sm font-bold text-[#F4F7FB]">{goal.riskLevel}</div>
                </div>
              </div>

              {/* Allocation */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold mb-2">
                  Target allocation
                </div>
                <div className="h-3 rounded-full overflow-hidden flex mb-2">
                  {Object.entries(goal.allocation).map(([horizon, pct]) => {
                    const color = horizon === "DIVIDEND" ? "#00E676" :
                                  horizon === "GROWTH" ? "#22E881" :
                                  horizon === "SWING" ? "#FBBF24" : "#64748B";
                    if (pct === 0) return null;
                    return (
                      <div
                        key={horizon}
                        style={{ width: `${pct}%`, backgroundColor: color }}
                        title={`${horizon}: ${pct}%`}
                      />
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-2 text-[10px]">
                  {Object.entries(goal.allocation).filter(([_, pct]) => pct > 0).map(([horizon, pct]) => (
                    <span key={horizon} className="font-mono text-[#94A3B8]">
                      {horizon} {pct}%
                    </span>
                  ))}
                </div>
              </div>

              {/* Risk managed note */}
              <div className="rounded-lg bg-[#00E676]/[0.07] border border-[#00E676]/20 p-3 flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-[#00E676] flex-shrink-0 mt-0.5" />
                <p className="text-xs text-[#94A3B8] leading-relaxed">
                  Risk is managed via built-in stop-losses, position sizing caps, and rebalancing rules. Your capital is never concentrated in a single stock. You can change strategy anytime.
                </p>
              </div>

              <Button
                onClick={handleConfirm}
                className="w-full bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold h-11"
              >
                {goal.callToAction}
                <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3 text-[11px] text-[#64748B] leading-relaxed mt-6">
          <span className="text-[#94A3B8] font-semibold">Strategy note:</span> Expected returns are
          projections based on historical PSX benchmarks, not guarantees. Past performance does
          not guarantee future returns. Strategy allocations shown are starting points —
          customize in the Portfolio tab.
        </div>
      </main>
    </div>
  );
}
