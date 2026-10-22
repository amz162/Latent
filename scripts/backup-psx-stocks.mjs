/**
 * Latent.pk — PSX market backup script
 *
 * Fetches all 1,048+ PSX-listed securities from psxdata-api.fastapicloud.dev
 * and saves them to the local SQLite database (Stock, Sector, StockSnapshot).
 *
 * Strategy (3 passes, ~60-90s total):
 *   1. /sectors       →  38 sectors  (bulk, 1 request)
 *   2. /screener      →  750 stocks  (bulk, 1 request, full fundamentals)
 *   3. /stocks + /quote → ~298 remaining symbols (TFCs/Sukuks not in screener)
 *                          fetched in batches of 8 parallel
 *
 * Usage:
 *   bun run scripts/backup-psx-stocks.mjs                 # full sync
 *   bun run scripts/backup-psx-stocks.mjs --sectors      # sectors only
 *   bun run scripts/backup-psx-stocks.mjs --screener     # screener only
 *   bun run scripts/backup-psx-stocks.mjs --quotes       # individual quotes only
 *   bun run scripts/backup-psx-stocks.mjs --snapshot     # capture a StockSnapshot row for every existing stock
 */

import { PrismaClient } from "@prisma/client";

const BASE_URL = "https://psxdata-api.fastapicloud.dev";
const prisma = new PrismaClient({ log: ["warn", "error"] });
const CONCURRENCY = 8;
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

async function fetchJson(path, timeoutMs = 30000) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Accept: "application/json", "User-Agent": "LatentBot/1.0" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  const json = await res.json();
  return json?.data ?? null;
}

async function syncSectors() {
  log("Fetching /sectors ...");
  const sectors = await fetchJson("/sectors");
  if (!Array.isArray(sectors)) throw new Error("/sectors did not return an array");
  let n = 0;
  for (const s of sectors) {
    if (!s?.sector_code || !s?.sector_name) continue;
    await prisma.sector.upsert({
      where: { code: String(s.sector_code) },
      create: {
        code: String(s.sector_code),
        name: String(s.sector_name),
        advance: Number(s.advance ?? 0),
        decline: Number(s.decline ?? 0),
        unchanged: Number(s.unchanged ?? 0),
        turnover: s.turnover != null ? Number(s.turnover) : null,
        marketCapB: s.market_cap_b != null ? Number(s.market_cap_b) : null,
        lastSyncedAt: new Date(),
      },
      update: {
        name: String(s.sector_name),
        advance: Number(s.advance ?? 0),
        decline: Number(s.decline ?? 0),
        unchanged: Number(s.unchanged ?? 0),
        turnover: s.turnover != null ? Number(s.turnover) : null,
        marketCapB: s.market_cap_b != null ? Number(s.market_cap_b) : null,
        lastSyncedAt: new Date(),
      },
    });
    n++;
  }
  log(`✓ Saved ${n} sectors`);
  return n;
}

async function syncScreener() {
  log("Fetching /screener ...");
  const rows = await fetchJson("/screener", 60000);
  if (!Array.isArray(rows)) throw new Error("/screener did not return an array");
  let n = 0;
  const now = new Date();
  for (const r of rows) {
    if (!r?.symbol) continue;
    const sectorCode = r.sector != null ? String(r.sector) : null;
    // Resolve sector code → if the sector row doesn't exist yet, skip the FK
    // (we already synced sectors above; if missing here it's because the
    // upstream sector value was a float like 813.0 instead of "0813" — we
    // normalise by left-padding to 4 chars to match sector codes).
    const normalizedSectorCode = sectorCode != null ? sectorCode.padStart(4, "0") : null;

    await prisma.stock.upsert({
      where: { symbol: String(r.symbol) },
      create: {
        symbol: String(r.symbol),
        name: String(r.symbol),
        sectorCode: normalizedSectorCode,
        listedIn: r.listed_in != null ? String(r.listed_in) : null,
        price: r.price != null ? Number(r.price) : null,
        marketCap: r.market_cap != null ? Number(r.market_cap) : null,
        peRatio: r.pe_ratio != null ? Number(r.pe_ratio) : null,
        divYield: r.dividend_yield != null ? Number(r.dividend_yield) : null,
        freeFloat: r.free_float != null ? Number(r.free_float) : null,
        volume30d: r.volume_avg_30d != null ? Number(r.volume_avg_30d) : null,
        change1yPct: r.change_1y_pct != null ? Number(r.change_1y_pct) : null,
        source: "psxdata",
        lastSyncedAt: now,
      },
      update: {
        sectorCode: normalizedSectorCode,
        listedIn: r.listed_in != null ? String(r.listed_in) : null,
        price: r.price != null ? Number(r.price) : null,
        marketCap: r.market_cap != null ? Number(r.market_cap) : null,
        peRatio: r.pe_ratio != null ? Number(r.pe_ratio) : null,
        divYield: r.dividend_yield != null ? Number(r.dividend_yield) : null,
        freeFloat: r.free_float != null ? Number(r.free_float) : null,
        volume30d: r.volume_avg_30d != null ? Number(r.volume_avg_30d) : null,
        change1yPct: r.change_1y_pct != null ? Number(r.change_1y_pct) : null,
        source: "psxdata",
        lastSyncedAt: now,
      },
    });
    n++;
  }
  log(`✓ Saved ${n} stocks from screener`);
  return n;
}

async function syncRemainingQuotes() {
  log("Fetching /stocks (master symbol list) ...");
  const all = await fetchJson("/stocks");
  if (!Array.isArray(all)) throw new Error("/stocks did not return an array");
  log(`  → ${all.length} symbols on PSX`);

  // Which symbols do we already have (from screener pass)?
  const existing = new Set(
    (await prisma.stock.findMany({ select: { symbol: true } })).map((s) => s.symbol)
  );
  const missing = all.filter((s) => !existing.has(String(s)));
  log(`  → ${missing.length} symbols not yet in DB (fetching /quote for each in batches of ${CONCURRENCY})`);

  let ok = 0, fail = 0, started = 0;
  const t0 = Date.now();
  // Process in chunks of CONCURRENCY
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const batch = missing.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (sym) => {
        const q = await fetchJson(`/stocks/${encodeURIComponent(sym)}/quote`, 15000);
        return { sym: String(sym), q };
      })
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const sym = String(batch[j]);
      started++;
      // Quote fetch failed (404 for TFCs/Sukuks, or network error).
      // Still insert the symbol row so DB has the full 1,048 master list.
      if (r.status !== "fulfilled" || !r.value?.q) {
        try {
          await prisma.stock.upsert({
            where: { symbol: sym },
            create: { symbol: sym, name: sym, source: "psxdata-noquote", lastSyncedAt: new Date() },
            update: { source: "psxdata-noquote", lastSyncedAt: new Date() },
          });
        } catch (e) { /* ignore */ }
        fail++;
        continue;
      }
      const { q } = r.value;
      // normalize symbol (strip trailing XD for dividend adjustments)
      let normalized = sym;
      if (typeof q.symbol === "string" && q.symbol.toUpperCase().endsWith("XD")) {
        normalized = q.symbol.slice(0, -2);
      }
      try {
        await prisma.stock.upsert({
          where: { symbol: sym },
          create: {
            symbol: sym,
            name: sym,
            price: typeof q.price === "number" ? q.price : null,
            marketCap: q.market_cap != null ? Number(q.market_cap) : null,
            peRatio: q.pe_ratio != null ? Number(q.pe_ratio) : null,
            divYield: q.dividend_yield != null ? Number(q.dividend_yield) : null,
            freeFloat: q.free_float != null ? Number(q.free_float) : null,
            volume30d: q.volume_avg_30d != null ? Number(q.volume_avg_30d) : null,
            change1yPct: q.change_1y_pct != null ? Number(q.change_1y_pct) : null,
            ldcp: q.ldcp != null ? Number(q.ldcp) : null,
            change: q.change != null ? Number(q.change) : null,
            changePct: q.change_pct != null ? Number(q.change_pct) : null,
            source: "psxdata",
            lastSyncedAt: new Date(),
          },
          update: {
            price: typeof q.price === "number" ? q.price : null,
            marketCap: q.market_cap != null ? Number(q.market_cap) : null,
            peRatio: q.pe_ratio != null ? Number(q.pe_ratio) : null,
            divYield: q.dividend_yield != null ? Number(q.dividend_yield) : null,
            freeFloat: q.free_float != null ? Number(q.free_float) : null,
            volume30d: q.volume_avg_30d != null ? Number(q.volume_avg_30d) : null,
            change1yPct: q.change_1y_pct != null ? Number(q.change_1y_pct) : null,
            ldcp: q.ldcp != null ? Number(q.ldcp) : null,
            change: q.change != null ? Number(q.change) : null,
            changePct: q.change_pct != null ? Number(q.change_pct) : null,
            source: "psxdata",
            lastSyncedAt: new Date(),
          },
        });
        ok++;
      } catch (e) {
        fail++;
      }
    }
    if (started % 40 === 0 || started === missing.length) {
      const pct = ((started / missing.length) * 100).toFixed(1);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      log(`  progress: ${started}/${missing.length} (${pct}%) ok=${ok} fail=${fail} elapsed=${elapsed}s`);
    }
  }
  log(`✓ Saved ${ok} additional quotes (${fail} failed)`);
  return { ok, fail, total: all.length };
}

async function captureSnapshot() {
  const stocks = await prisma.stock.findMany({
    select: { symbol: true, price: true, marketCap: true, peRatio: true, divYield: true, volume30d: true, change: true, changePct: true },
  });
  if (stocks.length === 0) { log("No stocks to snapshot. Run --screener / --quotes first."); return; }
  const now = new Date();
  await prisma.stockSnapshot.createMany({
    data: stocks.filter(s => s.price != null).map((s) => ({
      symbol: s.symbol,
      price: s.price,
      marketCap: s.marketCap,
      peRatio: s.peRatio,
      divYield: s.divYield,
      volume30d: s.volume30d,
      change: s.change,
      changePct: s.changePct,
      capturedAt: now,
    })),
  });
  log(`✓ Captured ${stocks.filter(s => s.price != null).length} snapshots`);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const only = (k) => args.has(k);
  const doAll = !only("--sectors") && !only("--screener") && !only("--quotes") && !only("--snapshot");
  const t0 = Date.now();
  try {
    if (doAll || only("--sectors")) await syncSectors();
    if (doAll || only("--screener")) await syncScreener();
    if (doAll || only("--quotes")) await syncRemainingQuotes();
    if (only("--snapshot")) await captureSnapshot();

    // Final summary
    const [stockCount, sectorCount, snapCount] = await Promise.all([
      prisma.stock.count(),
      prisma.sector.count(),
      prisma.stockSnapshot.count(),
    ]);
    log("════════════════════════════════════════════════════════════");
    log(`  DB now holds:`);
    log(`    • ${sectorCount} sectors`);
    log(`    • ${stockCount} stocks (target ≥ 1,000)`);
    log(`    • ${snapCount} historical snapshots`);
    log(`  Total time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    log("════════════════════════════════════════════════════════════");
  } catch (e) {
    console.error("FATAL:", e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
