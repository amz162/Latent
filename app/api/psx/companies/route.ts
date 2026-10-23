import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import type { Company } from "@/components/latent/StockSearch";

export const dynamic = "force-dynamic";

const prisma = new PrismaClient();

// Fallback to upstream ONLY if DB is completely empty (cold-start)
// Otherwise we ALWAYS prefer the DB (which has all 1,240 PSX stocks)
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

    // PRIMARY: Always serve from DB if it has any stocks (we have 1,240)
    if (count > 0) {
      const stocks = await prisma.stock.findMany({
        select: {
          symbol: true,
          name: true,
          sectorCode: true,
          sector: { select: { name: true } },
          price: true,
          lastSyncedAt: true,
        },
        orderBy: { symbol: "asc" },
      });
      // Match the Company shape used by StockSearch: { id, value, label, sector }
      const companies: Company[] = stocks.map((s, i) => ({
        id: i + 1,
        value: s.symbol,
        label: s.symbol, // symbol is the display label (DB doesn't have full company names yet)
        sector: s.sector?.name ?? undefined,
      }));
      // Get the most recent sync timestamp for any stock
      const latestSync = await prisma.stock.findFirst({
        orderBy: { lastSyncedAt: "desc" },
        select: { lastSyncedAt: true },
      });
      return NextResponse.json({
        companies,
        source: "db",
        count: companies.length,
        lastSyncedAt: latestSync?.lastSyncedAt ?? null,
        dbTotal: count,
      });
    }

    // FALLBACK: DB is empty (cold-start) → use upstream askanalyst.com.pk
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
