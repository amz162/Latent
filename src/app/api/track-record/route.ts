import { NextResponse } from "next/server";
import { computeTrackRecord } from "@/lib/latent/track-record";
import { MOCK_TRADES } from "@/lib/latent/mock-trades";

export async function GET() {
  const stats = computeTrackRecord(MOCK_TRADES);
  // Return the most recent 25 trades for display
  const recentTrades = [...MOCK_TRADES]
    .sort((a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime())
    .slice(0, 25);
  return NextResponse.json({ stats, trades: recentTrades });
}
