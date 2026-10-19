# Task 01+04-Dashboard: Align Dashboard with SignalSection + per-stock "See Signal" guard

## Summary
Refactored `Dashboard.tsx` so the "active signals" count and signal list use the **same data source** as `SignalSection.tsx` — the new batch endpoint `/api/signals/all` (CL Ensemble consensus across all 361 PSX stocks, filtered to BUY/SELL with R:R ≥ 1:2). The Dashboard no longer pulls from `/api/signals` (the legacy `MOCK_SIGNALS` list) so the two views can never disagree on what counts as an actionable signal (Issue 1).

Also added a per-stock **"See Signal"** affordance in the Plan-allocation card that only renders when a signal actually exists for that stock in the shared signals list — otherwise it shows muted "No signal" text. This implements Issue 4's policy: never send a user to the signals tab for a stock that has no signal.

## Changes

### Issue 1 — same data source as SignalSection
- Replaced `fetch("/api/signals")` (MOCK_SIGNALS) with `fetch("/api/signals/all")`.
- Defined a `DashboardSignal` interface matching the batch endpoint's response shape (`symbol, signal, entry, sl, tp1-3, riskReward, confidence, currentPrice, avgReturn`).
- Removed the old `Signal`-shaped state and the `status === "ACTIVE" || "TRIGGERED"` filter — the batch endpoint already returns only actionable BUY/SELL signals with R:R ≥ 1:2, so every entry in the list *is* an active signal.
- The "Active signals" KPI count and the greeting line ("N active signals to review") now reflect the same filtered list the SignalSection renders — so they always match.

### Issue 1 — bug fix: `setView("signals")` → `setView("signals_v2")`
- The "See all" button at the top of the Active signals card used `setView("signals")`, which isn't a valid `LatentView` (the AppShell's switch would fall through to the landing page). Fixed to `"signals_v2"`, which is the actual SignalSection route.

### Issue 4 — per-stock "See Signal" guard in the Plan card
- Built a `signalBySymbol` lookup (Map) from the shared signals list.
- For each stock in `plan.allocation`, the row now ends with either:
  - A small **`{signal}` pill** (e.g., `BUY` in green, `SELL` in red) with a LineChart icon — clicking it sets `selectedSymbol` and navigates to `signals_v2` so the user lands on the SignalSection with the relevant signal visible. Tooltip shows direction + R:R.
  - Muted **"No signal"** text (with tooltip "No actionable signal for this stock") when no signal exists for that stock.
- The button is **never** shown when no signal exists — matching Issue 4's requirement: "Don't send users to the signals tab if no signal exists for that stock."

### Active-signals row updates
- Each row was previously keyed by `sig.id` and clicked `selectSignal(sig.id)` to open `signal_detail`. The batch endpoint doesn't return IDs (the legacy `/api/signals/[id]` route is for MOCK_SIGNALS only, not the ensemble consensus), so the row click now calls `selectSymbol(sig.symbol)` + `setView("ai_model_signals")`. This opens the AI Model Signals view for the stock — which works for **any** of the 361 PSX-listed companies, not just the 8 in `ml_predictions.json`. `AiModelSignals.tsx` was updated to read `selectedSymbol` from the store on mount so the right stock is displayed.
- The row layout now shows the signal direction badge (`BUY`/`SELL`) and an `R:R 1:N.N` badge instead of the old horizon/triggered badges. Trade params come from `sig.entry / sig.tp2 / sig.sl`. Upside % uses TP2 as the target (consistent with the R:R computation in `/api/signals/all`).

### Empty state
- When the batch endpoint returns 0 signals (current state with TP2 R:R ≥ 2 across the CL Ensemble consensus), the dashboard shows a muted "No actionable signals right now" empty state with a link to "Open Signal Section →" rather than rendering empty rows.

## Commit
- Commit: `Issue 1+4: Dashboard now fetches /api/signals/all (same source as SignalSection), active-signals count matches signals tab, per-stock "See Signal" only renders when a signal exists, fix setView("signals") -> "signals_v2"`
- File: `src/components/latent/Dashboard.tsx`
