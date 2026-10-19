# Issues 13–18: PortfolioTab + Dividends + Tracker multi-fix

**Agent:** main (code-fix)
**Date:** 2026-10-19
**Task IDs:** 13, 14, 15, 16, 17, 18
**Files touched:**
- `src/components/latent/PortfolioTab.tsx`
- `src/components/latent/Dividends.tsx`
- `src/components/latent/Tracker.tsx`
- `src/lib/latent/store.ts`

## Summary of fixes (6 individual commits)

### Issue 14 — Non-demo stocks now display in portfolio (commit `ddcdc5f`)
- Added `usePortfolioLivePrices(symbols)` hook in `PortfolioTab.tsx` — fetches the latest close price via `/api/psx/ohlcv/[symbol]` for every portfolio symbol in parallel.
- Removed `if (!stock) return null;` filter that previously skipped any stock not in the 8-item `MOCK_STOCKS` baseline — ALL stored positions now render.
- `currentPrice` resolves to live price (preferred) → `MOCK_STOCKS` fallback (for the 8 demo stocks when fetch fails) → `null` ("—" in UI).
- `totalValue` now sums `(livePrice || MOCK_STOCKS.price) × shares` so cost basis + market value work for the full 361+ PSX universe.
- Extended `PortfolioPosition` type with optional `sector?: string | null` (used downstream by the Tracker pie chart).
- `StockSearch.onChange(sym, company)` callback now also captures `company.sector` and stores it on the position.

### Issue 13 — Close trade flow with CGT/commission/P&L alert + send to tracker (commit `aac8404`)
- New wallet-icon button on every holding row (only when `shares > 0 && buyPrice != null`).
- Clicking opens a Dialog that:
  - Auto-fills sell price from cached live price and re-fetches the latest OHLCV close via `/api/psx/ohlcv/[symbol]`.
  - Computes `buyCost = buy × shares`, `sellValue = sell × shares`, `commission = 0.0015 × sellValue × 2` (both-sides: buy + sell), `holdingDays` from `addedAt`, `taxRate = 15% if ≤12mo else 0%`, `grossPnl = sellValue − buyCost`, `cgt = grossPnl > 0 ? grossPnl × taxRate : 0`, `netPnl = grossPnl − commission − cgt`.
  - Shows a full breakdown table (buy cost / sell value / gross P&L / commission / CGT-with-bracket / net P&L with %) plus a holding-period banner.
- Confirm-close calls new store action `closePositionFromPortfolio(symbol, closedTrade)`:
  - Pushes a `ClosedTrade` record into `closedTrades[]` (capped at 200, persisted via `partialize`).
  - Resets the position to watch-only (`shares = 0, buyPrice = null, status = "open"`) — the stock stays in the portfolio list.
- Fires `pushNotification` with the net P&L summary so the closed trade surfaces in the Tracker.

### Issue 15 — Per-stock dividend history panel (commit `b05b72b`)
- When user selects a stock via `StockSearch` in `Dividends.tsx`, an effect fires `fetch("/api/psx/financial-results/[symbol]")`.
- Filters the returned quarterly results to entries with `metrics.dividendPerShare > 0` and sorts by `periodEnd` desc (latest first).
- Renders a "Dividend history — {symbol}" card above the all-announcements list. Each row shows period (e.g. "Q1 FY24"), period-end date, DPS (PKR per share), payout ratio, EPS context.
- "LATEST" badge marks the most recent payout. Empty/loading/error states all handled.

### Issue 16 — Bell icon only on future dates (commit `3ca36f7`)
- New `isFutureDate(iso)` helper: returns `false` for null/invalid dates or any date ≤ now.
- For each dividend row: `const showBell = isFutureDate(d.exDate);` controls whether the bell button renders.
- Past-date rows: bell button replaced with a static, opacity-30 `<Bell>` placeholder + a "PAST" badge — row layout stays consistent.
- Alert-active banner now requires `showBell && isAlerted`.
- Updated the bottom note to clarify the live announcements cover ALL PSX-listed companies (not just the 8 baseline stocks) and describe the future-only bell rule.

### Issue 17 — Tracker signal-tab layout changes (commit `3010810`)
- Moved the Investment Simulator card to the TOP of the signal tracker section (above the top stat cards), with a "TOP" badge for clarity.
- Added a `TIMEFRAMES` constant `[{1m,30d},{3m,90d},{6m,180d},{1y,365d}]` and a `timeframe` state.
- New segmented selector UI (1M / 3M / 6M / 1Y) — selection triggers a re-fetch via `/api/ai-model-signals/[symbol]?refresh=1&timeframe={key}`.
- All hardcoded "Last 30 days" labels now use the dynamic `timeframeLabel`:
  - stats banner ("Last {tf} backtest · X stocks · …")
  - top stat card sub-text ("per trade, last {tf}")
  - per-stock signals table header ("Live signals — last {tf}")
  - empty-state text ("No actionable BUY/SELL signals in the last {tf} window.")
  - download report header (`=== SIGNAL TRACKER (Last {tf} Backtest) ===`)
- Removed the "Ensemble backtesting" card and "Top models by win rate" card entirely.
- Note: API ignores the `timeframe` query param for now (training data is fixed at 30 days) — passing it through future-proofs the UI for when the training script supports other windows.

### Issue 18 — Portfolio tracker: remove reopen/close + add pie chart (commit `0ddacb8`)
- `PortfolioRow` component refactored: removed `onClose`/`onReopen` props, removed the inline close form, removed Close + Reopen buttons. Now just shows position info + live P&L.
- New `ClosedTradeRow` component renders each closed trade from `closedTrades[]` — shows buy/sell prices, shares, holding days, gross/commission/CGT/net P&L breakdown, tax bracket, closed date.
- Portfolio tracker tab content restructured:
  1. Top stat cards (kept) — Total value / Total P&L (with ROI) / Win rate / Positions (open + closed counts).
  2. NEW SVG donut pie chart card: "Sector-wise holding distribution" — uses `sectorData` computed from open positions weighted by current market value (live × shares). Each sector gets a colored slice with `<title>` tooltip + legend on the right.
  3. "Open positions" card — only renders positions with `shares > 0 && buyPrice != null` (the existing `portfolioPositions` filter already enforces this).
  4. NEW "Closed trades" card — lists `closedTrades` from store (populated by Issue 13's close flow).
- New `useEffect` fetches `/api/psx/companies` on mount to build a `sectorMap: Record<string, string>` — used to look up sector for legacy positions that don't have it stored.
- New `sectorData` useMemo groups open positions by sector and computes percentages.
- `portfolioStats` useMemo updated: closed-trades count/wins/netPnl now derived from `closedTrades[]` (instead of the old `position.status === "closed"` path, which Issue 13's close flow no longer uses).
- Removed unused lucide-react imports (`Check`, `X`, `Unlock`).
- Refactored `SectorPieChart` to compute cumulative slice angles functionally (no `currentAngle` reassignment) to satisfy `react-hooks/immutability` lint rule.

## Lint state
- Only pre-existing error: `StockSearch.tsx:19` (set-state-in-effect, present before this session).
- No new errors or warnings introduced by Issues 13–18.
- All 4 files pass type-check and Next.js compilation cleanly.

## Dev server
- `bun run dev` running on PID 1081 (port 3000) throughout the session.
- `curl http://localhost:3000/` returns 200 OK after every commit.
- All consumed APIs verified reachable:
  - `/api/psx/ohlcv/ENGRO` → 200 (live OHLCV cache)
  - `/api/psx/financial-results/ENGRO` → 200 (quarterly DPS)
  - `/api/scrape/announcements?type=dividend` → 200 (live announcements)
  - `/api/psx/companies` → 200 (sector map)
  - `/api/ai-model-signals/ENGRO?refresh=1&timeframe=3m` → 200 (timeframe param accepted)

## Store changes (`src/lib/latent/store.ts`)
- New `ClosedTrade` interface — full close-flow record.
- New state field `closedTrades: ClosedTrade[]` (capped at 200, persisted).
- New actions:
  - `addClosedTrade(t)` — append-only.
  - `closePositionFromPortfolio(symbol, closedTrade)` — push trade + reset position to watch-only.
- `partialize` extended to persist `closedTrades` alongside `portfolio`.
- `PortfolioPosition` extended with optional `sector?: string | null`.
- Old `closePortfolioPosition` / `reopenPortfolioPosition` actions retained for backward compatibility (no longer called from Tracker after Issue 18).

## Commit log
```
0ddacb8 Issue 18: Portfolio tracker — pie chart, removed reopen/close, open-only list, closed-trades card
3010810 Issue 17: Tracker signal-tab — Investment simulator on top + 1M/3M/6M/1Y timeframe + dropped ensemble cards
3ca36f7 Issue 16: Bell icon only on future last-date-to-buy rows; PAST badge on past dates
b05b72b Issue 15: Per-stock dividend history panel from /api/psx/financial-results
aac8404 Issue 13: Close trade flow with CGT/commission/P&L dialog; pushes closed trade to Tracker
ddcdc5f Issue 14: Portfolio renders ALL PSX stocks via usePortfolioLivePrices hook
```
