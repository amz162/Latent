const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const BASE = __dirname;
const STATIC = path.join(BASE, '.next', 'standalone', '.next', 'static');
const HTML = path.join(BASE, '.next', 'standalone', '.next', 'server', 'app');
const PUBLIC = path.join(BASE, 'public');

const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2','.map':'application/json'};
const cache = new Map();

async function fetchJson(u) {
  const c = cache.get(u);
  if (c && Date.now()-c.ts < 60000) return c.d;
  try {
    const r = await fetch(u, {headers:{'User-Agent':'LatentBot/1.0'},signal:AbortSignal.timeout(15000)});
    const j = await r.json();
    const d = j?.data ?? j;
    cache.set(u,{d,ts:Date.now()});
    return d;
  } catch { return null; }
}

function serveFile(res, filePath) {
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      res.writeHead(200, {'Content-Type': MIME[ext]||'application/octet-stream', 'Cache-Control': 'public, max-age=3600'});
      fs.createReadStream(filePath).pipe(res);
      return true;
    }
  } catch {}
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  
  res.setHeader('Access-Control-Allow-Origin','*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // API routes
  if (p === '/api/psx/live') {
    const sym = (url.searchParams.get('symbol')||'KSE100').toUpperCase();
    if (sym === 'KSE100') {
      const d = await fetchJson('https://psxdata-api.fastapicloud.dev/indices/KSE100');
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({symbol:'KSE100',constituents:(d||[]).slice(0,10),count:(d||[]).length,mode:'live'}));
      return;
    }
    const d = await fetchJson(`https://psxdata-api.fastapicloud.dev/stocks/${encodeURIComponent(sym)}/quote`);
    if (d && typeof d.price === 'number') {
      if (typeof d.symbol === 'string' && d.symbol.toUpperCase().endsWith('XD')) d.symbol = d.symbol.slice(0,-2);
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({...d,close:d.price,mode:'live',timestamp:new Date().toISOString()}));
    } else { res.writeHead(404); res.end(JSON.stringify({error:`No data for ${sym}`})); }
    return;
  }
  if (p === '/api/psx/companies') {
    const plain = url.searchParams.get('plain')==='1';
    const stocks = await fetchJson('https://psxdata-api.fastapicloud.dev/stocks')||[];
    if (plain) { res.writeHead(200); res.end(JSON.stringify({companies:stocks,count:stocks.length,source:'psxdata'})); return; }
    const sc = await fetchJson('https://psxdata-api.fastapicloud.dev/screener')||[];
    const m = new Map(); for (const s of sc) if (s.symbol) m.set(s.symbol.toUpperCase(),s);
    const companies = stocks.map(s => { const x = m.get(s.toUpperCase()); return {value:s,label:s,sector:x?.sector??null,price:x?.price??null,pe_ratio:x?.pe_ratio??null}; });
    res.writeHead(200); res.end(JSON.stringify({companies,count:companies.length,source:'psxdata'}));
    return;
  }
  if (p === '/api/psx/sectors') { const d = await fetchJson('https://psxdata-api.fastapicloud.dev/sectors')||[]; res.writeHead(200); res.end(JSON.stringify({sectors:d,count:d.length})); return; }
  if (p === '/api/psx/screener') { const d = await fetchJson('https://psxdata-api.fastapicloud.dev/screener')||[]; res.writeHead(200); res.end(JSON.stringify({stocks:d,count:d.length})); return; }
  if (p === '/api/psx/indices') { const d = await fetchJson('https://psxdata-api.fastapicloud.dev/indices')||[]; res.writeHead(200); res.end(JSON.stringify({indices:d,count:d.length})); return; }
  if (p === '/api/psx/ohlcv' && url.searchParams.get('symbol')) {
    const sym = url.searchParams.get('symbol').toUpperCase();
    try {
      const t = fs.readFileSync(path.join(BASE,'data','ohlcv_all',`${sym}.csv`),'utf-8');
      const ohlcv = t.trim().split('\n').slice(1).map(l=>{const p=l.split(',');return{date:parseInt(p[0]),open:parseFloat(p[1]),high:parseFloat(p[2]),low:parseFloat(p[3]),close:parseFloat(p[4]),volume:parseFloat(p[5])};}).filter(r=>!isNaN(r.date));
      res.writeHead(200); res.end(JSON.stringify({symbol:sym,source:'local-cache',rowsCount:ohlcv.length,ohlcv}));
    } catch {
      const d = await fetchJson(`https://psxdata-api.fastapicloud.dev/stocks/${encodeURIComponent(sym)}/historical`);
      if (Array.isArray(d)) {
        const ohlcv = d.slice().reverse().map(b=>({date:Date.parse(b.date),open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume}));
        res.writeHead(200); res.end(JSON.stringify({symbol:sym,source:'psxdata',rowsCount:ohlcv.length,ohlcv}));
      } else { res.writeHead(404); res.end(JSON.stringify({error:`No data for ${sym}`})); }
    }
    return;
  }
  if (p === '/api/signals/all') {
    try {
      const pr = JSON.parse(fs.readFileSync(path.join(BASE,'data','ml_predictions_multi.json'),'utf-8'));
      const cl = pr.cl_ensemble_predictions||{};
      const sig = Object.entries(cl).map(([s,p]) => { if (!p||p.signal==='HOLD'||!p.entry) return null; const t=p.tp3||p.entry; return {symbol:s,signal:p.signal,direction:p.direction||'LONG',confidence:p.confidence||0,currentPrice:p.currentPrice||p.entry,entry:p.entry,sl:p.sl,tp1:p.tp1,tp2:p.tp2,tp3:p.tp3,retPct:((t-p.entry)/p.entry)*100}; }).filter(Boolean).sort((a,b)=>Math.abs(b.retPct)-Math.abs(a.retPct));
      res.writeHead(200); res.end(JSON.stringify({signals:sig,count:sig.length}));
    } catch(e) { res.writeHead(200); res.end(JSON.stringify({signals:[],count:0,error:e.message})); }
    return;
  }
  if (p === '/api/simulate') {
    try {
      const pr = JSON.parse(fs.readFileSync(path.join(BASE,'data','ml_predictions_multi.json'),'utf-8'));
      const eb = pr.ensemble_backtesting||{};
      const results = Object.entries(eb).map(([n,b])=>({name:n.replace(/_/g,' '),totalTrades:b.totalTrades,winRate:b.winRate})).sort((a,b)=>(b.winRate||0)-(a.winRate||0));
      res.writeHead(200); res.end(JSON.stringify({amount:parseInt(url.searchParams.get('amount')||'100000'),results,count:results.length}));
    } catch(e) { res.writeHead(200); res.end(JSON.stringify({results:[],count:0})); }
    return;
  }

  // Static files — try multiple directories
  let fp = p === '/' ? '/index.html' : p;
  
  // 1. Try public/ directory
  if (serveFile(res, path.join(PUBLIC, fp))) return;
  
  // 2. Try pre-rendered HTML from .next/server/app/
  if (fp.endsWith('.html') || fp === '/index.html') {
    const htmlPath = path.join(HTML, fp === '/index.html' ? 'index.html' : fp);
    if (serveFile(res, htmlPath)) return;
  }
  
  // 3. Try _next/static/ (JS chunks, CSS)
  if (fp.startsWith('/_next/static/')) {
    const staticPath = path.join(STATIC, fp.replace('/_next/static/',''));
    if (serveFile(res, staticPath)) return;
  }
  
  // 4. Try _next/ (other Next.js assets)
  if (fp.startsWith('/_next/')) {
    const nextPath = path.join(BASE, '.next', 'standalone', '.next', fp.replace('/_next/',''));
    if (serveFile(res, nextPath)) return;
    // Try without _next prefix
    const nextPath2 = path.join(STATIC, fp.replace('/_next/',''));
    if (serveFile(res, nextPath2)) return;
  }
  
  // 5. Fallback to index.html
  if (serveFile(res, path.join(HTML, 'index.html'))) return;

  res.writeHead(404, {'Content-Type':'text/plain'});
  res.end('Not found: ' + p);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Latent.pk running on http://0.0.0.0:${PORT} | RSS: ${Math.round(process.memoryUsage().rss/1024/1024)}MB`);
});

process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
