// Latent.pk — Tax calculation helpers
// Pakistan tax law (2024-2025 Finance Act):
//   - Capital gains on PSX securities:
//     * Filer (active ATL): 15% on realized gains
//     * Non-filer: 30% on realized gains
//   - Dividend income:
//     * Filer: 15% on gross dividend
//     * Non-filer: 30% on gross dividend
//   - Loss offset: Capital losses can offset capital gains within the same fiscal year (July 1 - June 30)
//
// CGT is only on REALIZED gains (when you actually sell). Unrealized/paper gains are not taxable.

export type FilerStatus = "filer" | "non-filer";

export const CGT_RATE: Record<FilerStatus, number> = {
  filer: 0.15,
  "non-filer": 0.30,
};

export const DIVIDEND_TAX_RATE: Record<FilerStatus, number> = {
  filer: 0.15,
  "non-filer": 0.30,
};

export interface CgtInput {
  buyPrice: number;
  sellPrice: number;
  shares: number;
  commissionPct?: number; // broker commission as % of trade value (default 0.12%)
  filerStatus: FilerStatus;
}

export interface CgtResult {
  buyValue: number;
  sellValue: number;
  grossGain: number;            // sell - buy (before costs)
  commissionBuy: number;
  commissionSell: number;
  totalCommission: number;
  transactionCosts: number;     // total commission paid
  netGain: number;              // grossGain - transactionCosts
  cgtRate: number;              // 0.15 or 0.30
  cgtAmount: number;            // tax owed
  profitAfterTax: number;      // netGain - cgtAmount
  lossOffsetEligible: boolean; // losses can offset other gains within fiscal year
  effectiveTaxRate: number;     // cgtAmount / grossGain (can exceed CGT_RATE if transaction costs eat gains)
}

export function calculateCGT(input: CgtInput): CgtResult {
  const commissionPct = input.commissionPct ?? 0.0012; // 0.12% default
  const buyValue = input.buyPrice * input.shares;
  const sellValue = input.sellPrice * input.shares;
  const grossGain = sellValue - buyValue;
  const commissionBuy = buyValue * commissionPct;
  const commissionSell = sellValue * commissionPct;
  const totalCommission = commissionBuy + commissionSell;
  const transactionCosts = totalCommission;
  const netGain = grossGain - transactionCosts;

  // CGT only applies to POSITIVE net gains. Losses → no tax owed, but can offset other gains.
  const cgtRate = CGT_RATE[input.filerStatus];
  const cgtAmount = netGain > 0 ? netGain * cgtRate : 0;
  const profitAfterTax = netGain - cgtAmount;
  const effectiveTaxRate = grossGain > 0 ? cgtAmount / grossGain : 0;

  return {
    buyValue,
    sellValue,
    grossGain,
    commissionBuy,
    commissionSell,
    totalCommission,
    transactionCosts,
    netGain,
    cgtRate,
    cgtAmount,
    profitAfterTax,
    lossOffsetEligible: netGain < 0,
    effectiveTaxRate,
  };
}

// Aggregate CGT for multiple realized trades within the same fiscal year.
// Losses offset gains before applying the tax rate.
export interface RealizedTrade {
  symbol: string;
  buyPrice: number;
  sellPrice: number;
  shares: number;
  realizedAt: string; // ISO date
}

export interface AggregatedCgtResult {
  totalGrossGain: number;       // sum of all positive gains
  totalGrossLoss: number;       // sum of all negative gains (absolute value)
  netGain: number;              // totalGrossGain - totalGrossLoss
  totalCommission: number;
  taxableGain: number;          // netGain - totalCommission (if > 0)
  cgtAmount: number;
  profitAfterTax: number;
  lossCarriedForward: number;   // if net loss > total commission, the loss carries forward (Pakistan rule)
  filerStatus: FilerStatus;
  tradeCount: number;
  winningTrades: number;
  losingTrades: number;
}

export function calculateAggregatedCGT(trades: RealizedTrade[], filerStatus: FilerStatus): AggregatedCgtResult {
  let totalGrossGain = 0;
  let totalGrossLoss = 0;
  let totalCommission = 0;
  let winningTrades = 0;
  let losingTrades = 0;

  for (const trade of trades) {
    const result = calculateCGT({ ...trade, filerStatus });
    if (result.netGain > 0) {
      totalGrossGain += result.netGain;
      winningTrades += 1;
    } else if (result.netGain < 0) {
      totalGrossLoss += Math.abs(result.netGain);
      losingTrades += 1;
    }
    totalCommission += result.totalCommission;
  }

  const netGain = totalGrossGain - totalGrossLoss;
  const taxableGain = Math.max(0, netGain);
  const cgtRate = CGT_RATE[filerStatus];
  const cgtAmount = taxableGain * cgtRate;
  const profitAfterTax = netGain - cgtAmount;
  const lossCarriedForward = netGain < 0 ? Math.abs(netGain) : 0;

  return {
    totalGrossGain,
    totalGrossLoss,
    netGain,
    totalCommission,
    taxableGain,
    cgtAmount,
    profitAfterTax,
    lossCarriedForward,
    filerStatus,
    tradeCount: trades.length,
    winningTrades,
    losingTrades,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Dividend tax
// ────────────────────────────────────────────────────────────────────────────

export interface DividendTaxInput {
  shares: number;
  dividendPerShare: number;
  filerStatus: FilerStatus;
}

export interface DividendTaxResult {
  grossDividend: number;
  taxRate: number;
  taxAmount: number;
  netDividend: number;
}

export function calculateDividendTax(input: DividendTaxInput): DividendTaxResult {
  const grossDividend = input.shares * input.dividendPerShare;
  const taxRate = DIVIDEND_TAX_RATE[input.filerStatus];
  const taxAmount = grossDividend * taxRate;
  const netDividend = grossDividend - taxAmount;
  return {
    grossDividend,
    taxRate,
    taxAmount,
    netDividend,
  };
}
