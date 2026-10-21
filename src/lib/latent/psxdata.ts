/**
 * psxdata API client — minimal version for production build.
 * Fetches from https://psxdata-api.fastapicloud.dev with caching.
 */

const BASE_URL = "https://psxdata-api.fastapicloud.dev";

const cache = new Map<string, { value: any; expiresAt: number }>();

async function fetchJson(path: string, timeoutMs: number = 15000): Promise<any | null> {
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
    return json?.data ?? null;
  } catch { return null; }
}

export interface PsxQuote {
  symbol: string; price: number; market_cap: number | null;
  pe_ratio: number | null; dividend_yield: number | null;
  free_float: number | null; volume_avg_30d: number | null;
  change_1y_pct: number | null; ldcp: number | null;
  change: number | null; change_pct: number | null;
}

export async function getQuote(symbol: string): Promise<PsxQuote | null> {
  const data = await fetchJson(`/stocks/${encodeURIComponent(symbol.toUpperCase())}/quote`);
  if (!data || typeof data.price !== "number") return null;
  if (typeof data.symbol === "string" && data.symbol.toUpperCase().endsWith("XD"))
    data.symbol = data.symbol.slice(0, -2);
  return data;
}

export async function getHistorical(symbol: string): Promise<any[] | null> {
  const data = await fetchJson(`/stocks/${encodeURIComponent(symbol.toUpperCase())}/historical`, 30000);
  return Array.isArray(data) ? data : null;
}

export async function getAllStocks(): Promise<string[]> {
  const data = await fetchJson(`/stocks`);
  return Array.isArray(data) ? data : [];
}

export async function getSectors(): Promise<any[]> {
  const data = await fetchJson(`/sectors`);
  return Array.isArray(data) ? data : [];
}

export async function getSectorStocks(sectorName: string): Promise<string[]> {
  const data = await fetchJson(`/sectors/${encodeURIComponent(sectorName)}/stocks`);
  return Array.isArray(data) ? data : [];
}

export async function getIndices(): Promise<string[]> {
  const data = await fetchJson(`/indices`);
  return Array.isArray(data) ? data : [];
}

export async function getIndexConstituents(indexName: string): Promise<any[]> {
  const data = await fetchJson(`/indices/${encodeURIComponent(indexName)}`);
  return Array.isArray(data) ? data : [];
}

export async function getScreener(): Promise<any[]> {
  const data = await fetchJson(`/screener`, 30000);
  return Array.isArray(data) ? data : [];
}

export async function getFundamentals(symbol: string): Promise<any[] | null> {
  const data = await fetchJson(`/stocks/${encodeURIComponent(symbol.toUpperCase())}/fundamentals`);
  return Array.isArray(data) ? data : null;
}

export async function getHealth(): Promise<{ status: string } | null> {
  const data = await fetchJson(`/health`, 5000);
  return data && typeof data.status === "string" ? data : null;
}
