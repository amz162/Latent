# Task 20: Dividends.tsx - StockSearch + All Companies + Bell Alert

## Summary
Replaced the 8-stock synthetic DIVIDENDS list with a live-fetched list of ALL dividend announcements from investify.pk via `/api/scrape/announcements?type=dividend`. Added StockSearch for filtering to a specific company. Replaced "Total payout" with "Maximum dividend". Replaced "Ex dividend date" with "Last date to buy/hold". Removed "Signal" and "Watch" buttons. Added a bell icon that turns yellow when an alert is active.

## Changes

### StockSearch Integration (Issue 20 - "Replace any stock selector with StockSearch")
- Added `import { StockSearch } from "./StockSearch"`
- The Dividends tab didn't have a `<select>` before, but the static DIVIDENDS list of 8 stocks was effectively the only way to view dividends
- Added a new Card with StockSearch above the KPI cards
- StockSearch's value is `filterSymbol`; onChange sets `filterSymbol` to the selected stock's symbol
- The dividend list filters by symbol or company name match
- When `filterSymbol` is set, shows a "Filtering dividends for: SYMBOL [show all]" line with a clear button

### Issue 20 - Show ALL Companies' Dividends (PSX API)
- Renamed DIVIDENDS to STATIC_DIVIDENDS (baseline — used as fallback when scraper fails)
- Added `useEffect` that fetches from `/api/scrape/announcements?type=dividend`
- Parses dividend amount from title/summary via `parseDividendAmount(title)` regex:
  - `Rs.? 4.50 per share`, `PKR 6.0/share`, `10.5 per share`, `Final Dividend Rs.7.50 per share`, etc.
- Classifies type (Interim/Final/Special/Bonus/Unknown) from title keywords
- Uses announcement's `publishedAt` as proxy for ex-date (the announcements endpoint doesn't expose a true ex-date)
- Merges live + static (live takes precedence; static fills gaps for symbols not in live data)
- Sorts by amount descending — biggest payouts at top
- Live announcements get a "LIVE" badge on the card
- If scraper fails, falls back to STATIC_DIVIDENDS only and shows a banner explaining the fallback
- Loading skeleton shows 5 cards + a "Fetching all dividend announcements from investify.pk..." banner

### Issue 20 - Replace "Total Payout" with "Maximum Dividend"
- Removed the "Total payout (PKR)" KPI card
- Added "Maximum dividend" KPI card showing the max PKR dividend amount + the symbol that paid it

### Issue 20 - Replace "Ex Dividend Date" with "Last Date to Buy/Hold"
- All dividend card badges that said "Ex-date: ..." now say "Last date to buy/hold: ..."
- Added a CalendarClock icon to the badge for clarity
- The alert banner also says "last date to buy/hold" instead of ex-date

### Issue 20 - Remove Signal and Watch Buttons
- Removed the `Button` for "+ Watch" from dividend cards
- Removed the `Button` for "Signal" with ArrowRight icon
- Removed the now-unused imports: `Button`, `ArrowRight`
- Removed the `setView` and `addPosition` from `useLatentStore` (no longer used)

### Issue 20 - Bell Icon Turns Yellow When Clicked
- Added `alerts` state: `useState<Set<string>>(new Set())` — tracks which symbols have active alerts
- Added `toggleAlert(symbol)` function — adds/removes from alerts Set, fires a pushNotification + toast
- The bell button:
  - Default state: grey (`text-[#64748B]`) with `Bell` icon
  - Active state: yellow (`text-[#FBBF24]`) with `BellRing` icon and a yellow-tinted background
  - Card border also turns yellow when alert is active (`border-[#FBBF24]/40`)
- When alert is active, a banner appears at the bottom of the card:
  - "Alert active: You'll be notified before {symbol}'s last date to buy/hold (date) so you can position for the dividend."
- Bell button has `aria-label` and `aria-pressed` for accessibility

### Other
- Removed unused `MOCK_STOCKS` import (no longer needed)
- Added `Loader2` and `CalendarClock` and `TrendingUp` to lucide-react imports
- Updated disclaimer at the bottom to explain the live fetch, the parsing, and the bell icon behavior

## Commit
- Commit: `Issue 20: Dividends - StockSearch filter, show ALL companies from PSX API, max dividend replaces total payout, last date to buy/hold label, bell icon turns yellow on alert`
- File: `src/components/latent/Dividends.tsx`
