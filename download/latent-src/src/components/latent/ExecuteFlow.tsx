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
import { Signal, Broker } from "@/lib/latent/types";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Loader2,
  Receipt,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

export function ExecuteFlow() {
  const setView = useLatentStore((s) => s.setView);
  const selectedSignalId = useLatentStore((s) => s.selectedSignalId);
  const userId = useLatentStore((s) => s.userId);
  const [signal, setSignal] = useState<Signal | null>(null);
  const [brokers, setBrokers] = useState<Broker[]>([]);
  const [selectedBroker, setSelectedBroker] = useState<string>("");
  const [shares, setShares] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState<null | {
    tradeRef: string;
    broker: string;
    shares: number;
    filledPrice: number;
    orderValue: number;
    commission: number;
    totalDebit: number;
    settlementDate: string;
  }>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/signals/${selectedSignalId}`).then((r) => r.json()),
      fetch("/api/stocks").then((r) => r.json()),
    ])
      .then(([sig, stk]) => {
        if (sig.signal) {
          setSignal(sig.signal);
          // Default shares: ~100K PKR worth
          setShares(Math.floor(100000 / sig.signal.entryPrice));
        }
        if (stk.brokers) {
          setBrokers(stk.brokers);
          setSelectedBroker(stk.brokers[0]?.id || "");
        }
      })
      .catch(() => {
        toast.error("Failed to load signal or brokers");
      });
  }, [selectedSignalId]);

  if (!signal) {
    return (
      <div className="min-h-screen bg-[#0A0E1A]">
        <AppNav />
        <div className="max-w-3xl mx-auto p-6 space-y-4">
          <Skeleton className="h-10 w-32 bg-white/[0.04]" />
          <Skeleton className="h-48 w-full bg-white/[0.04]" />
        </div>
      </div>
    );
  }

  const orderValue = shares * signal.entryPrice;
  const commission = orderValue * 0.001;
  const totalDebit = orderValue + commission;

  const handleSubmit = async () => {
    if (!userId) {
      // Demo-mode: simulate confirmation without backend
      toast.info("Demo mode — generating simulated confirmation.");
      setConfirmation({
        tradeRef: `LTX-DEMO-${Date.now().toString(36).toUpperCase()}`,
        broker: brokers.find((b) => b.id === selectedBroker)?.name || "Demo Broker",
        shares,
        filledPrice: signal.entryPrice,
        orderValue,
        commission,
        totalDebit,
        settlementDate: new Date(Date.now() + 2 * 86400 * 1000).toISOString(),
      });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          signalId: signal.id,
          brokerId: selectedBroker,
          shares,
          price: signal.entryPrice,
        }),
      });
      if (!res.ok) throw new Error("Execution failed");
      const data = await res.json();
      setConfirmation(data);
      toast.success("Trade executed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setConfirmation(null);
    setView("signals");
  };

  return (
    <div className="min-h-screen bg-[#0A0E1A]">
      <AppNav />
      <main className="max-w-3xl mx-auto px-4 md:px-6 py-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setView("signals")}
          className="text-[#94A3B8] hover:text-[#F4F7FB] mb-4 -ml-2"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to signals
        </Button>

        <h1 className="text-2xl font-bold text-[#F4F7FB] mb-1">Execute trade</h1>
        <p className="text-sm text-[#94A3B8] mb-6">
          {signal.status === "TRIGGERED"
            ? "Entry window closed — view only."
            : "Confirm your order details and route to your broker."}
        </p>

        {/* Trade summary */}
        <Card className="bg-[#131829] border-white/[0.08] mb-4">
          <CardContent className="p-5">
            <div className="flex items-start gap-4 mb-4">
              <div className="h-12 w-12 rounded-lg bg-[#00E676]/10 flex items-center justify-center font-mono font-bold text-[#00E676]">
                {signal.symbol.slice(0, 4)}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[#F4F7FB]">{signal.symbol}</span>
                  <Badge variant="outline" className="text-[9px] py-0 h-4 border-[#00E676]/40 text-[#00E676]">
                    {signal.horizon}
                  </Badge>
                </div>
                <p className="text-xs text-[#94A3B8] mt-0.5">{signal.stockName}</p>
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase text-[#64748B]">Entry price</div>
                <div className="text-lg font-mono font-bold text-[#F4F7FB]">{signal.entryPrice}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-2">
                <div className="text-[9px] uppercase text-[#64748B]">Target</div>
                <div className="text-sm font-mono font-bold text-[#00E676]">{signal.targetPrice}</div>
              </div>
              <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-2">
                <div className="text-[9px] uppercase text-[#64748B]">Stop-loss</div>
                <div className="text-sm font-mono font-bold text-[#FF5C5C]">{signal.stopLoss}</div>
              </div>
              <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-2">
                <div className="text-[9px] uppercase text-[#64748B]">Upside</div>
                <div className="text-sm font-mono font-bold text-[#00E676]">
                  +{(((signal.targetPrice - signal.entryPrice) / signal.entryPrice) * 100).toFixed(1)}%
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {confirmation ? (
          // Confirmation view
          <Card className="bg-[#131829] border-[#00E676]/30">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-[#00E676]/20 flex items-center justify-center">
                  <Check className="h-4 w-4 text-[#00E676]" />
                </div>
                <CardTitle className="text-base text-[#F4F7FB]">Trade filled</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-4 space-y-2.5 text-sm font-mono">
                <div className="flex justify-between">
                  <span className="text-[#94A3B8]">Trade reference</span>
                  <span className="text-[#00E676] font-bold">{confirmation.tradeRef}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#94A3B8]">Broker</span>
                  <span className="text-[#F4F7FB]">{confirmation.broker}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#94A3B8]">Symbol</span>
                  <span className="text-[#F4F7FB]">{signal.symbol}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#94A3B8]">Shares</span>
                  <span className="text-[#F4F7FB]">{confirmation.shares.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#94A3B8]">Filled price</span>
                  <span className="text-[#F4F7FB]">{confirmation.filledPrice}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#94A3B8]">Order value</span>
                  <span className="text-[#F4F7FB]">PKR {confirmation.orderValue.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#94A3B8]">Commission</span>
                  <span className="text-[#F4F7FB]">PKR {confirmation.commission.toLocaleString()}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-white/[0.06]">
                  <span className="text-[#94A3B8] font-semibold">Total debit</span>
                  <span className="text-[#F4F7FB] font-bold">PKR {confirmation.totalDebit.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#94A3B8]">Settlement</span>
                  <span className="text-[#F4F7FB]">
                    {new Date(confirmation.settlementDate).toLocaleDateString("en-PK", { year: "numeric", month: "short", day: "numeric" })}
                  </span>
                </div>
              </div>

              <div className="rounded-lg bg-[#00E676]/[0.07] border border-[#00E676]/20 p-3 flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-[#00E676] flex-shrink-0 mt-0.5" />
                <p className="text-xs text-[#94A3B8] leading-relaxed">
                  Your trade is now <span className="text-[#00E676] font-semibold">tracked automatically</span>.
                  We&apos;ll monitor entry, target, and stop-loss. You&apos;ll see results in your
                  Track Record once the position closes.
                </p>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => setView("track_record")}
                  variant="outline"
                  className="flex-1 border-white/[0.12] text-[#94A3B8] hover:text-[#F4F7FB]"
                >
                  View track record
                </Button>
                <Button
                  onClick={handleReset}
                  className="flex-1 bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold"
                >
                  Back to signals
                  <ArrowRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          // Order form
          <>
            {/* Broker selection */}
            <Card className="bg-[#131829] border-white/[0.08] mb-4">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-[#00E676]" />
                  <CardTitle className="text-base text-[#F4F7FB]">Select broker</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {brokers.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => setSelectedBroker(b.id)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                        selectedBroker === b.id
                          ? "border-[#00E676]/40 bg-[#00E676]/[0.05]"
                          : "border-white/[0.08] bg-[#0A0E1A] hover:border-white/[0.15]"
                      }`}
                    >
                      <div
                        className="h-8 w-8 rounded-md flex items-center justify-center font-bold text-[#0A0E1A] text-xs"
                        style={{ backgroundColor: b.logoColor }}
                      >
                        {b.name[0]}
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-[#F4F7FB] text-sm">{b.name}</div>
                        <div className="text-[11px] text-[#94A3B8]">
                          {b.commissionPct}% commission · T+{b.settlementDays} settlement
                        </div>
                      </div>
                      {selectedBroker === b.id && (
                        <Check className="h-4 w-4 text-[#00E676]" />
                      )}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Order details */}
            <Card className="bg-[#131829] border-white/[0.08] mb-4">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-[#00E676]" />
                  <CardTitle className="text-base text-[#F4F7FB]">Order details</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <div className="space-y-2">
                  <Label htmlFor="shares" className="text-[#94A3B8]">Number of shares</Label>
                  <Input
                    id="shares"
                    type="number"
                    value={shares}
                    onChange={(e) => setShares(Math.max(0, Number(e.target.value)))}
                    className="bg-[#0A0E1A] border-white/[0.12] text-[#F4F7FB] font-mono"
                  />
                  <div className="flex gap-2">
                    {[50_000, 100_000, 250_000].map((amt) => (
                      <Button
                        key={amt}
                        size="sm"
                        variant="outline"
                        onClick={() => setShares(Math.floor(amt / signal.entryPrice))}
                        className="border-white/[0.12] text-[#94A3B8] hover:text-[#F4F7FB] text-xs"
                      >
                        PKR {(amt / 1000).toFixed(0)}K
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-4 space-y-2 text-sm font-mono">
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Shares</span>
                    <span className="text-[#F4F7FB]">{shares.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Price</span>
                    <span className="text-[#F4F7FB]">{signal.entryPrice}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Order value</span>
                    <span className="text-[#F4F7FB]">PKR {orderValue.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#94A3B8]">Commission (~0.10%)</span>
                    <span className="text-[#F4F7FB]">PKR {commission.toFixed(0)}</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-white/[0.06]">
                    <span className="text-[#94A3B8] font-semibold">Total debit</span>
                    <span className="text-[#00E676] font-bold">PKR {totalDebit.toLocaleString()}</span>
                  </div>
                </div>

                <div className="rounded-lg bg-[#FF5C5C]/[0.07] border border-[#FF5C5C]/20 p-3 text-[11px] text-[#94A3B8] leading-relaxed">
                  <span className="text-[#FF5C5C] font-semibold">Risk:</span> If stop-loss
                  hits at {signal.stopLoss}, you lose approximately{" "}
                  <span className="text-[#FF5C5C] font-mono">
                    PKR {((signal.entryPrice - signal.stopLoss) * shares).toLocaleString()}
                  </span>{" "}
                  ({(((signal.entryPrice - signal.stopLoss) / signal.entryPrice) * 100).toFixed(1)}%).
                  Only trade with capital you can afford to lose.
                </div>

                <Button
                  onClick={handleSubmit}
                  disabled={submitting || shares <= 0 || signal.status === "TRIGGERED"}
                  className="w-full bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold h-11"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      Routing to broker...
                    </>
                  ) : signal.status === "TRIGGERED" ? (
                    "Entry window closed"
                  ) : (
                    <>
                      Execute order · PKR {totalDebit.toLocaleString()}
                      <ArrowRight className="h-4 w-4 ml-1.5" />
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3 text-[11px] text-[#64748B] leading-relaxed">
              <span className="text-[#94A3B8] font-semibold">Demo mode:</span> Orders are
              simulated end-to-end — no real broker integration is active. This represents the
              planned UX once SECP RIA licensing and broker API agreements are in place.
            </div>
          </>
        )}
      </main>
    </div>
  );
}
