# Issues 14-18: Calculators.tsx + PatternFinder.tsx Multi-fix

**Agent:** main (code-fix)
**Date:** 2026-10-18
**Files touched:**
- `src/components/latent/Calculators.tsx`
- `src/components/latent/PatternFinder.tsx`
- `src/lib/latent/mock-company-results.ts`

## Summary of fixes (5 individual commits)

### Issue 14 — SIP Calculator (Calculators.tsx)
Commit: `7f23949`
- Refactored `SipCalculator` to a **side-by-side grid** (`md:grid-cols-2`): LEFT = inputs, RIGHT = results — matching `CgtCalculator`, `DividendCalculator`, `PositionSizeCalculator`.
- Verified **quick presets** update (NOT clear) the four input fields to preset values. Added `calcKey` state so clicking a preset bumps a recompute key — guarantees the displayed results refresh even when input string equality would otherwise hide the change.
- Added a **green "Calculate SIP" button** at the bottom of the inputs card.
- Added a new `SipGrowthChart` component (pure SVG) showing two lines: corpus value (solid green + filled gradient area) and cumulative invested (yellow dashed) — placed BELOW the year-by-year table card, per spec.
- Year-by-year table gained a **Cumulative (Rs)** column.
- Result card now shows Profit multiplier (×) and Wealth gain (%).

### Issue 15 — Fair Value Calculator (Calculators.tsx)
Commit: `729815b`
- Added a new **5th sub-tab "Fair Value"** (`<Landmark>` icon) inside the main `Tabs`.
- New `FairValueCalculator` component uses `StockSearch` to pick a stock.
- On stock selection it concurrently fetches:
  - `/api/psx/incomestatement/[symbol]` → extracts "EPS - Basic" annual line and "DPS" line.
  - `/api/psx/ohlcv/[symbol]` → last close as current price.
- Auto-fills: latest annual **EPS**, **5-year EPS CAGR** as growth rate, sector-default **P/E ratio** (from a small `SECTOR_DEFAULT_PE` map, fallback 10), and **dividend yield** = latest DPS / current price × 100.
- All 5 fields (EPS, growth, P/E, dividend yield, current price) are user-editable.
- Computes `FairValue = EPS × (1 + growth)^5 × P/E` (simplified DCF / forward P/E model).
- Shows: "Fair Value: Rs. XXX", "Current Price: Rs. YYY", and verdict ("Undervalued/Overvalued by Z%" — ±10% band for "Fairly valued").
- Uses **"Rs."** (Pakistani Rupee) consistently, no ₹.

### Issue 16 — PatternFinder summary stat tooltips + Rs. fix
Commit: `c52cf62`
- Replaced the only `₹` occurrence (Total DPS card, line 299) with `Rs. `.
- Split the single "Volatility" card into two: **EPS volatility** and **Revenue volatility** (new `revVolatility` computed via `computeStdDev(revenueYoYGrowth)`).
- Renamed "Margin slope" → "Margin trend slope" and "Patterns" → "Patterns detected" to match the user's wording. Removed "Quarters" card so the grid still has exactly 8 cards.
- Added an `explanation: string` field to each stat and updated `SummaryStat` to render a hover-tooltip **Info icon** (using shadcn `Tooltip`/`TooltipTrigger`/`TooltipContent`) with the exact layman text the user specified per metric.

### Issue 17 — Quarterly seasonal pattern CAUSE explanations
Commit: `d99ead9`
- Extended `QuarterSummary` interface in `mock-company-results.ts` with `causeSummary: string`.
- Inside `generateQuarterlySummary`, added a per-quarter `cs` switch that explains WHY the seasonal effect happens — generic for PSX-listed companies (no sector info available):
  - Q1 (Jul–Sep): monsoon + Kharif-harvest end + summer heat → weaker cyclical demand.
  - Q2 (Oct–Dec): post-monsoon dry weather → peak construction, Rabi sowing, Eid festive spend.
  - Q3 (Jan–Mar): mid-fiscal-year, winter peak continues, interim dividends.
  - Q4 (Apr–Jun): fiscal year-end, final dividends, summer heat + pre-monsoon slows construction.
- Updated `QuarterSummaryCard` in `PatternFinder.tsx` to render a green-bordered **"Why this happens:"** info box prominently below the existing pattern summary.

### Issue 18 — laymanSummary prominence for detected patterns
Commit: `8195fec`
- Verified all 14 detection rules in `mock-company-results.ts` already populate `laymanSummary`.
- Enhanced the `PatternRow` rendering: the layman summary is now wrapped in a tinted box (`bg-[#00E676]/[0.05] border-[#00E676]/20 rounded-md p-2`) with a small uppercase label **"In plain English"** above the green summary text and a slightly larger Info icon.

## Lint state
- Only pre-existing error in `StockSearch.tsx:20` (set-state-in-effect) — not from these changes.
- No new errors or warnings introduced by Issues 14–18.

## Dev server
- `bun run dev` already running on PID 1081 (port 3000) — untouched by the fixes.
- `curl http://localhost:3000/` returns 200 OK after every commit.
