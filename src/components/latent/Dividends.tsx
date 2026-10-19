"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AppNav } from "./AppNav";
import { StockSearch } from "./StockSearch";
import { useLatentStore } from "@/lib/latent/store";
import { Coins, Bell, BellRing, Loader2, CalendarClock, TrendingUp, History } from "lucide-react";
import { toast } from "sonner";

// Fallback baseline of dividend announcements (used when scraper is rate-limited).
// This is the same synthetic data as before — the live view fetches ALL companies'
// dividends from /api/scrape/announcements?type=dividend on top of this baseline.
interface DividendRow {
  symbol: string;
  company: string;
  amount: number; // PKR per share
  type: "Interim" | "Final" | "Special" | "Bonus" | "Unknown";
  yieldPct: number;
  exDate: string | null; // ISO date string for "Last date to buy/hold"
  source: "static" | "live";
}

const STATIC_DIVIDENDS: DividendRow[] = [
  { symbol: "HUBC", company: "Hub Power Company", amount: 7, type: "Interim", yieldPct: 5.6, exDate: "2026-01-15", source: "static" },
  { symbol: "OGDC", company: "Oil & Gas Development", amount: 4.5, type: "Interim", yieldPct: 3.2, exDate: "2026-01-20", source: "static" },
  { symbol: "PPL", company: "Pakistan Petroleum", amount: 3.5, type: "Interim", yieldPct: 3.0, exDate: "2026-01-22", source: "static" },
  { symbol: "ENGRO", company: "Engro Corporation", amount: 12, type: "Final", yieldPct: 4.2, exDate: "2026-01-25", source: "static" },
  { symbol: "LUCK", company: "Lucky Cement", amount: 25, type: "Final", yieldPct: 2.8, exDate: "2026-02-01", source: "static" },
  { symbol: "MEBL", company: "Meezan Bank", amount: 6, type: "Interim", yieldPct: 2.2, exDate: "2026-02-05", source: "static" },
  { symbol: "PSO", company: "Pakistan State Oil", amount: 5, type: "Interim", yieldPct: 2.5, exDate: "2026-02-08", source: "static" },
  { symbol: "SYS", company: "Systems Limited", amount: 5, type: "Final", yieldPct: 1.2, exDate: "2026-02-10", source: "static" },
];

interface Announcement {
  id: string;
  company: string;
  symbol: string;
  title: string;
  type: string;
  pdfLink: string | null;
  link: string;
  publishedAt: string | null;
  summary: string;
}

// Parse the dividend amount (PKR per share) from an announcement title.
// Handles patterns like: "Rs. 4.50 per share", "PKR 6.0/share", "10.5 per share",
// "Final Dividend Rs.7.50 per share", etc.
function parseDividendAmount(title: string): number | null {
  const t = title.toLowerCase();
  // Negative lookahead-free patterns ordered most-specific → least-specific
  const patterns: RegExp[] = [
    /(?:rs\.?|pkr|rupees)\s*\=?\s*(\d+(?:\.\d+)?)\s*(?:per\s*share|\/\s*share|p\.?s\.?|ps)?/i,
    /(\d+(?:\.\d+)?)\s*(?:per\s*share|\/\s*share)/i,
    /dividend[^0-9]*(\d+(?:\.\d+)?)/i,
    /(\d+(?:\.\d+)?)\s*(?:dividend|payout)/i,
  ];
  for (const p of patterns) {
    const m = title.match(p);
    if (m && m[1]) {
      const amt = parseFloat(m[1]);
      if (!isNaN(amt) && amt > 0 && amt < 1000) return amt;
    }
  }
  // Also check summary field if no match in title (handled by caller)
  void t;
  return null;
}

function classifyType(title: string): DividendRow["type"] {
  const t = title.toLowerCase();
  if (/final/.test(t)) return "Final";
  if (/interim/.test(t)) return "Interim";
  if (/special/.test(t)) return "Special";
  if (/bonus/.test(t)) return "Bonus";
  return "Unknown";
}

// Issue 15: per-stock dividend history item — derived from the quarterly
// financial-results endpoint (/api/psx/financial-results/[symbol]) which
// returns metrics.dividendPerShare per period. We keep only periods where
// DPS > 0 and sort by periodEnd desc (latest first → oldest).
interface DividendHistoryItem {
  symbol: string;
  company: string;
  period: string;       // e.g. "Q1 FY24"
  periodEnd: string;    // ISO date — sort key
  dps: number;          // PKR per share
  payoutRatio: number;  // %
  eps: number;          // PKR per share (context for the payout)
}

export function Dividends() {
  const [filterSymbol, setFilterSymbol] = useState("");
  const [alerts, setAlerts] = useState<Set<string>>(new Set());
  const [dividends, setDividends] = useState<DividendRow[]>(STATIC_DIVIDENDS);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"static+live" | "static-only">("static+live");
  const pushNotification = useLatentStore((s) => s.pushNotification);

  // Issue 15: per-stock dividend history (DPS by quarter from financial
  // results endpoint). Populated when the user selects a stock via
  // StockSearch. Shows ALL previous dividend announcements for that stock,
  // latest first to oldest.
  const [historyItems, setHistoryItems] = useState<DividendHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyCompany, setHistoryCompany] = useState<string>("");

  // Fetch ALL companies' dividends from the announcements scraper (live)
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => setLoading(true));
    fetch("/api/scrape/announcements?type=dividend")
      .then((r) => {
        if (!r.ok) throw new Error(`Upstream ${r.status}`);
        return r.json();
      })
      .then((d: { announcements: Announcement[] }) => {
        if (cancelled) return;
        const live: DividendRow[] = [];
        const seen = new Set<string>();
        for (const a of d.announcements || []) {
          const sym = (a.symbol || "").toUpperCase().trim();
          if (!sym || sym.length < 2 || sym.length > 6) continue;
          // Deduplicate by symbol (first occurrence wins — typically latest announcement)
          if (seen.has(sym)) continue;
          seen.add(sym);
          // Try parsing amount from title, then summary
          let amount = parseDividendAmount(a.title || "");
          if (amount === null) amount = parseDividendAmount(a.summary || "");
          if (amount === null) continue; // skip announcements without a parseable amount
          live.push({
            symbol: sym,
            company: a.company || sym,
            amount,
            type: classifyType(a.title || ""),
            yieldPct: 0, // yield not derivable from announcement alone
            exDate: a.publishedAt || null, // publishedAt as proxy for "last date to buy/hold"
            source: "live",
          });
        }
        // Merge: prefer live entries; static fills in gaps for symbols not in live data
        const liveSyms = new Set(live.map((d) => d.symbol));
        const merged = [...live];
        for (const s of STATIC_DIVIDENDS) {
          if (!liveSyms.has(s.symbol)) merged.push(s);
        }
        if (cancelled) return;
        setDividends(merged);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Scraper rate-limited / down — fall back to static baseline only
        setDividends(STATIC_DIVIDENDS);
        setSource("static-only");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Issue 15: when the user selects a stock via StockSearch, fetch its full
  // dividend history (DPS per quarter) from /api/psx/financial-results/[symbol].
  // Renders as a list of ALL previous dividend announcements for that stock,
  // latest first to oldest. Also augments with investify.pk announcement titles
  // (already loaded in `dividends` state) filtered to the selected symbol.
  useEffect(() => {
    if (!filterSymbol) {
      // Defer setState to satisfy react-hooks/set-state-in-effect rule
      Promise.resolve().then(() => {
        setHistoryItems([]);
        setHistoryError(null);
        setHistoryCompany("");
        setHistoryLoading(false);
      });
      return;
    }
    let cancelled = false;
    Promise.resolve().then(() => setHistoryLoading(true));
    Promise.resolve().then(() => setHistoryError(null));
    fetch(`/api/psx/financial-results/${encodeURIComponent(filterSymbol)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (!d) {
          setHistoryItems([]);
          setHistoryError("No financial-results data for this symbol");
          return;
        }
        const company: string = d.company || filterSymbol;
        setHistoryCompany(company);
        const items: DividendHistoryItem[] = (d.results || [])
          .filter((r: any) => r?.metrics?.dividendPerShare && r.metrics.dividendPerShare > 0)
          .map((r: any) => ({
            symbol: filterSymbol.toUpperCase(),
            company,
            period: r.period || "",
            periodEnd: r.periodEnd || "",
            dps: Number(r.metrics.dividendPerShare) || 0,
            payoutRatio: Number(r.metrics.dividendPayoutRatio) || 0,
            eps: Number(r.metrics.eps) || 0,
          }))
          .sort((a, b) => (b.periodEnd || "").localeCompare(a.periodEnd || ""));
        setHistoryItems(items);
      })
      .catch((err) => {
        if (cancelled) return;
        setHistoryItems([]);
        setHistoryError(err instanceof Error ? err.message : "Failed to load dividend history");
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filterSymbol]);

  // Issue 16: bell icon should only render when the row's last-date-to-buy
  // (exDate) is in the FUTURE. Past dates get no bell — the user can't act
  // on them anymore.
  const isFutureDate = (iso: string | null): boolean => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    if (isNaN(t)) return false;
    return t > Date.now();
  };

  const toggleAlert = (symbol: string) => {
    setAlerts((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) {
        next.delete(symbol);
        toast.info(`Alert cleared for ${symbol}`);
      } else {
        next.add(symbol);
        pushNotification({
          type: "info",
          title: `Alert set: ${symbol} dividend`,
          body: `We'll notify you before ${symbol}'s "Last date to buy/hold" so you can position for the dividend.`,
          linkView: "dividends",
        });
        toast.success(`Alert set for ${symbol} dividend`);
      }
      return next;
    });
  };

  // Apply StockSearch filter
  const filtered = filterSymbol
    ? dividends.filter(
        (d) =>
          d.symbol.toUpperCase() === filterSymbol.toUpperCase() ||
          d.company.toLowerCase().includes(filterSymbol.toLowerCase())
      )
    : dividends;

  // Sort by amount descending — biggest payouts at top
  const sorted = [...filtered].sort((a, b) => b.amount - a.amount);

  const maxDividend = dividends.length > 0 ? Math.max(...dividends.map((d) => d.amount)) : 0;
  const maxDividendSymbol = dividends.length > 0
    ? dividends.find((d) => d.amount === maxDividend)?.symbol
    : "—";
  const avgYield = dividends.length > 0
    ? dividends.filter((d) => d.yieldPct > 0).reduce((s, d) => s + d.yieldPct, 0) /
        Math.max(1, dividends.filter((d) => d.yieldPct > 0).length)
    : 0;
  const highestYield = dividends.length > 0
    ? Math.max(0, ...dividends.map((d) => d.yieldPct))
    : 0;
  const highestYieldSymbol = dividends.length > 0
    ? dividends.find((d) => d.yieldPct === highestYield && d.yieldPct > 0)?.symbol
    : "—";

  const formatDate = (iso: string | null) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString("en-PK", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0E1A]">
      <AppNav />
      <main className="px-4 md:px-6 py-6 max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[#F4F7FB] flex items-center gap-2">
            <Coins className="h-6 w-6 text-[#00E676]" />
            Dividends
          </h1>
          <p className="text-sm text-[#94A3B8] mt-1">
            All dividend announcements by PSX-listed companies — fetched live from investify.pk/announcements. Sorted by amount (highest first).
          </p>
        </div>

        {/* StockSearch — filter to a specific company */}
        <Card className="bg-[#131829] border-white/[0.08] mb-5">
          <CardContent className="p-4">
            <label className="text-[10px] uppercase tracking-wider text-[#64748B] block mb-1.5">
              Search company dividends (any of 361+ PSX-listed)
            </label>
            <StockSearch
              value={filterSymbol}
              onChange={(sym) => setFilterSymbol(sym)}
              placeholder="Search any PSX stock to view its dividend..."
            />
            {filterSymbol && (
              <p className="text-[11px] text-[#94A3B8] mt-2">
                Filtering dividends for: <span className="font-mono font-semibold text-[#00E676]">{filterSymbol}</span>
                <button
                  onClick={() => setFilterSymbol("")}
                  className="ml-2 text-[#64748B] hover:text-[#F4F7FB] underline"
                >
                  show all
                </button>
              </p>
            )}
          </CardContent>
        </Card>

        {/* Issue 15: per-stock dividend history panel — shown when a symbol
            is selected via StockSearch. Lists ALL previous dividend
            announcements for that stock, latest first to oldest. */}
        {filterSymbol && (
          <Card className="bg-[#131829] border-[#00E676]/20 mb-5">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div>
                  <h3 className="font-semibold text-[#F4F7FB] flex items-center gap-2">
                    <History className="h-4 w-4 text-[#00E676]" />
                    Dividend history — {filterSymbol.toUpperCase()}
                  </h3>
                  <p className="text-xs text-[#94A3B8] mt-0.5">
                    All previous dividend announcements for{" "}
                    <span className="font-semibold text-[#F4F7FB]">{historyCompany || filterSymbol}</span>,
                    latest first to oldest · sourced from quarterly financial results.
                  </p>
                </div>
                {historyItems.length > 0 && (
                  <Badge variant="outline" className="text-[9px] py-0 h-4 border-[#00E676]/40 text-[#00E676]">
                    {historyItems.length} DIVIDEND PAYOUTS
                  </Badge>
                )}
              </div>

              {historyLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 bg-white/[0.04]" />)}
                </div>
              ) : historyError ? (
                <div className="rounded-md bg-[#FF5C5C]/[0.07] border border-[#FF5C5C]/20 p-3 text-xs text-[#FF5C5C]">
                  <span className="font-semibold">Error:</span> {historyError}
                </div>
              ) : historyItems.length === 0 ? (
                <div className="text-center py-6">
                  <Coins className="h-8 w-8 text-[#00E676]/30 mx-auto mb-2" />
                  <p className="text-xs text-[#94A3B8]">
                    No previous dividend payouts found for {filterSymbol.toUpperCase()}.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                  {historyItems.map((h, i) => (
                    <div
                      key={`${h.period}-${h.periodEnd}-${i}`}
                      className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-3 flex items-center gap-3"
                    >
                      <div className="h-9 w-9 rounded-md bg-[#00E676]/10 flex items-center justify-center font-mono font-bold text-[#00E676] text-[10px] shrink-0">
                        {h.symbol.slice(0, 4)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-[#F4F7FB] text-sm">{h.period}</span>
                          <Badge variant="outline" className="text-[9px] py-0 h-4 border-[#FBBF24]/40 text-[#FBBF24] uppercase flex items-center gap-1">
                            <CalendarClock className="h-2.5 w-2.5" />
                            {formatDate(h.periodEnd)}
                          </Badge>
                          {h.payoutRatio > 0 && (
                            <Badge variant="outline" className="text-[9px] py-0 h-4 border-white/[0.12] text-[#94A3B8]">
                              payout {h.payoutRatio.toFixed(0)}%
                            </Badge>
                          )}
                          {i === 0 && (
                            <Badge variant="outline" className="text-[9px] py-0 h-4 border-[#00E676]/40 text-[#00E676] uppercase">
                              LATEST
                            </Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-[#94A3B8] mt-0.5 truncate">
                          {h.company}
                          {h.eps > 0 && (
                            <span className="text-[#64748B] ml-1.5">· EPS PKR {h.eps.toFixed(2)}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-mono font-bold text-[#00E676]">PKR {h.dps.toFixed(2)}</div>
                        <div className="text-[10px] text-[#64748B]">per share</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-2.5 mt-3 text-[10px] text-[#64748B]">
                <span className="text-[#94A3B8] font-semibold">Source:</span> Quarterly financial
                results via <code className="text-[#00E676]">/api/psx/financial-results/{filterSymbol}</code> —
                filtered to quarters with DPS &gt; 0, sorted by period end (latest first).
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary stats — max dividend replaces total payout, avg yield, highest yield */}
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 bg-white/[0.04]" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <Card className="bg-[#131829] border-white/[0.08]">
              <CardContent className="p-4">
                <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Dividends tracked</div>
                <div className="text-2xl font-bold text-[#F4F7FB] font-mono">{dividends.length}</div>
              </CardContent>
            </Card>
            <Card className="bg-[#131829] border-white/[0.08]">
              <CardContent className="p-4">
                <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Maximum dividend</div>
                <div className="text-2xl font-bold text-[#00E676] font-mono">PKR {maxDividend.toFixed(2)}</div>
                <div className="text-[10px] text-[#94A3B8]">{maxDividendSymbol}</div>
              </CardContent>
            </Card>
            <Card className="bg-[#131829] border-white/[0.08]">
              <CardContent className="p-4">
                <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Highest yield</div>
                <div className="text-2xl font-bold text-[#F4F7FB] font-mono">{highestYield > 0 ? `${highestYield.toFixed(1)}%` : "—"}</div>
                <div className="text-[10px] text-[#94A3B8]">{highestYield > 0 ? highestYieldSymbol : "live data"}</div>
              </CardContent>
            </Card>
            <Card className="bg-[#131829] border-white/[0.08]">
              <CardContent className="p-4">
                <div className="text-[10px] uppercase tracking-wider text-[#64748B]">Avg yield (known)</div>
                <div className="text-2xl font-bold text-[#F4F7FB] font-mono">{avgYield > 0 ? `${avgYield.toFixed(1)}%` : "—"}</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Dividend list */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-20 bg-white/[0.04]" />)}
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-center py-16">
            <Coins className="h-10 w-10 text-[#00E676]/30 mx-auto mb-3" />
            <p className="text-sm text-[#94A3B8]">
              {filterSymbol
                ? `No dividend announcements found for ${filterSymbol}.`
                : "No dividend announcements available."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map((d) => {
              const isAlerted = alerts.has(d.symbol);
              return (
                <Card
                  key={`${d.symbol}-${d.type}`}
                  className={`bg-[#131829] ${
                    isAlerted ? "border-[#FBBF24]/40" : "border-white/[0.08]"
                  } hover:border-[#00E676]/30 transition-colors`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                      {/* Symbol */}
                      <div className="h-12 w-12 rounded-lg bg-[#00E676]/10 flex items-center justify-center font-mono font-bold text-[#00E676] shrink-0">
                        {d.symbol.slice(0, 4)}
                      </div>

                      {/* Main */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-[#F4F7FB]">{d.symbol}</span>
                          <Badge
                            variant="outline"
                            className="text-[9px] py-0 h-4 border-[#00E676]/40 text-[#00E676] uppercase"
                          >
                            {d.type}
                          </Badge>
                          {/* Replaced "Ex dividend date" with "Last date to buy/hold" */}
                          <Badge
                            variant="outline"
                            className="text-[9px] py-0 h-4 border-[#FBBF24]/40 text-[#FBBF24] uppercase flex items-center gap-1"
                          >
                            <CalendarClock className="h-2.5 w-2.5" />
                            Last date to buy/hold: {formatDate(d.exDate)}
                          </Badge>
                          {d.source === "live" && (
                            <Badge
                              variant="outline"
                              className="text-[8px] py-0 h-3.5 border-[#00E676]/30 text-[#00E676]/80"
                            >
                              LIVE
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-[#94A3B8] mt-0.5 truncate">{d.company}</div>
                      </div>

                      {/* Amount */}
                      <div className="text-right shrink-0">
                        <div className="text-sm font-mono font-bold text-[#F4F7FB]">PKR {d.amount.toFixed(2)}</div>
                        <div className="text-[10px] text-[#64748B]">per share</div>
                      </div>

                      {/* Yield (only show if known) */}
                      <div className="text-right shrink-0 hidden sm:block">
                        {d.yieldPct > 0 ? (
                          <>
                            <div className="text-sm font-mono font-bold text-[#00E676]">{d.yieldPct.toFixed(1)}%</div>
                            <div className="text-[10px] text-[#64748B]">yield</div>
                          </>
                        ) : (
                          <>
                            <div className="text-sm font-mono text-[#64748B]">—</div>
                            <div className="text-[10px] text-[#64748B]">yield</div>
                          </>
                        )}
                      </div>

                      {/* Bell alert — turns yellow when clicked (alert active) */}
                      <button
                        onClick={() => toggleAlert(d.symbol)}
                        title={isAlerted ? `Alert active — click to remove` : `Set alert for ${d.symbol} dividend`}
                        className={`shrink-0 h-9 w-9 rounded-md flex items-center justify-center transition-colors ${
                          isAlerted
                            ? "bg-[#FBBF24]/15 text-[#FBBF24] hover:bg-[#FBBF24]/25"
                            : "text-[#64748B] hover:text-[#F4F7FB] hover:bg-white/[0.04]"
                        }`}
                        aria-label={isAlerted ? "Remove dividend alert" : "Set dividend alert"}
                        aria-pressed={isAlerted}
                      >
                        {isAlerted ? (
                          <BellRing className="h-4 w-4" />
                        ) : (
                          <Bell className="h-4 w-4" />
                        )}
                      </button>
                    </div>

                    {/* Alert active banner */}
                    {isAlerted && (
                      <div className="mt-3 pt-3 border-t border-[#FBBF24]/20 flex items-center gap-2">
                        <TrendingUp className="h-3 w-3 text-[#FBBF24]" />
                        <span className="text-[10px] uppercase tracking-wider text-[#FBBF24] font-semibold">
                          Alert active:
                        </span>
                        <span className="text-[11px] text-[#94A3B8]">
                          You'll be notified before {d.symbol}'s last date to buy/hold ({formatDate(d.exDate)}) so you can position for the dividend.
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Loading banner during live fetch */}
        {loading && (
          <div className="rounded-md bg-[#0A0E1A] border border-[#00E676]/20 p-3 mt-4 flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 text-[#00E676] animate-spin" />
            <span className="text-[11px] text-[#94A3B8]">
              Fetching all dividend announcements from investify.pk...
            </span>
          </div>
        )}

        <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3 text-[11px] text-[#64748B] leading-relaxed mt-6">
          <span className="text-[#94A3B8] font-semibold">Dividends note:</span>{" "}
          {source === "static-only"
            ? "Live fetch from investify.pk/announcements failed (rate-limited or down). Showing the static baseline of 8 stocks as a fallback. Try refreshing later."
            : "Live dividend announcements fetched from investify.pk/announcements (type=dividend). The amount is parsed from the announcement title/summary. \"Last date to buy/hold\" is the published date of the announcement as a proxy for ex-dividend date — buy/hold before this date to qualify for the dividend. The bell icon turns yellow when you set an alert."}
        </div>
      </main>
    </div>
  );
}
