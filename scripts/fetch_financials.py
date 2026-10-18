#!/usr/bin/env python3
"""Fetch income statements for ALL 361 PSX stocks from askanalyst.com.pk"""
import json,time,sys,urllib.request
from pathlib import Path
from datetime import datetime
OUT=Path("data/financials");OUT.mkdir(parents=True,exist_ok=True)
def fetch_companies():
 req=urllib.request.Request("https://api.askanalyst.com.pk/api/companylistwithsymbols",headers={"User-Agent":"Mozilla/5.0"})
 with urllib.request.urlopen(req,timeout=30)as r:return json.loads(r.read().decode())
def fetch_fin(sym):
 url=f"https://api.askanalyst.com.pk/api/incomestatement/{sym}"
 req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0"})
 with urllib.request.urlopen(req,timeout=30)as r:return json.loads(r.read().decode())
def main():
 companies=fetch_companies();s=f=0
 for i,c in enumerate(companies,1):
  sym=(c.get("value")or c.get("symbol")or"").strip()
  if not sym:continue
  p=OUT/f"{sym}.json"
  if p.exists()and(time.time()-p.stat().st_mtime)<86400:continue
  try:
   data=fetch_fin(sym);data["symbol"]=sym;data["company_name"]=c.get("label","");data["sector"]=c.get("sector","");data["fetched_at"]=datetime.now().isoformat()
   p.write_text(json.dumps(data,indent=2));s+=1;time.sleep(0.3)
  except Exception as e:f+=1
  if i%25==0:print(f"[{i}/{len(companies)}] {sym} OK",flush=True)
 print(f"Done: {s} fetched, {f} failed, {len(list(OUT.glob('*.json')))} total")
if __name__=="__main__":main()
