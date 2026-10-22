import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import type { Company } from "@/components/latent/StockSearch";

export const dynamic = "force-dynamic";

const prisma = new PrismaClient();

// Fallback to upstream if DB is empty or sync is stale (>24h)
async function fallbackToUpstream(): Promise<Company[]> {
  try {
    const res = await fetch("https://api.askanalyst.com.pk/api/companylistwithsymbols", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const count = await prisma.stock.count();
    const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h ago
    const freshCount = await prisma.stock.count({
      where: { lastSyncedAt: { gt: staleThreshold } },
    });

    // If DB has lots of fresh records, serve from DB
    if (count > 100 && freshCount > count * 0.5) {
      const stocks = await prisma.stock.findMany({
        select: {
          symbol: true,
          sectorCode: true,
          sector: { select: { name: true } },
          lastSyncedAt: true,
        },
        orderBy: { symbol: "asc" },
      });
      // Match the Company shape used by StockSearch: { id, value, label, sector }
      const companies: Company[] = stocks.map((s, i) => ({
        id: i + 1,
        value: s.symbol,
        label: s.symbol, // TODO: enrich with full company name from askanalyst
        sector: s.sector?.name ?? undefined,
      }));
      return NextResponse.json({
        companies,
        source: "db",
        count: companies.length,
        lastSyncedAt: stocks[0]?.lastSyncedAt ?? null,
      });
    }

    // DB empty or stale — fall back to upstream and return that
    const upstream = await fallbackToUpstream();
    if (upstream.length > 0) {
      return NextResponse.json({
        companies: upstream,
        source: "upstream-fallback",
        count: upstream.length,
      });
    }
    return NextResponse.json(
      { error: "No company data available (DB empty and upstream unreachable)" },
      { status: 503 }
    );
  } catch (err) {
    console.error("[/api/psx/companies] error:", err);
    // Last-resort fallback
    const upstream = await fallbackToUpstream();
    if (upstream.length > 0) {
      return NextResponse.json({ companies: upstream, source: "upstream-error-fallback", count: upstream.length });
    }
    return NextResponse.json({ error: "Failed to fetch companies" }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}
