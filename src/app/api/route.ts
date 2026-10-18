import { NextResponse } from "next/server";

// Root API — list of available endpoints for the Latent.pk MVP
export async function GET() {
  return NextResponse.json({
    name: "Latent.pk MVP API",
    version: "0.1.0",
    endpoints: {
      "GET /api/stocks": "List KSE-100 mock stocks and partner brokers",
      "GET /api/signals": "List active AI-generated signals",
      "GET /api/signals/:id": "Get signal detail with layman explanation",
      "POST /api/onboarding": "Save risk profile and generate plan",
      "GET /api/plan?userId=": "Fetch user's investment plan",
      "POST /api/execute": "Execute (simulated) broker trade",
      "GET /api/track-record": "Get accuracy stats + recent trades",
    },
    note: "Mock data layer — swap for real ML/LLM/broker integrations in production.",
  });
}
