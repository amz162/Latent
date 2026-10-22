import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const dynamic = "force-dynamic";

const prisma = new PrismaClient();

/**
 * GET /api/market/live
 * Returns live market data: top movers, gainers, losers, most active, and a market summary.
 * Reads from the DB backup (last sync). For real-time, hit /api/market/live/[symbol] which
 * always proxies the live psxdata API.
 *
 * Query params:
 *   ?limit=20      — number of stocks per category (default 20, max 50)
 *   ?sector=0810   — filter to a specific sector code
 *   ?listedIn=KSE100 — filter to a specific index membership
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 50);
    const sector = url.searchParams.get("sector") ?? undefined;
    const listedIn = url.searchParams.get("listedIn") ?? undefined;

    const baseFilter = {
      price: { not: null as unknown as number },
      ...(sector ? { sectorCode: sector } : {}),
      ...(listedIn ? { listedIn } : {}),
    };

    const [total, withPrice, gainers, losers, mostActive, topMcap, sectors] = await Promise.all([
      prisma.stock.count(),
      prisma.stock.count({ where: { price: { not: null } } }),
      // Top gainers (by changePct)
      prisma.stock.findMany({
        where: { ...baseFilter, changePct: { not: null } },
        orderBy: { changePct: "desc" },
        take: limit,
        select: stockSelect,
      }),
      // Top losers (by changePct ascending)
      prisma.stock.findMany({
        where: { ...baseFilter, changePct: { not: null } },
        orderBy: { changePct: "asc" },
        take: limit,
        select: stockSelect,
      }),
      // Most active (by 30d volume)
      prisma.stock.findMany({
        where: { ...baseFilter, volume30d: { not: null } },
        orderBy: { volume30d: "desc" },
        take: limit,
        select: stockSelect,
      }),
      // Largest by market cap (per-stock marketCap is often 0 in screener —
      // filter to only those with a real positive value)
      prisma.stock.findMany({
        where: { ...baseFilter, marketCap: { gt: 0 } },
        orderBy: { marketCap: "desc" },
        take: limit,
        select: stockSelect,
      }),
      // Sector summary
      prisma.sector.findMany({
        orderBy: { marketCapB: "desc" },
        select: {
          code: true, name: true, advance: true, decline: true, unchanged: true,
          turnover: true, marketCapB: true, lastSyncedAt: true,
        },
      }),
    ]);

    // Aggregate market summary
    // The psxdata screener returns `market_cap=0/null` for most individual stocks,
    // but sector-level `market_cap_b` is reliable. Use sector totals as the
    // authoritative market-cap source.
    const sectorSum = await prisma.sector.aggregate({
      _sum: { marketCapB: true },
      where: { marketCapB: { gt: 0 } },
    });
    const avgChangePct = await prisma.stock.aggregate({
      _avg: { changePct: true },
      where: { changePct: { not: null } },
    });
    const advances = await prisma.stock.count({ where: { changePct: { gt: 0 } } });
    const declines = await prisma.stock.count({ where: { changePct: { lt: 0 } } });
    const unchanged = await prisma.stock.count({ where: { changePct: 0 } });

    return NextResponse.json({
      summary: {
        totalSecurities: total,
        withPrice: withPrice,
        totalMarketCapPkrB: sectorSum._sum.marketCapB != null
          ? +sectorSum._sum.marketCapB.toFixed(2)
          : null,
        marketCapStocksCount: null,
        avgChangePct: avgChangePct._avg.changePct != null
          ? +avgChangePct._avg.changePct.toFixed(2)
          : null,
        advances, declines, unchanged,
      },
      gainers: gainers.map(toLiveQuote),
      losers: losers.map(toLiveQuote),
      mostActive: mostActive.map(toLiveQuote),
      topByMarketCap: topMcap.map(toLiveQuote),
      sectors,
      lastSyncedAt: (gainers[0] ?? losers[0] ?? mostActive[0] ?? topMcap[0])?.lastSyncedAt ?? null,
      source: "db-backup",
      params: { limit, sector: sector ?? null, listedIn: listedIn ?? null },
    });
  } catch (err) {
    console.error("[/api/market/live] error:", err);
    return NextResponse.json({ error: "Failed to fetch market data" }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}

const stockSelect = {
  symbol: true,
  name: true,
  sectorCode: true,
  sector: { select: { name: true } },
  listedIn: true,
  price: true,
  marketCap: true,
  peRatio: true,
  divYield: true,
  freeFloat: true,
  volume30d: true,
  change1yPct: true,
  ldcp: true,
  change: true,
  changePct: true,
  lastSyncedAt: true,
} as const;

function toLiveQuote(s: any) {
  return {
    symbol: s.symbol,
    name: s.name,
    sector: s.sector?.name ?? null,
    sectorCode: s.sectorCode ?? null,
    listedIn: s.listedIn ?? null,
    price: s.price,
    marketCap: s.marketCap,
    peRatio: s.peRatio,
    dividendYield: s.divYield,
    freeFloat: s.freeFloat,
    volume30d: s.volume30d,
    change1yPct: s.change1yPct,
    ldcp: s.ldcp,
    change: s.change,
    changePct: s.changePct,
    lastSyncedAt: s.lastSyncedAt,
    source: "db-backup",
  };
}
