/**
 * psxdata API client — wraps https://psxdata-api.fastapicloud.dev
 *
 * This is the PRIMARY data source for PSX market data (replaces askanalyst).
 * Key advantages:
 *   - 1,048 stocks (vs 361 from askanalyst)
 *   - Rich quote data: PE ratio, dividend yield, market cap, 30-day volume,
 *     1-year change (none of which askanalyst provides)
 *   - Sector + index + screener endpoints
 *   - Faster response (~0.3s per quote vs 1-2s for askanalyst)
 *   - ENGRO works (askanalyst has been broken for ENGRO for 348+ days)
 *
 * All functions return the parsed JSON `data` field directly (no `meta`).
 * On error, they return null (caller should handle gracefully).
 *
 * In-memory cache (5 minutes for quotes, 1 hour for stock lists / sectors /
 * indices / screener) reduces calls to psxdata during heavy UI polling.
 */

const BASE_URL = "https://psxdata-api.fastapicloud.dev";
const DEFAULT_TIMEOUT_MS = 15_000;

// In-memory cache: key → { value, expiresAt }
const cache = new Map<string, { value: any; expiresAt: number }>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

function setCached<T>(key: string, value: T, ttlMs: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function fetchJson(path: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<any | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { "Accept": "application/json", "User-Agent": "LatentBot/1.0" },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    // psxdata wraps everything in { data: ..., meta: ... } — return data
    return json?.data ?? null;
  } catch {
    return null;
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

// 5-minute cache for quotes (real-time enough for UI polling, but not so
// aggressive that we hammer psxdata when the market is closed).
const QUOTE_TTL = 5 * 60 * 1000;
// 1-hour cache for stock lists / sectors / indices / screener (these change
// slowly — refresh once an hour is plenty).
const LIST_TTL = 60 * 60 * 1000;

export interface PsxQuote {
  symbol: string;
  price: number;
  market_cap: number | null;
  pe_ratio: number | null;
  dividend_yield: number | null;
  free_float: number | null;
  volume_avg_30d: number | null;
  change_1y_pct: number | null;
  ldcp: number | null;
  change: number | null;
  change_pct: number | null;
}

export interface PsxOhlcvBar {
  date: string; // ISO date "YYYY-MM-DD"
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  is_anomaly: boolean;
}

export interface PsxSector {
  sector_code: string;
  sector_name: string;
  advance: number;
  decline: number;
  unchanged: number;
  turnover: number;
  market_cap_b: number;
}

export interface PsxIndexConstituent {
  symbol: string;
  current_index: number;
  idx_weight: number;
  idx_point: number;
  market_cap_m: number;
  freefloat_m: number | null;
  shares_m: number | null;
}

export interface PsxScreenerRow {
  symbol: string;
  sector: number | null;
  listed_in: string | null;
  market_cap: number | null;
  price: number | null;
  pe_ratio: number | null;
  dividend_yield: number | null;
  free_float: number | null;
  volume_avg_30d: number | null;
  change_1y_pct: number | null;
}

export interface PsxFundamentalsRow {
  symbol: string;
  year: string;
  type: string;
  period_ended: string;
  posting_date: string;
  document: string;
}

/**
 * Get a real-time quote for a single stock.
 * Returns: { symbol, price, pe_ratio, dividend_yield, market_cap,
 *            free_float, volume_avg_30d, change_1y_pct, ldcp, change,
 *            change_pct }
 * Cached for 5 minutes.
 */
export async function getQuote(symbol: string): Promise<PsxQuote | null> {
  const sym = symbol.toUpperCase().trim();
  const cacheKey = `quote:${sym}`;
  const cached = getCached<PsxQuote>(cacheKey);
  if (cached) return cached;
  const data = await fetchJson(`/stocks/${encodeURIComponent(sym)}/quote`);
  if (!data || typeof data.price !== "number") return null;
  // psxdata sometimes returns the symbol with an "XD" suffix (ex-dividend
  // marker) — strip it for consistency with our internal symbol format.
  if (typeof data.symbol === "string" && data.symbol.toUpperCase().endsWith("XD")) {
    data.symbol = data.symbol.slice(0, -2);
  }
  setCached(cacheKey, data, QUOTE_TTL);
  return data;
}

/**
 * Get full OHLCV history for a single stock (going back to ~2016).
 * Returns bars sorted NEWEST FIRST (date 2026-10-20 at index 0).
 * NOT cached — historical data is large and not requested often.
 */
export async function getHistorical(symbol: string, start?: string, end?: string): Promise<PsxOhlcvBar[] | null> {
  const sym = symbol.toUpperCase().trim();
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  const qs = params.toString();
  const path = `/stocks/${encodeURIComponent(sym)}/historical${qs ? "?" + qs : ""}`;
  const data = await fetchJson(path, 30_000); // 30s for big history fetches
  if (!Array.isArray(data)) return null;
  return data;
}

/**
 * Get the list of ALL 1,048 PSX stock symbols.
 * Cached for 1 hour.
 */
export async function getAllStocks(): Promise<string[]> {
  const cached = getCached<string[]>("stocks");
  if (cached) return cached;
  const data = await fetchJson(`/stocks`, 15_000);
  if (!Array.isArray(data)) return [];
  setCached("stocks", data, LIST_TTL);
  return data;
}

/**
 * Get all 38 sectors with advance/decline/turnover/market_cap.
 * Cached for 1 hour.
 */
export async function getSectors(): Promise<PsxSector[]> {
  const cached = getCached<PsxSector[]>("sectors");
  if (cached) return cached;
  const data = await fetchJson(`/sectors`, 15_000);
  if (!Array.isArray(data)) return [];
  setCached("sectors", data, LIST_TTL);
  return data;
}

/**
 * Get all stocks in a given sector (by sector name).
 * Use the FULL sector name from /sectors (e.g. "OIL & GAS EXPLORATION COMPANIES").
 * Cached for 1 hour.
 */
export async function getSectorStocks(sectorName: string): Promise<string[]> {
  const cacheKey = `sector-stocks:${sectorName}`;
  const cached = getCached<string[]>(cacheKey);
  if (cached) return cached;
  const data = await fetchJson(`/sectors/${encodeURIComponent(sectorName)}/stocks`, 15_000);
  if (!Array.isArray(data)) return [];
  setCached(cacheKey, data, LIST_TTL);
  return data;
}

/**
 * Get the list of all 18 PSX indices.
 * Cached for 1 hour.
 */
export async function getIndices(): Promise<string[]> {
  const cached = getCached<string[]>("indices");
  if (cached) return cached;
  const data = await fetchJson(`/indices`, 15_000);
  if (!Array.isArray(data)) return [];
  setCached("indices", data, LIST_TTL);
  return data;
}

/**
 * Get constituents of a given index (e.g. "KSE100").
 * Returns: { symbol, idx_weight, idx_point, market_cap_m, freefloat_m, shares_m }
 * Cached for 1 hour.
 */
export async function getIndexConstituents(indexName: string): Promise<PsxIndexConstituent[]> {
  const cacheKey = `index:${indexName}`;
  const cached = getCached<PsxIndexConstituent[]>(cacheKey);
  if (cached) return cached;
  const data = await fetchJson(`/indices/${encodeURIComponent(indexName)}`, 15_000);
  if (!Array.isArray(data)) return [];
  setCached(cacheKey, data, LIST_TTL);
  return data;
}

/**
 * Get the screener data for 750 stocks (sector, listed_in, market_cap,
 * price, pe_ratio, dividend_yield, free_float, volume_avg_30d, change_1y_pct).
 * Cached for 1 hour.
 */
export async function getScreener(): Promise<PsxScreenerRow[]> {
  const cached = getCached<PsxScreenerRow[]>("screener");
  if (cached) return cached;
  const data = await fetchJson(`/screener`, 30_000);
  if (!Array.isArray(data)) return [];
  setCached("screener", data, LIST_TTL);
  return data;
}

/**
 * Get fundamentals (annual reports, financial statements) for a stock.
 * NOT cached — varies per stock.
 */
export async function getFundamentals(symbol: string): Promise<PsxFundamentalsRow[] | null> {
  const sym = symbol.toUpperCase().trim();
  const data = await fetchJson(`/stocks/${encodeURIComponent(sym)}/fundamentals`, 15_000);
  if (!Array.isArray(data)) return null;
  return data;
}

/**
 * Get the API liveness status.
 */
export async function getHealth(): Promise<{ status: string } | null> {
  const data = await fetchJson(`/health`, 5_000);
  if (!data || typeof data.status !== "string") return null;
  return data;
}
