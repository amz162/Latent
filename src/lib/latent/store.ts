"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Signal, Plan, RiskProfileInput, Trade } from "./types";

export type LatentView =
  | "landing"
  | "onboarding"
  | "dashboard"
  | "fundamental_news"
  | "technical_analysis"
  | "signals_v2"
  | "portfolio"
  | "strategy"
  | "dividends"
  | "tracker"
  | "signal_detail"
  | "execute"
  | "ai_model_signals"
  | "calculators"
  | "pattern_finder";

export interface PortfolioPosition {
  symbol: string;
  name: string;
  sector?: string | null;
  buyPrice: number | null;
  shares: number;
  addedAt: string;
  order: number;
  status: "open" | "closed";
  closePrice?: number | null;
  closedAt?: string | null;
}

// Issue 13: a closed trade is recorded when a user closes a portfolio
// position via the close-trade flow in PortfolioTab. The position itself is
// reset to "watch-only" (shares=0, buyPrice=null) but the closed-trade record
// persists so the Tracker's Portfolio tab can show closed trades history.
export interface ClosedTrade {
  id: string;
  symbol: string;
  name: string;
  sector?: string | null;
  buyPrice: number;
  shares: number;
  sellPrice: number;
  buyCost: number;
  sellValue: number;
  commission: number;
  cgt: number;
  grossPnl: number;
  netPnl: number;
  netPnlPct: number;
  holdingDays: number;
  taxRate: number; // 0.15 for ≤12mo, 0 for >12mo
  closedAt: string;
}

export interface AppNotification {
  id: string;
  type: "signal" | "tp_hit" | "sl_hit" | "news" | "info";
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  linkView?: LatentView;
  linkSignalId?: string;
}

interface LatentState {
  view: LatentView;
  selectedSignalId: string | null;
  selectedSymbol: string | null;
  selectedBrokerId: string | null;

  userId: string | null;
  userEmail: string;
  userName: string;
  riskProfile: RiskProfileInput | null;
  plan: Plan | null;
  trades: Trade[];
  portfolio: PortfolioPosition[];
  closedTrades: ClosedTrade[];

  notifications: AppNotification[];

  setView: (v: LatentView) => void;
  selectSignal: (id: string) => void;
  selectSymbol: (symbol: string) => void;
  selectBroker: (id: string) => void;
  setUser: (id: string, email: string, name?: string) => void;
  setRiskProfile: (rp: RiskProfileInput) => void;
  setPlan: (p: Plan) => void;
  setTrades: (t: Trade[]) => void;
  addTrade: (t: Trade) => void;

  addPortfolioPosition: (p: Omit<PortfolioPosition, "addedAt" | "order" | "status">) => void;
  removePortfolioPosition: (symbol: string) => void;
  closePortfolioPosition: (symbol: string, closePrice: number) => void;
  reopenPortfolioPosition: (symbol: string) => void;
  reorderPortfolio: (from: number, to: number) => void;

  addClosedTrade: (t: ClosedTrade) => void;
  closePositionFromPortfolio: (symbol: string, closedTrade: ClosedTrade) => void;

  pushNotification: (n: Omit<AppNotification, "id" | "createdAt" | "read">) => void;
  markNotificationRead: (id: string) => void;
  clearNotifications: () => void;

  reset: () => void;
}

export const useLatentStore = create<LatentState>()(
  persist(
    (set) => ({
      view: "landing",
      selectedSignalId: null,
      selectedSymbol: null,
      selectedBrokerId: null,

      userId: null,
      userEmail: "",
      userName: "",
      riskProfile: null,
      plan: null,
      trades: [],
      portfolio: [],
      closedTrades: [],

      notifications: [],

      setView: (v) => set({ view: v }),
      selectSignal: (id) => set({ selectedSignalId: id, view: "signal_detail" }),
      selectSymbol: (symbol) => set({ selectedSymbol: symbol }),
      selectBroker: (id) => set({ selectedBrokerId: id }),
      setUser: (id, email, name = "") => set({ userId: id, userEmail: email, userName: name }),
      setRiskProfile: (rp) => set({ riskProfile: rp }),
      setPlan: (p) => set({ plan: p }),
      setTrades: (t) => set({ trades: t }),
      addTrade: (t) => set((s) => ({ trades: [...s.trades, t] })),

      addPortfolioPosition: (p) =>
        set((s) => ({
          portfolio: [
            ...s.portfolio,
            { ...p, addedAt: new Date().toISOString(), order: s.portfolio.length, status: "open" as const },
          ],
        })),
      removePortfolioPosition: (symbol) =>
        set((s) => ({
          portfolio: s.portfolio
            .filter((p) => p.symbol !== symbol)
            .map((p, i) => ({ ...p, order: i })),
        })),
      closePortfolioPosition: (symbol, closePrice) =>
        set((s) => ({
          portfolio: s.portfolio.map((p) =>
            p.symbol === symbol
              ? { ...p, status: "closed" as const, closePrice, closedAt: new Date().toISOString() }
              : p
          ),
        })),
      reopenPortfolioPosition: (symbol) =>
        set((s) => ({
          portfolio: s.portfolio.map((p) =>
            p.symbol === symbol
              ? { ...p, status: "open" as const, closePrice: null, closedAt: null }
              : p
          ),
        })),
      reorderPortfolio: (from, to) =>
        set((s) => {
          const arr = [...s.portfolio].sort((a, b) => a.order - b.order);
          const [moved] = arr.splice(from, 1);
          arr.splice(to, 0, moved);
          return { portfolio: arr.map((p, i) => ({ ...p, order: i })) };
        }),

      // Issue 13: record a closed trade (kept separately so the Tracker can
      // show closed-trade history) AND reset the portfolio position to
      // watch-only (shares=0, buyPrice=null) — the stock remains in the
      // portfolio so the user can re-add a position later.
      addClosedTrade: (t) =>
        set((s) => ({ closedTrades: [t, ...s.closedTrades].slice(0, 200) })),
      closePositionFromPortfolio: (symbol, closedTrade) =>
        set((s) => ({
          closedTrades: [closedTrade, ...s.closedTrades].slice(0, 200),
          portfolio: s.portfolio.map((p) =>
            p.symbol === symbol
              ? { ...p, shares: 0, buyPrice: null, status: "open" as const }
              : p
          ),
        })),

      pushNotification: (n) =>
        set((s) => ({
          notifications: [
            {
              ...n,
              id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              createdAt: new Date().toISOString(),
              read: false,
            },
            ...s.notifications,
          ].slice(0, 50),
        })),
      markNotificationRead: (id) =>
        set((s) => ({
          notifications: s.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n
          ),
        })),
      clearNotifications: () => set({ notifications: [] }),

      reset: () =>
        set({
          view: "landing",
          selectedSignalId: null,
          selectedSymbol: null,
          selectedBrokerId: null,
          userId: null,
          userEmail: "",
          userName: "",
          riskProfile: null,
          plan: null,
          trades: [],
          portfolio: [],
          closedTrades: [],
          notifications: [],
        }),
    }),
    {
      name: "latent-store-v2",
      partialize: (s) => ({
        userId: s.userId,
        userEmail: s.userEmail,
        userName: s.userName,
        riskProfile: s.riskProfile,
        plan: s.plan,
        portfolio: s.portfolio,
        closedTrades: s.closedTrades,
      }),
    }
  )
);
