#!/usr/bin/env python3
"""Simple Python server for Latent.pk — serves static files + APIs."""
import http.server, json, os, urllib.request, urllib.parse, time, csv, io
from pathlib import Path

PORT = 3000
BASE = Path(__file__).parent
STATIC = BASE / ".next" / "standalone" / ".next" / "static"
HTML_DIR = BASE / ".next" / "standalone" / ".next" / "server" / "app"
PRED_FILE = BASE / "data" / "ml_predictions_multi.json"
OHLCV_DIR = BASE / "data" / "ohlcv_all"

MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css',
        '.json':'application/json','.png':'image/png','.svg':'image/svg+xml',
        '.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2',
        '.map':'application/json','.txt':'text/plain'}

_cache = {}
def fetch_json(url):
    c = _cache.get(url)
    if c and (time.time() - c[1]) < 60: return c[0]
    try:
        req = urllib.request.Request(url, headers={'User-Agent':'LatentBot/1.0'})
        with urllib.request.urlopen(req, timeout=15) as r:
            d = json.loads(r.read().decode())
            result = d.get('data', d) if isinstance(d, dict) else d
            _cache[url] = (result, time.time())
            return result
    except: return None

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin','*')
        self.end_headers()
    
    def do_GET(self):
        try:
            self._handle()
        except Exception as e:
            try:
                self.send_response(500)
                self.send_header('Content-Type','application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'error':str(e)}).encode())
            except: pass
    
    def _handle(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        q = urllib.parse.parse_qs(parsed.query)
        
        self.send_header('Access-Control-Allow-Origin','*')
        
        # API routes
        if path == '/api/psx/live':
            sym = (q.get('symbol',['KSE100'])[0]).upper()
            if sym == 'KSE100':
                d = fetch_json('https://psxdata-api.fastapicloud.dev/indices/KSE100') or []
                return self._json({'symbol':'KSE100','constituents':d[:10],'count':len(d),'mode':'live'})
            d = fetch_json(f'https://psxdata-api.fastapicloud.dev/stocks/{urllib.parse.quote(sym)}/quote')
            if d and isinstance(d.get('price'),(int,float)):
                if isinstance(d.get('symbol'),str) and d['symbol'].upper().endswith('XD'):
                    d['symbol'] = d['symbol'][:-2]
                return self._json({**d,'close':d['price'],'mode':'live','timestamp':time.strftime('%Y-%m-%dT%H:%M:%S')})
            return self._json({'error':f'No data for {sym}'},404)
        
        if path == '/api/psx/companies':
            stocks = fetch_json('https://psxdata-api.fastapicloud.dev/stocks') or []
            plain = q.get('plain',['0'])[0]=='1'
            if plain: return self._json({'companies':stocks,'count':len(stocks),'source':'psxdata'})
            sc = fetch_json('https://psxdata-api.fastapicloud.dev/screener') or []
            sm = {s.get('symbol','').upper():s for s in sc if s.get('symbol')}
            comps = [{'value':s,'label':s,'sector':sm.get(s.upper(),{}).get('sector'),
                      'price':sm.get(s.upper(),{}).get('price'),
                      'pe_ratio':sm.get(s.upper(),{}).get('pe_ratio')} for s in stocks]
            return self._json({'companies':comps,'count':len(comps),'source':'psxdata'})
        
        if path == '/api/psx/sectors':
            d = fetch_json('https://psxdata-api.fastapicloud.dev/sectors') or []
            return self._json({'sectors':d,'count':len(d)})
        
        if path == '/api/psx/screener':
            d = fetch_json('https://psxdata-api.fastapicloud.dev/screener') or []
            return self._json({'stocks':d,'count':len(d)})
        
        if path == '/api/psx/indices':
            d = fetch_json('https://psxdata-api.fastapicloud.dev/indices') or []
            return self._json({'indices':d,'count':len(d)})
        
        if path == '/api/psx/ohlcv' and 'symbol' in q:
            sym = q['symbol'][0].upper()
            try:
                with open(OHLCV_DIR/f'{sym}.csv') as f:
                    rows = list(csv.DictReader(f))
                ohlcv = [{'date':int(r['date']),'open':float(r.get('open',0) or 0),'high':float(r.get('high',0) or 0),
                          'low':float(r.get('low',0) or 0),'close':float(r.get('close',0) or 0),
                          'volume':float(r.get('volume',0) or 0)} for r in rows if r.get('date')]
                return self._json({'symbol':sym,'source':'local-cache','rowsCount':len(ohlcv),'ohlcv':ohlcv})
            except:
                d = fetch_json(f'https://psxdata-api.fastapicloud.dev/stocks/{urllib.parse.quote(sym)}/historical')
                if isinstance(d,list):
                    import datetime
                    ohlcv = [{'date':int(datetime.datetime.strptime(b.get('date',''),'%Y-%m-%d').timestamp()*1000),
                              'open':b.get('open',0),'high':b.get('high',0),'low':b.get('low',0),
                              'close':b.get('close',0),'volume':b.get('volume',0)} for b in reversed(d)]
                    return self._json({'symbol':sym,'source':'psxdata','rowsCount':len(ohlcv),'ohlcv':ohlcv})
                return self._json({'error':f'No data for {sym}'},404)
        
        if path == '/api/signals/all':
            try:
                with open(PRED_FILE) as f: preds = json.load(f)
                cl = preds.get('cl_ensemble_predictions',{})
                sigs = []
                for s,p in cl.items():
                    if not p or p.get('signal')=='HOLD' or not p.get('entry'): continue
                    t = p.get('tp3',p['entry'])
                    sigs.append({'symbol':s,'signal':p['signal'],'direction':p.get('direction','LONG'),
                                 'confidence':p.get('confidence',0),'currentPrice':p.get('currentPrice',p['entry']),
                                 'entry':p['entry'],'sl':p.get('sl'),'tp1':p.get('tp1'),'tp2':p.get('tp2'),
                                 'tp3':p.get('tp3'),'retPct':((t-p['entry'])/p['entry'])*100})
                sigs.sort(key=lambda x:abs(x['retPct']),reverse=True)
                return self._json({'signals':sigs,'count':len(sigs)})
            except Exception as e:
                return self._json({'signals':[],'count':0,'error':str(e)})
        
        if path == '/api/simulate':
            try:
                with open(PRED_FILE) as f: preds = json.load(f)
                eb = preds.get('ensemble_backtesting',{})
                results = [{'name':n.replace('_',' '),'totalTrades':b.get('totalTrades',0),
                            'winRate':b.get('winRate',0)} for n,b in eb.items()]
                results.sort(key=lambda x:x.get('winRate',0),reverse=True)
                return self._json({'amount':int(q.get('amount',['100000'])[0]),'results':results,'count':len(results)})
            except:
                return self._json({'results':[],'count':0})
        
        if path == '/api/cron/scheduler-status':
            return self._json({'scheduler_installed':True,'scheduler_running':False,'market_status':'CLOSED'})
        
        # Static files
        fp = '/index.html' if path == '/' else path
        
        # Try HTML dir
        for d in [HTML_DIR, STATIC, BASE/'public', BASE/'.next'/'standalone'/'.next']:
            fp2 = d / fp.lstrip('/')
            if fp2.is_file():
                return self._file(fp2)
        
        # Try _next paths
        if fp.startswith('/_next/'):
            for d in [STATIC, BASE/'.next'/'standalone'/'.next']:
                fp2 = d / fp.replace('/_next/','')
                if fp2.is_file():
                    return self._file(fp2)
        
        # Fallback to index.html
        idx = HTML_DIR / 'index.html'
        if idx.is_file():
            return self._file(idx)
        
        self.send_error(404, f'Not found: {path}')
    
    def _json(self, data, code=200):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    
    def _file(self, fp):
        ext = fp.suffix
        data = fp.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', MIME.get(ext,'application/octet-stream'))
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control','public, max-age=3600')
        self.end_headers()
        self.wfile.write(data)

class Server(http.server.ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

print(f'Latent.pk on :{PORT}')
Server(('0.0.0.0', PORT), Handler).serve_forever()
