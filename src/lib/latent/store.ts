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
  buyPrice: number | null;
  shares: number;
  addedAt: string;
  order: number;
  status: "open" | "closed";
  closePrice?: number | null;
  closedAt?: string | null;
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
      }),
    }
  )
);
