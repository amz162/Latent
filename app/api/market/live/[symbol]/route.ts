import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const prisma = new PrismaClient();
const BASE_URL = "https://psxdata-api.fastapicloud.dev";

/**
 * GET /api/market/live/[symbol]
 * Returns the live quote for a single PSX symbol.
 *
 * Strategy:
 *   1. Fetch fresh from psxdata-api.fastapicloud.dev (live)
 *   2. Update the DB row in-place (so subsequent reads are fast)
 *   3. If live fetch fails, fall back to the latest cached row from DB
 *
 * Query params:
 *   ?forceCache=1   — skip the live upstream fetch and return the DB row only (fast)
 */
export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const start = Date.now();
  const { symbol: rawSymbol } = await params;
  const sym = rawSymbol.toUpperCase().trim();
  if (!sym) return NextResponse.json({ error: "Missing symbol" }, { status: 400 });

  const url = new URL(req.url);
  const forceCache = url.searchParams.get("forceCache") === "1";

  let liveQuote: any = null;
  let liveSource: string | null = null;
  let liveError: string | null = null;

  if (!forceCache) {
    // 1. Fetch fresh from upstream
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${BASE_URL}/stocks/${encodeURIComponent(sym)}/quote`, {
        headers: { Accept: "application/json", "User-Agent": "LatentBot/1.0" },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const json = await res.json();
        if (json?.data && typeof json.data.price === "number") {
          liveQuote = json.data;
          // Strip trailing "XD" if present (ex-dividend adjustment marker)
          if (typeof liveQuote.symbol === "string" && liveQuote.symbol.toUpperCase().endsWith("XD")) {
            liveQuote.symbol = liveQuote.symbol.slice(0, -2);
          }
          liveSource = "psxdata-live";
        }
      }
    } catch (e: any) {
      liveError = e?.message ?? String(e);
    }

    // 2. Update DB row in-place with the fresh quote (best-effort, non-blocking)
    if (liveQuote) {
      try {
        await prisma.stock.upsert({
          where: { symbol: sym },
          create: {
            symbol: sym, name: sym,
            price: typeof liveQuote.price === "number" ? liveQuote.price : null,
            marketCap: liveQuote.market_cap != null ? Number(liveQuote.market_cap) : null,
            peRatio: liveQuote.pe_ratio != null ? Number(liveQuote.pe_ratio) : null,
            divYield: liveQuote.dividend_yield != null ? Number(liveQuote.dividend_yield) : null,
            freeFloat: liveQuote.free_float != null ? Number(liveQuote.free_float) : null,
            volume30d: liveQuote.volume_avg_30d != null ? Number(liveQuote.volume_avg_30d) : null,
            change1yPct: liveQuote.change_1y_pct != null ? Number(liveQuote.change_1y_pct) : null,
            ldcp: liveQuote.ldcp != null ? Number(liveQuote.ldcp) : null,
            change: liveQuote.change != null ? Number(liveQuote.change) : null,
            changePct: liveQuote.change_pct != null ? Number(liveQuote.change_pct) : null,
            source: "psxdata-live",
            lastSyncedAt: new Date(),
          },
          update: {
            price: typeof liveQuote.price === "number" ? liveQuote.price : null,
            marketCap: liveQuote.market_cap != null ? Number(liveQuote.market_cap) : null,
            peRatio: liveQuote.pe_ratio != null ? Number(liveQuote.pe_ratio) : null,
            divYield: liveQuote.dividend_yield != null ? Number(liveQuote.dividend_yield) : null,
            freeFloat: liveQuote.free_float != null ? Number(liveQuote.free_float) : null,
            volume30d: liveQuote.volume_avg_30d != null ? Number(liveQuote.volume_avg_30d) : null,
            change1yPct: liveQuote.change_1y_pct != null ? Number(liveQuote.change_1y_pct) : null,
            ldcp: liveQuote.ldcp != null ? Number(liveQuote.ldcp) : null,
            change: liveQuote.change != null ? Number(liveQuote.change) : null,
            changePct: liveQuote.change_pct != null ? Number(liveQuote.change_pct) : null,
            source: "psxdata-live",
            lastSyncedAt: new Date(),
          },
        });
      } catch (e) {
        // Don't fail the request if DB update fails
        console.error("[/api/market/live/[symbol]] db upsert failed:", e);
      }
    }
  }

  // 3. If live fetch failed, try the DB cache
  let cachedRow = null;
  if (!liveQuote) {
    cachedRow = await prisma.stock.findUnique({
      where: { symbol: sym },
      include: { sector: { select: { name: true } } },
    });
    if (cachedRow?.price != null) {
      liveSource = "db-cache";
    } else if (cachedRow) {
      liveSource = "db-cache-noquote";
    }
  }

  if (!liveQuote && !cachedRow) {
    return NextResponse.json(
      { error: `Symbol ${sym} not found in live API or DB`, symbol: sym, liveError },
      { status: 404 }
    );
  }

  const quote = liveQuote ?? {
    symbol: cachedRow!.symbol,
    price: cachedRow!.price,
    market_cap: cachedRow!.marketCap,
    pe_ratio: cachedRow!.peRatio,
    dividend_yield: cachedRow!.divYield,
    free_float: cachedRow!.freeFloat,
    volume_avg_30d: cachedRow!.volume30d,
    change_1y_pct: cachedRow!.change1yPct,
    ldcp: cachedRow!.ldcp,
    change: cachedRow!.change,
    change_pct: cachedRow!.changePct,
  };

  return NextResponse.json({
    symbol: sym,
    quote: {
      symbol: quote.symbol,
      price: quote.price,
      marketCap: quote.market_cap ?? null,
      peRatio: quote.pe_ratio ?? null,
      dividendYield: quote.dividend_yield ?? null,
      freeFloat: quote.free_float ?? null,
      volume30d: quote.volume_avg_30d ?? null,
      change1yPct: quote.change_1y_pct ?? null,
      ldcp: quote.ldcp ?? null,
      change: quote.change ?? null,
      changePct: quote.change_pct ?? null,
      sector: cachedRow?.sector?.name ?? null,
    },
    source: liveSource,
    lastSyncedAt: cachedRow?.lastSyncedAt ?? new Date().toISOString(),
    latencyMs: Date.now() - start,
    upstreamError: liveError,
  });
}
