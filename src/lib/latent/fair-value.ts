// Latent.pk — Fair Value Calculator
// Implements 6 valuation methods (4 relative + 2 intrinsic) and combines them.
//
// Data sources (all fetched from AskAnalyst.com.pk via our /api/psx/* proxy routes):
//   - EPS, Book Value per Share, Dividend per Share: from /api/psx/financials/[symbol]
//   - Sector avg P/E + P/B: from /api/psx/valuation/[symbol]
//   - Current price: from /api/psx/technical/[symbol] (latest close)
//   - Dividend yield: computed from dividend per share / current price
//   - Historical EPS growth (3-yr CAGR): from /api/psx/financials/[symbol]
//   - Pakistan 10Y bond yield: hardcoded fallback (~15%) — can be replaced with live bond data
//
// Methods:
//   1. P/E Multiple Method (relative)
//   2. Price-to-Book Method (relative)
//   3. Benjamin Graham Formula (relative, intrinsic-adj)
//   4. Peter Lynch PEG Formula (relative)
//   5. Dividend Discount Model (DDM — intrinsic)
//   6. Discounted Cash Flow (DCF — intrinsic)
//
// User can override any input in the Advanced panel (especially growth rate,
// discount rate, terminal growth, FCF, shares outstanding — these are forward-looking
// and judgment-driven).

export type FairValueMethod =
  | "PE_MULTIPLE"
  | "PB_MULTIPLE"
  | "BENJAMIN_GRAHAM"
  | "PETER_LYNCH"
  | "DDM"
  | "DCF";

export const METHOD_NAMES: Record<FairValueMethod, string> = {
  PE_MULTIPLE: "P/E Multiple Method",
  PB_MULTIPLE: "Price-to-Book Method",
  BENJAMIN_GRAHAM: "Benjamin Graham Formula",
  PETER_LYNCH: "Peter Lynch (PEG) Formula",
  DDM: "Dividend Discount Model (DDM)",
  DCF: "Discounted Cash Flow (DCF)",
};

export const METHOD_TYPES: Record<FairValueMethod, "relative" | "intrinsic"> = {
  PE_MULTIPLE: "relative",
  PB_MULTIPLE: "relative",
  BENJAMIN_GRAHAM: "relative",
  PETER_LYNCH: "relative",
  DDM: "intrinsic",
  DCF: "intrinsic",
};

export interface FairValueInput {
  symbol: string;
  currentPrice: number;
  eps: number;                   // earnings per share (TTM)
  bookValuePerShare: number;
  dividendPerShare: number;     // trailing 12-month dividend
  sectorPE: number;             // sector average P/E
  sectorPB: number;             // sector average P/B
  growthRate: number;            // expected annual EPS growth rate, % (e.g., 12 for 12%)
  dividendYield: number;        // current %, computed from dividendPerShare / currentPrice
  pakistanBondYield: number;    // Pakistan 10Y bond yield, % (fallback: 15)
  // DCF inputs (user can override)
  fcf: number;                   // free cash flow, total PKR (last 12 months)
  sharesOutstanding: number;     // total shares outstanding
  shortTermGrowth: number;       // 5-10 year growth rate for FCF, %
  terminalGrowth: number;        // long-term perpetual growth, % (typically 3-4% = GDP)
  wacc: number;                  // discount rate / WACC, %
  // DDM inputs
  dividendGrowthRate: number;    // expected annual dividend growth, %
  requiredReturn: number;        // required rate of return on equity, %
}

export interface FairValueResult {
  method: FairValueMethod;
  methodName: string;
  type: "relative" | "intrinsic";
  fairValue: number;
  formula: string;
  rationale: string;
}

export interface FairValueSummary {
  results: FairValueResult[];
  average: number;
  min: number;
  max: number;
  range: string;
  mode: number;                  // most repeated fair value (rounded to nearest 1 PKR)
  ourAlgoFairValue: number;      // mode if it exists, else median
  currentPrice: number;
  aboveOrBelowFair: "above" | "below" | "fair";
  percentVsFair: number;          // +X% above fair, -X% below fair
  symbol: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Individual method implementations
// ────────────────────────────────────────────────────────────────────────────

/**
 * 1. P/E Multiple Method
 * Fair Price = Sector P/E × EPS
 * Logic: If peer stocks trade at 8× earnings and this stock's EPS is PKR 25,
 * the "fair" price is PKR 200 (if the stock is fairly valued vs peers).
 */
function calcPEMultiple(input: FairValueInput): FairValueResult {
  const fairValue = input.sectorPE * input.eps;
  return {
    method: "PE_MULTIPLE",
    methodName: METHOD_NAMES.PE_MULTIPLE,
    type: "relative",
    fairValue,
    formula: `Sector P/E (${input.sectorPE}) × EPS (${input.eps})`,
    rationale: `If peers trade at ${input.sectorPE}× earnings, this stock's earnings of PKR ${input.eps}/share should be valued at PKR ${fairValue.toFixed(2)}.`,
  };
}

/**
 * 2. Price-to-Book Method
 * Fair Price = Sector P/B × Book Value per Share
 */
function calcPBMultiple(input: FairValueInput): FairValueResult {
  const fairValue = input.sectorPB * input.bookValuePerShare;
  return {
    method: "PB_MULTIPLE",
    methodName: METHOD_NAMES.PB_MULTIPLE,
    type: "relative",
    fairValue,
    formula: `Sector P/B (${input.sectorPB}) × BVPS (${input.bookValuePerShare})`,
    rationale: `If peers trade at ${input.sectorPB}× book value, this stock's book value of PKR ${input.bookValuePerShare}/share should be valued at PKR ${fairValue.toFixed(2)}.`,
  };
}

/**
 * 3. Benjamin Graham Formula
 * V = EPS × (8.5 + 2g) × (4.4 / Y)
 *   where 8.5 = P/E for no-growth company, g = growth rate %, 4.4 = AAA bond yield in 1962,
 *   Y = current AAA bond yield (we use Pakistan 10Y as proxy)
 * Graham's original formula uses these constants; modern variants use Pakistan 10Y for Y.
 */
function calcBenjaminGraham(input: FairValueInput): FairValueResult {
  const g = input.growthRate; // expected annual growth %
  const Y = input.pakistanBondYield;
  const fairValue = input.eps * (8.5 + 2 * g) * (4.4 / Y);
  return {
    method: "BENJAMIN_GRAHAM",
    methodName: METHOD_NAMES.BENJAMIN_GRAHAM,
    type: "relative",
    fairValue,
    formula: `EPS (${input.eps}) × (8.5 + 2×g (${g})) × (4.4 / Y (${Y}))`,
    rationale: `Graham's intrinsic value: assumes fair P/E = 8.5 + 2× growth rate, adjusted for current bond yield of ${Y}% (vs Graham's 4.4% baseline).`,
  };
}

/**
 * 4. Peter Lynch PEG Formula
 * Lynch's rule: A stock is fairly valued when PEG = 1, i.e., P/E = Growth Rate.
 * Adjusted: Fair P/E = Growth Rate + Dividend Yield
 * Fair Price = EPS × (Growth Rate + Dividend Yield)
 *
 * Example: EPS 25, growth 12%, dividend yield 5% → Fair P/E = 17 → Fair Price = 25 × 17 = 425
 */
function calcPeterLynch(input: FairValueInput): FairValueResult {
  const growth = input.growthRate;
  const dy = input.dividendYield;
  const fairPE = growth + dy; // Lynch's adjustment
  const fairValue = input.eps * fairPE;
  return {
    method: "PETER_LYNCH",
    methodName: METHOD_NAMES.PETER_LYNCH,
    type: "relative",
    fairValue,
    formula: `EPS (${input.eps}) × (Growth (${growth}) + Div Yield (${dy}))`,
    rationale: `Lynch's PEG rule: fair P/E should equal growth rate + dividend yield. Fair P/E = ${fairPE.toFixed(1)}.`,
  };
}

/**
 * 5. Dividend Discount Model (DDM — Gordon Growth Model)
 * P = D1 / (r − g)
 *   D1 = next year's dividend = DPS × (1 + g)
 *   r = required return on equity
 *   g = perpetual dividend growth rate
 */
function calcDDM(input: FairValueInput): FairValueResult {
  const g = input.dividendGrowthRate / 100;
  const r = input.requiredReturn / 100;
  const D1 = input.dividendPerShare * (1 + g);
  if (r <= g) {
    return {
      method: "DDM",
      methodName: METHOD_NAMES.DDM,
      type: "intrinsic",
      fairValue: 0,
      formula: `D1 (${D1.toFixed(2)}) / (r (${r}) − g (${g}))`,
      rationale: `Cannot compute — required return (${r * 100}%) must exceed growth (${g * 100}%). Adjust inputs.`,
    };
  }
  const fairValue = D1 / (r - g);
  return {
    method: "DDM",
    methodName: METHOD_NAMES.DDM,
    type: "intrinsic",
    fairValue,
    formula: `D1 (${D1.toFixed(2)}) / (r − g = ${(r - g).toFixed(4)})`,
    rationale: `Next year's dividend (PKR ${D1.toFixed(2)}) discounted to perpetuity at required return ${r * 100}% less growth ${g * 100}%.`,
  };
}

/**
 * 6. Discounted Cash Flow (DCF)
 * Stage 1: 5-year explicit FCF projections with short-term growth
 * Stage 2: Terminal Value = FCF_year5 × (1 + g_terminal) / (WACC − g_terminal)
 * Discount all to present value, divide by shares outstanding.
 */
function calcDCF(input: FairValueInput): FairValueResult {
  const gShort = input.shortTermGrowth / 100;
  const gTerm = input.terminalGrowth / 100;
  const wacc = input.wacc / 100;
  const shares = input.sharesOutstanding;

  if (shares <= 0) {
    return {
      method: "DCF",
      methodName: METHOD_NAMES.DCF,
      type: "intrinsic",
      fairValue: 0,
      formula: `DCF = Σ(FCFt / (1+r)^t) + Terminal / (1+r)^N`,
      rationale: `Cannot compute — shares outstanding must be > 0. Adjust inputs.`,
    };
  }
  if (wacc <= gTerm) {
    return {
      method: "DCF",
      methodName: METHOD_NAMES.DCF,
      type: "intrinsic",
      fairValue: 0,
      formula: `DCF requires WACC (${wacc * 100}%) > terminal growth (${gTerm * 100}%)`,
      rationale: `Cannot compute — WACC must exceed terminal growth rate. Adjust inputs.`,
    };
  }

  // 5-year explicit forecast
  const projectionYears = 5;
  const fcfProjections: number[] = [];
  let fcf = input.fcf;
  for (let i = 1; i <= projectionYears; i++) {
    fcf = fcf * (1 + gShort);
    fcfProjections.push(fcf);
  }

  // Terminal value at end of year 5
  const fcfYear6 = fcfProjections[fcfProjections.length - 1] * (1 + gTerm);
  const terminalValue = fcfYear6 / (wacc - gTerm);

  // Discount everything to present value
  let pv = 0;
  for (let i = 0; i < projectionYears; i++) {
    pv += fcfProjections[i] / Math.pow(1 + wacc, i + 1);
  }
  pv += terminalValue / Math.pow(1 + wacc, projectionYears);

  const fairValue = pv / shares;

  return {
    method: "DCF",
    methodName: METHOD_NAMES.DCF,
    type: "intrinsic",
    fairValue,
    formula: `5yr FCF @ ${input.shortTermGrowth}% → TV @ ${input.terminalGrowth}% → discount @ ${input.wacc}% → ÷ shares (${shares.toLocaleString()})`,
    rationale: `Forecasted 5 years of FCF growing at ${input.shortTermGrowth}%, then terminal value at ${input.terminalGrowth}% perpetual growth, discounted at WACC ${input.wacc}%. Per-share = total PV ÷ shares outstanding.`,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Combined summary
// ────────────────────────────────────────────────────────────────────────────

export function calculateFairValue(input: FairValueInput): FairValueSummary {
  const results: FairValueResult[] = [
    calcPEMultiple(input),
    calcPBMultiple(input),
    calcBenjaminGraham(input),
    calcPeterLynch(input),
    calcDDM(input),
    calcDCF(input),
  ];

  // Filter out zero/negative values for stats
  const valid = results.filter((r) => r.fairValue > 0);
  if (valid.length === 0) {
    return {
      results,
      average: 0,
      min: 0,
      max: 0,
      range: "—",
      mode: 0,
      ourAlgoFairValue: 0,
      currentPrice: input.currentPrice,
      aboveOrBelowFair: "fair",
      percentVsFair: 0,
      symbol: input.symbol,
    };
  }

  const values = valid.map((r) => r.fairValue);
  const average = values.reduce((s, v) => s + v, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);

  // Mode: most repeated value (rounded to nearest PKR)
  const rounded = values.map((v) => Math.round(v));
  const counts: Record<number, number> = {};
  for (const v of rounded) {
    counts[v] = (counts[v] || 0) + 1;
  }
  let mode = rounded[0];
  let modeCount = 0;
  for (const [v, c] of Object.entries(counts)) {
    if (c > modeCount) {
      modeCount = c;
      mode = Number(v);
    }
  }
  const modeExists = modeCount > 1;

  // If no repeated values, use median as fallback
  const sortedValues = [...values].sort((a, b) => a - b);
  const median = sortedValues.length % 2 === 0
    ? (sortedValues[sortedValues.length / 2 - 1] + sortedValues[sortedValues.length / 2]) / 2
    : sortedValues[Math.floor(sortedValues.length / 2)];
  const ourAlgoFairValue = modeExists ? mode : median;

  const percentVsFair = input.currentPrice > 0
    ? ((input.currentPrice - ourAlgoFairValue) / ourAlgoFairValue) * 100
    : 0;
  const aboveOrBelowFair: "above" | "below" | "fair" =
    Math.abs(percentVsFair) < 5 ? "fair" : percentVsFair > 0 ? "above" : "below";

  return {
    results,
    average,
    min,
    max,
    range: `PKR ${min.toFixed(2)} — PKR ${max.toFixed(2)}`,
    mode,
    ourAlgoFairValue,
    currentPrice: input.currentPrice,
    aboveOrBelowFair,
    percentVsFair,
    symbol: input.symbol,
  };
}

// Default inputs (used when user just clicks Calculate without overrides)
export function getDefaultFairValueInputs(symbol: string, currentPrice: number, eps: number, dps: number, bvps: number): Partial<FairValueInput> {
  const dividendYield = currentPrice > 0 ? (dps / currentPrice) * 100 : 0;
  return {
    symbol,
    currentPrice,
    eps,
    bookValuePerShare: bvps,
    dividendPerShare: dps,
    dividendYield,
    sectorPE: 8,       // conservative default for PSX (fallback if not fetched)
    sectorPB: 1.2,     // conservative default
    growthRate: 8,     // 8% EPS growth assumption (typical for PSX)
    pakistanBondYield: 15, // Pakistan 10Y bond ~15% as of 2024-2025
    fcf: eps * 0.8,    // estimate: FCF ≈ 80% of EPS (rough heuristic; user should override)
    sharesOutstanding: 1_000_000, // placeholder — user MUST override for DCF
    shortTermGrowth: 10,   // 10% short-term growth
    terminalGrowth: 3,     // 3% perpetual (GDP-like)
    wacc: 18,              // 18% WACC (15% risk-free + 3% equity premium — Pakistan-style)
    dividendGrowthRate: 5, // 5% dividend growth
    requiredReturn: 18,    // 18% required return on equity
  };
}
