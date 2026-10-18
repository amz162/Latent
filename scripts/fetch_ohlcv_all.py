#!/usr/bin/env python3
"""Fetch 10-year OHLCV for ALL 361 PSX stocks from askanalyst.com.pk"""
import json,time,sys,urllib.request,urllib.error
from pathlib import Path
OUT=Path("data/ohlcv_all");OUT.mkdir(parents=True,exist_ok=True)
TO=int(time.time()*1000);FROM=TO-10*365*24*60*60*1000
def fetch_companies():
 req=urllib.request.Request("https://api.askanalyst.com.pk/api/companylistwithsymbols",headers={"User-Agent":"Mozilla/5.0"})
 with urllib.request.urlopen(req,timeout=30)as r:return json.loads(r.read().decode())
def fetch_ohlcv(sym):
 url=f"https://api.askanalyst.com.pk/api/technicalchart/day/{FROM}/{TO}/{sym}"
 req=urllib.request.Request(url,headers={"User-Agent":"LatentBot/1.0"})
 with urllib.request.urlopen(req,timeout=60)as r:return r.read().decode("utf-8")
def main():
 if len(sys.argv)>=3 and sys.argv[1]=="--symbol":
  sym=sys.argv[2].upper();csv=fetch_ohlcv(sym);(OUT/f"{sym}.csv").write_text(csv);print(f"{sym}: {len(csv.strip().split(chr(10)))-1} rows");return
 companies=fetch_companies();s=f=0
 for i,c in enumerate(companies,1):
  sym=(c.get("value")or c.get("symbol")or"").strip()
  if not sym:continue
  p=OUT/f"{sym}.csv"
  if p.exists()and(time.time()-p.stat().st_mtime)<86400:continue
  try:csv=fetch_ohlcv(sym);p.write_text(csv);s+=1;time.sleep(0.3)
  except Exception as e:f+=1
  if i%25==0:print(f"[{i}/{len(companies)}] {sym} OK",flush=True)
 print(f"Done: {s} fetched, {f} failed, {len(list(OUT.glob('*.csv')))} total")
if __name__=="__main__":main()
