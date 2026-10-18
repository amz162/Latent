// Latent.pk — TypeScript types for the MVP

export type TradeHorizon = "DAY" | "SWING" | "DIVIDEND" | "GROWTH";
export type SignalDirection = "LONG" | "SHORT";
export type SignalStatus = "ACTIVE" | "TRIGGERED" | "EXPIRED" | "CLOSED";
export type TradeStatus = "OPEN" | "CLOSED_WIN" | "CLOSED_LOSS" | "CLOSED_BREAKEVEN";
export type RiskBucket = "conservative" | "moderate" | "growth" | "aggressive";

export interface Stock {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  changePct: number;
  peRatio: number;
  pbRatio: number;
  dividendYield: number;
  marketCapBn: number;
  volumeToday: number;
}

export interface SignalExplanation {
  summary: string;
  technicalLayman: string;
  technicalTerms: { term: string; meaning: string; current: string; impact: string }[];
  fundamentalLayman: string;
  fundamentalFactors: { label: string; value: string; impact: "positive" | "negative" | "neutral" }[];
  newsLayman: string;
  newsItems: { headline: string; source: string; impact: "positive" | "negative" | "neutral"; affectedStocks: string[] }[];
  actionLayman: string;
  riskFactors: string[];
}

export interface Signal {
  id: string;
  symbol: string;
  stockName: string;
  direction: SignalDirection;
  horizon: TradeHorizon;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  confidenceScore: number;
  setupScore: number;
  status: SignalStatus;
  createdAt: string;
  expiresAt: string;
  explanation: SignalExplanation;
}

export interface Trade {
  id: string;
  signalId: string;
  symbol: string;
  direction: SignalDirection;
  horizon: TradeHorizon;
  entryPrice: number;
  exitPrice: number | null;
  entryDate: string;
  exitDate: string | null;
  status: TradeStatus;
  pnlPct: number | null;
  pnlPkr: number | null;
  timeToCloseDays: number | null;
}

export interface RiskProfileInput {
  riskTolerance: number;
  timeHorizon: number;
  monthlyContribution: number;
  goalLabel: string;
  goalTargetAmount: number;
  goalDate: string;
}

export interface PlanAllocation {
  symbol: string;
  name: string;
  allocationPct: number;
  horizon: TradeHorizon;
  thesis: string;
}

export interface PlanLadderStep {
  month: number;
  amount: number;
  instructions: string;
}

export interface Plan {
  id: string;
  userId: string;
  profileBucket: RiskBucket;
  allocation: PlanAllocation[];
  entryLadder: PlanLadderStep[];
  rebalancingRules: string[];
  expectedReturnPct: number;
  riskScore: number;
}

export interface TrackRecordStats {
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  openTrades: number;
  winRate: number;
  avgTimeToProfitDays: number;
  avgTimeToLossDays: number;
  avgWinPct: number;
  avgLossPct: number;
  profitFactor: number;
  bestTradePct: number;
  worstTradePct: number;
  byHorizon: {
    horizon: TradeHorizon;
    total: number;
    wins: number;
    winRate: number;
  }[];
}

export interface Broker {
  id: string;
  name: string;
  commissionPct: number;
  settlementDays: number;
  logoColor: string;
}
