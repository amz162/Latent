# Task 01: AiModelSignals.tsx - StockSearch Integration

## Summary
Replaced the limited `<select>` dropdown (MOCK_STOCKS) with the `StockSearch` component to allow searching any of 361+ PSX-listed companies.

## Changes
- Removed `MOCK_STOCKS` import (no longer needed)
- Added `import { StockSearch } from "./StockSearch"`
- Replaced `<select value={symbol} onChange={e=>setSymbol(e.target.value)}>` with `<StockSearch value={symbol} onChange={(sym)=>setSymbol(sym)} placeholder="Search any PSX stock..." />`
- Changed label text from "Select Stock" to "Select Stock (any of 361+ PSX-listed companies)"
- Added min-width `min-w-[180px]` to the StockSearch container
- Wrapped StockSearch in a `<div className="mt-1">` for spacing

## Issue 13 Fix (verified)
The price shown next to the selector uses `data.currentPrice` which is returned by the API. The API already handles fetching the price from `data/ohlcv_all/{symbol}.csv` for stocks not in MOCK_STOCKS (see `/api/ai-model-signals/[symbol]/route.ts` line 12). No UI change needed since the existing code already uses `data.currentPrice.toFixed(2)`.

## Commit
- Commit: `Issue 13: Replace AI Model Signals stock selector with StockSearch component, fetch latest price from API for any of 361+ PSX-listed companies`
- File: `src/components/latent/AiModelSignals.tsx`
