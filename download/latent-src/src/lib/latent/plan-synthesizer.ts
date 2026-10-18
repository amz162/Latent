import { RiskProfileInput, RiskBucket, Plan, PlanAllocation, PlanLadderStep } from "./types";
import { MOCK_STOCKS } from "./mock-stocks";

// Rule-based plan synthesizer — REAL logic, not mocked.
// Allocates based on risk profile, time horizon, and monthly contribution.

export function classifyRiskBucket(input: RiskProfileInput): RiskBucket {
  // Composite score: weighted sum of risk tolerance, time horizon (longer = more aggressive), and monthly capacity
  const horizonScore = Math.min(10, Math.max(1, Math.floor(input.timeHorizon / 3))); // 1yr=1, 5yr=2, 10yr=3, 30yr=10
  const capacityScore = Math.min(10, Math.max(1, Math.floor(input.monthlyContribution / 5000))); // 5K=1, 50K=10

  const composite = (input.riskTolerance * 0.5) + (horizonScore * 0.3) + (capacityScore * 0.2);

  if (composite < 3.5) return "conservative";
  if (composite < 5.5) return "moderate";
  if (composite < 7.5) return "growth";
  return "aggressive";
}

// Bucket-specific target allocation by horizon
const BUCKET_ALLOCATIONS: Record<RiskBucket, Record<string, number>> = {
  conservative: {
    DIVIDEND: 60,
    GROWTH: 15,
    SWING: 10,
    DAY: 0,
    CASH: 15,
  },
  moderate: {
    DIVIDEND: 45,
    GROWTH: 25,
    SWING: 15,
    DAY: 0,
    CASH: 15,
  },
  growth: {
    DIVIDEND: 30,
    GROWTH: 35,
    SWING: 25,
    DAY: 5,
    CASH: 5,
  },
  aggressive: {
    DIVIDEND: 15,
    GROWTH: 40,
    SWING: 30,
    DAY: 10,
    CASH: 5,
  },
};

// Stock selection per horizon (defensible logic: liquidity + sector diversification)
const STOCKS_BY_HORIZON: Record<string, string[]> = {
  DIVIDEND: ["HUBC", "OGDC", "PPL"], // high-yield energy + power
  GROWTH: ["LUCK", "SYS", "ENGRO"], // cyclical + tech + conglomerate
  SWING: ["MEBL", "ENGRO", "LUCK"], // liquid, decent volatility
  DAY: ["SYS", "MEBL"], // tech + bank, high intraday beta
};

const STOCK_THESES: Record<string, string> = {
  HUBC: "11.2% dividend yield, predictable cash flows, utility-like stability",
  OGDC: "12.4% dividend yield, government backing, energy exposure",
  PPL: "10.8% dividend yield, discounted valuation, energy sector",
  LUCK: "Cement cyclical low, P/E 33% below 5-year average, rate cut beneficiary",
  SYS: "Pakistan IT sector leader, 24% revenue growth, USD revenue exposure",
  ENGRO: "Conglomerate diversification, 7.8% yield, fertilizer margins expanding",
  MEBL: "Islamic banking growth (30% YoY), best-in-class ADR, sector tailwind",
};

export function synthesizePlan(userId: string, input: RiskProfileInput): Plan {
  const bucket = classifyRiskBucket(input);
  const allocations = BUCKET_ALLOCATIONS[bucket];

  const planAllocations: PlanAllocation[] = [];

  // For each horizon bucket with non-zero allocation, pick stocks
  Object.entries(allocations).forEach(([horizon, pct]) => {
    if (horizon === "CASH" || pct === 0) return;

    const stocksInHorizon = STOCKS_BY_HORIZON[horizon] || [];
    // Equal-weight within horizon
    const perStockPct = pct / stocksInHorizon.length;

    stocksInHorizon.forEach((symbol) => {
      const stock = MOCK_STOCKS.find((s) => s.symbol === symbol);
      if (!stock) return;

      planAllocations.push({
        symbol,
        name: stock.name,
        allocationPct: parseFloat(perStockPct.toFixed(2)),
        horizon: horizon as PlanAllocation["horizon"],
        thesis: STOCK_THESES[symbol] || "Allocation based on risk profile and horizon",
      });
    });
  });

  // Build entry ladder — spread monthly contribution over 3 months to reduce timing risk
  const ladder: PlanLadderStep[] = [];
  const ladderSplit = [0.5, 0.3, 0.2]; // 50% / 30% / 20% across 3 months

  for (let month = 1; month <= 3; month++) {
    const amount = Math.floor(input.monthlyContribution * ladderSplit[month - 1]);
    ladder.push({
      month,
      amount,
      instructions: `Deploy PKR ${amount.toLocaleString()} across allocation targets. ${
        month === 1
          ? "Initial deployment — take all positions at current prices."
          : month === 2
          ? "Second tranche — average down any positions that have pulled back 5%+ from initial entry."
          : "Final tranche — top up underweight positions, hold cash for opportunistic adds."
      }`,
    });
  }

  // Rebalancing rules
  const rebalancingRules = [
    "Review plan monthly on the 1st.",
    "Rebalance if any single stock exceeds target allocation by more than 25% (e.g., 10% target → 12.5%+ actual).",
    "Rebalance if any sector exposure exceeds 40% of plan value.",
    "Stop-loss review: any position down 15% from entry triggers manual review.",
    "Goal horizon review every 6 months — if horizon shortened by 1+ years, de-risk toward conservative bucket.",
    "Quarterly: update risk profile questionnaire — life events (marriage, job change, home purchase) may shift bucket.",
  ];

  // Expected return projection (annualized, conservative)
  const expectedReturns: Record<RiskBucket, number> = {
    conservative: 12,    // mostly dividend + cash yield
    moderate: 16,
    growth: 22,
    aggressive: 28,
  };

  return {
    id: `plan_${userId}_${Date.now()}`,
    userId,
    profileBucket: bucket,
    allocation: planAllocations,
    entryLadder: ladder,
    rebalancingRules,
    expectedReturnPct: expectedReturns[bucket],
    riskScore: input.riskTolerance,
  };
}
