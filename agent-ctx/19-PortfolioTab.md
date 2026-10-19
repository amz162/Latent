# Task 19: PortfolioTab.tsx - StockSearch in Dialog + Watch-Only Behavior

## Summary
The "Add to portfolio" dialog previously used a 2x4 grid of buttons (only 8 MOCK_STOCKS) for stock selection. Replaced this with the StockSearch component so the user can pick any of 361+ PSX-listed companies. Also clarified the Issue 19 watch-only behavior — a stock stays as "watch only" until the user explicitly enters shares (volume).

## Changes

### StockSearch Integration in Add-Stock Dialog
- Added `import { StockSearch } from "./StockSearch"`
- Replaced the `<div className="grid grid-cols-2 md:grid-cols-4 ...">` button grid (which mapped over MOCK_STOCKS) with a single `<StockSearch value={selectedSymbol} onChange={(sym, company) => { setSelectedSymbol(sym); setSelectedName(company?.label || ""); setBuyPrice(""); }} placeholder="Search any PSX stock by symbol or name..." />`
- Added `interface CompanyInfo` declaration matching StockSearch's Company type, since StockSearch passes a Company object to onChange
- Added a new state `selectedName` to capture the company label from the StockSearch Company object (used as the portfolio entry's `name` field, falling back to the symbol if no label is provided)
- Removed the auto-fill of `buyPrice` from MOCK_STOCKS.price — user must enter it explicitly now (more honest UX since the StockSearch doesn't carry a price)
- Added a confirmation line below StockSearch: "Selected: SYMBOL — Company Name" when a symbol is chosen

### Issue 19 - Watch-Only Until Shares Specified
- Added explicit inline comment in `handleAdd()` documenting the Issue 19 behavior
- Changed the helper text under the inputs to explain:
  - "The stock is **not moved to holdings** until you specify the number of shares."
  - "Leaving shares empty adds the stock as a **watch-only item** (no P&L tracking). You can add shares later."
- The submit button text now reflects the current state:
  - If `shares` is empty: "Add SYMBOL (watch only)"
  - If `shares` is set: "Add SYMBOL (N shares)"
  - If no symbol: "Add to portfolio"
- Toast message reflects the watch-only vs. holdings distinction
- Push notification body reflects the actual state (shares count or "watch only")

### Other
- Removed unused eslint-disable directive at line 433 (in PortfolioNewsDigest)
- The `MOCK_STOCKS` import is still needed for the totalValue/totalCost calculations (which fetch the current price from MOCK_STOCKS) and as a fallback for the PortfolioNewsDigest component when portfolio is empty

## Commit
- Commit: `Issue 19: Add StockSearch to Portfolio dialog (361+ companies), keep watch-only behavior until shares specified`
- File: `src/components/latent/PortfolioTab.tsx`
