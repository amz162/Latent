# Task 04: TechnicalAnalysis.tsx - StockSearch + Historical OHLCV Chart

## Summary
Replaced the limited `<select>` dropdown (INDEXES + CHART_SYMBOLS) with the `StockSearch` component to allow picking any of 361+ PSX-listed companies. Added a new `HistoricalOhlcvChart` inline component that fetches ALL historical OHLCV data from the `/api/psx/ohlcv/[symbol]` endpoint (which itself fetches up to 10 years from askanalyst.com.pk /technicalchart endpoint, with local caching fallback).

## Changes

### StockSearch Integration
- Removed the `<select>` dropdown with INDEXES + CHART_SYMBOLS optgroups
- Added `import { StockSearch } from "./StockSearch"`
- Added a new Card containing StockSearch with label "Select Stock (any of 361+ PSX-listed companies)"
- StockSearch callback sets the selected symbol AND switches view mode to "stock"

### Indexes (kept as quick-select)
- INDEXES grid (KSE-100, KSE-30, KMI-30, ALLSHR) still rendered
- Clicking an index shows a placeholder card explaining askanalyst doesn't serve index OHLCV
- Only individual PSX stocks get the historical OHLCV chart

### HistoricalOhlcvChart component (new inline)
- Fetches from `/api/psx/ohlcv/[symbol]`
- Tries local cache (data/ohlcv_all or data/ohlcv) first, then live fetch up to 10 years
- Loading animation: animated spinner + progress bar + "Fetching up to 10 years of daily candles from askanalyst.com.pk" text
- Range selector: 1M / 6M / 1Y / 5Y / ALL
- Shows total return % between first and last close in selected range
- Renders: Price line (green), Volume area, 50-DMA (dashed), 200-DMA (dashed), Support (red), Resistance (yellow) using recharts ComposedChart
- Shows bar count + date range + data source label below chart
- Error state with friendly message if askanalyst API fails or symbol not in coverage
- Empty state if no bars in selected range

### Removed imports
- Removed `RealChart` import (no longer used)
- Removed `CHART_SYMBOLS` constant (replaced by full 361+ universe)

## Commit
- Commit: `Issue 4: Replace stock selector with StockSearch in Technical Analysis tab, add full historical OHLCV chart (up to 10y) with loading animation from askanalyst API`
- File: `src/components/latent/TechnicalAnalysis.tsx`
