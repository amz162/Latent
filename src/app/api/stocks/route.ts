import { NextResponse } from "next/server";
import { MOCK_STOCKS, MOCK_BROKERS } from "@/lib/latent/mock-stocks";

export async function GET() {
  return NextResponse.json({ stocks: MOCK_STOCKS, brokers: MOCK_BROKERS });
}
