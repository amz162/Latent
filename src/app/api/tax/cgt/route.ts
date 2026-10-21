import { NextResponse } from "next/server";
import { z } from "zod";
import { calculateCGT, calculateAggregatedCGT, type CgtInput, type RealizedTrade, type FilerStatus } from "@/lib/latent/tax";

// POST /api/tax/cgt
// Body:
//   Single trade mode:    { buyPrice, sellPrice, shares, filerStatus, commissionPct? }
//   Aggregated mode:      { trades: [{ symbol, buyPrice, sellPrice, shares, realizedAt }], filerStatus }
//
// Returns CGT computation including tax owed + net profit after tax.

const SingleTradeSchema = z.object({
  buyPrice: z.number().positive(),
  sellPrice: z.number().positive(),
  shares: z.number().int().positive(),
  filerStatus: z.enum(["filer", "non-filer"]),
  commissionPct: z.number().optional(),
});

const RealizedTradeSchema = z.object({
  symbol: z.string(),
  buyPrice: z.number().positive(),
  sellPrice: z.number().positive(),
  shares: z.number().int().positive(),
  realizedAt: z.string(),
});

const AggregatedSchema = z.object({
  trades: z.array(RealizedTradeSchema),
  filerStatus: z.enum(["filer", "non-filer"]),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Try aggregated mode first
    if (Array.isArray(body.trades)) {
      const parsed = AggregatedSchema.parse(body);
      const result = calculateAggregatedCGT(
        parsed.trades as RealizedTrade[],
        parsed.filerStatus as FilerStatus
      );
      return NextResponse.json({
        mode: "aggregated",
        result,
        filerStatus: parsed.filerStatus,
        cgtRate: parsed.filerStatus === "filer" ? 0.15 : 0.30,
      });
    }

    // Single trade mode
    const parsed = SingleTradeSchema.parse(body);
    const result = calculateCGT({
      buyPrice: parsed.buyPrice,
      sellPrice: parsed.sellPrice,
      shares: parsed.shares,
      filerStatus: parsed.filerStatus as FilerStatus,
      commissionPct: parsed.commissionPct,
    });

    return NextResponse.json({
      mode: "single",
      result,
      filerStatus: parsed.filerStatus,
      cgtRate: parsed.filerStatus === "filer" ? 0.15 : 0.30,
    });
  } catch (err) {
    console.error("[/api/tax/cgt] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "CGT calculation failed" },
      { status: 400 }
    );
  }
}
