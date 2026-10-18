# Task 07: SignalSection.tsx - StockSearch + BUY/SELL Filter + R:R ≥ 1:2

## Summary
Replaced the basic search Input with the `StockSearch` component (allows picking any of 361+ PSX-listed companies). Filtered signals to only show BUY and SELL (HOLD and ACCUMULATE removed). Added a Risk:Reward filter (≥ 1:2 minimum = reward ≥ 2× risk). Removed the HOLD and ACCUMULATE filter buttons/cards.

## Changes

### StockSearch Integration
- Removed `Input` import and `Search` icon import
- Added `import { StockSearch } from "./StockSearch"`
- Replaced the search Input with StockSearch, with label "Search any PSX stock (361+ companies)"
- StockSearch onChange updates the `search` state, which triggers a single-stock signal fetch via `/api/ml/signal/[symbol]`
- When `search` is empty: shows all MOCK_STOCKS signals filtered by the BUY/SELL filter buttons
- When `search` has a value: shows only that stock's signal (extends beyond MOCK_STOCKS to any of 361+ companies)
- Guard: `singleSignal.symbol === search.toUpperCase()` ensures stale data is never displayed

### Issue 7 - Filter to BUY/SELL only
- Changed `Direction` type from `"BUY" | "SELL" | "HOLD" | "ACCUMULATE"` to just `"BUY" | "SELL"`
- Replaced `mapCall` with `mapCallStrict` — only returns "BUY" or "SELL" (no HOLD/ACCUMULATE)
- During `fetchAllSignals`, signals that don't map to BUY or SELL are filtered out

### Issue 7 - R:R ≥ 1:2 filter
- Added `computeRiskReward(entry, target, stop)` helper: returns `|target-entry| / |entry-stopLoss|`
- Added `MIN_RISK_REWARD = 2` constant (1:2 minimum = reward ≥ 2× risk)
- During `fetchAllSignals`, signals with `rr < MIN_RISK_REWARD` are filtered out
- Each signal card now shows a prominent R:R badge (e.g., "1 : 2.45")

### Issue 7 - Removed HOLD/ACCUMULATE UI
- Filter buttons reduced from `[ALL, BUY, SELL, HOLD, ACCUMULATE]` to `[ALL, BUY, SELL]`
- KPI summary cards reduced from 4 (BUY/SELL/HOLD/ACCUMULATE) to 3 (BUY/SELL/Min R:R)
- Updated copy throughout to reflect the new filter policy

### Filter buttons hidden when searching
- When user picks a single stock via StockSearch, the filter buttons (ALL/BUY/SELL) are hidden
- Because the single-stock view overrides the list filter

### Loading states
- `singleLoading` shows a single Skeleton card while fetching the single-stock signal
- `loading` shows 6 Skeleton cards while fetching the full list

### Disclaimer
- Updated disclaimer: "Only actionable BUY and SELL signals are shown — HOLD and ACCUMULATE are suppressed. Signals are further filtered to setups with a Risk:Reward ratio of ≥ 1:2 (reward ≥ 2× risk)."

## Commit
- Commit: `Issue 7: Signal Section - filter to BUY/SELL only with R:R >= 1:2, replace search Input with StockSearch (361+ companies)`
- File: `src/components/latent/SignalSection.tsx`
