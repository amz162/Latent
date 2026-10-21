"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AppNav } from "./AppNav";
import { useLatentStore } from "@/lib/latent/store";
import { calculateCGT, calculateAggregatedCGT, type FilerStatus, type RealizedTrade } from "@/lib/latent/tax";
import { Calculator, TrendingUp, TrendingDown, Info, AlertCircle, Coins, Receipt } from "lucide-react";
import { toast } from "sonner";

export function CgtCalculator() {
  const filerStatus = useLatentStore((s) => s.filerStatus);
  const setFilerStatus = useLatentStore((s) => s.setFilerStatus);

  // Single-trade mode
  const [buyPrice, setBuyPrice] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [shares, setShares] = useState("");
  const [commissionPct, setCommissionPct] = useState("0.12");
  const [result, setResult] = useState<ReturnType<typeof calculateCGT> | null>(null);

  // Aggregated mode
  const [aggInput, setAggInput] = useState("");
  const [aggResult, setAggResult] = useState<ReturnType<typeof calculateAggregatedCGT> | null>(null);
  const [aggMode, setAggMode] = useState(false);

  const handleSingleCalc = () => {
    const bp = Number(buyPrice);
    const sp = Number(sellPrice);
    const sh = Number(shares);
    const cp = Number(commissionPct);

    if (!bp || !sp || !sh) {
      toast.error("Fill in buy price, sell price, and shares");
      return;
    }
    if (sp <= 0 || bp <= 0 || sh <= 0) {
      toast.error("Values must be positive");
      return;
    }

    const res = calculateCGT({
      buyPrice: bp,
      sellPrice: sp,
      shares: sh,
      filerStatus: filerStatus as FilerStatus,
      commissionPct: cp / 100,
    });
    setResult(res);
    toast.success(`CGT calculated: PKR ${res.cgtAmount.toLocaleString()} tax owed`);
  };

  const handleAggCalc = () => {
    // Parse aggInput: each line = "SYMBOL,buyPrice,sellPrice,shares"
    const lines = aggInput.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      toast.error("Enter at least one trade (one per line: SYMBOL,buy,sell,shares)");
      return;
    }
    const trades: RealizedTrade[] = [];
    for (const line of lines) {
      const parts = line.split(",");
      if (parts.length !== 4) {
        toast.error(`Invalid line: "${line}" — use format SYMBOL,buyPrice,sellPrice,shares`);
        return;
      }
      const [symbol, buy, sell, sh] = parts;
      const trade: RealizedTrade = {
        symbol: symbol.trim().toUpperCase(),
        buyPrice: Number(buy),
        sellPrice: Number(sell),
        shares: Number(sh),
        realizedAt: new Date().toISOString(),
      };
      if (!trade.buyPrice || !trade.sellPrice || !trade.shares) {
        toast.error(`Invalid numbers in line: "${line}"`);
        return;
      }
      trades.push(trade);
    }
    const res = calculateAggregatedCGT(trades, filerStatus as FilerStatus);
    setAggResult(res);
    toast.success(`Aggregated CGT for ${trades.length} trades calculated`);
  };

  return (
    <div className="min-h-screen bg-[#0A0E1A]">
      <AppNav />
      <main className="px-4 md:px-6 py-6 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[#F4F7FB] flex items-center gap-2">
            <Calculator className="h-6 w-6 text-[#00E676]" />
            CGT Calculator
          </h1>
          <p className="text-sm text-[#94A3B8] mt-1">
            Capital Gain Tax on realized PSX trades. Filer: 15%. Non-filer: 30%. Only on realized gains (when you actually sell).
          </p>
        </div>

        {/* Disclaimer */}
        <div className="rounded-lg bg-[#FF5C5C]/[0.05] border border-[#FF5C5C]/15 p-3 mb-6">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-[#FF5C5C] flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-[#94A3B8] leading-relaxed">
              <span className="text-[#FF5C5C] font-semibold">Disclaimer:</span> Tax calculations assume your declared filer status is accurate. Verify on FBR's Active Taxpayer List (ATL). This is informational only — consult a tax professional for filing.
            </p>
          </div>
        </div>

        {/* Filer status selector */}
        <Card className="bg-[#131829] border-white/[0.08] mb-4">
          <CardContent className="p-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <div className="text-xs uppercase tracking-wider text-[#64748B] mb-1">Your Tax Status</div>
                <div className="text-sm text-[#F4F7FB]">Active Filer (15%) or Non-Filer (30%)</div>
              </div>
              <RadioGroup
                value={filerStatus}
                onValueChange={(v) => setFilerStatus(v as "filer" | "non-filer")}
                className="flex items-center gap-4"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="filer" id="cgt-filer" className="text-[#00E676]" />
                  <Label htmlFor="cgt-filer" className="text-[#F4F7FB] text-sm cursor-pointer">Active Filer (15%)</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="non-filer" id="cgt-non-filer" className="text-[#FF5C5C]" />
                  <Label htmlFor="cgt-non-filer" className="text-[#F4F7FB] text-sm cursor-pointer">Non-Filer (30%)</Label>
                </div>
              </RadioGroup>
            </div>
          </CardContent>
        </Card>

        {/* Mode toggle */}
        <div className="flex items-center gap-2 mb-4">
          <Button
            size="sm"
            variant={!aggMode ? "default" : "outline"}
            onClick={() => setAggMode(false)}
            className={!aggMode ? "bg-[#00E676] text-[#0A0E1A]" : "border-white/[0.12] text-[#94A3B8]"}
          >
            Single Trade
          </Button>
          <Button
            size="sm"
            variant={aggMode ? "default" : "outline"}
            onClick={() => setAggMode(true)}
            className={aggMode ? "bg-[#00E676] text-[#0A0E1A]" : "border-white/[0.12] text-[#94A3B8]"}
          >
            Multiple Trades (Year-end)
          </Button>
        </div>

        {/* Single-trade calculator */}
        {!aggMode && (
          <Card className="bg-[#131829] border-white/[0.08] mb-4">
            <CardHeader>
              <CardTitle className="text-base text-[#F4F7FB]">Single Trade CGT</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <Label className="text-[#94A3B8] text-xs">Buy Price (PKR)</Label>
                  <Input
                    type="number"
                    value={buyPrice}
                    onChange={(e) => setBuyPrice(e.target.value)}
                    placeholder="e.g. 250"
                    className="bg-[#0A0E1A] border-white/[0.12] text-[#F4F7FB] font-mono"
                  />
                </div>
                <div>
                  <Label className="text-[#94A3B8] text-xs">Sell Price (PKR)</Label>
                  <Input
                    type="number"
                    value={sellPrice}
                    onChange={(e) => setSellPrice(e.target.value)}
                    placeholder="e.g. 290"
                    className="bg-[#0A0E1A] border-white/[0.12] text-[#F4F7FB] font-mono"
                  />
                </div>
                <div>
                  <Label className="text-[#94A3B8] text-xs">Shares</Label>
                  <Input
                    type="number"
                    value={shares}
                    onChange={(e) => setShares(e.target.value)}
                    placeholder="e.g. 1000"
                    className="bg-[#0A0E1A] border-white/[0.12] text-[#F4F7FB] font-mono"
                  />
                </div>
                <div>
                  <Label className="text-[#94A3B8] text-xs">Commission (%)</Label>
                  <Input
                    type="number"
                    value={commissionPct}
                    onChange={(e) => setCommissionPct(e.target.value)}
                    step="0.01"
                    className="bg-[#0A0E1A] border-white/[0.12] text-[#F4F7FB] font-mono"
                  />
                </div>
              </div>
              <Button
                onClick={handleSingleCalc}
                className="bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold"
              >
                <Calculator className="h-4 w-4 mr-1.5" />
                Calculate CGT
              </Button>

              {result && (
                <div className="space-y-3 pt-3 border-t border-white/[0.06]">
                  {/* Headline result */}
                  <div className={`rounded-lg p-4 border ${result.profitAfterTax >= 0 ? "bg-[#00E676]/[0.07] border-[#00E676]/20" : "bg-[#FF5C5C]/[0.07] border-[#FF5C5C]/20"}`}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Net profit after tax</span>
                      {result.profitAfterTax >= 0 ? (
                        <TrendingUp className="h-4 w-4 text-[#00E676]" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-[#FF5C5C]" />
                      )}
                    </div>
                    <div className={`text-3xl font-bold font-mono ${result.profitAfterTax >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}`}>
                      PKR {result.profitAfterTax.toLocaleString("en-PK", { maximumFractionDigits: 0 })}
                    </div>
                  </div>

                  {/* Breakdown */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                    <StatBox label="Buy value" value={`PKR ${result.buyValue.toLocaleString()}`} />
                    <StatBox label="Sell value" value={`PKR ${result.sellValue.toLocaleString()}`} />
                    <StatBox label="Gross gain" value={`PKR ${result.grossGain.toLocaleString()}`} tone={result.grossGain >= 0 ? "positive" : "negative"} />
                    <StatBox label="Commission (buy)" value={`PKR ${result.commissionBuy.toLocaleString()}`} />
                    <StatBox label="Commission (sell)" value={`PKR ${result.commissionSell.toLocaleString()}`} />
                    <StatBox label="Net gain (after costs)" value={`PKR ${result.netGain.toLocaleString()}`} tone={result.netGain >= 0 ? "positive" : "negative"} />
                    <StatBox label={`CGT rate (${filerStatus === "filer" ? "15%" : "30%"})`} value={`${(result.cgtRate * 100).toFixed(0)}%`} />
                    <StatBox label="CGT amount" value={`PKR ${result.cgtAmount.toLocaleString()}`} tone="warning" />
                    <StatBox label="Effective tax rate" value={`${(result.effectiveTaxRate * 100).toFixed(2)}%`} />
                  </div>

                  {result.lossOffsetEligible && (
                    <div className="rounded-md bg-[#FBBF24]/[0.05] border border-[#FBBF24]/20 p-3 text-xs text-[#94A3B8] flex items-start gap-2">
                      <Info className="h-3.5 w-3.5 text-[#FBBF24] flex-shrink-0 mt-0.5" />
                      <span>This is a <span className="text-[#FBBF24]">capital loss</span>. You can offset it against capital gains from other trades within the same fiscal year (July 1 – June 30).</span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Aggregated calculator */}
        {aggMode && (
          <Card className="bg-[#131829] border-white/[0.08] mb-4">
            <CardHeader>
              <CardTitle className="text-base text-[#F4F7FB]">Year-End Aggregated CGT (Multiple Trades)</CardTitle>
              <p className="text-xs text-[#94A3B8] mt-1">
                Paste your realized trades (one per line): <code className="text-[#94A3B8]">SYMBOL,buyPrice,sellPrice,shares</code>
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <textarea
                value={aggInput}
                onChange={(e) => setAggInput(e.target.value)}
                placeholder={"HUBC,124.50,140.20,1000\nENGRO,285,310,500\nLUCK,890,920,200"}
                className="w-full h-32 bg-[#0A0E1A] border border-white/[0.12] rounded-md p-3 text-[#F4F7FB] font-mono text-xs resize-y"
              />
              <Button
                onClick={handleAggCalc}
                className="bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold"
              >
                <Receipt className="h-4 w-4 mr-1.5" />
                Calculate Aggregated CGT
              </Button>

              {aggResult && (
                <div className="space-y-3 pt-3 border-t border-white/[0.06]">
                  <div className={`rounded-lg p-4 border ${aggResult.netGain >= 0 ? "bg-[#00E676]/[0.07] border-[#00E676]/20" : "bg-[#FF5C5C]/[0.07] border-[#FF5C5C]/20"}`}>
                    <div className="text-[10px] uppercase tracking-wider text-[#64748B] mb-1">Net result after tax</div>
                    <div className={`text-3xl font-bold font-mono ${aggResult.netGain >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}`}>
                      PKR {aggResult.profitAfterTax.toLocaleString("en-PK", { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <StatBox label="Trades counted" value={String(aggResult.tradeCount)} />
                    <StatBox label="Winning trades" value={String(aggResult.winningTrades)} tone="positive" />
                    <StatBox label="Losing trades" value={String(aggResult.losingTrades)} tone="negative" />
                    <StatBox label="Total commission" value={`PKR ${aggResult.totalCommission.toLocaleString()}`} />
                    <StatBox label="Total gains" value={`PKR ${aggResult.totalGrossGain.toLocaleString()}`} tone="positive" />
                    <StatBox label="Total losses" value={`PKR ${aggResult.totalGrossLoss.toLocaleString()}`} tone="negative" />
                    <StatBox label="Net taxable gain" value={`PKR ${aggResult.taxableGain.toLocaleString()}`} tone={aggResult.taxableGain >= 0 ? "positive" : "negative"} />
                    <StatBox label="CGT owed" value={`PKR ${aggResult.cgtAmount.toLocaleString()}`} tone="warning" />
                  </div>
                  {aggResult.lossCarriedForward > 0 && (
                    <div className="rounded-md bg-[#FBBF24]/[0.05] border border-[#FBBF24]/20 p-3 text-xs text-[#94A3B8]">
                      <Info className="h-3.5 w-3.5 text-[#FBBF24] inline mr-2" />
                      Net loss detected. <span className="text-[#FBBF24]">PKR {aggResult.lossCarriedForward.toLocaleString()}</span> loss may be carried forward to offset future capital gains (per Pakistan tax rules — confirm with tax advisor).
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* How it works */}
        <Card className="bg-[#131829] border-white/[0.08]">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-[#F4F7FB] mb-3 flex items-center gap-2">
              <Coins className="h-4 w-4 text-[#00E676]" />
              How CGT works in Pakistan
            </h3>
            <ul className="space-y-2 text-xs text-[#94A3B8] leading-relaxed">
              <li className="flex items-start gap-2">
                <span className="text-[#00E676] mt-0.5">▸</span>
                <span><span className="text-[#F4F7FB]">15% filer / 30% non-filer</span> — applied on <span className="text-[#F4F7FB]">realized gains</span> (when you sell). Paper gains are not taxed.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#00E676] mt-0.5">▸</span>
                <span><span className="text-[#F4F7FB]">Loss offset:</span> Capital losses from one trade can offset capital gains from another trade within the same fiscal year (July 1 – June 30).</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#00E676] mt-0.5">▸</span>
                <span><span className="text-[#F4F7FB]">Active filer verification:</span> Check FBR's Active Taxpayer List (ATL). Non-filers pay double tax.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#00E676] mt-0.5">▸</span>
                <span><span className="text-[#F4F7FB]">Fiscal year:</span> Pakistan's tax year is July 1 to June 30. Plan sales accordingly for tax efficiency.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#00E676] mt-0.5">▸</span>
                <span><span className="text-[#F4F7FB]">Commission:</span> Broker commission (typically 0.10-0.15%) is deducted before computing taxable gain.</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function StatBox({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" | "warning" }) {
  const color = tone === "positive" ? "text-[#00E676]" : tone === "negative" ? "text-[#FF5C5C]" : tone === "warning" ? "text-[#FBBF24]" : "text-[#F4F7FB]";
  return (
    <div className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-[#64748B]">{label}</div>
      <div className={`text-sm font-mono font-bold ${color}`}>{value}</div>
    </div>
  );
}
