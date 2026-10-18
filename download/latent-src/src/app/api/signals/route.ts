import { NextResponse } from "next/server";
import { MOCK_SIGNALS, getSignalById } from "@/lib/latent/mock-signals";

export async function GET() {
  return NextResponse.json({ signals: MOCK_SIGNALS });
}
