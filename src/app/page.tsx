"use client";
import { useState, useEffect } from "react";

const TABS = [
  { id: "home", label: "Home" },
  { id: "dashboard", label: "Dashboard" },
  { id: "fundamental", label: "Fundamental" },
];

async function fetchJSON(url: string) {
  try {
    const res = await fetch(url);
    return await res.json();
  } catch { return null; }
}

export default function Home() {
  const [tab, setTab] = useState("home");
  const [stocks, setStocks] = useState<any[]>([]);
  const [quote, setQuote] = useState<any>(null);
  const [sym, setSym] = useState("LUCK");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchJSON("/api/stocks").then(d => {
      if (d?.companies) setStocks(d.companies.slice(0, 50));
      else if (Array.isArray(d)) setStocks(d.slice(0, 50));
    });
  }, []);

  const getQuote = async () => {
    setLoading(true);
    const d = await fetchJSON(`/api/psx/live?symbol=${sym}`);
    setQuote(d);
    setLoading(false);
  };

  return (
    <div className="min-h-screen grid-bg">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#0A0E1A]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-[#00E676] glow flex items-center justify-center">
              <span className="font-black text-[#0A0E1A] text-sm">L</span>
            </div>
            <span className="font-bold text-lg md:text-xl">Latent<span className="text-[#00E676]">.pk</span></span>
          </div>
          <nav className="flex gap-1 md:gap-2">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium transition-colors
                  ${tab === t.id ? "bg-[#00E676]/15 text-[#00E676]" : "text-[#94A3B8] hover:text-[#F4F7FB] hover:bg-white/5"}`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-10">
        {tab === "home" && (
          <div className="space-y-6">
            <div className="text-center py-8 md:py-16">
              <h1 className="text-3xl md:text-5xl font-bold mb-3 md:mb-4">
                AI-Driven <span className="text-[#00E676]">PSX</span> Investment Intelligence
              </h1>
              <p className="text-[#94A3B8] text-sm md:text-lg max-w-2xl mx-auto">
                Turning "what stock should I buy" into "here's the plan to reach your goal."
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { title: "1,048 Stocks", desc: "All PSX-listed stocks with live prices" },
                { title: "25 Ensembles", desc: "AI model backtests with up to 91.9% precision" },
                { title: "Live Data", desc: "Real-time prices from psxdata API" },
              ].map((card, i) => (
                <div key={i} className="rounded-xl border border-white/[0.08] bg-[#131829] p-5 md:p-6">
                  <h3 className="text-lg md:text-xl font-bold text-[#00E676] mb-1">{card.title}</h3>
                  <p className="text-xs md:text-sm text-[#94A3B8]">{card.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "dashboard" && (
          <div className="space-y-4">
            <h2 className="text-xl md:text-2xl font-bold mb-4">Dashboard</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              {[
                { label: "Total Stocks", value: "1,048" },
                { label: "Sectors", value: "38" },
                { label: "Indices", value: "18" },
                { label: "Ensembles", value: "25" },
              ].map((s, i) => (
                <div key={i} className="rounded-xl border border-white/[0.08] bg-[#131829] p-4">
                  <div className="text-xs text-[#64748B] uppercase">{s.label}</div>
                  <div className="text-xl md:text-2xl font-bold mt-1">{s.value}</div>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-[#131829] p-4 md:p-6">
              <h3 className="font-bold mb-3">Quick Quote</h3>
              <div className="flex gap-2 mb-4">
                <input
                  value={sym}
                  onChange={e => setSym(e.target.value.toUpperCase())}
                  className="bg-[#0A0E1A] border border-white/[0.12] rounded-lg px-3 py-2 text-sm w-24 md:w-40"
                  placeholder="LUCK"
                />
                <button onClick={getQuote} disabled={loading}
                  className="bg-[#00E676] text-[#0A0E1A] px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50">
                  {loading ? "..." : "Search"}
                </button>
              </div>
              {quote && !quote.error && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div><div className="text-[#64748B] text-xs">Price</div><div className="font-mono font-bold">{quote.price}</div></div>
                  <div><div className="text-[#64748B] text-xs">P/E Ratio</div><div className="font-mono">{quote.pe_ratio}</div></div>
                  <div><div className="text-[#64748B] text-xs">Div Yield</div><div className="font-mono">{quote.dividend_yield}%</div></div>
                  <div><div className="text-[#64748B] text-xs">1Y Change</div><div className={`font-mono ${(quote.change_1y_pct||0) >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}`}>{(quote.change_1y_pct||0)}%</div></div>
                </div>
              )}
              {quote?.error && <p className="text-[#FF5C5C] text-sm">{quote.error}</p>}
            </div>
          </div>
        )}

        {tab === "fundamental" && (
          <div className="space-y-4">
            <h2 className="text-xl md:text-2xl font-bold mb-4">Fundamental Analysis</h2>
            <div className="rounded-xl border border-white/[0.08] bg-[#131829] p-4 md:p-6">
              <h3 className="font-bold mb-3">Stock Lookup</h3>
              <div className="flex gap-2 mb-4">
                <input
                  value={sym}
                  onChange={e => setSym(e.target.value.toUpperCase())}
                  className="bg-[#0A0E1A] border border-white/[0.12] rounded-lg px-3 py-2 text-sm w-24 md:w-40"
                  placeholder="LUCK"
                />
                <button onClick={getQuote} disabled={loading}
                  className="bg-[#00E676] text-[#0A0E1A] px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50">
                  {loading ? "..." : "Analyze"}
                </button>
              </div>
              {quote && !quote.error && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div className="bg-[#0A0E1A] rounded-lg p-3">
                      <div className="text-[#64748B] text-xs uppercase mb-1">Market Cap</div>
                      <div className="font-mono font-bold">{quote.market_cap ? `PKR ${(quote.market_cap/1e9).toFixed(1)}B` : "N/A"}</div>
                    </div>
                    <div className="bg-[#0A0E1A] rounded-lg p-3">
                      <div className="text-[#64748B] text-xs uppercase mb-1">P/E Ratio</div>
                      <div className="font-mono font-bold">{quote.pe_ratio || "N/A"}</div>
                    </div>
                    <div className="bg-[#0A0E1A] rounded-lg p-3">
                      <div className="text-[#64748B] text-xs uppercase mb-1">Dividend Yield</div>
                      <div className="font-mono font-bold">{quote.dividend_yield ? `${quote.dividend_yield}%` : "N/A"}</div>
                    </div>
                    <div className="bg-[#0A0E1A] rounded-lg p-3">
                      <div className="text-[#64748B] text-xs uppercase mb-1">Free Float</div>
                      <div className="font-mono font-bold">{quote.free_float || "N/A"}</div>
                    </div>
                    <div className="bg-[#0A0E1A] rounded-lg p-3">
                      <div className="text-[#64748B] text-xs uppercase mb-1">30D Volume</div>
                      <div className="font-mono font-bold">{quote.volume_avg_30d ? quote.volume_avg_30d.toLocaleString() : "N/A"}</div>
                    </div>
                    <div className="bg-[#0A0E1A] rounded-lg p-3">
                      <div className="text-[#64748B] text-xs uppercase mb-1">1Y Change</div>
                      <div className={`font-mono font-bold ${(quote.change_1y_pct||0) >= 0 ? "text-[#00E676]" : "text-[#FF5C5C]"}`}>{(quote.change_1y_pct||0)}%</div>
                    </div>
                  </div>
                  <div className="bg-[#0A0E1A] rounded-lg p-3">
                    <div className="text-[#64748B] text-xs uppercase mb-2">Current Price</div>
                    <div className="text-2xl font-bold font-mono text-[#00E676]">PKR {quote.price}</div>
                  </div>
                </div>
              )}
              {quote?.error && <p className="text-[#FF5C5C] text-sm">{quote.error}</p>}
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-[#131829] p-4">
              <h3 className="font-bold mb-2 text-sm">Popular Stocks</h3>
              <div className="flex flex-wrap gap-2">
                {["LUCK","OGDC","HUBC","ENGRO","SYS","MARI","PSO","PPL"].map(s => (
                  <button key={s} onClick={() => { setSym(s); }}
                    className="px-2 py-1 rounded text-xs bg-white/5 text-[#94A3B8] hover:bg-[#00E676]/10 hover:text-[#00E676]">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] mt-8">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 text-center text-xs text-[#64748B]">
          Latent.pk — AI-Driven Investment Intelligence for PSX
        </div>
      </footer>
    </div>
  );
}
