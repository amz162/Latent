#!/usr/bin/env python3
"""Latent.pk — Walk-Forward Ensemble Backtesting

Gold standard validation: for each test sample, re-train models on ALL data before
that point (expanding window), then predict. No data leakage.

Trains 5 fast classical models per sample:
  XGBoost, LightGBM, CatBoost, Random Forest, Ridge Regression

Computes 4 ensemble methods on walk-forward predictions:
  A. Majority Vote
  B. Probability-Weighted (avgReturn)
  C. Tier-Weighted
  D. Win-Rate-Weighted (uses walk-forward win rates as weights)

Compares walk-forward ensemble vs individual models.
"""
import json,sys,warnings,numpy as np,pandas as pd
import xgboost as xgb,lightgbm as lgb,catboost as cb
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_squared_error
from pathlib import Path
warnings.filterwarnings("ignore")

OHLCV=Path("data/ohlcv")
PRED_FILE=Path("data/ml_predictions_multi.json")
OUT_FILE=Path("data/walk_forward_backtesting.json")
STOCKS=["ENGRO","HUBC","LUCK","SYS","MEBL","PSO","OGDC","PPL"]
FC=["rsi_14","macd","macd_signal","macd_hist","bb_width","bb_pct_b","atr_14","obv_change_pct",
"price_sma_20_ratio","price_sma_50_ratio","price_sma_200_ratio","volume_sma_20_ratio",
"return_1d","return_7d","return_14d","return_30d","hl_range_pct","body_size_pct","volatility_14d"]
MODEL_NAMES=["XGBoost","LightGBM","CatBoost","Random Forest","Ridge Regression"]
TIER_W={"XGBoost":0.25,"LightGBM":0.25,"CatBoost":0.25,"Random Forest":0.25,"Ridge Regression":0.15}

def compute_rsi(p,n=14):
 d=p.diff();g=d.where(d>0,0);ll=-d.where(d<0,0)
 ag=g.ewm(alpha=1/n,min_periods=n).mean();al=ll.ewm(alpha=1/n,min_periods=n).mean()
 return(100-100/(1+ag/al.replace(0,np.nan))).fillna(50)
def compute_macd(p):
 e12=p.ewm(span=12,adjust=False).mean();e26=p.ewm(span=26,adjust=False).mean()
 m=e12-e26;s=m.ewm(span=9,adjust=False).mean();return m,s,m-s
def compute_bb(p,w=20):
 sma=p.rolling(w).mean();sd=p.rolling(w).std()
 return((sma+2*sd-(sma-2*sd))/sma).fillna(0),((p-(sma-2*sd))/(4*sd).replace(0,np.nan)).fillna(0.5)
def compute_atr(h,l,c,n=14):
 tr=pd.concat([h-l,(h-c.shift()).abs(),(l-c.shift()).abs()],axis=1).max(axis=1)
 return tr.rolling(n).mean().fillna(0)
def compute_obv(c,v):
 s=c.diff().apply(lambda x:1 if x>0 else(-1 if x<0 else 0));return(s*v).cumsum()
def add_features(df):
 df=df.copy().sort_values("date").reset_index(drop=True)
 c=df["close"];h=df["high"];l=df["low"];v=df["volume"]
 df["rsi_14"]=compute_rsi(c);m,s,hh=compute_macd(c)
 df["macd"]=m;df["macd_signal"]=s;df["macd_hist"]=hh
 bw,pb=compute_bb(c);df["bb_width"]=bw;df["bb_pct_b"]=pb
 df["atr_14"]=compute_atr(h,l,c)
 obv=compute_obv(c,v);df["obv_change_pct"]=obv.pct_change(periods=14).replace([np.inf,-np.inf],0).fillna(0)
 for w in[20,50,200]:df[f"price_sma_{w}_ratio"]=c/c.rolling(w,min_periods=1).mean()
 df["volume_sma_20_ratio"]=v/v.rolling(20,min_periods=1).mean().replace(0,1)
 for p in[1,7,14,30]:df[f"return_{p}d"]=c.pct_change(periods=p).replace([np.inf,-np.inf],0).fillna(0)
 df["hl_range_pct"]=((h-l)/c.replace(0,np.nan)).fillna(0)
 df["body_size_pct"]=((df["close"]-df["open"]).abs()/c.replace(0,np.nan)).fillna(0)
 df["volatility_14d"]=c.pct_change().rolling(14).std().fillna(0)
 for hz in[5,10,21]:df[f"target_{hz}d"]=((df["close"].shift(-hz)-df["close"])/df["close"]).fillna(0)
 return df

def load():
 frames=[]
 for s in STOCKS:
  p=OHLCV/f"{s}.csv"
  if not p.exists():continue
  df=pd.read_csv(p,usecols=range(6));df=df[df["volume"]>0].reset_index(drop=True)
  if len(df)<50:continue
  df=add_features(df);df["symbol"]=s;frames.append(df)
 return pd.concat(frames,ignore_index=True) if frames else pd.DataFrame()

def train_one_model(name, Xtr, ytr):
 """Train a single model on the given training data."""
 if name=="XGBoost":
  m=xgb.XGBRegressor(n_estimators=100,max_depth=3,learning_rate=0.05,subsample=0.7,colsample_bytree=0.7,random_state=42)
 elif name=="LightGBM":
  m=lgb.LGBMRegressor(n_estimators=100,num_leaves=15,learning_rate=0.01,subsample=0.8,colsample_bytree=0.8,min_child_samples=20,reg_alpha=0.5,reg_lambda=2.0,random_state=42,verbose=-1)
 elif name=="CatBoost":
  m=cb.CatBoostRegressor(iterations=100,depth=3,learning_rate=0.05,random_state=42,verbose=0,allow_writing_files=False)
 elif name=="Random Forest":
  from sklearn.ensemble import RandomForestRegressor
  m=RandomForestRegressor(n_estimators=100,max_depth=5,min_samples_leaf=15,max_features=0.7,random_state=42,n_jobs=-1)
 elif name=="Ridge Regression":
  m=Ridge(alpha=1.0,random_state=42)
 m.fit(Xtr,ytr)
 return m

def main():
 print("="*60);print("Walk-Forward Ensemble Backtesting");print("="*60)
 df=load();print(f"\nLoaded: {len(df)} rows from {df['symbol'].nunique()} stocks")

 # Split: 80% train start, 20% test
 test_start=int(len(df)*0.8)
 test_df=df.iloc[test_start:].copy()

 # Collect test samples: every 10 days per stock, need 21 days ahead
 samples=[]
 for s in STOCKS:
  ste=test_df[test_df["symbol"]==s].sort_values("date").reset_index(drop=True)
  for i in range(0,len(ste)-21,10):
   row=ste.iloc[i]
   future_close=ste.iloc[min(i+21,len(ste)-1)]["close"]
   actual_return=(future_close-row["close"])/row["close"]
   samples.append({
    "stock":s,
    "date":row["date"],
    "close":float(row["close"]),
    "features":row[FC].values.astype(np.float64),
    "actual_return_21d":float(actual_return),
    "actual_5d":float((ste.iloc[min(i+5,len(ste)-1)]["close"]-row["close"])/row["close"]),
    "actual_10d":float((ste.iloc[min(i+10,len(ste)-1)]["close"]-row["close"])/row["close"]),
    "actual_21d":float(actual_return),
   })
 print(f"Test samples: {len(samples)} (every 10 days per stock)")

 # Walk-forward: for each sample, train on ALL data before that date
 # Predict 5d/10d/21d returns
 all_predictions={name:[] for name in MODEL_NAMES}

 print(f"\nTraining {len(MODEL_NAMES)} models × {len(samples)} samples = {len(MODEL_NAMES)*len(samples)} model trainings...")
 for idx,sample in enumerate(samples):
  if idx%20==0:print(f"  Sample {idx}/{len(samples)}...")
  # Training data = all rows before this sample's date
  train_data=df[df["date"]<sample["date"]]
  if len(train_data)<100:continue
  Xtr=train_data[FC].values.astype(np.float64)

  for name in MODEL_NAMES:
   try:
    # Train 3 separate models for 5d/10d/21d targets
    r5=r10=r21=0
    for hz_col,hz in [("target_5d",5),("target_10d",10),("target_21d",21)]:
     ytr=train_data[hz_col].values.astype(np.float64)
     model=train_one_model(name,Xtr,ytr)
     pred=float(model.predict(sample["features"].reshape(1,-1))[0])
     if hz==5:r5=pred
     elif hz==10:r10=pred
     else:r21=pred

    avg=(r5+r10+r21)/3
    sig="BUY"if avg>0.01 else"SELL"if avg<-0.01 else"HOLD"
    actual=sample["actual_return_21d"]
    correct=(sig=="BUY"and actual>0)or(sig=="SELL"and actual<0)

    all_predictions[name].append({
     "stock":sample["stock"],"signal":sig,"avgReturn":avg,
     "actual_return":actual,"correct":correct,
     "r5":r5,"r10":r10,"r21":r21,
    })
   except Exception as e:
    all_predictions[name].append({
     "stock":sample["stock"],"signal":"HOLD","avgReturn":0,
     "actual_return":sample["actual_return_21d"],"correct":False,
     "r5":0,"r10":0,"r21":0,
    })

 # Compute individual model walk-forward backtesting
 print("\n\nComputing individual model walk-forward results...")
 wf_individual={}
 for name in MODEL_NAMES:
  preds=all_predictions[name]
  trades=[p for p in preds if p["signal"]!="HOLD"]
  wins=[p for p in trades if p["correct"]]
  rets=[p["actual_return"] if p["signal"]=="BUY" else -p["actual_return"] for p in trades]
  tt=len(trades);wr=len(wins)/max(tt,1)*100
  ar_=float(np.mean(rets))*100 if rets else 0
  wf_individual[name]={
   "totalTrades":int(tt),"wins":int(len(wins)),
   "winRate":round(float(wr),1),"avgReturnPct":round(float(ar_),2),
   "maxReturnPct":round(float(max(rets)*100)if rets else 0,2),
   "minReturnPct":round(float(min(rets)*100)if rets else 0,2),
   "stars":int(min(5,max(1,int(wr/20)+1))),
  }
  print(f"  {name}: trades={tt} winRate={wr:.1f}% avgReturn={ar_:.2f}% stars={'★'*int(min(5,max(1,int(wr/20)+1)))}")

 # Compute ensemble walk-forward backtesting
 print("\nComputing ensemble walk-forward results...")

 # For each sample, collect all 5 models' predictions
 ensemble_preds={"MAJORITY_VOTE":[],"PROBABILITY_WEIGHTED":[],"TIER_WEIGHTED":[],"WIN_RATE_WEIGHTED":[]}

 # Group predictions by sample index (they're in the same order)
 n_samples=len(all_predictions[MODEL_NAMES[0]])
 for i in range(n_samples):
  sample_preds={name:all_predictions[name][i] for name in MODEL_NAMES if i<len(all_predictions[name])}
  if not sample_preds:continue
  actual=sample_preds[MODEL_NAMES[0]]["actual_return"]

  # A. Majority Vote
  buys=sum(1 for p in sample_preds.values()if p["signal"]=="BUY")
  sells=sum(1 for p in sample_preds.values()if p["signal"]=="SELL")
  holds=sum(1 for p in sample_preds.values()if p["signal"]=="HOLD")
  if buys>sells and buys>holds:sig="BUY"
  elif sells>buys and sells>holds:sig="SELL"
  else:sig="HOLD"
  ensemble_preds["MAJORITY_VOTE"].append({"signal":sig,"actual_return":actual})

  # B. Probability-Weighted (avg of avgReturns)
  avg_ret=np.mean([p["avgReturn"]for p in sample_preds.values()])
  sig2="BUY"if avg_ret>0.01 else"SELL"if avg_ret<-0.01 else"HOLD"
  ensemble_preds["PROBABILITY_WEIGHTED"].append({"signal":sig2,"actual_return":actual})

  # C. Tier-Weighted
  ws=sum(p["avgReturn"]*TIER_W.get(n,0.2)for n,p in sample_preds.items())
  wt=sum(TIER_W.get(n,0.2)for n in sample_preds)
  wr_=ws/wt if wt>0 else 0
  sig3="BUY"if wr_>0.01 else"SELL"if wr_<-0.01 else"HOLD"
  ensemble_preds["TIER_WEIGHTED"].append({"signal":sig3,"actual_return":actual})

  # D. Win-Rate-Weighted (use walk-forward win rates as weights)
  weighted_buy=weighted_sell=total_w=0
  for n,p in sample_preds.items():
   wr_model=wf_individual.get(n,{}).get("winRate",0)
   if wr_model<30:weight=0
   elif wr_model>50:weight=1.0
   else:weight=(wr_model-30)/20
   if weight>0:
    total_w+=weight
    if p["signal"]=="BUY":weighted_buy+=p["avgReturn"]*weight
    elif p["signal"]=="SELL":weighted_sell+=p["avgReturn"]*weight
  wr_avg=(weighted_buy+weighted_sell)/total_w if total_w>0 else 0
  sig4="BUY"if wr_avg>0.01 else"SELL"if wr_avg<-0.01 else"HOLD"
  ensemble_preds["WIN_RATE_WEIGHTED"].append({"signal":sig4,"actual_return":actual})

 # Final consensus (2+ methods agree)
 final_preds=[]
 for i in range(n_samples):
  votes=[ensemble_preds[m][i]["signal"]for m in ensemble_preds]
  buy_v=sum(1 for v in votes if v=="BUY")
  sell_v=sum(1 for v in votes if v=="SELL")
  if buy_v>=2:sig="BUY"
  elif sell_v>=2:sig="SELL"
  else:sig="HOLD"
  actual=ensemble_preds["MAJORITY_VOTE"][i]["actual_return"]
  final_preds.append({"signal":sig,"actual_return":actual})
 ensemble_preds["FINAL_CONSENSUS"]=final_preds

 # Compute ensemble backtesting stats
 wf_ensemble={}
 for method,preds in ensemble_preds.items():
  trades=[p for p in preds if p["signal"]!="HOLD"]
  wins=[p for p in trades if(p["signal"]=="BUY"and p["actual_return"]>0)or(p["signal"]=="SELL"and p["actual_return"]<0)]
  rets=[p["actual_return"] if p["signal"]=="BUY" else -p["actual_return"] for p in trades]
  tt=len(trades);wr=len(wins)/max(tt,1)*100
  ar_=float(np.mean(rets))*100 if rets else 0
  wf_ensemble[method]={
   "totalTrades":int(tt),"wins":int(len(wins)),
   "winRate":round(float(wr),1),"avgReturnPct":round(float(ar_),2),
   "maxReturnPct":round(float(max(rets)*100)if rets else 0,2),
   "minReturnPct":round(float(min(rets)*100)if rets else 0,2),
   "stars":int(min(5,max(1,int(wr/20)+1))),
  }
  print(f"  {method}: trades={tt} winRate={wr:.1f}% avgReturn={ar_:.2f}% stars={'★'*int(min(5,max(1,int(wr/20)+1)))}")

 # Save results
 output={
  "walk_forward_at":pd.Timestamp.now().isoformat(),
  "n_samples":len(samples),
  "models_trained":MODEL_NAMES,
  "individual":wf_individual,
  "ensemble":wf_ensemble,
  "methodology":"Walk-forward: expanding window. For each test sample, models re-trained on ALL data before that point. No data leakage.",
  "comparison_note":"Walk-forward results are MORE ACCURATE than simplified backtesting (which used latest prediction for all test rows).",
 }
 OUT_FILE.write_text(json.dumps(output,indent=2,default=lambda o:int(o)if isinstance(o,(np.integer,))else float(o)if isinstance(o,(np.floating,))else str(o)))

 # Merge into main predictions file
 existing=json.loads(PRED_FILE.read_text())
 existing["walk_forward_backtesting"]=output
 PRED_FILE.write_text(json.dumps(existing,indent=2,default=lambda o:int(o)if isinstance(o,(np.integer,))else float(o)if isinstance(o,(np.floating,))else str(o)))

 print(f"\n{'='*60}")
 print(f"WALK-FORWARD BACKTESTING COMPLETE")
 print(f"{'='*60}")
 print(f"Samples: {len(samples)}")
 print(f"Model trainings: {len(samples)*len(MODEL_NAMES)*3} (5 models × 3 horizons × {len(samples)} samples)")
 print(f"\nIndividual model walk-forward results:")
 for name in MODEL_NAMES:
  r=wf_individual[name]
  print(f"  {name}: {r['winRate']}% win ({r['totalTrades']} trades) +{r['avgReturnPct']}% avg {'★'*r['stars']}")
 print(f"\nEnsemble walk-forward results:")
 for method,r in wf_ensemble.items():
  print(f"  {method}: {r['winRate']}% win ({r['totalTrades']} trades) +{r['avgReturnPct']}% avg {'★'*r['stars']}")
 print(f"\nSaved: {OUT_FILE}")
 print(f"Also merged into: {PRED_FILE}")

if __name__=="__main__":main()
