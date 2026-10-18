"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppNav } from "./AppNav";
import { useLatentStore } from "@/lib/latent/store";
import { Plan } from "@/lib/latent/types";
import { Target, RefreshCw, BookOpen, Calendar } from "lucide-react";

export function PlanView() {
  const plan = useLatentStore((s) => s.plan) as Plan | null;
  const riskProfile = useLatentStore((s) => s.riskProfile);
  const setView = useLatentStore((s) => s.setView);

  if (!plan) {
    return (
      <div className="min-h-screen bg-[#0A0E1A]">
        <AppNav />
        <div className="max-w-4xl mx-auto px-6 py-16 text-center">
          <Target className="h-12 w-12 text-[#00E676]/30 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-[#F4F7FB] mb-2">No plan yet</h2>
          <p className="text-sm text-[#94A3B8] mb-6">
            Build your personalized PSX investment plan in 4 quick steps.
          </p>
          <Button
            onClick={() => setView("onboarding")}
            className="bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold"
          >
            Build my plan
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0E1A]">
      <AppNav />
      <main className="max-w-5xl mx-auto px-4 md:px-6 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#F4F7FB]">Your investment plan</h1>
            <p className="text-sm text-[#94A3B8] mt-1">
              Generated from your risk profile. Adjust anytime by retaking the questionnaire.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="bg-[#00E676]/15 text-[#00E676] border-[#00E676]/30 capitalize">
              {plan.profileBucket} bucket
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setView("onboarding")}
              className="border-white/[0.12] text-[#94A3B8] hover:text-[#F4F7FB]"
            >
              <RefreshCw className="h-3 w-3 mr-1.5" />
              Rebuild
            </Button>
          </div>
        </div>

        {/* Top stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardContent className="p-4">
              <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Target annualized</div>
              <div className="text-xl font-bold text-[#00E676] font-mono">{plan.expectedReturnPct}%</div>
            </CardContent>
          </Card>
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardContent className="p-4">
              <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Risk score</div>
              <div className="text-xl font-bold text-[#F4F7FB] font-mono">{plan.riskScore}/10</div>
            </CardContent>
          </Card>
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardContent className="p-4">
              <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Positions</div>
              <div className="text-xl font-bold text-[#F4F7FB] font-mono">{plan.allocation.length}</div>
            </CardContent>
          </Card>
          {riskProfile && (
            <Card className="bg-[#131829] border-white/[0.08]">
              <CardContent className="p-4">
                <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Monthly SIP</div>
                <div className="text-xl font-bold text-[#F4F7FB] font-mono">
                  PKR {riskProfile.monthlyContribution.toLocaleString()}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Allocation */}
        <Card className="bg-[#131829] border-white/[0.08] mb-4">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-[#00E676]" />
              <CardTitle className="text-base text-[#F4F7FB]">Target allocation</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {/* Bucket summary bar */}
            <div className="h-3 rounded-full overflow-hidden flex mb-4">
              {plan.allocation.reduce<{ acc: typeof plan.allocation; curr: number }>(
                (state, a) => {
                  // group by horizon for the visual bucket
                  const existing = state.acc.find((x) => x.horizon === a.horizon);
                  if (existing) {
                    existing.allocationPct += a.allocationPct;
                  } else {
                    state.acc.push({ ...a });
                  }
                  return state;
                },
                { acc: [], curr: 0 }
              ).acc.map((h) => {
                const color =
                  h.horizon === "DIVIDEND" ? "#00E676" :
                  h.horizon === "GROWTH" ? "#22E881" :
                  h.horizon === "SWING" ? "#FBBF24" :
                  "#FF5C5C";
                return (
                  <div
                    key={h.horizon}
                    style={{ width: `${h.allocationPct}%`, backgroundColor: color }}
                    title={`${h.horizon}: ${h.allocationPct.toFixed(1)}%`}
                  />
                );
              })}
            </div>

            <div className="space-y-2">
              {plan.allocation.map((a) => (
                <div
                  key={a.symbol}
                  className="flex items-center gap-3 p-3 rounded-lg bg-[#0A0E1A] border border-white/[0.06]"
                >
                  <div className="h-10 w-10 rounded-lg bg-[#00E676]/10 flex items-center justify-center font-mono font-bold text-[#00E676] text-xs">
                    {a.symbol.slice(0, 4)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[#F4F7FB] text-sm">{a.symbol}</span>
                      <Badge variant="outline" className="text-[9px] py-0 h-4 border-[#00E676]/40 text-[#00E676]">
                        {a.horizon}
                      </Badge>
                    </div>
                    <p className="text-xs text-[#94A3B8] truncate mt-0.5">{a.thesis}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono font-bold text-[#F4F7FB]">{a.allocationPct.toFixed(1)}%</div>
                    <div className="text-[10px] text-[#64748B]">allocation</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Entry ladder */}
        <Card className="bg-[#131829] border-white/[0.08] mb-4">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-[#00E676]" />
              <CardTitle className="text-base text-[#F4F7FB]">3-month entry ladder</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {plan.entryLadder.map((step) => (
                <div key={step.month} className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-full bg-[#00E676]/10 flex items-center justify-center font-mono font-bold text-[#00E676] text-xs">
                        M{step.month}
                      </div>
                      <span className="font-semibold text-[#F4F7FB] text-sm">
                        Month {step.month} deployment
                      </span>
                    </div>
                    <span className="font-mono font-bold text-[#00E676]">PKR {step.amount.toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-[#94A3B8]">{step.instructions}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Rebalancing rules */}
        <Card className="bg-[#131829] border-white/[0.08]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-[#00E676]" />
              <CardTitle className="text-base text-[#F4F7FB]">Rebalancing rules</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {plan.rebalancingRules.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-[#94A3B8]">
                  <div className="h-5 w-5 rounded-full bg-[#00E676]/10 flex items-center justify-center font-mono text-[10px] text-[#00E676] flex-shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <span className="leading-relaxed">{r}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
