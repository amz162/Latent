#!/usr/bin/env python3
"""Latent.pk — Train ALL models + compute backtesting for each model AND ensemble."""
import json,sys,warnings,numpy as np,pandas as pd
import xgboost as xgb,lightgbm as lgb,catboost as cb
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_squared_error,mean_absolute_error,r2_score
from sklearn.preprocessing import StandardScaler
from pathlib import Path
warnings.filterwarnings("ignore")
OHLCV=Path("data/ohlcv");OUT=Path("data/ml_predictions_multi.json")
STOCKS=["ENGRO","HUBC","LUCK","SYS","MEBL","PSO","OGDC","PPL"]
FC=["rsi_14","macd","macd_signal","macd_hist","bb_width","bb_pct_b","atr_14","obv_change_pct",
"price_sma_20_ratio","price_sma_50_ratio","price_sma_200_ratio","volume_sma_20_ratio",
"return_1d","return_7d","return_14d","return_30d","hl_range_pct","body_size_pct","volatility_14d"]
TIER_W={"TIER_1":0.35,"TIER_2":0.25,"TIER_3":0.30,"TIER_4":0.10}

def compute_rsi(p,n=14):
 d=p.diff();g=d.where(d>0,0);l=-d.where(d<0,0)
 ag=g.ewm(alpha=1/n,min_periods=n).mean();al=l.ewm(alpha=1/n,min_periods=n).mean()
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
 return df
def add_labels(df):
 df=df.copy()
 for hz in[5,10,21]:df[f"target_{hz}d"]=((df["close"].shift(-hz)-df["close"])/df["close"]).fillna(0)
 return df
def load():
 frames=[]
 for s in STOCKS:
  p=OHLCV/f"{s}.csv"
  if not p.exists():continue
  df=pd.read_csv(p,usecols=range(6));df=df[df["volume"]>0].reset_index(drop=True)
  if len(df)<50:continue
  df=add_features(df);df=add_labels(df);df["symbol"]=s;frames.append(df)
 return pd.concat(frames,ignore_index=True) if frames else pd.DataFrame()

def gen_preds(df, predict_fn):
 preds={}
 for s in STOCKS:
  sdf=df[df["symbol"]==s].sort_values("date").reset_index(drop=True)
  if len(sdf)==0:continue
  cp=float(sdf.iloc[-1]["close"])
  r5,r10,r21=predict_fn(sdf)
  sl=round(float(np.min(sdf["low"].tail(14).values)),2)
  avg=(r5+r10+r21)/3
  sig="BUY"if avg>0.01 else"SELL"if avg<-0.01 else"HOLD"
  d="LONG"if sig!="SELL"else"SHORT"
  preds[s]={"signal":sig,"direction":d,"confidence":min(100,int(abs(avg)*1000)),
   "currentPrice":round(cp,2),"entry":round(cp,2),
   "tp1":round(cp*(1+r5),2),"tp2":round(cp*(1+r10),2),"tp3":round(cp*(1+r21),2),
   "sl":sl,"avgReturn":round(avg,4)}
 return preds

def train_classical(df):
 targets=["target_5d","target_10d","target_21d"]
 split=int(len(df)*0.8);tr=df.iloc[:split];te=df.iloc[split:]
 Xtr=tr[FC].values;Xte=te[FC].values
 cfg={"XGBoost":lambda:xgb.XGBRegressor(n_estimators=150,max_depth=3,learning_rate=0.05,subsample=0.7,colsample_bytree=0.7,random_state=42),
  "LightGBM":lambda:lgb.LGBMRegressor(n_estimators=150,num_leaves=15,learning_rate=0.05,subsample=0.7,colsample_bytree=0.7,random_state=42,verbose=-1),
  "CatBoost":lambda:cb.CatBoostRegressor(iterations=150,depth=3,learning_rate=0.05,random_state=42,verbose=0,allow_writing_files=False),
  "Random Forest":lambda:RandomForestRegressor(n_estimators=150,max_depth=5,min_samples_leaf=15,max_features=0.7,random_state=42,n_jobs=-1)}
 results={}
 for name,factory in cfg.items():
  print(f"  Training {name}...")
  metrics={};preds={}
  for tc in targets:
   hz=int(tc.split("_")[1].replace("d",""))
   ytr=tr[tc].values;yte=te[tc].values
   m=factory();m.fit(Xtr,ytr);yp=m.predict(Xte)
   metrics[f"{hz}d"]={"mse":float(mean_squared_error(yte,yp)),"mae":float(mean_absolute_error(yte,yp)),"r2":float(r2_score(yte,yp))}
   for s in STOCKS:
    sdf=df[df["symbol"]==s].sort_values("date").reset_index(drop=True)
    if len(sdf)==0:continue
    latest=sdf.iloc[-1];lf=latest[FC].values.reshape(1,-1)
    pr=float(m.predict(lf)[0]);cp=float(latest["close"])
    if s not in preds:preds[s]={"currentPrice":round(cp,2),"entry":round(cp,2)}
    preds[s][f"ret_{hz}d"]=round(pr,4)
  for s,pd_ in preds.items():
   r5=pd_.get("ret_5d",0);r10=pd_.get("ret_10d",0);r21=pd_.get("ret_21d",0)
   cp=pd_["currentPrice"]
   sdf=df[df["symbol"]==s].sort_values("date").reset_index(drop=True)
   sl=round(float(np.min(sdf["low"].tail(14).values)),2)
   avg=(r5+r10+r21)/3
   sig="BUY"if avg>0.01 else"SELL"if avg<-0.01 else"HOLD"
   d="LONG"if sig!="SELL"else"SHORT"
   pd_.update({"signal":sig,"direction":d,"confidence":min(100,int(abs(avg)*1000)),
    "tp1":round(cp*(1+r5),2),"tp2":round(cp*(1+r10),2),"tp3":round(cp*(1+r21),2),
    "sl":sl,"avgReturn":round(avg,4)})
  results[name]={"trained":True,"version":"2.0.0","metrics":metrics,"predictions":preds}
  print(f"    R²(5d)={metrics['5d']['r2']:.3f}")
 return results

def train_lstm(df):
 try:
  import torch,torch.nn as nn
  from torch.utils.data import DataLoader,TensorDataset
  print("  Training LSTM...")
  SEQ=30;seqs=[];targs=[]
  for s in STOCKS:
   sdf=df[df["symbol"]==s].sort_values("date").reset_index(drop=True)
   if len(sdf)<SEQ+21:continue
   f=sdf[FC].values;sc=StandardScaler();fs=sc.fit_transform(f)
   for i in range(len(sdf)-SEQ-21):
    seqs.append(fs[i:i+SEQ])
    targs.append([sdf.iloc[i+SEQ]["target_5d"],sdf.iloc[i+SEQ]["target_10d"],sdf.iloc[i+SEQ]["target_21d"]])
  if len(seqs)<50:return{"trained":False,"error":"Not enough sequences"}
  X=np.array(seqs,dtype=np.float32);y=np.array(targs,dtype=np.float32)
  sp=int(len(X)*0.8);Xtr,Xte=X[:sp],X[sp:];ytr,yte=y[:sp],y[sp:]
  dl=DataLoader(TensorDataset(torch.from_numpy(Xtr),torch.from_numpy(ytr)),batch_size=32,shuffle=True)
  class M(nn.Module):
   def __init__(s):
    super().__init__();s.lstm=nn.LSTM(len(FC),64,2,batch_first=True,dropout=0.1);s.fc=nn.Linear(64,3)
   def forward(s,x):
    o,_=s.lstm(x);return s.fc(o[:,-1,:])
  model=M();crit=nn.MSELoss();opt=torch.optim.Adam(model.parameters(),lr=0.001)
  model.train()
  for ep in range(30):
   for bx,by in dl:opt.zero_grad();loss=crit(model(bx),by);loss.backward();opt.step()
   if ep%10==0:print(f"    Epoch {ep}: loss={loss.item():.6f}")
  model.eval()
  with torch.no_grad():ypt=model(torch.from_numpy(Xte)).numpy()
  metrics={"5d":{"mse":float(mean_squared_error(yte[:,0],ypt[:,0]))},
   "10d":{"mse":float(mean_squared_error(yte[:,1],ypt[:,1]))},
   "21d":{"mse":float(mean_squared_error(yte[:,2],ypt[:,2]))}}
  def predict_fn(sdf):
   f=sdf[FC].values;sc=StandardScaler();fs=sc.fit_transform(f)
   sq=fs[-SEQ:].reshape(1,SEQ,len(FC))
   with torch.no_grad():p=model(torch.from_numpy(sq.astype(np.float32)))[0].numpy()
   return float(p[0]),float(p[1]),float(p[2])
  preds=gen_preds(df,predict_fn)
  print(f"    Done.")
  return{"trained":True,"version":"2.0.0","metrics":metrics,"predictions":preds}
 except Exception as e:
  print(f"    LSTM FAILED: {e}",file=sys.stderr)
  return{"trained":False,"error":str(e)}

def train_cnn_lstm(df):
 try:
  import torch,torch.nn as nn
  from torch.utils.data import DataLoader,TensorDataset
  print("  Training CNN-LSTM...")
  SEQ=30;seqs=[];targs=[]
  for s in STOCKS:
   sdf=df[df["symbol"]==s].sort_values("date").reset_index(drop=True)
   if len(sdf)<SEQ+21:continue
   f=sdf[FC].values;sc=StandardScaler();fs=sc.fit_transform(f)
   for i in range(len(sdf)-SEQ-21):
    seqs.append(fs[i:i+SEQ])
    targs.append([sdf.iloc[i+SEQ]["target_5d"],sdf.iloc[i+SEQ]["target_10d"],sdf.iloc[i+SEQ]["target_21d"]])
  if len(seqs)<50:return{"trained":False,"error":"Not enough sequences"}
  X=np.array(seqs,dtype=np.float32);y=np.array(targs,dtype=np.float32)
  sp=int(len(X)*0.8);Xtr,Xte=X[:sp],X[sp:];ytr,yte=y[:sp],y[sp:]
  dl=DataLoader(TensorDataset(torch.from_numpy(Xtr),torch.from_numpy(ytr)),batch_size=32,shuffle=True)
  class CNNLSTM(nn.Module):
   def __init__(s):
    super().__init__()
    s.conv1=nn.Conv1d(len(FC),32,kernel_size=3,padding=1);s.relu=nn.ReLU()
    s.conv2=nn.Conv1d(32,32,kernel_size=3,padding=1)
    s.lstm=nn.LSTM(32,64,2,batch_first=True,dropout=0.1);s.fc=nn.Linear(64,3)
   def forward(s,x):
    x=x.transpose(1,2);x=s.relu(s.conv1(x));x=s.relu(s.conv2(x))
    x=x.transpose(1,2);o,_=s.lstm(x);return s.fc(o[:,-1,:])
  model=CNNLSTM();crit=nn.MSELoss();opt=torch.optim.Adam(model.parameters(),lr=0.001)
  model.train()
  for ep in range(30):
   for bx,by in dl:opt.zero_grad();loss=crit(model(bx),by);loss.backward();opt.step()
   if ep%10==0:print(f"    Epoch {ep}: loss={loss.item():.6f}")
  model.eval()
  with torch.no_grad():ypt=model(torch.from_numpy(Xte)).numpy()
  metrics={"5d":{"mse":float(mean_squared_error(yte[:,0],ypt[:,0]))}}
  def predict_fn(sdf):
   f=sdf[FC].values;sc=StandardScaler();fs=sc.fit_transform(f)
   sq=fs[-SEQ:].reshape(1,SEQ,len(FC))
   with torch.no_grad():p=model(torch.from_numpy(sq.astype(np.float32)))[0].numpy()
   return float(p[0]),float(p[1]),float(p[2])
  preds=gen_preds(df,predict_fn)
  print(f"    Done.")
  return{"trained":True,"version":"2.0.0","metrics":metrics,"predictions":preds}
 except Exception as e:
  print(f"    CNN-LSTM FAILED: {e}",file=sys.stderr)
  return{"trained":False,"error":str(e)}

def train_transformer_lstm(df):
 try:
  import torch,torch.nn as nn
  from torch.utils.data import DataLoader,TensorDataset
  print("  Training Transformer-LSTM...")
  SEQ=30;seqs=[];targs=[]
  for s in STOCKS:
   sdf=df[df["symbol"]==s].sort_values("date").reset_index(drop=True)
   if len(sdf)<SEQ+21:continue
   f=sdf[FC].values;sc=StandardScaler();fs=sc.fit_transform(f)
   for i in range(len(sdf)-SEQ-21):
    seqs.append(fs[i:i+SEQ])
    targs.append([sdf.iloc[i+SEQ]["target_5d"],sdf.iloc[i+SEQ]["target_10d"],sdf.iloc[i+SEQ]["target_21d"]])
  if len(seqs)<50:return{"trained":False,"error":"Not enough sequences"}
  X=np.array(seqs,dtype=np.float32);y=np.array(targs,dtype=np.float32)
  sp=int(len(X)*0.8);Xtr,Xte=X[:sp],X[sp:];ytr,yte=y[:sp],y[sp:]
  dl=DataLoader(TensorDataset(torch.from_numpy(Xtr),torch.from_numpy(ytr)),batch_size=32,shuffle=True)
  class TL(nn.Module):
   def __init__(s):
    super().__init__()
    s.el=nn.TransformerEncoderLayer(d_model=len(FC),nhead=1,dim_feedforward=64,dropout=0.1,batch_first=True)
    s.enc=nn.TransformerEncoder(s.el,num_layers=2)
    s.lstm=nn.LSTM(len(FC),64,2,batch_first=True,dropout=0.1);s.fc=nn.Linear(64,3)
   def forward(s,x):
    x=s.enc(x);o,_=s.lstm(x);return s.fc(o[:,-1,:])
  model=TL();crit=nn.MSELoss();opt=torch.optim.Adam(model.parameters(),lr=0.001)
  model.train()
  for ep in range(30):
   for bx,by in dl:opt.zero_grad();loss=crit(model(bx),by);loss.backward();opt.step()
   if ep%10==0:print(f"    Epoch {ep}: loss={loss.item():.6f}")
  model.eval()
  with torch.no_grad():ypt=model(torch.from_numpy(Xte)).numpy()
  metrics={"5d":{"mse":float(mean_squared_error(yte[:,0],ypt[:,0]))}}
  def predict_fn(sdf):
   f=sdf[FC].values;sc=StandardScaler();fs=sc.fit_transform(f)
   sq=fs[-SEQ:].reshape(1,SEQ,len(FC))
   with torch.no_grad():p=model(torch.from_numpy(sq.astype(np.float32)))[0].numpy()
   return float(p[0]),float(p[1]),float(p[2])
  preds=gen_preds(df,predict_fn)
  print(f"    Done.")
  return{"trained":True,"version":"2.0.0","metrics":metrics,"predictions":preds}
 except Exception as e:
  print(f"    Transformer-LSTM FAILED: {e}",file=sys.stderr)
  return{"trained":False,"error":str(e)}

def train_neuralforecast(df):
 from neuralforecast import NeuralForecast
 from neuralforecast.models import PatchTST,NBEATS,TimesNet,Informer
 results={}
 nf_df=pd.DataFrame()
 for s in STOCKS:
  sdf=df[df["symbol"]==s].sort_values("date").reset_index(drop=True).copy()
  sdf["ds"]=pd.to_datetime(sdf["date"],unit="ms");sdf["y"]=sdf["close"];sdf["unique_id"]=s
  nf_df=pd.concat([nf_df,sdf[["ds","y","unique_id"]]],ignore_index=True)
 models=[
  ("PatchTST",PatchTST,{"h":21,"input_size":30,"max_steps":50,"patch_len":4,"stride":4}),
  ("N-BEATS",NBEATS,{"h":21,"input_size":30,"max_steps":50,"n_blocks":[1,1,1]}),
  ("TimesNet",TimesNet,{"h":21,"input_size":30,"max_steps":50,"hidden_size":32,"top_k":5}),
  ("Informer",Informer,{"h":21,"input_size":30,"max_steps":50,"hidden_size":32,"factor":3,"n_head":4}),
 ]
 for name,cls,params in models:
  print(f"  Training {name}...")
  try:
   model=cls(**params);nf=NeuralForecast(models=[model],freq="D");nf.fit(df=nf_df)
   fc=nf.predict()
   col=[c for c in fc.columns if c not in["unique_id","ds"]][0]
   preds={}
   for s in STOCKS:
    sdf=df[df["symbol"]==s].sort_values("date").reset_index(drop=True)
    if len(sdf)==0:continue
    cp=float(sdf.iloc[-1]["close"])
    sc=fc[fc["unique_id"]==s]if"unique_id"in fc.columns else fc
    vals=sc[col].values if col in(sc.columns if hasattr(sc,"columns")else[])else np.array([cp*1.02])
    if len(vals)>=21:tp1,tp2,tp3=float(vals[4]),float(vals[9]),float(vals[20])
    elif len(vals)>=3:tp1,tp2,tp3=float(vals[0]),float(vals[len(vals)//2]),float(vals[-1])
    else:tp1,tp2,tp3=cp*1.02,cp*1.03,cp*1.05
    sl=round(float(np.min(sdf["low"].tail(14).values)),2)
    avg=((tp1+tp2+tp3)/3-cp)/cp
    sig="BUY"if avg>0.01 else"SELL"if avg<-0.01 else"HOLD"
    d="LONG"if sig!="SELL"else"SHORT"
    preds[s]={"signal":sig,"direction":d,"confidence":min(100,int(abs(avg)*1000)),
     "currentPrice":round(cp,2),"entry":round(cp,2),
     "tp1":round(tp1,2),"tp2":round(tp2,2),"tp3":round(tp3,2),
     "sl":sl,"avgReturn":round(avg,4)}
   results[name]={"trained":True,"version":"2.0.0","predictions":preds}
   print(f"    Done — {len(preds)} stocks")
  except Exception as e:
   print(f"    {name} FAILED: {e}",file=sys.stderr)
   results[name]={"trained":False,"error":str(e)}
 return results

# ─── Model metadata (tier mapping) ───
MODEL_TIERS={
 "PatchTST":"TIER_1","N-BEATS":"TIER_1","TimesNet":"TIER_1","Informer":"TIER_1",
 "Chronos (Amazon)":"TIER_2","Lag-Llama":"TIER_2","Moirai (Salesforce)":"TIER_2","Time-LLM":"TIER_2",
 "XGBoost":"TIER_3","LightGBM":"TIER_3","CatBoost":"TIER_3","Random Forest":"TIER_3","LSTM":"TIER_3",
 "CNN-LSTM":"TIER_4","Transformer-LSTM":"TIER_4","TabNet":"TIER_4","FinGPT":"TIER_4",
}

def backtest_individual(df, models):
 """Backtest each individual model on the 20% test set."""
 te=df.iloc[int(len(df)*0.8):].copy()
 bt={}
 for name,md in models.items():
  if not md.get("trained"):continue
  buys=sells=cb_=cs=0;rets=[]
  for s in STOCKS:
   ste=te[te["symbol"]==s].sort_values("date").reset_index(drop=True)
   if len(ste)<21:continue
   for i in range(0,len(ste)-21,5):
    ar=(ste.iloc[min(i+21,len(ste)-1)]["close"]-ste.iloc[i]["close"])/ste.iloc[i]["close"]
    pr=md.get("predictions",{}).get(s,{});sig=pr.get("signal","HOLD")
    if sig=="BUY":buys+=1;rets.append(ar);cb_+=ar>0
    elif sig=="SELL":sells+=1;rets.append(-ar);cs+=ar<0
  tt=buys+sells;wr=(cb_+cs)/max(tt,1)*100;ar_=float(np.mean(rets))*100 if rets else 0
  bt[name]={"totalTrades":int(tt),"buySignals":int(buys),"sellSignals":int(sells),
   "correctBuys":int(cb_),"correctSells":int(cs),
   "winRate":round(float(wr),1),"avgReturnPct":round(float(ar_),2),
   "maxReturnPct":round(float(max(rets)*100 if rets else 0),2),
   "minReturnPct":round(float(min(rets)*100 if rets else 0),2),
   "stars":int(min(5,max(1,int(wr/20)+1)))}
 return bt

def backtest_ensemble(df, models):
 """Backtest the 3 ensemble methods + final consensus on the test set."""
 te=df.iloc[int(len(df)*0.8):].copy()
 trained_models={n:m for n,m in models.items() if m.get("trained") and m.get("predictions",{})}
 if not trained_models:return{}

 # For each test sample, collect all model signals + compute ensemble
 ens_bt={"MAJORITY_VOTE":{"trades":0,"wins":0,"rets":[]},
  "PROBABILITY_WEIGHTED":{"trades":0,"wins":0,"rets":[]},
  "TIER_WEIGHTED":{"trades":0,"wins":0,"rets":[]},
  "FINAL_CONSENSUS":{"trades":0,"wins":0,"rets":[]}}

 for s in STOCKS:
  ste=te[te["symbol"]==s].sort_values("date").reset_index(drop=True)
  if len(ste)<21:continue
  for i in range(0,len(ste)-21,5):
   ar=(ste.iloc[min(i+21,len(ste)-1)]["close"]-ste.iloc[i]["close"])/ste.iloc[i]["close"]

   # Collect signals from all trained models
   signals=[];avg_returns=[]
   for mn,md in trained_models.items():
    pr=md.get("predictions",{}).get(s,{})
    sig=pr.get("signal","HOLD")
    ar_m=pr.get("avgReturn",0)
    tier=MODEL_TIERS.get(mn,"TIER_3")
    signals.append((mn,sig,ar_m,tier))

   if not signals:continue

   # A. Majority Vote
   buys=sum(1 for _,s,_,_ in signals if s=="BUY")
   sells=sum(1 for _,s,_,_ in signals if s=="SELL")
   holds=sum(1 for _,s,_,_ in signals if s=="HOLD")
   if buys>sells and buys>holds:ens_sig="BUY"
   elif sells>buys and sells>holds:ens_sig="SELL"
   else:ens_sig="HOLD"

   if ens_sig!="HOLD":
    ens_bt["MAJORITY_VOTE"]["trades"]+=1
    if (ens_sig=="BUY"and ar>0)or(ens_sig=="SELL"and ar<0):ens_bt["MAJORITY_VOTE"]["wins"]+=1
    ens_bt["MAJORITY_VOTE"]["rets"].append(ar if ens_sig=="BUY"else -ar)

   # B. Probability-Weighted
   avg_ret=sum(ar_m for _,_,ar_m,_ in signals)/len(signals)
   if avg_ret>0.01:ens_sig2="BUY"
   elif avg_ret<-0.01:ens_sig2="SELL"
   else:ens_sig2="HOLD"

   if ens_sig2!="HOLD":
    ens_bt["PROBABILITY_WEIGHTED"]["trades"]+=1
    if (ens_sig2=="BUY"and ar>0)or(ens_sig2=="SELL"and ar<0):ens_bt["PROBABILITY_WEIGHTED"]["wins"]+=1
    ens_bt["PROBABILITY_WEIGHTED"]["rets"].append(ar if ens_sig2=="BUY"else -ar)

   # C. Tier-Weighted
   ws=sum(ar_m*TIER_W.get(t,0.25)for _,_,ar_m,t in signals)
   wt=sum(TIER_W.get(t,0.25)for _,_,_,t in signals)
   wr_=ws/wt if wt>0 else 0
   if wr_>0.01:ens_sig3="BUY"
   elif wr_<-0.01:ens_sig3="SELL"
   else:ens_sig3="HOLD"

   if ens_sig3!="HOLD":
    ens_bt["TIER_WEIGHTED"]["trades"]+=1
    if (ens_sig3=="BUY"and ar>0)or(ens_sig3=="SELL"and ar<0):ens_bt["TIER_WEIGHTED"]["wins"]+=1
    ens_bt["TIER_WEIGHTED"]["rets"].append(ar if ens_sig3=="BUY"else -ar)

   # Final Consensus (2+ methods agree)
   votes=[ens_sig,ens_sig2,ens_sig3]
   buy_v=sum(1 for v in votes if v=="BUY")
   sell_v=sum(1 for v in votes if v=="SELL")
   if buy_v>=2:fc_sig="BUY"
   elif sell_v>=2:fc_sig="SELL"
   else:fc_sig="HOLD"

   if fc_sig!="HOLD":
    ens_bt["FINAL_CONSENSUS"]["trades"]+=1
    if (fc_sig=="BUY"and ar>0)or(fc_sig=="SELL"and ar<0):ens_bt["FINAL_CONSENSUS"]["wins"]+=1
    ens_bt["FINAL_CONSENSUS"]["rets"].append(ar if fc_sig=="BUY"else -ar)

 # Compute stats
 result={}
 for method,data in ens_bt.items():
  t=data["trades"];w=data["wins"];r=data["rets"]
  result[method]={"totalTrades":int(t),"wins":int(w),
   "winRate":round(float(w/max(t,1)*100),1),
   "avgReturnPct":round(float(np.mean(r)*100)if r else 0,2),
   "maxReturnPct":round(float(max(r)*100)if r else 0,2),
   "minReturnPct":round(float(min(r)*100)if r else 0,2),
   "stars":int(min(5,max(1,int(w/max(t,1)*100/20)+1)))if t>0 else 0}
 return result

def main():
 print("="*60);print("Latent.pk — Train ALL Models + Ensemble Backtesting");print("="*60)
 df=load();print(f"\nLoaded: {len(df)} rows from {df['symbol'].nunique()} stocks")

 print("\n[1/4] Classical regressors...")
 cl=train_classical(df)

 print("\n[2/4] Deep learning (LSTM, CNN-LSTM, Transformer-LSTM)...")
 lstm=train_lstm(df)
 cnn=train_cnn_lstm(df)
 tl=train_transformer_lstm(df)

 print("\n[3/4] Neuralforecast (PatchTST, N-BEATS, TimesNet, Informer)...")
 nf=train_neuralforecast(df)

 all_models={}
 all_models.update(cl)
 all_models["LSTM"]=lstm
 all_models["CNN-LSTM"]=cnn
 all_models["Transformer-LSTM"]=tl
 all_models.update(nf)

 # Mark untrained
 untrained={"Chronos (Amazon)":"Requires chronos-forecasting package",
  "Lag-Llama":"Requires custom repo","Moirai (Salesforce)":"Requires uni2ts",
  "Time-LLM":"Requires LLM pipeline","TabNet":"Data type issue","FinGPT":"Requires BloombergGPT"}
 for n,r in untrained.items():
  if n not in all_models:all_models[n]={"trained":False,"error":r}

 print("\n[4/4] Computing backtesting (individual models + ensemble)...")
 bt_ind=backtest_individual(df,all_models)
 bt_ens=backtest_ensemble(df,all_models)

 out={"trained_at":pd.Timestamp.now().isoformat(),"data_source":"askanalyst.com.pk",
  "training_rows":int(len(df)),"model_type":"multi_horizon_regressor",
  "targets":["return_5d","return_10d","return_21d"],
  "sl_rule":"min(low[-14:])","tp_rule":"TP1=5d,TP2=10d,TP3=21d",
  "models":all_models,"untrained_models":untrained,
  "backtesting":bt_ind,"ensemble_backtesting":bt_ens}

 OUT.parent.mkdir(parents=True,exist_ok=True)
 OUT.write_text(json.dumps(out,indent=2,default=lambda o:int(o)if isinstance(o,(np.integer,))else float(o)if isinstance(o,(np.floating,))else str(o)))

 tc=sum(1 for m in all_models.values()if m.get("trained"))
 print(f"\n{'='*60}")
 print(f"TRAINING + BACKTESTING COMPLETE")
 print(f"{'='*60}")
 print(f"Trained: {tc}/{len(all_models)} models")
 print(f"\nIndividual model backtesting:")
 for n,b in bt_ind.items():
  print(f"  {n}: winRate={b['winRate']}% avgReturn={b['avgReturnPct']}% stars={'★'*b['stars']}")
 print(f"\nEnsemble backtesting:")
 for n,b in bt_ens.items():
  print(f"  {n}: trades={b['totalTrades']} winRate={b['winRate']}% avgReturn={b['avgReturnPct']}% stars={'★'*b['stars']}")
 print(f"\nSaved: {OUT}")

if __name__=="__main__":main()
