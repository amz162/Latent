"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

interface Candle {
  date: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ChartProps {
  symbol: string;
  height?: number;
}

// Real chart using recharts wired to /api/psx/technical/[symbol] (real OHLCV)
// Shows: price line + volume area + 50-DMA + 200-DMA + horizontal S/R lines
export function RealChart({ symbol, height = 320 }: ChartProps) {
  const [data, setData] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/psx/technical/${encodeURIComponent(symbol)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Upstream ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        // The /api/psx/technical endpoint returns the raw CSV-shaped data
        // from askanalyst.com.pk. Parse it into Candle objects.
        const raw = d.technical;
        const candles: Candle[] = parseUpstream(raw);
        if (candles.length === 0) {
          if (cancelled) return;
          setError("No OHLCV data available");
          setLoading(false);
          return;
        }
        setData(candles);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[RealChart] fetch error:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // Compute 50-DMA and 200-DMA + identify S/R levels
  const enriched = computeSMAAndLevels(data);

  // Format date for x-axis
  const formatXAxis = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString("en-PK", { month: "short", day: "numeric" });
  };

  if (loading) {
    return (
      <div className="w-full" style={{ height }}>
        <Skeleton className="h-full w-full bg-white/[0.04]" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="w-full flex items-center justify-center text-center text-xs text-[#94A3B8] border border-white/[0.06] rounded-lg bg-[#0A0E1A]"
        style={{ height }}
      >
        <div>
          <p className="font-semibold mb-1">Chart unavailable</p>
          <p className="text-[10px] text-[#64748B]">{error}</p>
          <p className="text-[10px] text-[#64748B] mt-1">
            AskAnalyst.com.pk technical chart endpoint may be rate-limited or down.
          </p>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div
        className="w-full flex items-center justify-center text-xs text-[#64748B]"
        style={{ height }}
      >
        No data
      </div>
    );
  }

  const { support, resistance } = findSupportResistance(enriched);

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={enriched} margin={{ top: 10, right: 10, bottom: 5, left: 5 }}>
          <defs>
            <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00E676" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#00E676" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis
            dataKey="date"
            tickFormatter={formatXAxis}
            stroke="#64748B"
            tick={{ fontSize: 10, fill: "#64748B" }}
            tickLine={false}
            axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
            minTickGap={40}
          />
          <YAxis
            yAxisId="price"
            orientation="right"
            stroke="#64748B"
            tick={{ fontSize: 10, fill: "#64748B" }}
            tickLine={false}
            axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
            domain={["auto", "auto"]}
          />
          <YAxis
            yAxisId="volume"
            orientation="left"
            hide
            domain={[0, "auto"]}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#131829",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            labelStyle={{ color: "#94A3B8" }}
            labelFormatter={(ts) => new Date(Number(ts)).toLocaleDateString("en-PK", { year: "numeric", month: "short", day: "numeric" })}
            formatter={(value: number, name: string) => {
              if (name === "Price") return [value.toFixed(2), "Price"];
              if (name === "50-DMA") return [value.toFixed(2), "50-DMA"];
              if (name === "200-DMA") return [value.toFixed(2), "200-DMA"];
              if (name === "Volume") return [value.toLocaleString(), "Volume"];
              return [value, name];
            }}
          />
          {/* Support / Resistance lines */}
          {support && (
            <ReferenceLine
              yAxisId="price"
              y={support}
              stroke="#FF5C5C"
              strokeDasharray="6 4"
              strokeOpacity={0.6}
              label={{ value: `S: ${support.toFixed(2)}`, position: "insideLeft", fill: "#FF5C5C", fontSize: 10 }}
            />
          )}
          {resistance && (
            <ReferenceLine
              yAxisId="price"
              y={resistance}
              stroke="#FBBF24"
              strokeDasharray="6 4"
              strokeOpacity={0.6}
              label={{ value: `R: ${resistance.toFixed(2)}`, position: "insideLeft", fill: "#FBBF24", fontSize: 10 }}
            />
          )}
          {/* Volume area */}
          <Area
            yAxisId="volume"
            dataKey="volume"
            stroke="rgba(0,230,118,0.25)"
            strokeWidth={1}
            fill="rgba(0,230,118,0.08)"
            name="Volume"
            isAnimationActive={false}
          />
          {/* Price line */}
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="close"
            stroke="#00E676"
            strokeWidth={2}
            dot={false}
            name="Price"
            isAnimationActive={false}
          />
          {/* 50-DMA */}
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="sma50"
            stroke="#22E881"
            strokeWidth={1}
            strokeDasharray="3 3"
            dot={false}
            name="50-DMA"
            isAnimationActive={false}
            connectNulls
          />
          {/* 200-DMA */}
          <Line
            yAxisId="price"
            type="monotone"
            dataKey="sma200"
            stroke="#94A3B8"
            strokeWidth={1}
            strokeDasharray="6 3"
            dot={false}
            name="200-DMA"
            isAnimationActive={false}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function parseUpstream(raw: unknown): Candle[] {
  // The askanalyst.com.pk /technicalchart endpoint returns CSV-text in our proxy
  // Format: "date,open,high,low,close,volume\n{ts},{o},{h},{l},{c},{v},{adj_close},{adj_vol}"
  if (typeof raw === "string") {
    const lines = raw.split("\n").filter((l) => l.trim());
    const candles: Candle[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",");
      if (parts.length < 6) continue;
      const date = Number(parts[0]);
      const open = Number(parts[1]);
      const high = Number(parts[2]);
      const low = Number(parts[3]);
      const close = Number(parts[4]);
      const volume = Number(parts[5]);
      if (!date || !close || isNaN(close) || volume === 0) continue;
      candles.push({ date, open, high, low, close, volume });
    }
    return candles;
  }
  // If upstream returned JSON already, handle that too
  if (Array.isArray(raw)) {
    return raw.filter((c: any) => c && c.date && c.close && c.volume > 0);
  }
  return [];
}

function computeSMAAndLevels(candles: Candle[]): (Candle & { sma50?: number; sma200?: number })[] {
  return candles.map((c, i) => {
    const sma50 = i >= 49 ? avg(candles.slice(i - 49, i + 1).map((x) => x.close)) : undefined;
    const sma200 = i >= 199 ? avg(candles.slice(i - 199, i + 1).map((x) => x.close)) : undefined;
    return { ...c, sma50, sma200 };
  });
}

function avg(nums: number[]): number {
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function findSupportResistance(data: (Candle & { sma50?: number; sma200?: number })[]): { support: number | null; resistance: number | null } {
  if (data.length < 20) return { support: null, resistance: null };
  // Take last 60 days, find min low + max high (excluding recent 5 days)
  const recent = data.slice(-60, -5);
  if (recent.length === 0) return { support: null, resistance: null };
  const lows = recent.map((c) => c.low);
  const highs = recent.map((c) => c.high);
  const support = Math.min(...lows);
  const resistance = Math.max(...highs);
  return { support, resistance };
}
