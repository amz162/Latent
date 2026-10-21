// Latent.pk — Pattern Recognition (Quarterly Results Analysis)
// Analyzes last 5 years of quarterly financial statements to identify patterns:
//   - Revenue trajectory (growing/declining/flat/decelerating)
//   - Profit margin trends
//   - EPS trajectory
//   - YoY growth patterns
//   - Quarter-over-quarter momentum
//   - Volatility (how steady is the growth?)
//
// Pattern detection algorithm:
//   1. Rank all quarters by YoY growth rate
//   2. Compute trend slope (linear regression on quarterly EPS)
//   3. Compute coefficient of variation (CV = std/mean) for stability
//   4. Identify "best quarter" + "worst quarter" by absolute growth
//   5. Identify seasonality (if any quarter consistently outperforms)
//   6. Compute "pattern score": 0-100 confidence in the detected pattern
//
// LLM (GLM-4) is then called to explain the detected patterns in layman terms.

export interface QuarterData {
  period: string;          // e.g., "Q1 2024" or "1Q2024"
  revenue: number;
  netProfit: number;
  eps: number;
  profitMargin: number;    // computed: netProfit / revenue
  yoyGrowth: number | null; // EPS YoY growth, % (null if no prior-year data)
  qoqGrowth: number | null; // EPS QoQ growth, %
}

export type PatternType =
  | "ACCELERATING_GROWTH"
  | "STEADY_GROWTH"
  | "DECELERATING_GROWTH"
  | "VOLATILE"
  | "DECLINING"
  | "FLAT"
  | "INSUFFICIENT_DATA";

export const PATTERN_LABELS: Record<PatternType, string> = {
  ACCELERATING_GROWTH: "Accelerating growth",
  STEADY_GROWTH: "Steady growth",
  DECELERATING_GROWTH: "Decelerating growth",
  VOLATILE: "Volatile / inconsistent",
  DECLINING: "Declining",
  FLAT: "Flat / no trend",
  INSUFFICIENT_DATA: "Insufficient data",
};

export interface PatternRecognitionResult {
  symbol: string;
  quarters: QuarterData[];
  patternType: PatternType;
  patternLabel: string;
  patternScore: number;          // 0-100 confidence in detected pattern
  trendSlope: number;            // EPS trend slope (PKR/quarter)
  coefficientOfVariation: number; // CV of EPS (lower = more stable)
  bestQuarter: QuarterData | null;
  worstQuarter: QuarterData | null;
  avgYoYGrowth: number | null;   // average YoY EPS growth %
  avgQoQGrowth: number | null;   // average QoQ growth %
  totalRevenueGrowth: number | null; // first to last quarter revenue growth %
  epsVolatility: number;         // std of EPS / mean of EPS
  quarterlySeasonality: { quarter: string; avgGrowth: number }[]; // e.g. "Q1 avg 12% growth"
  summary: string;                // 1-paragraph plain-English summary
}

export interface RawFinancialData {
  quarters?: Array<{
    period?: string;
    revenue?: number;
    netIncome?: number;
    netProfit?: number;
    eps?: number;
    earningsPerShare?: number;
  }>;
  // AskAnalyst may also return annual or other formats
  annual?: Array<{
    year?: string;
    revenue?: number;
    eps?: number;
  }>;
}

/**
 * Parse the upstream financial statement response from AskAnalyst.com.pk.
 * Handles various possible response shapes.
 */
export function parseFinancialData(raw: unknown): QuarterData[] {
  if (!raw || typeof raw !== "object") return [];

  const data = raw as RawFinancialData;
  const rawQuarters = data.quarters || [];

  if (!Array.isArray(rawQuarters) || rawQuarters.length === 0) {
    // If only annual data, derive pseudo-quarters (will be limited)
    if (data.annual && Array.isArray(data.annual) && data.annual.length > 0) {
      return data.annual.map((a) => ({
        period: a.year || "—",
        revenue: Number(a.revenue) || 0,
        netProfit: 0,
        eps: Number(a.eps) || 0,
        profitMargin: 0,
        yoyGrowth: null,
        qoqGrowth: null,
      }));
    }
    return [];
  }

  // Sort by period ascending (assuming chronological order from API)
  const sorted = [...rawQuarters].filter((q) => q && (q.eps || q.earningsPerShare));
  const quarters: QuarterData[] = sorted.map((q, i) => {
    const eps = Number(q.eps ?? q.earningsPerShare ?? 0);
    const revenue = Number(q.revenue || 0);
    const profit = Number(q.netProfit ?? q.netIncome ?? 0);
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

    // YoY growth (4 quarters back)
    let yoyGrowth: number | null = null;
    if (i >= 4 && sorted[i - 4] && Number(sorted[i - 4].eps ?? sorted[i - 4].earningsPerShare ?? 0) > 0) {
      const prevYearEps = Number(sorted[i - 4].eps ?? sorted[i - 4].earningsPerShare ?? 0);
      yoyGrowth = prevYearEps > 0 ? ((eps - prevYearEps) / prevYearEps) * 100 : null;
    }

    // QoQ growth (1 quarter back)
    let qoqGrowth: number | null = null;
    if (i >= 1 && sorted[i - 1] && Number(sorted[i - 1].eps ?? sorted[i - 1].earningsPerShare ?? 0) > 0) {
      const prevQEps = Number(sorted[i - 1].eps ?? sorted[i - 1].earningsPerShare ?? 0);
      qoqGrowth = prevQEps > 0 ? ((eps - prevQEps) / prevQEps) * 100 : null;
    }

    return {
      period: q.period || `Q${(i % 4) + 1} ${Math.floor(i / 4) + 1}`,
      revenue,
      netProfit: profit,
      eps,
      profitMargin: margin,
      yoyGrowth,
      qoqGrowth,
    };
  });

  return quarters;
}

/**
 * Parse the AskAnalyst /api/rationew/[symbol] response into annual "quarters" (1 entry per year).
 *
 * Sample upstream shape:
 * [
 *   {
 *     section: "Valuation",
 *     data: [
 *       { label: "EPS", unit: "PKR", data: [{year:"2013", value:"13.90"}, {year:"2014", value:"12.37"}, ...] },
 *       { label: "DPS", unit: "PKR", data: [{year:"2013", value:"0.00"}, ...] },
 *       { label: "BVPS", unit: "PKR", data: [...] },
 *       { label: "PER", unit: "x", data: [...] },
 *       ...
 *     ]
 *   },
 *   { section: "Profitability", data: [...] },
 *   ...
 * ]
 *
 * We treat each year as a "period" — this gives us 10+ years of pattern data.
 */
export function parseRatiosToQuarters(raw: unknown): QuarterData[] {
  if (!raw) return [];

  // The /api/psx/ratio/[symbol] proxy wraps the upstream response in { ratios: <data> }
  const data = (raw as any)?.ratios || raw;
  if (!Array.isArray(data)) return [];

  // Find the Valuation section (contains EPS, DPS, BVPS, PER)
  const valuationSection = data.find((s: any) => s?.section === "Valuation");
  if (!valuationSection || !Array.isArray(valuationSection.data)) return [];

  const metrics: Record<string, Record<string, number>> = {};
  for (const item of valuationSection.data) {
    if (!item || !item.label || !Array.isArray(item.data)) continue;
    const label = String(item.label).toUpperCase();
    const series: Record<string, number> = {};
    for (const point of item.data) {
      if (point && point.year && point.value !== undefined && point.value !== null) {
        const v = Number(point.value);
        if (!isNaN(v)) {
          series[String(point.year)] = v;
        }
      }
    }
    metrics[label] = series;
  }

  const epsSeries = metrics["EPS"] || {};
  const dpsSeries = metrics["DPS"] || {};
  const perSeries = metrics["PER"] || {};
  const years = Object.keys(epsSeries).sort();
  if (years.length === 0) return [];

  const quarters: QuarterData[] = years.map((year, i) => {
    const eps = epsSeries[year];
    const dps = dpsSeries[year] ?? 0;
    const per = perSeries[year];
    // Approximate revenue from EPS / PER × shares... actually we don't have shares, so leave as 0
    // Approximate profit margin from PER (lower PER often = lower margin business, but this is rough)
    // For pattern detection, we mainly care about EPS + YoY growth, so revenue/margin = 0 is fine
    const revenue = 0;
    const netProfit = 0;
    const profitMargin = 0;

    // YoY growth (1 year back — since each "quarter" is actually a year)
    let yoyGrowth: number | null = null;
    if (i >= 1 && epsSeries[years[i - 1]] > 0) {
      yoyGrowth = ((eps - epsSeries[years[i - 1]]) / epsSeries[years[i - 1]]) * 100;
    }

    // QoQ growth (1 period back — same as YoY here since each period is annual)
    const qoqGrowth = yoyGrowth;

    return {
      period: year,
      revenue,
      netProfit,
      eps,
      profitMargin,
      yoyGrowth,
      qoqGrowth,
    };
  });

  return quarters;
}

/**
 * Pattern detection algorithm — analyzes the quarters and classifies the pattern.
 *
 * Approach:
 * 1. Compute trend slope (linear regression on EPS)
 * 2. Compute coefficient of variation (CV) for stability
 * 3. Look at YoY growth acceleration pattern
 * 4. Classify based on slope + CV + growth pattern
 */
export function detectPattern(quarters: QuarterData[]): Omit<PatternRecognitionResult, "symbol" | "summary"> {
  if (quarters.length < 4) {
    return {
      quarters,
      patternType: "INSUFFICIENT_DATA",
      patternLabel: PATTERN_LABELS.INSUFFICIENT_DATA,
      patternScore: 0,
      trendSlope: 0,
      coefficientOfVariation: 0,
      bestQuarter: null,
      worstQuarter: null,
      avgYoYGrowth: null,
      avgQoQGrowth: null,
      totalRevenueGrowth: null,
      epsVolatility: 0,
      quarterlySeasonality: [],
    };
  }

  // Linear regression on EPS to get slope (PKR/quarter)
  const epsValues = quarters.map((q) => q.eps);
  const n = epsValues.length;
  const xs = epsValues.map((_, i) => i);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = epsValues.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((s, x, i) => s + x * epsValues[i], 0);
  const sumXX = xs.reduce((s, x) => s + x * x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

  // Coefficient of variation
  const mean = sumY / n;
  const variance = epsValues.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  const cv = mean !== 0 ? std / Math.abs(mean) : 0;

  // YoY growth analysis
  const yoyValues = quarters
    .map((q) => q.yoyGrowth)
    .filter((v): v is number => v !== null);
  const avgYoY = yoyValues.length > 0 ? yoyValues.reduce((a, b) => a + b, 0) / yoyValues.length : null;

  // QoQ growth analysis
  const qoqValues = quarters
    .map((q) => q.qoqGrowth)
    .filter((v): v is number => v !== null);
  const avgQoQ = qoqValues.length > 0 ? qoqValues.reduce((a, b) => a + b, 0) / qoqValues.length : null;

  // Total revenue growth (first to last)
  const firstRevenue = quarters[0].revenue;
  const lastRevenue = quarters[quarters.length - 1].revenue;
  const totalRevGrowth = firstRevenue > 0 ? ((lastRevenue - firstRevenue) / firstRevenue) * 100 : null;

  // Best/worst quarter (by absolute YoY growth)
  let bestQuarter: QuarterData | null = null;
  let worstQuarter: QuarterData | null = null;
  for (const q of quarters) {
    if (q.yoyGrowth !== null) {
      if (bestQuarter === null || (q.yoyGrowth > (bestQuarter.yoyGrowth ?? -Infinity))) {
        bestQuarter = q;
      }
      if (worstQuarter === null || (q.yoyGrowth < (worstQuarter.yoyGrowth ?? Infinity))) {
        worstQuarter = q;
      }
    }
  }

  // Quarterly seasonality (which calendar quarter tends to be strongest?)
  const seasonality: { quarter: string; avgGrowth: number }[] = [];
  const quarterLabels = ["Q1", "Q2", "Q3", "Q4"];
  for (let qIdx = 0; qIdx < 4; qIdx++) {
    const matching = quarters.filter((q, i) => (i % 4) === qIdx && q.yoyGrowth !== null);
    if (matching.length > 0) {
      const avg = matching.reduce((s, q) => s + (q.yoyGrowth ?? 0), 0) / matching.length;
      seasonality.push({ quarter: quarterLabels[qIdx], avgGrowth: avg });
    }
  }

  // Pattern classification
  let patternType: PatternType;
  let patternScore = 50;

  if (avgYoY === null) {
    patternType = "INSUFFICIENT_DATA";
    patternScore = 0;
  } else if (cv > 0.5) {
    patternType = "VOLATILE";
    patternScore = 35;
  } else if (slope > 0 && avgYoY > 15) {
    // Check acceleration: is YoY growth increasing?
    const yoyRecent = yoyValues.slice(-3); // last 3 YoY values
    const yoyEarlier = yoyValues.slice(0, -3);
    const recentAvg = yoyRecent.reduce((a, b) => a + b, 0) / yoyRecent.length;
    const earlierAvg = yoyEarlier.length > 0 ? yoyEarlier.reduce((a, b) => a + b, 0) / yoyEarlier.length : recentAvg;
    if (recentAvg > earlierAvg * 1.2) {
      patternType = "ACCELERATING_GROWTH";
      patternScore = 85;
    } else if (recentAvg < earlierAvg * 0.8) {
      patternType = "DECELERATING_GROWTH";
      patternScore = 65;
    } else {
      patternType = "STEADY_GROWTH";
      patternScore = 80;
    }
  } else if (slope > 0) {
    patternType = "STEADY_GROWTH";
    patternScore = 70;
  } else if (slope < 0 && avgYoY < -5) {
    patternType = "DECLINING";
    patternScore = 75;
  } else {
    patternType = "FLAT";
    patternScore = 40;
  }

  return {
    quarters,
    patternType,
    patternLabel: PATTERN_LABELS[patternType],
    patternScore,
    trendSlope: slope,
    coefficientOfVariation: cv,
    bestQuarter,
    worstQuarter,
    avgYoYGrowth: avgYoY,
    avgQoQGrowth: avgQoQ,
    totalRevenueGrowth: totalRevGrowth,
    epsVolatility: cv,
    quarterlySeasonality: seasonality,
  };
}

/**
 * Generate a plain-English summary of the detected pattern.
 * Used as a fallback when LLM is unavailable; LLM endpoint will produce a richer version.
 */
export function generatePatternSummary(
  symbol: string,
  data: Omit<PatternRecognitionResult, "symbol" | "summary">
): string {
  if (data.patternType === "INSUFFICIENT_DATA") {
    return `${symbol} has insufficient quarterly data for pattern analysis. At least 4 quarters are needed.`;
  }

  const growthDir = data.avgYoYGrowth !== null && data.avgYoYGrowth > 0 ? "growing" : "declining";
  const growthPct = data.avgYoYGrowth !== null ? Math.abs(data.avgYoYGrowth).toFixed(1) : "—";
  const stability = data.coefficientOfVariation < 0.3 ? "stable" : data.coefficientOfVariation < 0.6 ? "moderately stable" : "volatile";

  let summary = `${symbol} shows ${data.patternLabel.toLowerCase()} pattern. `;
  summary += `Average YoY EPS growth is ${growthPct}% (${growthDir}), and earnings are ${stability} (CV ${(data.coefficientOfVariation * 100).toFixed(1)}%). `;

  if (data.bestQuarter) {
    summary += `Strongest quarter was ${data.bestQuarter.period} with ${data.bestQuarter.yoyGrowth?.toFixed(1)}% YoY growth. `;
  }
  if (data.worstQuarter) {
    summary += `Weakest quarter was ${data.worstQuarter.period} with ${data.worstQuarter.yoyGrowth?.toFixed(1)}% YoY growth. `;
  }

  if (data.patternType === "ACCELERATING_GROWTH") {
    summary += `Growth is accelerating — recent quarters show stronger YoY gains than earlier periods. This typically supports stock price appreciation.`;
  } else if (data.patternType === "STEADY_GROWTH") {
    summary += `Growth is steady and predictable. Investors typically pay a premium multiple for this predictability.`;
  } else if (data.patternType === "DECELERATING_GROWTH") {
    summary += `Growth is decelerating — recent quarters show weaker YoY gains than earlier periods. Watch for further slowdown in upcoming quarters.`;
  } else if (data.patternType === "VOLATILE") {
    summary += `Earnings are highly volatile quarter-to-quarter. This makes valuation harder and typically warrants a lower P/E multiple.`;
  } else if (data.patternType === "DECLINING") {
    summary += `Earnings are declining. This is a bearish signal — investigate root cause (margin compression, revenue loss, sector headwinds).`;
  } else if (data.patternType === "FLAT") {
    summary += `Earnings are flat — no clear growth trend. Stock likely trades on dividend yield rather than capital appreciation.`;
  }

  return summary;
}
