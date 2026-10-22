import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { synthesizePlan } from "@/lib/latent/plan-synthesizer";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      include: { riskProfile: true, plans: { orderBy: { createdAt: "desc" }, take: 1 } },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!user.riskProfile) {
      return NextResponse.json({ error: "No risk profile on file" }, { status: 404 });
    }

    const latestPlan = user.plans[0];
    if (!latestPlan) {
      // Re-synthesize if missing
      const plan = synthesizePlan(user.id, {
        riskTolerance: user.riskProfile.riskTolerance,
        timeHorizon: user.riskProfile.timeHorizon,
        monthlyContribution: user.riskProfile.monthlyContribution,
        goalLabel: user.riskProfile.goalLabel,
        goalTargetAmount: user.riskProfile.goalTargetAmount,
        goalDate: user.riskProfile.goalDate.toISOString(),
      });
      return NextResponse.json({ plan, profileBucket: user.riskProfile.profileBucket });
    }

    const plan = {
      id: latestPlan.id,
      userId: latestPlan.userId,
      profileBucket: user.riskProfile.profileBucket,
      allocation: JSON.parse(latestPlan.allocation),
      entryLadder: JSON.parse(latestPlan.entryLadder),
      rebalancingRules: JSON.parse(latestPlan.rebalancingRules),
      expectedReturnPct:
        user.riskProfile.profileBucket === "conservative" ? 12 :
        user.riskProfile.profileBucket === "moderate" ? 16 :
        user.riskProfile.profileBucket === "growth" ? 22 : 28,
      riskScore: user.riskProfile.riskTolerance,
    };

    return NextResponse.json({ plan, profileBucket: user.riskProfile.profileBucket });
  } catch (err) {
    console.error("Plan fetch error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Plan fetch failed" },
      { status: 500 }
    );
  }
}
