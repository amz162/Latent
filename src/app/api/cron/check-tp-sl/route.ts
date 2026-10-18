import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { db } from "@/lib/db";
import { MOCK_TRADES } from "@/lib/latent/mock-trades";
import { MOCK_STOCKS } from "@/lib/latent/mock-stocks";

// Latent.pk — TP/SL Monitor Cron
// Checks all open trades against current PSX prices. Fires a notification
// when price hits target (TP) or stop-loss (SL).
//
// This endpoint is designed to be called by:
//   - Vercel Cron: https://vercel.com/docs/cron-jobs (every 5 min during PSX session)
//   - GitHub Actions: scheduled workflow
//   - External cron: curl https://latent.pk/api/cron/check-tp-sl
//
// Auth: protect with a CRON_SECRET env var in production.
//   if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) ...
//
// In-app polling: AppNav polls this endpoint every 5 min while user is active.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface PriceCheck {
  symbol: string;
  currentPrice: number;
  openTradesChecked: number;
  tpHits: { tradeId: string; symbol: string; entryPrice: number; targetPrice: number; currentPrice: number }[];
  slHits: { tradeId: string; symbol: string; entryPrice: number; stopLoss: number; currentPrice: number }[];
}

export async function GET(req: NextRequest) {
  const startTime = Date.now();
  const authHeader = req.headers.get("authorization");
  const expectedAuth = process.env.CRON_SECRET;

  // In production, require auth
  if (expectedAuth && authHeader !== `Bearer ${expectedAuth}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch open trades from DB (real tracked trades from /api/execute)
    const dbTrades = await db.trade.findMany({
      where: { status: "OPEN" },
    });

    // Also include mock open trades for demo purposes
    const mockOpenTrades = MOCK_TRADES.filter((t) => t.status === "OPEN");

    const allOpenTrades = [
      ...dbTrades.map((t) => ({
        id: t.id,
        symbol: t.symbol,
        entryPrice: t.entryPrice,
        targetPrice: null as number | null,  // TP/SL not stored on Trade; load from signal
        stopLoss: null as number | null,
      })),
      ...mockOpenTrades.map((t) => ({
        id: t.id,
        symbol: t.symbol,
        entryPrice: t.entryPrice,
        targetPrice: t.targetPrice || null,
        stopLoss: t.stopLoss || null,
      })),
    ];

    if (allOpenTrades.length === 0) {
      return NextResponse.json({
        checkedAt: new Date().toISOString(),
        openTrades: 0,
        tpHits: [],
        slHits: [],
        latencyMs: Date.now() - startTime,
        message: "No open trades to monitor.",
      });
    }

    // For each unique symbol, fetch current price + load TP/SL from predictions
    const symbolsToCheck = Array.from(new Set(allOpenTrades.map((t) => t.symbol)));
    const priceChecks: PriceCheck[] = [];

    for (const symbol of symbolsToCheck) {
      // Get current price from mock-stocks (fallback) or live API
      let currentPrice: number | null = null;
      const mockStock = MOCK_STOCKS.find((s) => s.symbol === symbol);
      if (mockStock) {
        currentPrice = mockStock.price;
      }

      // Try live price from askanalyst.com.pk (best effort — don't fail if it errors)
      if (!currentPrice) {
        try {
          const now = Date.now();
          const from = now - 7 * 24 * 60 * 60 * 1000; // last 7 days
          const res = await fetch(
            `https://api.askanalyst.com.pk/api/technicalchart/day/${from}/${now}/${symbol}`,
            { headers: { "User-Agent": "LatentBot/1.0" } }
          );
          if (res.ok) {
            const text = await res.text();
            const lines = text.split("\n").filter((l) => l.trim());
            // Find last non-zero-volume row
            for (let i = lines.length - 1; i >= 1; i--) {
              const parts = lines[i].split(",");
              if (parts.length < 6) continue;
              const close = Number(parts[4]);
              const volume = Number(parts[5]);
              if (close && volume > 0) {
                currentPrice = close;
                break;
              }
            }
          }
        } catch (err) {
          console.warn(`[check-tp-sl] Failed to fetch live price for ${symbol}:`, err);
        }
      }

      if (!currentPrice) continue;

      // Load TP/SL from predictions file
      let targetPrice: number | null = null;
      let stopLoss: number | null = null;
      try {
        const predPath = path.join(process.cwd(), "data", "ml_predictions.json");
        const predContent = await fs.readFile(predPath, "utf-8");
        const predictions = JSON.parse(predContent);
        const pred = predictions.predictions?.[symbol];
        if (pred) {
          targetPrice = pred.targetPrice;
          stopLoss = pred.stopLoss;
        }
      } catch {
        // Skip if predictions file not available
      }

      // Check TP/SL hits
      const symbolTrades = allOpenTrades.filter((t) => t.symbol === symbol);
      const tpHits: PriceCheck["tpHits"] = [];
      const slHits: PriceCheck["slHits"] = [];

      for (const trade of symbolTrades) {
        const tp = trade.targetPrice || targetPrice;
        const sl = trade.stopLoss || stopLoss;
        if (!tp || !sl) continue;

        // TP hit: current price >= target
        if (currentPrice >= tp) {
          tpHits.push({
            tradeId: trade.id,
            symbol,
            entryPrice: trade.entryPrice,
            targetPrice: tp,
            currentPrice,
          });
        }
        // SL hit: current price <= stop-loss
        if (currentPrice <= sl) {
          slHits.push({
            tradeId: trade.id,
            symbol,
            entryPrice: trade.entryPrice,
            stopLoss: sl,
            currentPrice,
          });
        }
      }

      priceChecks.push({
        symbol,
        currentPrice,
        openTradesChecked: symbolTrades.length,
        tpHits,
        slHits,
      });
    }

    // Update trade statuses in DB for hits
    const allHits = priceChecks.flatMap((p) => [
      ...p.tpHits.map((h) => ({ tradeId: h.tradeId, type: "TP" as const, ...h })),
      ...p.slHits.map((h) => ({ tradeId: h.tradeId, type: "SL" as const, ...h })),
    ]);

    for (const hit of allHits) {
      try {
        await db.trade.updateMany({
          where: { id: hit.tradeId, status: "OPEN" },
          data: {
            status: hit.type === "TP" ? "CLOSED_WIN" : "CLOSED_LOSS",
            exitPrice: hit.currentPrice,
            exitDate: new Date(),
          },
        });
      } catch (err) {
        console.warn(`[check-tp-sl] Failed to update trade ${hit.tradeId}:`, err);
      }
    }

    const totalTpHits = allHits.filter((h) => h.type === "TP").length;
    const totalSlHits = allHits.filter((h) => h.type === "SL").length;

    return NextResponse.json({
      checkedAt: new Date().toISOString(),
      openTradesChecked: allOpenTrades.length,
      symbolsChecked: symbolsToCheck.length,
      tpHits: totalTpHits,
      slHits: totalSlHits,
      details: priceChecks,
      latencyMs: Date.now() - startTime,
      schedule: "Should run every 5 minutes during PSX session (09:00-17:00 PKT, Mon-Fri)",
      productionSetup: {
        vercelCron: 'Add to vercel.json: { "crons": [{ "path": "/api/cron/check-tp-sl", "schedule": "*/5 4-12 * * 1-5" }] }',
        githubActions: "Schedule a workflow with curl https://latent.pk/api/cron/check-tp-sl",
        secret: "Set CRON_SECRET env var and pass as Bearer token in Authorization header",
      },
    });
  } catch (err) {
    console.error("[check-tp-sl] error:", err);
    return NextResponse.json(
      {
        error: "Cron run failed",
        detail: err instanceof Error ? err.message : "Unknown",
        latencyMs: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}
