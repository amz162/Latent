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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AppNav } from "./AppNav";
import { StockSearch } from "./StockSearch";
import {
  Calculator,
  Coins,
  TrendingUp,
  Info,
  Calendar,
  Crosshair,
  Landmark,
  Loader2,
  AlertTriangle,
  Building2,
  Percent,
  PieChart,
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
  const [calculated, setCalculated] = useState(false);

  const markDirty = () => setCalculated(false);

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

  const handleCalculate = () => {
    setCalculated(true);
    toast.success(`CGT calculated · Net profit: ${fmtMoney(r.netProfit)}`);
  };

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
                onChange={(e) => { setBuyPrice(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Sell price (Rs)</Label>
              <Input
                type="number"
                value={sellPrice}
                onChange={(e) => { setSellPrice(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Quantity (shares)</Label>
              <Input
                type="number"
                value={qty}
                onChange={(e) => { setQty(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Brokerage (%)</Label>
              <Input
                type="number"
                step="0.01"
                value={brokerage}
                onChange={(e) => { setBrokerage(e.target.value); markDirty(); }}
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
                onChange={(e) => { setBuyDate(e.target.value); markDirty(); }}
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
                onChange={(e) => { setSellDate(e.target.value); markDirty(); }}
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
                onClick={() => { setFiler("filer"); markDirty(); }}
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
                onClick={() => { setFiler("non_filer"); markDirty(); }}
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

          <Button
            size="sm"
            className="w-full bg-[#00E676] text-[#0A0E1A] hover:bg-[#00E676]/90 font-semibold"
            onClick={handleCalculate}
          >
            <Calculator className="h-3.5 w-3.5 mr-1.5" />
            Calculate CGT
          </Button>
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
          {calculated ? (
            <>
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
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Calculator className="h-10 w-10 text-[#64748B] mb-3 opacity-40" />
              <p className="text-sm text-[#94A3B8] font-medium mb-1">No results yet</p>
              <p className="text-[11px] text-[#64748B]">
                Fill in trade inputs and click &quot;Calculate CGT&quot; to see the tax &amp; profit summary.
              </p>
            </div>
          )}
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
  const [calculated, setCalculated] = useState(false);

  const markDirty = () => setCalculated(false);

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

  const handleCalculate = () => {
    setCalculated(true);
    toast.success(`Dividend tax calculated · Net: ${fmtMoney(r.net)}`);
  };

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
                onChange={(e) => { setDps(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Shares held</Label>
              <Input
                type="number"
                value={shares}
                onChange={(e) => { setShares(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs text-[#94A3B8]">Buy price (Rs/share)</Label>
              <Input
                type="number"
                value={buyPrice}
                onChange={(e) => { setBuyPrice(e.target.value); markDirty(); }}
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
                    onClick={() => { setCat(k); markDirty(); }}
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

          <Button
            size="sm"
            className="w-full bg-[#00E676] text-[#0A0E1A] hover:bg-[#00E676]/90 font-semibold"
            onClick={handleCalculate}
          >
            <Coins className="h-3.5 w-3.5 mr-1.5" />
            Calculate Dividend Tax
          </Button>
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
          {calculated ? (
            <>
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
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Coins className="h-10 w-10 text-[#64748B] mb-3 opacity-40" />
              <p className="text-sm text-[#94A3B8] font-medium mb-1">No results yet</p>
              <p className="text-[11px] text-[#64748B]">
                Enter dividend details and click &quot;Calculate Dividend Tax&quot; to see the payout summary.
              </p>
            </div>
          )}
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
  const [calculated, setCalculated] = useState(false);

  const markDirty = () => setCalculated(false);

  const r = useMemo(() => {
    const m = parseFloat(monthly) || 0;
    const a = (parseFloat(annual) || 0) / 100;
    const y = parseInt(years) || 0;
    const su = (parseFloat(stepUp) || 0) / 100;

    const monthlyRate = Math.pow(1 + a, 1 / 12) - 1;
    const yearlyRows: { year: number; monthlyThisYear: number; contributed: number; corpus: number; cumulativeContributed: number }[] = [];
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
        cumulativeContributed: totalContributed,
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

  // Apply preset values — does NOT auto-calculate, only updates each field.
  // Results hide until the user clicks "Calculate SIP".
  const applyPreset = (p: (typeof SIP_PRESETS)[0]) => {
    setMonthly(String(p.monthly));
    setAnnual(String(p.annual));
    setYears(String(p.years));
    setStepUp(String(p.stepUp));
    setCalculated(false);
    toast.success(`Loaded preset: ${p.label} — fields updated. Click "Calculate SIP" to compute.`);
  };

  const handleCalculate = () => {
    setCalculated(true);
    toast.success(`SIP calculated · Final corpus: ${fmtMoney(r.corpus)}`);
  };

  return (
    <div className="space-y-4">
      {/* Side-by-side: LEFT inputs, RIGHT results */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Inputs (LEFT) */}
        <Card className="bg-[#131829] border-white/[0.08]">
          <CardHeader>
            <CardTitle className="text-[#F4F7FB] text-base flex items-center gap-2">
              <Calculator className="h-4 w-4 text-[#00E676]" />
              SIP Inputs
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-[#94A3B8]">Monthly investment (Rs)</Label>
                <Input
                  type="number"
                  value={monthly}
                  onChange={(e) => { setMonthly(e.target.value); markDirty(); }}
                  className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-[#94A3B8]">Expected return (%)</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={annual}
                  onChange={(e) => { setAnnual(e.target.value); markDirty(); }}
                  className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-[#94A3B8]">Duration (years)</Label>
                <Input
                  type="number"
                  value={years}
                  onChange={(e) => { setYears(e.target.value); markDirty(); }}
                  className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-[#94A3B8]">Yearly step-up (%)</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={stepUp}
                  onChange={(e) => { setStepUp(e.target.value); markDirty(); }}
                  className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs text-[#94A3B8] mb-1.5 block">Quick presets</Label>
              <div className="grid grid-cols-2 gap-2">
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

            <div className="flex items-start gap-2 p-2.5 rounded-md bg-[#0A0E1A] border border-white/[0.06]">
              <Info className="h-3.5 w-3.5 text-[#00E676] shrink-0 mt-0.5" />
              <p className="text-[10px] text-[#94A3B8] leading-relaxed">
                SIP = Systematic Investment Plan. Invest a fixed amount monthly, step it up yearly to beat inflation,
                and let compounding grow your corpus over time.
              </p>
            </div>

            <Button
              size="sm"
              className="w-full bg-[#00E676] text-[#0A0E1A] hover:bg-[#00E676]/90 font-semibold"
              onClick={handleCalculate}
            >
              <Calculator className="h-3.5 w-3.5 mr-1.5" />
              Calculate SIP
            </Button>
          </CardContent>
        </Card>

        {/* Results (RIGHT) */}
        <Card className="bg-[#131829] border-white/[0.08]">
          <CardHeader>
            <CardTitle className="text-[#F4F7FB] text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[#00E676]" />
              SIP Results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {calculated ? (
              <>
                <div className="grid grid-cols-2 gap-2.5">
                  <Stat label="Total invested" value={fmtMoney(r.totalContributed)} />
                  <Stat label="Estimated profit" value={fmtMoney(r.profit)} tone="pos" />
                </div>

                <div className="p-3 rounded-md bg-gradient-to-br from-[#00E676]/[0.07] to-transparent border border-[#00E676]/20">
                  <div className="text-[10px] uppercase tracking-wider text-[#00E676]">Final corpus</div>
                  <div className="text-2xl font-bold text-[#00E676] font-mono">{fmtMoney(r.corpus)}</div>
                  <div className="text-[10px] text-[#64748B] mt-1">End of year {years}</div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <MiniStat label="Monthly" value={`Rs ${fmtNum(parseFloat(monthly) || 0, 0)}`} />
                  <MiniStat label="Return rate" value={`${annual || 0}%`} />
                  <MiniStat label="Step-up" value={`${stepUp || 0}%`} />
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <Stat label="Profit multiplier" value={`${r.totalContributed > 0 ? (r.corpus / r.totalContributed).toFixed(2) : "0"}×`} tone="pos" />
                  <Stat label="Wealth gain" value={r.totalContributed > 0 ? `${((r.corpus / r.totalContributed - 1) * 100).toFixed(1)}%` : "0%"} tone="pos" />
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="w-full border-white/[0.12] text-[#94A3B8] hover:text-[#F4F7FB] hover:bg-white/[0.04]"
                  onClick={() => toast.success("SIP plan saved to records")}
                >
                  Save SIP plan
                </Button>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Calculator className="h-10 w-10 text-[#64748B] mb-3 opacity-40" />
                <p className="text-sm text-[#94A3B8] font-medium mb-1">No results yet</p>
                <p className="text-[11px] text-[#64748B]">
                  Enter SIP inputs and click &quot;Calculate SIP&quot; to see the projected corpus.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Year-by-year table — only show when calculated */}
      {calculated && (
        <Card className="bg-[#131829] border-white/[0.08]">
          <CardHeader>
            <CardTitle className="text-[#F4F7FB] text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[#00E676]" />
              Year-by-year Corpus Growth
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Scrollable table */}
            <div className="max-h-64 overflow-y-auto latent-thin-scrollbar rounded-md border border-white/[0.06]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[#0A0E1A] z-10">
                  <tr className="text-[#64748B] text-[10px] uppercase">
                    <th className="text-left p-2 font-medium">Year</th>
                    <th className="text-right p-2 font-medium">Monthly (Rs)</th>
                    <th className="text-right p-2 font-medium">Year contrib.</th>
                    <th className="text-right p-2 font-medium">Cumulative (Rs)</th>
                    <th className="text-right p-2 font-medium">Corpus (Rs)</th>
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((row, i) => (
                    <tr key={row.year} className={i % 2 === 0 ? "bg-white/[0.01]" : ""}>
                      <td className="p-2 text-[#94A3B8] font-mono">{row.year}</td>
                      <td className="p-2 text-right text-[#F4F7FB] font-mono">{fmtNum(row.monthlyThisYear, 0)}</td>
                      <td className="p-2 text-right text-[#94A3B8] font-mono">{fmtMoney(row.contributed)}</td>
                      <td className="p-2 text-right text-[#94A3B8] font-mono">{fmtMoney(row.cumulativeContributed)}</td>
                      <td className="p-2 text-right text-[#00E676] font-mono font-semibold">{fmtMoney(row.corpus)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* SVG line chart showing corpus growth over years (BELOW the table) */}
      {calculated && (
        <Card className="bg-[#131829] border-white/[0.08]">
          <CardHeader>
            <CardTitle className="text-[#F4F7FB] text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[#00E676]" />
              Corpus Growth Chart
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SipGrowthChart rows={r.rows} maxCorpus={r.maxCorpus} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ============================================================
 * SVG line chart for SIP corpus growth
 * ============================================================ */
function SipGrowthChart({
  rows,
  maxCorpus,
}: {
  rows: { year: number; corpus: number; cumulativeContributed: number }[];
  maxCorpus: number;
}) {
  const W = 800;
  const H = 280;
  const P = { top: 24, right: 30, bottom: 36, left: 70 };
  const innerW = W - P.left - P.right;
  const innerH = H - P.top - P.bottom;

  if (rows.length === 0 || maxCorpus <= 0) {
    return <p className="text-xs text-[#64748B]">Add inputs and click Calculate SIP to see the chart.</p>;
  }

  const xAt = (i: number) =>
    P.left + (rows.length === 1 ? innerW / 2 : (i / (rows.length - 1)) * innerW);
  const yAt = (v: number) => P.top + (1 - v / maxCorpus) * innerH;

  // Corpus line (green solid) + area
  const corpusLine = rows
    .map((row, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(row.corpus).toFixed(1)}`)
    .join(" ");
  const corpusArea =
    `${corpusLine} L ${xAt(rows.length - 1).toFixed(1)} ${(P.top + innerH).toFixed(1)}` +
    ` L ${xAt(0).toFixed(1)} ${(P.top + innerH).toFixed(1)} Z`;

  // Cumulative contribution line (yellow dashed)
  const contribLine = rows
    .map((row, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(row.cumulativeContributed).toFixed(1)}`)
    .join(" ");

  const gridLines = Array.from({ length: 5 }, (_, i) => P.top + (i / 4) * innerH);
  const labelStep = Math.max(1, Math.ceil(rows.length / 12));

  // Y-axis ticks — 5 values between 0 and maxCorpus
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const v = (maxCorpus * (4 - i)) / 4;
    return { y: P.top + (i / 4) * innerH, label: v };
  });

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="sipCorpusFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00E676" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#00E676" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grid */}
        {gridLines.map((y, i) => (
          <line key={i} x1={P.left} y1={y} x2={P.left + innerW} y2={y} stroke="#1E2536" strokeWidth="1" strokeDasharray="2 4" />
        ))}
        {/* Y-axis labels */}
        {yTicks.map((t, i) => (
          <text key={i} x={P.left - 8} y={t.y + 3} fill="#64748B" fontSize="9" textAnchor="end" fontFamily="monospace">
            {t.label >= 1_00_00_000
              ? `Rs ${(t.label / 1_00_00_000).toFixed(2)}Cr`
              : t.label >= 1_00_000
              ? `Rs ${(t.label / 1_00_000).toFixed(1)}L`
              : t.label >= 1_000
              ? `Rs ${(t.label / 1_000).toFixed(0)}k`
              : `Rs ${t.label.toFixed(0)}`}
          </text>
        ))}
        {/* X-axis labels */}
        {rows.map((row, i) =>
          i % labelStep === 0 || i === rows.length - 1 ? (
            <text
              key={row.year}
              x={xAt(i)}
              y={H - 8}
              fill="#64748B"
              fontSize="9"
              textAnchor="middle"
              fontFamily="monospace"
            >
              Y{row.year}
            </text>
          ) : null
        )}
        {/* Filled corpus area */}
        <path d={corpusArea} fill="url(#sipCorpusFill)" />
        {/* Cumulative contribution line (yellow dashed) */}
        <path d={contribLine} fill="none" stroke="#FBBF24" strokeWidth="2" strokeDasharray="6 4" />
        {/* Corpus line (green solid) */}
        <path d={corpusLine} fill="none" stroke="#00E676" strokeWidth="2.5" />
        {/* Endpoint markers */}
        <circle cx={xAt(rows.length - 1)} cy={yAt(rows[rows.length - 1].corpus)} r="4" fill="#00E676" />
        <circle cx={xAt(rows.length - 1)} cy={yAt(rows[rows.length - 1].cumulativeContributed)} r="3.5" fill="#FBBF24" />
        {/* Endpoint label */}
        <text
          x={xAt(rows.length - 1) - 6}
          y={yAt(rows[rows.length - 1].corpus) - 8}
          fill="#00E676"
          fontSize="10"
          textAnchor="end"
          fontFamily="monospace"
          fontWeight="bold"
        >
          {fmtMoney(rows[rows.length - 1].corpus)}
        </text>
      </svg>
      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 text-[10px] text-[#94A3B8] flex-wrap justify-center">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-[#00E676] inline-block" />
          Corpus value (incl. returns)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 inline-block" style={{ borderBottom: "2px dashed #FBBF24" }} />
          Cumulative invested
        </span>
        <span className="text-[#64748B]">
          The widening gap between the two lines = your compounding profit.
        </span>
      </div>
    </div>
  );
}

/* ============================================================
 * 4. Fair Value Calculator (multi-method: DDM / DCF / RI / P-E / P-B / EV-EBITDA / Graham)
 *    Calls POST /api/fair-value with full fundamentals JSON.
 * ============================================================ */

// Per-sector default target multiples (used by API as weighting + valuation defaults)
const SECTOR_DEFAULTS: Record<
  string,
  { pe: number; pb: number; evEbitda: number; label: string }
> = {
  bank:       { pe: 5,  pb: 1.3, evEbitda: 3,   label: "Bank" },
  fertilizer: { pe: 8,  pb: 2,   evEbitda: 5,   label: "Fertilizer" },
  cement:     { pe: 9,  pb: 1.5, evEbitda: 5.5, label: "Cement" },
  oilgas:     { pe: 6,  pb: 1.2, evEbitda: 4,   label: "Oil & Gas" },
  power:      { pe: 7,  pb: 1.1, evEbitda: 5,   label: "Power" },
  default:    { pe: 10, pb: 1.5, evEbitda: 6,   label: "Other" },
};

const SECTOR_OPTIONS = Object.entries(SECTOR_DEFAULTS).map(([code, d]) => ({
  code,
  ...d,
}));

// Map a long PSX sector name (e.g. "Commercial Banks", "Oil & Gas Marketing")
// into the short code the fair-value API uses (bank / fertilizer / cement / oilgas / power / default).
function toSectorCode(sectorName: string): string {
  const s = (sectorName || "").toLowerCase();
  if (!s) return "default";
  if (s.includes("bank")) return "bank";
  if (s.includes("fertil")) return "fertilizer";
  if (s.includes("cement")) return "cement";
  if (s.includes("oil") || s.includes("gas")) return "oilgas";
  if (s.includes("power") || s.includes("energy")) return "power";
  return "default";
}

const METHOD_LABELS: Record<string, string> = {
  ddm: "DDM",
  dcf: "DCF",
  residual_income: "Residual Income",
  pe: "P/E",
  pb: "P/B",
  ev_ebitda: "EV/EBITDA",
  graham: "Graham",
};

interface FairValueMethod {
  method: string;
  value: number;
  weight: number;
}

interface FairValueResult {
  symbol?: string;
  sector?: string;
  price?: number;
  fair_value: number;
  low: number;
  high: number;
  ke: number;
  wacc: number;
  methods: FairValueMethod[];
  all_values: Record<string, number | null>;
  upside_pct?: number;
  buy_below?: number;
  verdict?: string;
  error?: string;
}

interface Company {
  id: number;
  value: string;
  label: string;
  sector?: string;
  image?: string;
}

interface AnnualLineItem {
  label: string;
  unit?: string;
  data: { year: string; value: string }[];
}

interface IncomeStatementResponse {
  symbol: string;
  company_name?: string;
  sector?: string;
  annual: AnnualLineItem[];
  quarter?: AnnualLineItem[];
  error?: string;
}

interface OhlcvResponse {
  symbol: string;
  ohlcv: { date: number; close: number }[];
  error?: string;
}

// Verdict string → friendly label + tone color
function verdictInfo(
  verdict?: string
): { label: string; tone: "pos" | "warn" | "neutral" | "neg" } {
  const v = (verdict || "").toUpperCase();
  if (v.includes("UNDERVALUED") && !v.includes("SLIGHT"))
    return { label: "UNDERVALUED", tone: "pos" };
  if (v.includes("SLIGHTLY UNDERVALUED"))
    return { label: "SLIGHTLY UNDERVALUED", tone: "pos" };
  if (v.includes("FAIRLY VALUED"))
    return { label: "FAIRLY VALUED", tone: "neutral" };
  if (v.includes("OVERVALUED"))
    return { label: "OVERVALUED", tone: "neg" };
  return { label: verdict || "—", tone: "neutral" };
}

function FairValueCalculator() {
  const [symbol, setSymbol] = useState("");
  const [company, setCompany] = useState("");
  const [sector, setSector] = useState<string>("default");
  const [eps, setEps] = useState("");
  const [growthRate, setGrowthRate] = useState(""); // %
  const [bvps, setBvps] = useState("");
  const [dps, setDps] = useState("");
  const [fcf, setFcf] = useState("0");
  const [sharesOut, setSharesOut] = useState("0");
  const [netDebt, setNetDebt] = useState("0");
  const [ebitda, setEbitda] = useState("0");
  const [beta, setBeta] = useState("1.0");
  const [roe, setRoe] = useState(""); // decimal (e.g. 0.15 = 15%)
  const [targetPE, setTargetPE] = useState(String(SECTOR_DEFAULTS.default.pe));
  const [targetPB, setTargetPB] = useState(String(SECTOR_DEFAULTS.default.pb));
  const [targetEvEbitda, setTargetEvEbitda] = useState(String(SECTOR_DEFAULTS.default.evEbitda));
  const [debtRatio, setDebtRatio] = useState("0.30");
  const [costOfDebt, setCostOfDebt] = useState("0.15");
  const [taxRate, setTaxRate] = useState("0.29");
  const [currentPrice, setCurrentPrice] = useState("");

  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceNote, setSourceNote] = useState<string>("");
  const [result, setResult] = useState<FairValueResult | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [calculated, setCalculated] = useState(false);

  const markDirty = () => {
    setCalculated(false);
    setResult(null);
    setResultError(null);
  };

  // Reset every input field to defaults — used when the user clears StockSearch.
  const resetFields = () => {
    setCompany("");
    setSector("default");
    setEps("");
    setGrowthRate("");
    setBvps("");
    setDps("");
    setFcf("0");
    setSharesOut("0");
    setNetDebt("0");
    setEbitda("0");
    setBeta("1.0");
    setRoe("");
    setTargetPE(String(SECTOR_DEFAULTS.default.pe));
    setTargetPB(String(SECTOR_DEFAULTS.default.pb));
    setTargetEvEbitda(String(SECTOR_DEFAULTS.default.evEbitda));
    setDebtRatio("0.30");
    setCostOfDebt("0.15");
    setTaxRate("0.29");
    setCurrentPrice("");
    setError(null);
    setSourceNote("");
    setResult(null);
    setResultError(null);
  };

  // Helper: find the latest annual data point whose label contains ALL keywords.
  const findLatestAnnual = (items: AnnualLineItem[], keywords: string[]) => {
    const item = items.find(
      (x) => x.label && keywords.every((kw) => x.label.toLowerCase().includes(kw.toLowerCase()))
    );
    if (!item || !item.data || item.data.length === 0) return null;
    const byYear = item.data
      .map((d) => ({ year: parseInt(d.year, 10), value: parseFloat(d.value) }))
      .filter((d) => !isNaN(d.year) && !isNaN(d.value))
      .sort((a, b) => a.year - b.year);
    if (byYear.length === 0) return null;
    return byYear[byYear.length - 1];
  };

  // When user selects a stock via StockSearch, auto-fill the input fields from
  // /api/psx/incomestatement, /api/psx/ohlcv and /api/psx/bss.
  // Sector auto-detected from StockSearch's Company object.
  // Do NOT auto-calculate — wait for explicit "Calculate Fair Value" click.
  const handleSelect = async (sym: string, companyObj?: Company) => {
    setSymbol(sym);
    setCalculated(false);
    setResult(null);
    setResultError(null);
    if (!sym) {
      resetFields();
      return;
    }
    setLoading(true);
    setError(null);
    setSourceNote("");
    try {
      // 1. Fetch income statement (annual line items)
      const isRes = await fetch(`/api/psx/incomestatement/${encodeURIComponent(sym)}`);
      const isData: IncomeStatementResponse = await isRes.json();
      if (isData.error || !isData.annual || isData.annual.length === 0) {
        throw new Error(isData.error || "No income statement data available for this stock");
      }

      // 2. Extract latest annual EPS, compute 5-year CAGR.
      const epsEntry = findLatestAnnual(isData.annual, ["eps", "basic"]);
      if (!epsEntry) throw new Error("EPS data not found in income statement");
      const latestEps = epsEntry.value;

      const epsItem = isData.annual.find(
        (x) => x.label && x.label.toLowerCase().includes("eps") && x.label.toLowerCase().includes("basic")
      );
      const epsByYear = epsItem && epsItem.data
        ? epsItem.data
            .map((d) => ({ year: parseInt(d.year, 10), value: parseFloat(d.value) }))
            .filter((d) => !isNaN(d.year) && !isNaN(d.value))
            .sort((a, b) => a.year - b.year)
        : [];
      const fiveYearAgoEntry =
        epsByYear.length >= 6 ? epsByYear[epsByYear.length - 6] : epsByYear[0];
      const yearsDiff = epsEntry.year - fiveYearAgoEntry.year;
      let cagr = 0;
      if (fiveYearAgoEntry.value > 0 && latestEps > 0 && yearsDiff > 0) {
        cagr = (Math.pow(latestEps / fiveYearAgoEntry.value, 1 / yearsDiff) - 1) * 100;
      }

      // 3. DPS, EBITDA from annual data.
      const dpsEntry = findLatestAnnual(isData.annual, ["dps"]);
      const latestDps = dpsEntry ? dpsEntry.value : 0;
      const ebitdaEntry = findLatestAnnual(isData.annual, ["ebitda"]);
      const latestEbitda = ebitdaEntry ? ebitdaEntry.value : 0;

      // 4. Sector auto-detection from StockSearch Company.sector (with IS fallback).
      const incomingSector = companyObj?.sector || isData.sector || "";
      const sectorCode = toSectorCode(incomingSector);
      const defaults = SECTOR_DEFAULTS[sectorCode] || SECTOR_DEFAULTS.default;

      // 5. Current price via OHLCV (last available close).
      let price = 0;
      try {
        const ohRes = await fetch(`/api/psx/ohlcv/${encodeURIComponent(sym)}`);
        const ohData: OhlcvResponse = await ohRes.json();
        if (ohData.ohlcv && ohData.ohlcv.length > 0) {
          price = ohData.ohlcv[ohData.ohlcv.length - 1].close;
        }
      } catch {
        // Price fetch failed — user can input manually
      }

      // 6. Balance sheet → total equity / shares outstanding → BVPS, ROE.
      //    Best-effort: askanalyst BSS shape varies, so we try several common labels.
      let totalEquity = 0;
      let sharesOut = 0;
      let computedBvps = 0;
      try {
        const bssRes = await fetch(`/api/psx/bss/${encodeURIComponent(sym)}`);
        if (bssRes.ok) {
          const bssJson = await bssRes.json();
          const bssAnnual: AnnualLineItem[] =
            (bssJson?.bss?.annual as AnnualLineItem[]) ||
            (bssJson?.annual as AnnualLineItem[]) ||
            [];
          if (Array.isArray(bssAnnual) && bssAnnual.length > 0) {
            const eq =
              findLatestAnnual(bssAnnual, ["total", "equity"]) ||
              findLatestAnnual(bssAnnual, ["equity"]) ||
              findLatestAnnual(bssAnnual, ["shareholder"]);
            if (eq) totalEquity = eq.value;

            const sh =
              findLatestAnnual(bssAnnual, ["shares", "outstanding"]) ||
              findLatestAnnual(bssAnnual, ["shares"]) ||
              findLatestAnnual(bssAnnual, ["number", "shares"]);
            if (sh) sharesOut = sh.value;

            if (totalEquity > 0 && sharesOut > 0) {
              // sharesOut is typically in millions, totalEquity in PKR million.
              computedBvps = totalEquity / sharesOut;
            }
          }
        }
      } catch {
        // BSS fetch failed — user can input BVPS manually
      }

      // 7. ROE = EPS / BVPS (if BVPS available).
      const computedRoe = computedBvps > 0 && latestEps > 0 ? latestEps / computedBvps : 0;

      // 8. Auto-fill every input field. Do NOT calculate yet.
      setCompany(isData.company_name || sym);
      setSector(sectorCode);
      setEps(latestEps ? String(latestEps) : "");
      setGrowthRate(cagr.toFixed(2));
      setBvps(computedBvps > 0 ? String(computedBvps.toFixed(2)) : "");
      setDps(latestDps ? String(latestDps) : "");
      setFcf("0");
      setSharesOut(sharesOut > 0 ? String(sharesOut) : "0");
      setNetDebt("0");
      setEbitda(latestEbitda ? String(latestEbitda) : "0");
      setBeta("1.0");
      setRoe(computedRoe ? computedRoe.toFixed(4) : "");
      setTargetPE(String(defaults.pe));
      setTargetPB(String(defaults.pb));
      setTargetEvEbitda(String(defaults.evEbitda));
      setDebtRatio("0.30");
      setCostOfDebt("0.15");
      setTaxRate("0.29");
      setCurrentPrice(price > 0 ? String(price) : "");

      const parts: string[] = [];
      parts.push(`EPS FY${epsEntry.year}`);
      if (yearsDiff > 0) parts.push(`${yearsDiff}y CAGR`);
      if (latestDps > 0) parts.push(`DPS ${latestDps}`);
      if (latestEbitda > 0) parts.push(`EBITDA ${latestEbitda}M`);
      if (computedBvps > 0) parts.push(`BVPS ${computedBvps.toFixed(2)}`);
      if (computedRoe > 0) parts.push(`ROE ${(computedRoe * 100).toFixed(1)}%`);
      if (sharesOut > 0) parts.push(`shares ${sharesOut}M`);
      parts.push(price > 0 ? "price from OHLCV" : "no price — enter manually");
      setSourceNote(parts.join(" · "));

      toast.success(`Loaded ${sym} fundamentals — fields auto-filled. Click "Calculate Fair Value" to compute.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load fundamentals";
      setError(msg);
      toast.error(`Could not load ${sym}: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  // When sector changes via the selector, also update the target multiples to that
  // sector's defaults (only if user hasn't already overridden them meaningfully).
  // We always update — this keeps the multiples consistent with the chosen sector.
  const handleSectorChange = (code: string) => {
    setSector(code);
    const d = SECTOR_DEFAULTS[code] || SECTOR_DEFAULTS.default;
    setTargetPE(String(d.pe));
    setTargetPB(String(d.pb));
    setTargetEvEbitda(String(d.evEbitda));
    markDirty();
  };

  // POST all inputs to /api/fair-value on click. Result gates the display.
  const handleCalculate = async () => {
    setCalculating(true);
    setResultError(null);
    try {
      const body = {
        symbol,
        sector,
        price: parseFloat(currentPrice) || 0,
        eps: parseFloat(eps) || 0,
        bvps: parseFloat(bvps) || 0,
        dps: parseFloat(dps) || 0,
        fcf: parseFloat(fcf) || 0,
        shares: parseFloat(sharesOut) || 0,
        net_debt: parseFloat(netDebt) || 0,
        ebitda: parseFloat(ebitda) || 0,
        // growth UI is in %, API expects decimal
        growth: (parseFloat(growthRate) || 0) / 100,
        beta: parseFloat(beta) || 1.0,
        roe: parseFloat(roe) || 0,
        target_pe: parseFloat(targetPE) || 0,
        target_pb: parseFloat(targetPB) || 0,
        target_ev_ebitda: parseFloat(targetEvEbitda) || 0,
        debt_ratio: parseFloat(debtRatio) || 0,
        cost_of_debt: parseFloat(costOfDebt) || 0,
        tax: parseFloat(taxRate) || 0,
      };
      const res = await fetch("/api/fair-value", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: FairValueResult = await res.json();
      if (data.error) {
        setResultError(data.error);
        toast.error(data.error);
        return;
      }
      setResult(data);
      setCalculated(true);
      toast.success(`Fair value computed: Rs ${fmtNum(data.fair_value)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to compute fair value";
      setResultError(msg);
      toast.error(`Calculation failed: ${msg}`);
    } finally {
      setCalculating(false);
    }
  };

  const v = verdictInfo(result?.verdict);
  const upside = result?.upside_pct ?? 0;
  const upsideTone = upside >= 0 ? "pos" : "neg";

  // Method rows: every method that produced a non-null value, with weight from the blend.
  const methodRows = useMemo(() => {
    if (!result) return [];
    return Object.entries(result.all_values)
      .filter(([, val]) => val !== null && val !== undefined && (val as number) > 0)
      .map(([k, val]) => {
        const m = result.methods.find((x) => x.method === k);
        return {
          code: k,
          name: METHOD_LABELS[k] || k.toUpperCase(),
          value: val as number,
          weight: m ? m.weight : 0,
        };
      })
      .sort((a, b) => b.weight - a.weight);
  }, [result]);

  const maxWeight = methodRows.length > 0 ? Math.max(...methodRows.map((r) => r.weight)) : 1;

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {/* Inputs (LEFT) */}
      <Card className="bg-[#131829] border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-[#F4F7FB] text-base flex items-center gap-2">
            <Landmark className="h-4 w-4 text-[#00E676]" />
            Fair Value Inputs
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-[#94A3B8]">Select stock</Label>
            <StockSearch
              value={symbol}
              onChange={(s, c) => handleSelect(s, c)}
              placeholder="Search symbol or name — e.g. LUCK, Engro..."
              className="w-full"
            />
          </div>

          {loading && (
            <div className="flex items-center gap-2 p-2.5 rounded-md bg-[#0A0E1A] border border-white/[0.06]">
              <Loader2 className="h-3.5 w-3.5 text-[#00E676] animate-spin" />
              <p className="text-xs text-[#94A3B8]">Fetching {symbol} income statement, OHLCV & balance sheet...</p>
            </div>
          )}

          {error && !loading && (
            <div className="flex items-start gap-2 p-2.5 rounded-md bg-[#FF5C5C]/[0.05] border border-[#FF5C5C]/20">
              <AlertTriangle className="h-3.5 w-3.5 text-[#FF5C5C] shrink-0 mt-0.5" />
              <p className="text-[10px] text-[#FF5C5C] leading-relaxed">{error}</p>
            </div>
          )}

          {symbol && !loading && !error && (
            <div className="flex items-center gap-2 p-2.5 rounded-md bg-[#0A0E1A] border border-white/[0.06]">
              <Info className="h-3.5 w-3.5 text-[#00E676] shrink-0 mt-0.5" />
              <p className="text-[10px] text-[#94A3B8] leading-relaxed">
                {company ? `${company} · ` : ""}
                Auto-filled from API. {sourceNote}.
              </p>
            </div>
          )}

          {/* Sector selector (auto-detected, user can override) */}
          <div className="space-y-1.5">
            <Label className="text-xs text-[#94A3B8] flex items-center gap-1">
              <Building2 className="h-3 w-3" /> Sector
              <span className="text-[9px] text-[#64748B]">(auto-detected · drives default multiples & weighting)</span>
            </Label>
            <Select value={sector} onValueChange={handleSectorChange}>
              <SelectTrigger className="w-full bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono text-sm h-9">
                <SelectValue placeholder="Select sector..." />
              </SelectTrigger>
              <SelectContent className="bg-[#131829] border-white/[0.12] text-[#F4F7FB]">
                {SECTOR_OPTIONS.map((s) => (
                  <SelectItem key={s.code} value={s.code} className="text-xs">
                    {s.label} (P/E {s.pe} · P/B {s.pb} · EV/EBITDA {s.evEbitda})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Per-share metrics */}
          <div className="text-[10px] uppercase tracking-wider text-[#64748B] pt-1">Per-share metrics</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">EPS — latest annual (Rs)</Label>
              <Input
                type="number"
                step="0.01"
                value={eps}
                onChange={(e) => { setEps(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">BVPS — book value / share (Rs)</Label>
              <Input
                type="number"
                step="0.01"
                value={bvps}
                onChange={(e) => { setBvps(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">DPS — dividend / share (Rs)</Label>
              <Input
                type="number"
                step="0.01"
                value={dps}
                onChange={(e) => { setDps(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Current price (Rs)</Label>
              <Input
                type="number"
                step="0.01"
                value={currentPrice}
                onChange={(e) => { setCurrentPrice(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
          </div>

          {/* Company-level metrics (PKR million) */}
          <div className="text-[10px] uppercase tracking-wider text-[#64748B] pt-1">Company metrics (PKR million)</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Free Cash Flow (PKR Mn)</Label>
              <Input
                type="number"
                step="0.01"
                value={fcf}
                onChange={(e) => { setFcf(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Shares Outstanding (Mn)</Label>
              <Input
                type="number"
                step="0.01"
                value={sharesOut}
                onChange={(e) => { setSharesOut(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Net Debt (PKR Mn)</Label>
              <Input
                type="number"
                step="0.01"
                value={netDebt}
                onChange={(e) => { setNetDebt(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">EBITDA (PKR Mn)</Label>
              <Input
                type="number"
                step="0.01"
                value={ebitda}
                onChange={(e) => { setEbitda(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
          </div>

          {/* Risk & capital structure */}
          <div className="text-[10px] uppercase tracking-wider text-[#64748B] pt-1">Risk &amp; capital structure</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Beta (default 1.0)</Label>
              <Input
                type="number"
                step="0.05"
                value={beta}
                onChange={(e) => { setBeta(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">ROE (decimal, e.g. 0.15)</Label>
              <Input
                type="number"
                step="0.01"
                value={roe}
                onChange={(e) => { setRoe(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Growth rate — EPS CAGR (%)</Label>
              <Input
                type="number"
                step="0.1"
                value={growthRate}
                onChange={(e) => { setGrowthRate(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Debt ratio (default 0.30)</Label>
              <Input
                type="number"
                step="0.01"
                value={debtRatio}
                onChange={(e) => { setDebtRatio(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Cost of debt (default 0.15)</Label>
              <Input
                type="number"
                step="0.01"
                value={costOfDebt}
                onChange={(e) => { setCostOfDebt(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Tax rate (default 0.29)</Label>
              <Input
                type="number"
                step="0.01"
                value={taxRate}
                onChange={(e) => { setTaxRate(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
          </div>

          {/* Target multiples */}
          <div className="text-[10px] uppercase tracking-wider text-[#64748B] pt-1">Target multiples (sector defaults pre-filled)</div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8] flex items-center gap-1">
                <Percent className="h-3 w-3" /> Target P/E
              </Label>
              <Input
                type="number"
                step="0.5"
                value={targetPE}
                onChange={(e) => { setTargetPE(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Target P/B</Label>
              <Input
                type="number"
                step="0.1"
                value={targetPB}
                onChange={(e) => { setTargetPB(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-[#94A3B8]">Target EV/EBITDA</Label>
              <Input
                type="number"
                step="0.5"
                value={targetEvEbitda}
                onChange={(e) => { setTargetEvEbitda(e.target.value); markDirty(); }}
                className="bg-[#0A0E1A] border-white/[0.08] text-[#F4F7FB] font-mono"
              />
            </div>
          </div>

          <div className="flex items-start gap-2 p-2.5 rounded-md bg-[#0A0E1A] border border-white/[0.06]">
            <Info className="h-3.5 w-3.5 text-[#00E676] shrink-0 mt-0.5" />
            <p className="text-[10px] text-[#94A3B8] leading-relaxed">
              <span className="text-[#F4F7FB]">Multi-method blend:</span> POST /api/fair-value runs 7 valuation
              models (DDM, DCF, Residual Income, P/E, P/B, EV/EBITDA, Graham) and weights each by sector.
              Pakistan macro assumptions baked in: RF 12%, ERP 8%, Terminal Growth 6%, Margin of Safety 25%.
            </p>
          </div>

          <Button
            size="sm"
            className="w-full bg-[#00E676] text-[#0A0E1A] hover:bg-[#00E676]/90 font-semibold"
            onClick={handleCalculate}
            disabled={calculating || !symbol}
          >
            {calculating ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Landmark className="h-3.5 w-3.5 mr-1.5" />
            )}
            {calculating ? "Computing..." : "Calculate Fair Value"}
          </Button>
        </CardContent>
      </Card>

      {/* Results (RIGHT) */}
      <Card className="bg-[#131829] border-white/[0.08]">
        <CardHeader>
          <CardTitle className="text-[#F4F7FB] text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[#00E676]" />
            Fair Value Result
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {resultError && !result && (
            <div className="flex items-start gap-2 p-2.5 rounded-md bg-[#FF5C5C]/[0.05] border border-[#FF5C5C]/20">
              <AlertTriangle className="h-3.5 w-3.5 text-[#FF5C5C] shrink-0 mt-0.5" />
              <p className="text-[10px] text-[#FF5C5C] leading-relaxed">{resultError}</p>
            </div>
          )}

          {calculated && result ? (
            <>
              {/* Big fair value number */}
              <div className="p-3 rounded-md bg-gradient-to-br from-[#00E676]/[0.07] to-transparent border border-[#00E676]/20">
                <div className="text-[10px] uppercase tracking-wider text-[#00E676]">
                  Fair Value (multi-method blend)
                </div>
                <div
                  className={`text-3xl font-bold font-mono ${
                    v.tone === "pos"
                      ? "text-[#00E676]"
                      : v.tone === "neg"
                      ? "text-[#FF5C5C]"
                      : "text-[#F4F7FB]"
                  }`}
                >
                  Rs. {fmtNum(result.fair_value)}
                </div>
                <div className="text-[10px] text-[#64748B] mt-1">
                  Current price: Rs. {fmtNum(result.price ?? parseFloat(currentPrice) ?? 0)}
                  {symbol ? ` · ${symbol}` : ""}
                  {result.sector ? ` · ${SECTOR_DEFAULTS[result.sector]?.label || result.sector}` : ""}
                </div>
              </div>

              {/* Verdict badge */}
              <div
                className={`p-3 rounded-md border ${
                  v.tone === "pos"
                    ? "bg-[#00E676]/[0.08] border-[#00E676]/30"
                    : v.tone === "neg"
                    ? "bg-[#FF5C5C]/[0.08] border-[#FF5C5C]/30"
                    : "bg-white/[0.03] border-white/[0.08]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Verdict</div>
                    <Badge
                      variant="outline"
                      className={`text-[11px] font-mono mt-0.5 ${
                        v.tone === "pos"
                          ? "border-[#00E676]/40 bg-[#00E676]/10 text-[#00E676]"
                          : v.tone === "neg"
                          ? "border-[#FF5C5C]/40 bg-[#FF5C5C]/10 text-[#FF5C5C]"
                          : "border-white/[0.15] bg-white/[0.05] text-[#F4F7FB]"
                      }`}
                    >
                      {v.label}
                    </Badge>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-[#64748B]">
                      {upside >= 0 ? "Upside" : "Downside"}
                    </div>
                    <div
                      className={`text-xl font-bold font-mono ${
                        upsideTone === "pos" ? "text-[#00E676]" : "text-[#FF5C5C]"
                      }`}
                    >
                      {upside >= 0 ? "+" : ""}{upside.toFixed(1)}%
                    </div>
                  </div>
                </div>
                {result.verdict && (
                  <div className="text-[10px] text-[#94A3B8] mt-2 leading-relaxed">{result.verdict}</div>
                )}
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-2.5">
                <Stat label="Current price" value={`Rs. ${fmtNum(result.price ?? parseFloat(currentPrice) ?? 0)}`} />
                <Stat label="Buy Below (25% MoS)" value={result.buy_below ? `Rs. ${fmtNum(result.buy_below)}` : "—"} tone="pos" />
                <Stat label="Range Low" value={`Rs. ${fmtNum(result.low)}`} />
                <Stat label="Range High" value={`Rs. ${fmtNum(result.high)}`} />
                <Stat label="Cost of Equity (Ke)" value={`${(result.ke * 100).toFixed(1)}%`} />
                <Stat label="WACC" value={`${(result.wacc * 100).toFixed(1)}%`} />
              </div>

              {/* Method breakdown table */}
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-[#64748B] flex items-center gap-1.5">
                  <PieChart className="h-3 w-3" /> Method breakdown
                </div>
                <div className="rounded-md bg-[#0A0E1A] border border-white/[0.06] overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-white/[0.06] hover:bg-transparent">
                        <TableHead className="text-[10px] uppercase tracking-wider text-[#64748B] h-8 px-2">Method</TableHead>
                        <TableHead className="text-[10px] uppercase tracking-wider text-[#64748B] h-8 px-2 text-right">Value</TableHead>
                        <TableHead className="text-[10px] uppercase tracking-wider text-[#64748B] h-8 px-2 text-right">Weight</TableHead>
                        <TableHead className="text-[10px] uppercase tracking-wider text-[#64748B] h-8 px-2 w-[40%]">Contribution</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {methodRows.length === 0 ? (
                        <TableRow className="border-white/[0.06]">
                          <TableCell colSpan={4} className="text-[11px] text-[#64748B] text-center py-4">
                            No methods produced a value for this stock.
                          </TableCell>
                        </TableRow>
                      ) : (
                        methodRows.map((row) => (
                          <TableRow key={row.code} className="border-white/[0.06]">
                            <TableCell className="text-xs text-[#F4F7FB] font-medium py-2">{row.name}</TableCell>
                            <TableCell className="text-xs text-[#F4F7FB] font-mono py-2 text-right">
                              Rs. {fmtNum(row.value)}
                            </TableCell>
                            <TableCell className="text-xs text-[#94A3B8] font-mono py-2 text-right">
                              {(row.weight * 100).toFixed(0)}%
                            </TableCell>
                            <TableCell className="py-2 pr-3">
                              <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-[#00E676]/60 to-[#00E676]"
                                  style={{ width: `${maxWeight > 0 ? (row.weight / maxWeight) * 100 : 0}%` }}
                                />
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Macro assumptions */}
              <div className="flex flex-wrap items-center gap-1.5 p-2.5 rounded-md bg-[#0A0E1A] border border-white/[0.06]">
                <Info className="h-3 w-3 text-[#64748B] shrink-0" />
                <span className="text-[9px] uppercase tracking-wider text-[#64748B]">Macro assumptions:</span>
                <Badge variant="outline" className="text-[9px] font-mono px-1.5 py-0 h-4 border-white/[0.12] bg-white/[0.03] text-[#94A3B8]">RF 12%</Badge>
                <Badge variant="outline" className="text-[9px] font-mono px-1.5 py-0 h-4 border-white/[0.12] bg-white/[0.03] text-[#94A3B8]">ERP 8%</Badge>
                <Badge variant="outline" className="text-[9px] font-mono px-1.5 py-0 h-4 border-white/[0.12] bg-white/[0.03] text-[#94A3B8]">Terminal G 6%</Badge>
                <Badge variant="outline" className="text-[9px] font-mono px-1.5 py-0 h-4 border-white/[0.12] bg-white/[0.03] text-[#94A3B8]">MoS 25%</Badge>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Landmark className="h-10 w-10 text-[#64748B] mb-3 opacity-40" />
              <p className="text-sm text-[#94A3B8] font-medium mb-1">No fair value yet</p>
              <p className="text-[11px] text-[#64748B]">
                {symbol
                  ? `Fields auto-filled for ${symbol}. Click "Calculate Fair Value" to run the multi-method blend.`
                  : `Select a stock to auto-fill the inputs, then click "Calculate Fair Value".`}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================================================
 * 5. Position Size Calculator
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
            <TabsTrigger
              value="fairvalue"
              className="data-[state=active]:bg-[#00E676]/10 data-[state=active]:text-[#00E676] text-[#94A3B8] text-xs gap-1.5"
            >
              <Landmark className="h-3.5 w-3.5" />
              Fair Value
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
          <TabsContent value="fairvalue" className="mt-4">
            <FairValueCalculator />
          </TabsContent>
        </Tabs>

        <footer className="mt-8 pt-4 border-t border-white/[0.06] text-[10px] text-[#64748B] text-center">
          Rates as per Pakistan Finance Act 2024 · For education only — verify with FBR / SECP for filing.
        </footer>
      </main>
    </div>
  );
}
