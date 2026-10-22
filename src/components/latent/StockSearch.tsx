"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { Search, X, TrendingUp, Star } from "lucide-react";
import { Input } from "@/components/ui/input";

export interface Company { id: number; value: string; label: string; sector?: string; image?: string; }
interface StockSearchProps {
  value: string; onChange: (symbol: string, company?: Company) => void;
  placeholder?: string; autoFocus?: boolean; showRecent?: boolean; showSuggestions?: boolean; className?: string;
}
const RECENT_KEY = "stock-search-recent"; const MAX_RECENT = 8;
function loadRecent(): string[] { if (typeof window === "undefined") return []; try { const r = localStorage.getItem(RECENT_KEY); return r ? JSON.parse(r) : []; } catch { return []; } }
function saveRecent(s: string) { if (typeof window === "undefined") return; try { const e = loadRecent().filter(x => x !== s); localStorage.setItem(RECENT_KEY, JSON.stringify([s, ...e].slice(0, MAX_RECENT))); } catch {} }

export function StockSearch({ value, onChange, placeholder = "Search stock by symbol or name...", autoFocus = false, showRecent = true, showSuggestions = true, className = "" }: StockSearchProps) {
  const [query, setQuery] = useState(""); const [open, setOpen] = useState(false); const [highlighted, setHighlighted] = useState(0);
  const [companies, setCompanies] = useState<Company[]>([]); const [loading, setLoading] = useState(false); const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null); const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setLoading(true); fetch("/api/psx/companies").then(r => r.ok ? r.json() : null).then(d => { if (d?.companies) setCompanies(d.companies); }).catch(() => {}).finally(() => setLoading(false)); setRecent(loadRecent()); }, []);
  useEffect(() => { const h = (e: MouseEvent) => { if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  const filtered = useMemo(() => { if (!query.trim()) return []; const q = query.trim().toUpperCase(); const ql = query.trim().toLowerCase(); return companies.filter(c => c.value.includes(q) || (c.label && c.label.toLowerCase().includes(ql))).slice(0, 50); }, [query, companies]);
  const suggestions = useMemo(() => { if (!showSuggestions || query.trim()) return null; const rc = recent.map(s => companies.find(c => c.value === s)).filter(Boolean) as Company[]; const pop = ["OGDC","ENGRO","HUBC","LUCK","SYS","MEBL","PSO","PPL","MARI","DGKC","MLCF","EFERT","ABOT","INDU"].map(s => companies.find(c => c.value === s)).filter((c,i,a) => c && a.findIndex(x => x?.value === c!.value) === i).filter(c => !rc.find(r => r.value === c!.value)).slice(0, 12) as Company[]; return { recent: rc, popular: pop }; }, [query, companies, recent, showSuggestions]);
  const grouped = useMemo(() => { const g = new Map<string, Company[]>(); for (const c of filtered) { const s = c.sector || "Other"; if (!g.has(s)) g.set(s, []); g.get(s)!.push(c); } return Array.from(g.entries()).sort((a, b) => b[1].length - a[1].length); }, [filtered]);
  const select = (c: Company) => { onChange(c.value, c); setQuery(""); setOpen(false); saveRecent(c.value); setRecent(loadRecent()); };
  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => { if (!open) { if (e.key === "ArrowDown" || e.key === "Enter") setOpen(true); return; } if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)); } else if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); } else if (e.key === "Enter") { e.preventDefault(); if (filtered[highlighted]) select(filtered[highlighted]); else if (filtered.length === 1) select(filtered[0]); } else if (e.key === "Escape") { setOpen(false); inputRef.current?.blur(); } };
  const selected = companies.find(c => c.value === value);
  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#64748B] pointer-events-none" /><Input ref={inputRef} type="text" value={query || (selected ? `${selected.value} — ${selected.label}` : value)} onChange={e => { setQuery(e.target.value); setOpen(true); setHighlighted(0); }} onFocus={e => { setOpen(true); if (!query) e.target.select(); }} onKeyDown={handleKey} placeholder={placeholder} autoFocus={autoFocus} className="bg-[#0A0E1A] border-white/[0.12] text-[#F4F7FB] text-sm pl-8 pr-8" />{(query || value) && <button onClick={() => { setQuery(""); onChange(""); inputRef.current?.focus(); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#F4F7FB]"><X className="h-3.5 w-3.5" /></button>}</div>
      {open && (<div className="absolute z-50 top-full mt-1 left-0 right-0 bg-[#131829] border border-white/[0.12] rounded-md shadow-2xl max-h-96 overflow-y-auto">{loading && <div className="p-3 text-xs text-[#64748B] text-center">Loading PSX-listed companies...</div>}
        {!loading && !query.trim() && showSuggestions && suggestions && (<>
          {suggestions.recent.length > 0 && <div className="p-2"><div className="text-[10px] uppercase text-[#64748B] px-2 py-1 flex items-center gap-1.5"><Star className="h-3 w-3" /> Recent picks</div>{suggestions.recent.map(c => <Row key={`r-${c.value}`} c={c} onPick={select} />)}</div>}
          {suggestions.popular.length > 0 && <div className="p-2 border-t border-white/[0.04]"><div className="text-[10px] uppercase text-[#64748B] px-2 py-1 flex items-center gap-1.5"><TrendingUp className="h-3 w-3" /> Popular stocks</div>{suggestions.popular.map(c => <Row key={`p-${c.value}`} c={c} onPick={select} />)}</div>}
          <div className="p-2 border-t border-white/[0.04] text-[10px] text-[#64748B] text-center">Type to search all {companies.length > 0 ? companies.length.toLocaleString() : "1,000+"} PSX-listed securities</div></>)}
        {!loading && query.trim() && (filtered.length === 0 ? <div className="p-4 text-xs text-[#64748B] text-center">No stocks matching "{query}"</div> : <><div className="p-2 border-b border-white/[0.04] text-[10px] text-[#64748B] px-2">{filtered.length} matches</div>{grouped.map(([sector, items]) => <div key={sector} className="p-1"><div className="text-[10px] uppercase tracking-wider text-[#64748B] px-2 py-1 bg-white/[0.02] sticky top-0">{sector}</div>{items.map(c => { const idx = filtered.findIndex(f => f.value === c.value); return <Row key={c.value} c={c} onPick={select} highlighted={idx === highlighted} />; })}</div>)}</>)}
      </div>)}
    </div>
  );
}
function Row({ c, onPick, highlighted = false }: { c: Company; onPick: (c: Company) => void; highlighted?: boolean }) {
  return <button type="button" onClick={() => onPick(c)} className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center gap-2 transition-colors ${highlighted ? "bg-[#00E676]/10 text-[#00E676]" : "hover:bg-white/[0.04] text-[#F4F7FB]"}`}>{c.image ? <img src={c.image} alt={c.value} className="h-4 w-4 rounded-sm bg-white/5 shrink-0" onError={e => (e.currentTarget.style.display = "none")} /> : <div className="h-4 w-4 rounded-sm bg-[#00E676]/15 flex items-center justify-center text-[8px] font-mono text-[#00E676] shrink-0">{c.value.charAt(0)}</div>}<span className="font-mono font-semibold shrink-0 w-14">{c.value}</span><span className="text-[#94A3B8] truncate flex-1">{c.label}</span></button>;
}
