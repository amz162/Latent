import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { synthesizePlan, classifyRiskBucket } from "@/lib/latent/plan-synthesizer";

const OnboardingSchema = z.object({
  email: z.string().email(),
  name: z.string().optional().default(""),
  riskTolerance: z.number().min(1).max(10),
  timeHorizon: z.number().min(1).max(40),
  monthlyContribution: z.number().min(1000),
  goalLabel: z.string(),
  goalTargetAmount: z.number().min(10000),
  goalDate: z.string(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = OnboardingSchema.parse(body);

    // Upsert user
    let user = await db.user.findUnique({ where: { email: parsed.email } });
    if (!user) {
      user = await db.user.create({
        data: { email: parsed.email, name: parsed.name || null },
      });
    }

    // Upsert risk profile
    const profileBucket = classifyRiskBucket({
      riskTolerance: parsed.riskTolerance,
      timeHorizon: parsed.timeHorizon,
      monthlyContribution: parsed.monthlyContribution,
      goalLabel: parsed.goalLabel,
      goalTargetAmount: parsed.goalTargetAmount,
      goalDate: parsed.goalDate,
    });

    const existing = await db.riskProfile.findUnique({ where: { userId: user.id } });
    if (existing) {
      await db.riskProfile.update({
        where: { userId: user.id },
        data: {
          riskTolerance: parsed.riskTolerance,
          timeHorizon: parsed.timeHorizon,
          monthlyContribution: parsed.monthlyContribution,
          goalLabel: parsed.goalLabel,
          goalTargetAmount: parsed.goalTargetAmount,
          goalDate: new Date(parsed.goalDate),
          profileBucket,
        },
      });
    } else {
      await db.riskProfile.create({
        data: {
          userId: user.id,
          riskTolerance: parsed.riskTolerance,
          timeHorizon: parsed.timeHorizon,
          monthlyContribution: parsed.monthlyContribution,
          goalLabel: parsed.goalLabel,
          goalTargetAmount: parsed.goalTargetAmount,
          goalDate: new Date(parsed.goalDate),
          profileBucket,
        },
      });
    }

    // Synthesize plan
    const plan = synthesizePlan(user.id, {
      riskTolerance: parsed.riskTolerance,
      timeHorizon: parsed.timeHorizon,
      monthlyContribution: parsed.monthlyContribution,
      goalLabel: parsed.goalLabel,
      goalTargetAmount: parsed.goalTargetAmount,
      goalDate: parsed.goalDate,
    });

    await db.plan.create({
      data: {
        userId: user.id,
        allocation: JSON.stringify(plan.allocation),
        entryLadder: JSON.stringify(plan.entryLadder),
        rebalancingRules: JSON.stringify(plan.rebalancingRules),
      },
    });

    return NextResponse.json({
      userId: user.id,
      profileBucket,
      plan,
    });
  } catch (err) {
    console.error("Onboarding error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Onboarding failed" },
      { status: 400 }
    );
  }
}
