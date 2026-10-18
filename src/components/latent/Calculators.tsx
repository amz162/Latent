"use client";

import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { AppNav } from "./AppNav";
import {
  Calculator,
  Coins,
  TrendingUp,
  Info,
  Calendar,
  Crosshair,
} from "lucide-react";
import { toast } from "sonner";

/* ============================================================
 * Helpers
 * ============================================================ */

function fmtMoney(n: number): string {
  if (!isFinite(n) || isNaN(n)) return "Rs 0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_00_00_000) return `${sign}Rs ${(abs / 1_00_00_000).toFixed(2)} Cr`;
  if (abs >= 1_00_000) return `${sign}Rs ${(abs / 1_00_000).toFixed(2)} Lac`;
  if (abs >= 1_000) return `${sign}Rs ${abs.toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
  return `${sign}Rs ${abs.toFixed(2)}`;
}

function fmtNum(n: number, d = 2): string {
  if (!isFinite(n) || isNaN(n)) return "0";
  return n.toLocaleString("en-PK", { maximumFractionDigits: d, minimumFractionDigits: d });
}

function monthsBetween(buy: string, sell: string): number {
  if (!buy || !sell) return 0;
  const b = new Date(buy);
  const s = new Date(sell);
  if (isNaN(b.getTime()) || isNaN(s.getTime())) return 0;
  const diff = (s.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
  return diff / 30.4375; // avg month length
}

/* ============================================================
 * 1. CGT Calculator
 * ============================================================ */

type FilerStatus = "filer" | "non_filer";

function getCgtRateClean(months: number, status: FilerStatus): { rate: number; band: string } {
  if (months <= 12) return { rate: status === "filer" ? 15 : 22.5, band: "≤ 12 months (Short-term)" };
  if (months <= 24) return { rate: status === "filer" ? 12.5 : 18.75, band: "12–24 months (Mid-term)" };
  return { rate: 0, band: "> 24 months (Long-term — exempt)" };
}

function CgtCalculator() {
  const [buyPrice, setBuyPrice] = useState("150");
  const [sellPrice, setSellPrice] = useState("180");
  const [qty, setQty] = useState("1000");
  const [buyDate, setBuyDate] = useState("");
  const [sellDate, setSellDate] = useState("");
  const [brokerage, setBrokerage] = useState("0.15");
  const [filer, setFiler] = useState<FilerStatus>("filer");

  const r = useMemo(() => {
    const bp = parseFloat(buyPrice) || 0;
    const sp = parseFloat(sellPrice) || 0;
    const q = parseFloat(qty) || 0;
    const br = parseFloat(brokerage) || 0;

    const buyValue = bp * q;
    const sellValue = sp * q;
    const grossGain = sellValue - buyValue;
    const brokerageBuy = buyValue * (br / 100);
    const brokerageSell = sellValue * (br / 100);
    const totalBrokerage = brokerageBuy + brokerageSell;
    const netGainBeforeTax = grossGain - totalBrokerage;

    const months = monthsBetween(buyDate, sellDate);
    const { rate, band } = getCgtRateClean(months, filer);
    const cgt = Math.max(0, netGainBeforeTax) * (rate / 100);
    const netProfit = netGainBeforeTax - cgt;
    const totalInvested = buyValue + brokerageBuy;
    const roi = totalInvested > 0 ? (netProfit / totalInvested) * 100 : 0;

    return {
      buyValue,
      sellValue,
      grossGain,
      brokerageBuy,
      brokerageSell,
      totalBrokerage,
      netGainBeforeTax,
      months,
      rate,
      band,
      cgt,
      netProfit,
      totalInvested,
      roi,
    };
  }, [buyPrice, sellPrice, qty, buyDate, sellDate, brokerage, filer]);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {/* Inputs */}
      <Card className="bg-[#131829] border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-[#F4F7FB] text-base flex items-center gap-2">
            <Calculator className="h-4 w-4 text-[#00E676]" />
            Trade Inputs
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Buy price (Rs)</Label>
              <Input
                type="number"
                value={buyPrice}
                onChange={(e) => setBuyPrice(e.target.value)}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Sell price (Rs)</Label>
              <Input
                type="number"
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Quantity (shares)</Label>
              <Input
                type="number"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Brokerage (%)</Label>
              <Input
                type="number"
                step="0.01"
                value={brokerage}
                onChange={(e) => setBrokerage(e.target.value)}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8] flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Buy date
              </Label>
              <Input
                type="date"
                value={buyDate}
                onChange={(e) => setBuyDate(e.target.value)}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8] flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Sell date
              </Label>
              <Input
                type="date"
                value={sellDate}
                onChange={(e) => setSellDate(e.target.value)}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-[#94A3B8]">Filer status</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant={filer === "filer" ? "default" : "outline"}
                onClick={() => setFiler("filer")}
                className={
                  filer === "filer"
                    ? "bg-[#00E676] text-[#0A0E1A] hover:bg-[#00E676]/90"
                    : "bg-transparent border-white/[0.12] text-[#94A3B8] hover:text-[#F4F7FB]"
                }
              >
                Filer
              </Button>
              <Button
                size="sm"
                variant={filer === "non_filer" ? "default" : "outline"}
                onClick={() => setFiler("non_filer")}
                className={
                  filer === "non_filer"
                    ? "bg-[#FF5C5C] text-[#0A0E1A] hover:bg-[#FF5C5C]/90"
                    : "bg-transparent border-white/[0.12] text-[#94A3B8] hover:text-[#F4F7FB]"
                }
              >
                Non-Filer
              </Button>
            </div>
          </div>

          <div className="flex items-start gap-2 p-2.5 rounded-md bg-[#0A0E1A] border border-white/[0.06]">
            <Info className="h-3.5 w-3.5 text-[#00E676] shrink-0 mt-0.5" />
            <p className="text-[10px] text-[#94A3B8] leading-relaxed">
              Pakistan CGT slabs: <span className="text-[#F4F7FB]">≤12mo = 15% / 22.5%</span>,
              {" "}12–24mo = <span className="text-[#F4F7FB]">12.5% / 18.75%</span>,
              {" "}{"> 24mo = 0%"} (exempt). Filer / Non-filer respectively.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card className="bg-[#131829] border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-[#F4F7FB] text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[#00E676]" />
            Tax & Profit Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5">
            <Stat label="Buy value" value={fmtMoney(r.buyValue)} />
            <Stat label="Sell value" value={fmtMoney(r.sellValue)} />
            <Stat label="Gross capital gain" value={fmtMoney(r.grossGain)} tone={r.grossGain >= 0 ? "pos" : "neg"} />
            <Stat label="Total brokerage" value={fmtMoney(r.totalBrokerage)} tone="neg" />
          </div>

          <div className="p-2.5 rounded-md bg-[#0A0E1A] border border-white/[0.06]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-wider text-[#64748B]">Holding period</span>
              <Badge variant="outline" className="border-white/[0.12] bg-transparent text-[#94A3B8] text-[10px]">
                {r.months > 0 ? `${r.months.toFixed(1)} months` : "Set buy & sell dates"}
              </Badge>
            </div>
            <div className="text-xs text-[#94A3B8]">
              Tax band: <span className="text-[#F4F7FB]">{r.band}</span>
              {" · "}Rate: <span className="text-[#00E676] font-mono">{r.rate}%</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <Stat label="Net gain before tax" value={fmtMoney(r.netGainBeforeTax)} tone={r.netGainBeforeTax >= 0 ? "pos" : "neg"} />
            <Stat label="CGT payable" value={fmtMoney(r.cgt)} tone={r.cgt > 0 ? "neg" : "neutral"} />
          </div>

          <div className="p-3 rounded-md bg-gradient-to-br from-[#00E676]/[0.07] to-transparent border border-[#00E676]/20">
            <div className="text-[10px] uppercase tracking-wider text-[#00E676]">Net Profit after CGT</div>
            <div className={`text-2xl font-bold font-mono ${r.netProfit >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}`}>
              {fmtMoney(r.netProfit)}
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <Badge variant="outline" className="border-[#00E676]/30 bg-[#00E676]/10 text-[#00E676] text-[10px] font-mono">
                ROI: {r.roi.toFixed(2)}%
              </Badge>
              <span className="text-[10px] text-[#64748B]">
                on invested {fmtMoney(r.totalInvested)}
              </span>
            </div>
          </div>

          <Button
            size="sm"
            variant="outline"
            className="w-full border-white/[0.12] text-[#94A3B8] hover:text-[#F4F7FB] hover:bg-white/[0.04]"
            onClick={() => toast.success("CGT calculation saved to records")}
          >
            Save calculation
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================================================
 * 2. Dividend Tax Calculator
 * ============================================================ */

type DivTaxCat = "filer" | "non_filer" | "company";

const DIV_TAX_RATES: Record<DivTaxCat, { rate: number; label: string }> = {
  filer: { rate: 15, label: "Filer Individual" },
  non_filer: { rate: 20, label: "Non-Filer Individual" },
  company: { rate: 39, label: "Company / Corp" },
};

function DividendCalculator() {
  const [dps, setDps] = useState("5");
  const [shares, setShares] = useState("1000");
  const [buyPrice, setBuyPrice] = useState("100");
  const [cat, setCat] = useState<DivTaxCat>("filer");

  const r = useMemo(() => {
    const d = parseFloat(dps) || 0;
    const s = parseFloat(shares) || 0;
    const bp = parseFloat(buyPrice) || 0;
    const gross = d * s;
    const rate = DIV_TAX_RATES[cat].rate;
    const tax = gross * (rate / 100);
    const net = gross - tax;
    const invested = bp * s;
    const yieldPct = invested > 0 ? (net / invested) * 100 : 0;
    return { gross, rate, tax, net, invested, yieldPct };
  }, [dps, shares, buyPrice, cat]);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card className="bg-[#131829] border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-[#F4F7FB] text-base flex items-center gap-2">
            <Coins className="h-4 w-4 text-[#00E676]" />
            Dividend Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Gross DPS (Rs/share)</Label>
              <Input
                type="number"
                step="0.25"
                value={dps}
                onChange={(e) => setDps(e.target.value)}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Shares held</Label>
              <Input
                type="number"
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs text-[#94A3B8]">Buy price (Rs/share)</Label>
              <Input
                type="number"
                value={buyPrice}
                onChange={(e) => setBuyPrice(e.target.value)}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-[#94A3B8]">Tax category</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.keys(DIV_TAX_RATES) as DivTaxCat[]).map((k) => {
                const isActive = cat === k;
                return (
                  <Button
                    key={k}
                    size="sm"
                    variant={isActive ? "default" : "outline"}
                    onClick={() => setCat(k)}
                    className={
                      isActive
                        ? "bg-[#00E676] text-[#0A0E1A] hover:bg-[#00E676]/90 text-[11px]"
                        : "bg-transparent border-white/[0.12] text-[#94A3B8] hover:text-[#F4F7FB] text-[11px]"
                    }
                  >
                    {DIV_TAX_RATES[k].label.split(" ")[0]}
                  </Button>
                );
              })}
            </div>
            <p className="text-[10px] text-[#64748B] mt-1">
              Selected: <span className="text-[#F4F7FB]">{DIV_TAX_RATES[cat].label}</span>
              {" · "}Tax rate: <span className="text-[#00E676] font-mono">{DIV_TAX_RATES[cat].rate}%</span>
            </p>
          </div>

          <div className="flex items-start gap-2 p-2.5 rounded-md bg-[#0A0E1A] border border-white/[0.06]">
            <Info className="h-3.5 w-3.5 text-[#00E676] shrink-0 mt-0.5" />
            <p className="text-[10px] text-[#94A3B8] leading-relaxed">
              PSX withholding tax on dividends: <span className="text-[#F4F7FB]">Filer 15%</span>,
              {" Non-Filer 20%"}, <span className="text-[#F4F7FB]">Company 39%</span> (incl. super tax).
              Tax is deducted at source by the company paying the dividend.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[#131829] border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-[#F4F7FB] text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[#00E676]" />
            Payout Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5">
            <Stat label="Gross dividend" value={fmtMoney(r.gross)} tone="pos" />
            <Stat label="Tax withheld" value={fmtMoney(r.tax)} tone="neg" />
            <Stat label="Net dividend" value={fmtMoney(r.net)} tone="pos" />
            <Stat label="Cost basis" value={fmtMoney(r.invested)} />
          </div>

          <div className="p-3 rounded-md bg-gradient-to-br from-[#00E676]/[0.07] to-transparent border border-[#00E676]/20">
            <div className="text-[10px] uppercase tracking-wider text-[#00E676]">Net Dividend Yield</div>
            <div className="text-2xl font-bold text-[#00E676] font-mono">{r.yieldPct.toFixed(2)}%</div>
            <div className="text-[10px] text-[#64748B] mt-1">
              Net cash / invested capital · Tax rate {r.rate}%
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1">
            <MiniStat label="Per share (gross)" value={`Rs ${fmtNum(parseFloat(dps) || 0)}`} />
            <MiniStat label="Per share (net)" value={`Rs ${fmtNum((parseFloat(dps) || 0) * (1 - r.rate / 100))}`} />
            <MiniStat label="Eff. tax" value={`${r.rate}%`} />
          </div>

          <Button
            size="sm"
            variant="outline"
            className="w-full border-white/[0.12] text-[#94A3B8] hover:text-[#F4F7FB] hover:bg-white/[0.04]"
            onClick={() => toast.success("Dividend calculation saved")}
          >
            Save calculation
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================================================
 * 3. SIP Calculator
 * ============================================================ */

const SIP_PRESETS = [
  { id: "conservative", label: "Conservative", monthly: 5000, annual: 12, years: 10, stepUp: 0 },
  { id: "balanced", label: "Balanced", monthly: 15000, annual: 15, years: 15, stepUp: 5 },
  { id: "aggressive", label: "Aggressive", monthly: 30000, annual: 18, years: 20, stepUp: 10 },
  { id: "psx_blue", label: "PSX Blue-chip", monthly: 25000, annual: 14, years: 15, stepUp: 8 },
];

function SipCalculator() {
  const [monthly, setMonthly] = useState("15000");
  const [annual, setAnnual] = useState("15");
  const [years, setYears] = useState("15");
  const [stepUp, setStepUp] = useState("5");

  const r = useMemo(() => {
    const m = parseFloat(monthly) || 0;
    const a = (parseFloat(annual) || 0) / 100;
    const y = parseInt(years) || 0;
    const su = (parseFloat(stepUp) || 0) / 100;

    const monthlyRate = Math.pow(1 + a, 1 / 12) - 1;
    const yearlyRows: { year: number; monthlyThisYear: number; contributed: number; corpus: number }[] = [];
    let corpus = 0;
    let totalContributed = 0;
    let monthlyThisYear = m;

    for (let yy = 1; yy <= y; yy++) {
      const yearContribution = monthlyThisYear * 12;
      // Grow corpus + this year's monthly contributions compounded monthly
      let yearEnd = corpus;
      for (let mo = 0; mo < 12; mo++) {
        yearEnd = yearEnd * (1 + monthlyRate) + monthlyThisYear;
      }
      corpus = yearEnd;
      totalContributed += yearContribution;
      yearlyRows.push({
        year: yy,
        monthlyThisYear,
        contributed: yearContribution,
        corpus,
      });
      // Step up for next year
      monthlyThisYear = monthlyThisYear * (1 + su);
    }

    const profit = corpus - totalContributed;
    return {
      rows: yearlyRows,
      corpus,
      totalContributed,
      profit,
      maxCorpus: Math.max(...yearlyRows.map((x) => x.corpus), 1),
    };
  }, [monthly, annual, years, stepUp]);

  const applyPreset = (p: (typeof SIP_PRESETS)[0]) => {
    setMonthly(String(p.monthly));
    setAnnual(String(p.annual));
    setYears(String(p.years));
    setStepUp(String(p.stepUp));
    toast.success(`Loaded preset: ${p.label}`);
  };

  return (
    <div className="space-y-4">
      <Card className="bg-[#131829] border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-[#F4F7FB] text-base flex items-center gap-2">
            <Calculator className="h-4 w-4 text-[#00E676]" />
            SIP Inputs
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Monthly investment (Rs)</Label>
              <Input
                type="number"
                value={monthly}
                onChange={(e) => setMonthly(e.target.value)}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Expected return (%)</Label>
              <Input
                type="number"
                step="0.5"
                value={annual}
                onChange={(e) => setAnnual(e.target.value)}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Duration (years)</Label>
              <Input
                type="number"
                value={years}
                onChange={(e) => setYears(e.target.value)}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Yearly step-up (%)</Label>
              <Input
                type="number"
                step="0.5"
                value={stepUp}
                onChange={(e) => setStepUp(e.target.value)}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs text-[#94A3B8] mb-1.5 block">Quick presets</Label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {SIP_PRESETS.map((p) => (
                <Button
                  key={p.id}
                  size="sm"
                  variant="outline"
                  onClick={() => applyPreset(p)}
                  className="bg-transparent border-white/[0.12] text-[#94A3B8] hover:text-[#00E676] hover:border-[#00E676]/40 hover:bg-[#00E676]/[0.05] text-[11px] h-auto py-2 flex flex-col items-start gap-0.5"
                >
                  <span className="font-semibold">{p.label}</span>
                  <span className="text-[9px] text-[#64748B] font-mono">
                    {fmtMoney(p.monthly)}/mo · {p.annual}% · {p.years}y
                  </span>
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-3 gap-3">
        <Card className="bg-[#131829] border-white/[0.08]">
          <CardContent className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Total invested</div>
            <div className="text-xl font-bold text-[#F4F7FB] font-mono">{fmtMoney(r.totalContributed)}</div>
            <div className="text-[10px] text-[#94A3B8] mt-1">Over {years} years</div>
          </CardContent>
        </Card>
        <Card className="bg-[#131829] border-white/[0.08]">
          <CardContent className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Estimated profit</div>
            <div className="text-xl font-bold text-[#00E676] font-mono">{fmtMoney(r.profit)}</div>
            <div className="text-[10px] text-[#94A3B8] mt-1">Compounding gains</div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-[#00E676]/[0.07] to-transparent border-[#00E676]/20">
          <CardContent className="p-4">
            <div className="text-[10px] uppercase tracking-wider text-[#00E676]">Final corpus</div>
            <div className="text-xl font-bold text-[#00E676] font-mono">{fmtMoney(r.corpus)}</div>
            <div className="text-[10px] text-[#64748B] mt-1">End of year {years}</div>
          </CardContent>
        </Card>
      </div>

      {/* Year-by-year bar chart */}
      <Card className="bg-[#131829] border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-[#F4F7FB] text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[#00E676]" />
            Year-by-year Corpus Growth
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-1 h-56 overflow-x-auto latent-no-scrollbar pb-2">
            {r.rows.map((row) => {
              const heightPct = Math.max(4, (row.corpus / r.maxCorpus) * 100);
              const isLast = row.year === r.rows.length;
              return (
                <div
                  key={row.year}
                  className="flex flex-col items-center gap-1 shrink-0"
                  style={{ minWidth: 36 }}
                >
                  <div className="text-[9px] font-mono text-[#94A3B8] h-3">
                    {row.corpus >= 1_00_000 ? `${(row.corpus / 1_00_000).toFixed(1)}L` : `${(row.corpus / 1000).toFixed(0)}k`}
                  </div>
                  <div className="flex-1 flex items-end w-full">
                    <div
                      className={`w-full rounded-t transition-all ${
                        isLast
                          ? "bg-gradient-to-t from-[#00E676] to-[#00E676]/60"
                          : "bg-gradient-to-t from-[#00E676]/40 to-[#00E676]/15"
                      }`}
                      style={{ height: `${heightPct}%` }}
                      title={`Year ${row.year}: ${fmtMoney(row.corpus)}`}
                    />
                  </div>
                  <div className="text-[9px] text-[#64748B] font-mono">Y{row.year}</div>
                </div>
              );
            })}
          </div>

          {/* Scrollable table */}
          <div className="mt-4 max-h-64 overflow-y-auto latent-thin-scrollbar rounded-md border border-white/[0.06]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#0A0E1A] z-10">
                <tr className="text-[#64748B] text-[10px] uppercase">
                  <th className="text-left p-2 font-medium">Year</th>
                  <th className="text-right p-2 font-medium">Monthly (Rs)</th>
                  <th className="text-right p-2 font-medium">Year contrib.</th>
                  <th className="text-right p-2 font-medium">Corpus (Rs)</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row, i) => (
                  <tr key={row.year} className={i % 2 === 0 ? "bg-white/[0.01]" : ""}>
                    <td className="p-2 text-[#94A3B8] font-mono">{row.year}</td>
                    <td className="p-2 text-right text-[#F4F7FB] font-mono">{fmtNum(row.monthlyThisYear, 0)}</td>
                    <td className="p-2 text-right text-[#94A3B8] font-mono">{fmtMoney(row.contributed)}</td>
                    <td className="p-2 text-right text-[#00E676] font-mono font-semibold">{fmtMoney(row.corpus)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================================================
 * 4. Position Size Calculator
 * ============================================================ */

function PositionSizeCalculator() {
  const [capital, setCapital] = useState("500000");
  const [entry, setEntry] = useState("100");
  const [sl, setSl] = useState("95");
  const [risk, setRisk] = useState("1.5");
  const [target, setTarget] = useState("115");

  const r = useMemo(() => {
    const cap = parseFloat(capital) || 0;
    const e = parseFloat(entry) || 0;
    const s = parseFloat(sl) || 0;
    const rk = (parseFloat(risk) || 0) / 100;
    const tg = parseFloat(target) || 0;

    const isLong = s < e;
    const riskPerShare = Math.abs(e - s);
    const riskAmount = cap * rk;
    const shares = riskPerShare > 0 ? riskAmount / riskPerShare : 0;
    const positionValue = shares * e;
    const rewardPerShare = isLong ? Math.abs(tg - e) : Math.abs(e - tg);
    const rrRatio = riskPerShare > 0 ? rewardPerShare / riskPerShare : 0;
    const potentialProfit = shares * rewardPerShare;
    const potentialLoss = shares * riskPerShare;
    const pctAtTarget = e > 0 ? (rewardPerShare / e) * 100 : 0;
    const pctAtSl = e > 0 ? (riskPerShare / e) * 100 : 0;
    const capitalDeployedPct = cap > 0 ? (positionValue / cap) * 100 : 0;

    // Quality
    let quality: { label: string; tone: "neg" | "warn" | "ok" | "good" | "great" } = { label: "Poor", tone: "neg" };
    if (rrRatio >= 3) quality = { label: "Excellent", tone: "great" };
    else if (rrRatio >= 2) quality = { label: "Very Good", tone: "good" };
    else if (rrRatio >= 1.5) quality = { label: "Good", tone: "ok" };
    else if (rrRatio >= 1) quality = { label: "Fair", tone: "warn" };

    return {
      isLong,
      riskPerShare,
      riskAmount,
      shares,
      positionValue,
      rewardPerShare,
      rrRatio,
      potentialProfit,
      potentialLoss,
      pctAtTarget,
      pctAtSl,
      capitalDeployedPct,
      quality,
    };
  }, [capital, entry, sl, risk, target]);

  // Format R:R as "1:2.25" — strip trailing zeros from integer parts, keep 2-decimal ratio
  const rrFormatted = useMemo(() => {
    if (r.rrRatio <= 0) return "1:0";
    // Avoid "1.0:2.0"; always "1:X" where X has up to 2 decimals trimmed
    const ratioStr = Number.isInteger(r.rrRatio)
      ? String(r.rrRatio)
      : r.rrRatio.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return `1:${ratioStr || "0"}`;
  }, [r.rrRatio]);

  const qualityToneClass: Record<typeof r.quality.tone, string> = {
    neg: "border-[#FF5C5C]/30 bg-[#FF5C5C]/10 text-[#FF5C5C]",
    warn: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    ok: "border-[#00E676]/30 bg-[#00E676]/10 text-[#00E676]",
    good: "border-[#00E676]/40 bg-[#00E676]/15 text-[#00E676]",
    great: "border-[#00E676]/50 bg-[#00E676]/20 text-[#00E676]",
  };

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card className="bg-[#131829] border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-[#F4F7FB] text-base flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-[#00E676]" />
            Trade Setup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs text-[#94A3B8]">Total capital (Rs)</Label>
              <Input
                type="number"
                value={capital}
                onChange={(e) => setCapital(e.target.value)}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Entry price (Rs)</Label>
              <Input
                type="number"
                step="0.01"
                value={entry}
                onChange={(e) => setEntry(e.target.value)}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Stop-loss (Rs)</Label>
              <Input
                type="number"
                step="0.01"
                value={sl}
                onChange={(e) => setSl(e.target.value)}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Risk per trade (%)</Label>
              <Input
                type="number"
                step="0.1"
                value={risk}
                onChange={(e) => setRisk(e.target.value)}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Target price (Rs)</Label>
              <Input
                type="number"
                step="0.01"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
          </div>

          {/* Auto-detected direction */}
          <div className="flex items-center justify-between p-2.5 rounded-md bg-[#0A0E1A] border border-white/[0.06]">
            <span className="text-xs text-[#94A3B8]">Auto-detected direction</span>
            <Badge
              variant="outline"
              className={`text-[11px] font-mono ${
                r.isLong
                  ? "border-[#00E676]/40 bg-[#00E676]/10 text-[#00E676]"
                  : "border-[#FF5C5C]/40 bg-[#FF5C5C]/10 text-[#FF5C5C]"
              }`}
            >
              {r.isLong ? "▲ LONG" : "▼ SHORT"}
            </Badge>
          </div>

          <div className="flex items-start gap-2 p-2.5 rounded-md bg-[#0A0E1A] border border-white/[0.06]">
            <Info className="h-3.5 w-3.5 text-[#00E676] shrink-0 mt-0.5" />
            <p className="text-[10px] text-[#94A3B8] leading-relaxed">
              Direction auto-detected: SL below entry = LONG, SL above entry = SHORT.
              {" "}Position size = (capital × risk%) ÷ |entry − SL|. Keep R:R
              {" "}{"> 1.5"} for quality trades.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[#131829] border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-[#F4F7FB] text-base flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-[#00E676]" />
            Position Sizing
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5">
            <Stat label="Risk per share" value={`Rs ${fmtNum(r.riskPerShare)}`} tone="neg" />
            <Stat label="Reward per share" value={`Rs ${fmtNum(r.rewardPerShare)}`} tone="pos" />
            <Stat label="Risk amount" value={fmtMoney(r.potentialLoss)} tone="neg" />
            <Stat label="Potential profit" value={fmtMoney(r.potentialProfit)} tone="pos" />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div className="p-3 rounded-md bg-[#0A0E1A] border border-white/[0.06]">
              <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Position size</div>
              <div className="text-xl font-bold text-[#F4F7FB] font-mono">{fmtNum(r.shares, 0)} shares</div>
              <div className="text-[10px] text-[#94A3B8] mt-0.5">{fmtMoney(r.positionValue)} deployed</div>
            </div>
            <div className="p-3 rounded-md bg-[#0A0E1A] border border-white/[0.06]">
              <div className="text-[10px] uppercase tracking-wider text-[#64748B]">R:R ratio</div>
              <div className="text-xl font-bold text-[#00E676] font-mono">{rrFormatted}</div>
              <div className="text-[10px] text-[#94A3B8] mt-0.5">Reward ÷ Risk</div>
            </div>
          </div>

          {/* Quality badge */}
          <div className="flex items-center justify-between p-3 rounded-md bg-gradient-to-br from-[#00E676]/[0.05] to-transparent border border-[#00E676]/15">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Trade quality</div>
              <div className="text-sm text-[#F4F7FB] mt-0.5">
                {r.quality.label} setup
              </div>
            </div>
            <Badge variant="outline" className={`text-[11px] font-mono ${qualityToneClass[r.quality.tone]}`}>
              {rrFormatted}
            </Badge>
          </div>

          {/* % moves */}
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="At target" value={`+${r.pctAtTarget.toFixed(2)}%`} tone="pos" />
            <MiniStat label="At SL" value={`−${r.pctAtSl.toFixed(2)}%`} tone="neg" />
            <MiniStat label="Capital deployed" value={`${r.capitalDeployedPct.toFixed(1)}%`} />
          </div>

          <Button
            size="sm"
            variant="outline"
            className="w-full border-white/[0.12] text-[#94A3B8] hover:text-[#F4F7FB] hover:bg-white/[0.04]"
            onClick={() => toast.success("Position sizing saved to plan")}
          >
            Save to trade plan
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================================================
 * Shared mini components
 * ============================================================ */

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "pos" | "neg";
}) {
  const color =
    tone === "pos" ? "text-[#00E676]" : tone === "neg" ? "text-[#FF5C5C]" : "text-[#F4F7FB]";
  return (
    <div className="p-2.5 rounded-md bg-[#0A0E1A] border border-white/[0.06]">
      <div className="text-[10px] uppercase tracking-wider text-[#64748B]">{label}</div>
      <div className={`text-base font-semibold font-mono ${color}`}>{value}</div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "pos" | "neg";
}) {
  const color =
    tone === "pos" ? "text-[#00E676]" : tone === "neg" ? "text-[#FF5C5C]" : "text-[#F4F7FB]";
  return (
    <div className="p-2 rounded-md bg-[#0A0E1A] border border-white/[0.06] text-center">
      <div className="text-[9px] uppercase tracking-wider text-[#64748B]">{label}</div>
      <div className={`text-xs font-mono font-semibold ${color}`}>{value}</div>
    </div>
  );
}

/* ============================================================
 * Main exported component
 * ============================================================ */

export function Calculators() {
  return (
    <div className="min-h-screen bg-[#0A0E1A] text-[#F4F7FB]">
      <AppNav />
      <main className="px-4 md:px-6 py-6 max-w-5xl mx-auto">
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-[#F4F7FB] flex items-center gap-2">
            <Calculator className="h-5 w-5 text-[#00E676]" />
            Tax & Trading Calculators
          </h1>
          <p className="text-sm text-[#94A3B8] mt-1">
            Pakistan-specific calculators for PSX investors — CGT, dividend tax, SIP compounding, and position sizing.
          </p>
        </div>

        <Tabs defaultValue="cgt" className="w-full">
          <TabsList className="bg-[#131829] border border-white/[0.08] h-auto p-1 flex flex-wrap gap-1 w-full justify-start">
            <TabsTrigger
              value="cgt"
              className="data-[state=active]:bg-[#00E676]/10 data-[state=active]:text-[#00E676] text-[#94A3B8] text-xs gap-1.5"
            >
              <Calculator className="h-3.5 w-3.5" />
              CGT
            </TabsTrigger>
            <TabsTrigger
              value="dividend"
              className="data-[state=active]:bg-[#00E676]/10 data-[state=active]:text-[#00E676] text-[#94A3B8] text-xs gap-1.5"
            >
              <Coins className="h-3.5 w-3.5" />
              Dividend Tax
            </TabsTrigger>
            <TabsTrigger
              value="sip"
              className="data-[state=active]:bg-[#00E676]/10 data-[state=active]:text-[#00E676] text-[#94A3B8] text-xs gap-1.5"
            >
              <TrendingUp className="h-3.5 w-3.5" />
              SIP
            </TabsTrigger>
            <TabsTrigger
              value="position"
              className="data-[state=active]:bg-[#00E676]/10 data-[state=active]:text-[#00E676] text-[#94A3B8] text-xs gap-1.5"
            >
              <Crosshair className="h-3.5 w-3.5" />
              Position Size
            </TabsTrigger>
          </TabsList>

          <TabsContent value="cgt" className="mt-4">
            <CgtCalculator />
          </TabsContent>
          <TabsContent value="dividend" className="mt-4">
            <DividendCalculator />
          </TabsContent>
          <TabsContent value="sip" className="mt-4">
            <SipCalculator />
          </TabsContent>
          <TabsContent value="position" className="mt-4">
            <PositionSizeCalculator />
          </TabsContent>
        </Tabs>

        <footer className="mt-8 pt-4 border-t border-white/[0.06] text-[10px] text-[#64748B] text-center">
          Rates as per Pakistan Finance Act 2024 · For education only — verify with FBR / SECP for filing.
        </footer>
      </main>
    </div>
  );
}
