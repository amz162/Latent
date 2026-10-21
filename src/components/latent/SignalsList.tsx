"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AppNav } from "./AppNav";
import { useLatentStore } from "@/lib/latent/store";
import { Signal, TradeHorizon } from "@/lib/latent/types";
import { Filter, Zap, RefreshCw } from "lucide-react";

const HORIZON_FILTERS: (TradeHorizon | "ALL")[] = ["ALL", "DAY", "SWING", "DIVIDEND", "GROWTH"];

export function SignalsList() {
  const selectSignal = useLatentStore((s) => s.selectSignal);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TradeHorizon | "ALL">("ALL");

  const load = () => {
    setLoading(true);
    fetch("/api/signals")
      .then((r) => r.json())
      .then((d) => setSignals(d.signals || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetch("/api/signals")
      .then((r) => r.json())
      .then((d) => setSignals(d.signals || []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter === "ALL" ? signals : signals.filter((s) => s.horizon === filter);

  return (
    <div className="min-h-screen bg-[#0A0E1A]">
      <AppNav />
      <main className="px-4 md:px-6 py-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-[#F4F7FB]">Active signals</h1>
            <p className="text-sm text-[#94A3B8] mt-1">
              AI-generated, layman-explained. Tap any to see the full breakdown.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
            className="border-white/[0.12] text-[#94A3B8]"
          >
            <RefreshCw className={`h-3 w-3 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 mb-5 overflow-x-auto latent-no-scrollbar pb-1">
          <Filter className="h-3.5 w-3.5 text-[#64748B] flex-shrink-0" />
          {HORIZON_FILTERS.map((h) => (
            <Button
              key={h}
              variant={filter === h ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(h)}
              className={`shrink-0 ${
                filter === h
                  ? "bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] border-[#00E676]"
                  : "border-white/[0.12] text-[#94A3B8] hover:text-[#F4F7FB]"
              }`}
            >
              {h === "ALL" ? "All horizons" : h.charAt(0) + h.slice(1).toLowerCase()}
            </Button>
          ))}
        </div>

        {loading ? (
          <div className="grid md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32 bg-white/[0.04]" />
            ))}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {filtered.map((sig) => (
              <Card
                key={sig.id}
                className="bg-[#131829] border-white/[0.08] hover:border-[#00E676]/30 transition-colors cursor-pointer"
                onClick={() => selectSignal(sig.id)}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="h-11 w-11 rounded-lg bg-[#00E676]/10 flex items-center justify-center font-mono font-bold text-[#00E676]">
                        {sig.symbol.slice(0, 4)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[#F4F7FB]">{sig.symbol}</span>
                          <Badge variant="outline" className="text-[9px] py-0 h-4 border-[#00E676]/40 text-[#00E676]">
                            {sig.horizon}
                          </Badge>
                        </div>
                        <div className="text-xs text-[#94A3B8] mt-0.5 truncate max-w-[220px]">
                          {sig.stockName}
                        </div>
                      </div>
                    </div>
                    {sig.status === "TRIGGERED" && (
                      <Badge variant="outline" className="border-amber-500/40 text-amber-400 text-[9px]">
                        TRIGGERED
                      </Badge>
                    )}
                  </div>

                  {/* Trade parameters */}
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    <div>
                      <div className="text-[9px] uppercase text-[#64748B]">Entry</div>
                      <div className="text-sm font-mono font-semibold text-[#F4F7FB]">{sig.entryPrice}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase text-[#64748B]">Target</div>
                      <div className="text-sm font-mono font-semibold text-[#00E676]">{sig.targetPrice}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase text-[#64748B]">Stop</div>
                      <div className="text-sm font-mono font-semibold text-[#FF5C5C]">{sig.stopLoss}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase text-[#64748B]">Upside</div>
                      <div className="text-sm font-mono font-semibold text-[#00E676]">
                        +{(((sig.targetPrice - sig.entryPrice) / sig.entryPrice) * 100).toFixed(1)}%
                      </div>
                    </div>
                  </div>

                  {/* Summary */}
                  <p className="text-xs text-[#94A3B8] leading-relaxed line-clamp-2 mb-3">
                    {sig.explanation.summary}
                  </p>

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
                    <div className="flex items-center gap-2 text-[10px] text-[#64748B]">
                      <Zap className="h-3 w-3" />
                      <span>Confidence {sig.confidenceScore}/100</span>
                    </div>
                    <div className="text-[10px] text-[#64748B]">
                      {sig.status === "ACTIVE"
                        ? `Expires ${new Date(sig.expiresAt).toLocaleDateString("en-PK", { month: "short", day: "numeric" })}`
                        : "Entry window closed"}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-16">
            <Zap className="h-10 w-10 text-[#00E676]/30 mx-auto mb-3" />
            <p className="text-sm text-[#94A3B8]">No active signals in this horizon right now.</p>
          </div>
        )}
      </main>
    </div>
  );
}
