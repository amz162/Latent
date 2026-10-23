import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

export const dynamic = "force-dynamic";

const prisma = new PrismaClient();

/**
 * POST /api/psx/save-price
 * Body: { symbol: string, price: number, source?: string }
 *
 * Saves the current stock price (fetched live from psxdata API by the
 * AI Model Signals tab) into the local SQLite DB. This is a manual
 * "Save to DB" button — useful for refreshing prices without re-running
 * the full backup script.
 *
 * Returns: { ok: true, symbol, price, updatedAt }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const symbol = String(body.symbol || "").toUpperCase().trim();
    const price = Number(body.price);
    if (!symbol || !Number.isFinite(price) || price <= 0) {
      return NextResponse.json(
        { error: "Missing or invalid 'symbol' or 'price'" },
        { status: 400 }
      );
    }
    const source = String(body.source || "manual-save");

    // Upsert the stock row (update price + lastSyncedAt)
    const existing = await prisma.stock.findUnique({ where: { symbol } });
    let updated;
    if (existing) {
      updated = await prisma.stock.update({
        where: { symbol },
        data: {
          price,
          lastSyncedAt: new Date(),
          source,
        },
      });
    } else {
      // Stock not in DB — create new row
      updated = await prisma.stock.create({
        data: {
          symbol,
          name: symbol,
          price,
          source,
          lastSyncedAt: new Date(),
          createdAt: new Date(),
        },
      });
    }

    return NextResponse.json({
      ok: true,
      symbol: updated.symbol,
      price: updated.price,
      source: updated.source,
      lastSyncedAt: updated.lastSyncedAt,
    });
  } catch (err) {
    console.error("[/api/psx/save-price] error:", err);
    return NextResponse.json(
      { error: "Failed to save price: " + (err instanceof Error ? err.message : "unknown") },
      { status: 500 }
    );
  } finally {
    await prisma.$disconnect();
  }
}
