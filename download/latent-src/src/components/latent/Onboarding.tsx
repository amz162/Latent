"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "./BrandMark";
import { useLatentStore } from "@/lib/latent/store";
import { synthesizePlan, classifyRiskBucket } from "@/lib/latent/plan-synthesizer";
import { ArrowLeft, ArrowRight, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const STEPS = ["Profile", "Goal", "Risk", "Plan"] as const;

export function Onboarding() {
  const setView = useLatentStore((s) => s.setView);
  const setUser = useLatentStore((s) => s.setUser);
  const setRiskProfile = useLatentStore((s) => s.setRiskProfile);
  const setPlan = useLatentStore((s) => s.setPlan);

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [goalLabel, setGoalLabel] = useState("House down payment");
  const [goalTargetAmount, setGoalTargetAmount] = useState(5_000_000);
  const [goalDate, setGoalDate] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 5);
    return d.toISOString().slice(0, 10);
  });
  const [monthlyContribution, setMonthlyContribution] = useState(50_000);
  const [riskTolerance, setRiskTolerance] = useState(6);
  const [timeHorizon, setTimeHorizon] = useState(5);

  const bucket = classifyRiskBucket({
    riskTolerance,
    timeHorizon,
    monthlyContribution,
    goalLabel,
    goalTargetAmount,
    goalDate,
  });

  const canProceed = () => {
    if (step === 0) return name.trim().length > 0 && /\S+@\S+\.\S+/.test(email);
    if (step === 1) return goalLabel.trim().length > 0 && goalTargetAmount >= 10000;
    if (step === 2) return riskTolerance > 0 && monthlyContribution >= 1000;
    return true;
  };

  const handleNext = () => setStep((s) => Math.min(s + 1, 3));
  const handleBack = () => setStep((s) => Math.max(s - 1, 0));

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          name,
          riskTolerance,
          timeHorizon,
          monthlyContribution,
          goalLabel,
          goalTargetAmount,
          goalDate: new Date(goalDate).toISOString(),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Onboarding failed");
      }
      const data = await res.json();
      setUser(data.userId, email, name);
      setRiskProfile({
        riskTolerance,
        timeHorizon,
        monthlyContribution,
        goalLabel,
        goalTargetAmount,
        goalDate: new Date(goalDate).toISOString(),
      });
      setPlan(data.plan);
      toast.success("Plan generated. Welcome to Latent.pk.");
      setView("dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Onboarding failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen latent-grid-bg relative">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 md:px-10 py-5 border-b border-white/[0.06]">
        <button onClick={() => setView("landing")} className="hover:opacity-80">
          <BrandMark />
        </button>
        <div className="flex items-center gap-1.5 text-xs">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-1.5">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full font-mono text-[10px] ${
                  i < step
                    ? "bg-[#00E676] text-[#0A0E1A]"
                    : i === step
                    ? "bg-[#00E676]/20 text-[#00E676] border border-[#00E676]/40"
                    : "bg-white/[0.04] text-[#64748B] border border-white/[0.08]"
                }`}
              >
                {i < step ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
              </div>
              <span
                className={`text-xs font-medium ${
                  i === step ? "text-[#F4F7FB]" : "text-[#64748B]"
                }`}
              >
                {s}
              </span>
              {i < STEPS.length - 1 && (
                <div className="w-6 h-px bg-white/[0.08] mx-1.5" />
              )}
            </div>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setView("landing")}
          className="text-[#64748B]"
        >
          Cancel
        </Button>
      </header>

      <main className="max-w-2xl mx-auto px-6 md:px-0 py-10">
        {/* Step 0: Profile */}
        {step === 0 && (
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardHeader>
              <CardTitle className="text-2xl text-[#F4F7FB]">Let&apos;s start with you</CardTitle>
              <p className="text-sm text-[#94A3B8] mt-1">
                We need a way to keep your plan linked to you across devices.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name" className="text-[#94A3B8]">Full name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Bilal Ahmed"
                  className="bg-[#0A0E1A] border-white/[0.12] text-[#F4F7FB]"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-[#94A3B8]">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="bilal@example.com"
                  className="bg-[#0A0E1A] border-white/[0.12] text-[#F4F7FB]"
                />
              </div>
              <div className="rounded-lg bg-[#00E676]/[0.07] border border-[#00E676]/20 p-3 text-xs text-[#94A3B8]">
                <span className="text-[#00E676] font-semibold">Demo note:</span> We use email
                only to link your plan. No password, no spam. You can sign out anytime.
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 1: Goal */}
        {step === 1 && (
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardHeader>
              <CardTitle className="text-2xl text-[#F4F7FB]">What are you saving for?</CardTitle>
              <p className="text-sm text-[#94A3B8] mt-1">
                Your goal anchors your plan&apos;s time horizon and risk level.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label className="text-[#94A3B8]">Goal label</Label>
                <RadioGroup
                  value={goalLabel}
                  onValueChange={setGoalLabel}
                  className="grid grid-cols-2 gap-2"
                >
                  {[
                    "House down payment",
                    "Kid's education",
                    "Retirement",
                    "Wealth building",
                  ].map((g) => (
                    <div key={g} className="flex items-center space-x-2">
                      <RadioGroupItem value={g} id={`goal-${g}`} className="text-[#00E676]" />
                      <Label htmlFor={`goal-${g}`} className="text-[#F4F7FB] text-sm cursor-pointer">
                        {g}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              <div className="space-y-2">
                <Label className="text-[#94A3B8]">Target amount (PKR)</Label>
                <Input
                  type="number"
                  value={goalTargetAmount}
                  onChange={(e) => setGoalTargetAmount(Number(e.target.value))}
                  step={100000}
                  min={100000}
                  className="bg-[#0A0E1A] border-white/[0.12] text-[#F4F7FB] font-mono"
                />
                <p className="text-xs text-[#64748B]">
                  ≈ PKR {(goalTargetAmount / 280).toLocaleString("en-US", { maximumFractionDigits: 0 })} at current USD/PKR
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-[#94A3B8]">Target date</Label>
                <Input
                  type="date"
                  value={goalDate}
                  onChange={(e) => setGoalDate(e.target.value)}
                  className="bg-[#0A0E1A] border-white/[0.12] text-[#F4F7FB] font-mono"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Risk + Contribution */}
        {step === 2 && (
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardHeader>
              <CardTitle className="text-2xl text-[#F4F7FB]">Your risk profile</CardTitle>
              <p className="text-sm text-[#94A3B8] mt-1">
                Be honest — this drives your allocation. You can change later.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-[#94A3B8]">Risk tolerance (1=conservative, 10=aggressive)</Label>
                  <Badge variant="outline" className="border-[#00E676]/40 text-[#00E676] font-mono">
                    {riskTolerance}/10
                  </Badge>
                </div>
                <Slider
                  value={[riskTolerance]}
                  onValueChange={(v) => setRiskTolerance(v[0])}
                  min={1}
                  max={10}
                  step={1}
                  className="py-4"
                />
                <p className="text-xs text-[#64748B]">
                  {riskTolerance <= 3 ? "You prefer predictable returns even if lower." :
                   riskTolerance <= 6 ? "You accept some volatility for higher returns." :
                   riskTolerance <= 8 ? "You actively seek growth, accept moderate drawdowns." :
                   "You can tolerate significant drawdowns for high upside potential."}
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-[#94A3B8]">Time horizon (years)</Label>
                  <Badge variant="outline" className="border-[#00E676]/40 text-[#00E676] font-mono">
                    {timeHorizon} yr
                  </Badge>
                </div>
                <Slider
                  value={[timeHorizon]}
                  onValueChange={(v) => setTimeHorizon(v[0])}
                  min={1}
                  max={30}
                  step={1}
                  className="py-4"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-[#94A3B8]">Monthly contribution (PKR)</Label>
                <Input
                  type="number"
                  value={monthlyContribution}
                  onChange={(e) => setMonthlyContribution(Number(e.target.value))}
                  step={5000}
                  min={5000}
                  className="bg-[#0A0E1A] border-white/[0.12] text-[#F4F7FB] font-mono"
                />
                <p className="text-xs text-[#64748B]">
                  SIP-style: deployed automatically each month per your plan ladder.
                </p>
              </div>

              <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.08] p-4">
                <div className="text-xs text-[#64748B] uppercase tracking-wider mb-1">
                  Your profile bucket
                </div>
                <div className="text-2xl font-bold text-[#00E676] capitalize">{bucket}</div>
                <p className="text-xs text-[#94A3B8] mt-1">
                  {bucket === "conservative" ? "60% dividend yield, 15% growth, 15% cash" :
                   bucket === "moderate" ? "45% dividend, 25% growth, 15% swing" :
                   bucket === "growth" ? "30% dividend, 35% growth, 25% swing, 5% day" :
                   "15% dividend, 40% growth, 30% swing, 10% day"}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Plan preview */}
        {step === 3 && (
          <Card className="bg-[#131829] border-white/[0.08]">
            <CardHeader>
              <CardTitle className="text-2xl text-[#F4F7FB]">Your plan preview</CardTitle>
              <p className="text-sm text-[#94A3B8] mt-1">
                Generated from your profile. We&apos;ll show the full breakdown next.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.08] p-3">
                  <div className="text-xs text-[#64748B] uppercase">Bucket</div>
                  <div className="text-lg font-bold text-[#00E676] capitalize">{bucket}</div>
                </div>
                <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.08] p-3">
                  <div className="text-xs text-[#64748B] uppercase">Annualized target</div>
                  <div className="text-lg font-bold text-[#F4F7FB] font-mono">
                    {bucket === "conservative" ? "12%" :
                     bucket === "moderate" ? "16%" :
                     bucket === "growth" ? "22%" : "28%"}
                  </div>
                </div>
                <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.08] p-3">
                  <div className="text-xs text-[#64748B] uppercase">Monthly SIP</div>
                  <div className="text-lg font-bold text-[#F4F7FB] font-mono">
                    PKR {monthlyContribution.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.08] p-3">
                  <div className="text-xs text-[#64748B] uppercase">Goal target</div>
                  <div className="text-lg font-bold text-[#F4F7FB] font-mono">
                    PKR {goalTargetAmount.toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="rounded-lg bg-[#00E676]/[0.07] border border-[#00E676]/20 p-3 text-xs text-[#94A3B8]">
                <span className="text-[#00E676] font-semibold">Next:</span> We&apos;ll generate
                your allocation across 5-8 KSE-100 stocks, a 3-month entry ladder, and rebalancing
                rules. You can adjust any of it.
              </div>
            </CardContent>
          </Card>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6">
          <Button
            variant="ghost"
            onClick={handleBack}
            disabled={step === 0}
            className="text-[#94A3B8] hover:text-[#F4F7FB]"
          >
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back
          </Button>
          {step < 3 ? (
            <Button
              onClick={handleNext}
              disabled={!canProceed()}
              className="bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold"
            >
              Continue
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className="bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  Generate my plan
                  <ArrowRight className="h-4 w-4 ml-1.5" />
                </>
              )}
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
