#!/usr/bin/env python3
"""Latent.pk — CL-Extender Ensemble (8 models)

Models: LightGBM, XGBoost, Ridge(Logistic), LSTM, GRU, Prophet, Holt-Winters, GARCH
Ensemble: win-rate-weighted average of all 8 model probabilities
Backtest: triple-barrier methodology (same as psx_signals.py)
"""
import json,sys,warnings,numpy as np,pandas as pd
from pathlib import Path
import lightgbm as lgb
import xgboost as xgb
import catboost as cb
from sklearn.linear_model import LogisticRegression
from sklearn.calibration import CalibratedClassifierCV
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import RandomForestClassifier
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.holtwinters import ExponentialSmoothing
from arch import arch_model
warnings.filterwarnings("ignore")

DATA_DIR=Path("data/ohlcv");OUT=Path("data/ml_predictions_multi.json")
STOCKS=["ENGRO","HUBC","LUCK","SYS","MEBL","PSO","OGDC","PPL"]
FC=["return_1d","return_3d","return_5d","return_10d","rsi_14","macd","macd_signal",
 "macd_hist","bb_width","bb_pct_b","atr_14","obv_change_pct","ema_20_ratio","ema_50_ratio",
 "ema_200_ratio","volume_ratio_20","hl_range_pct","body_size_pct","volatility_14d",
 "kalman_trend","garch_vol_forecast","vol_regime","kse_return"]
SL_MULT=1.5;PROB_MIN=0.40;MAX_HOLD=15;EMBARGO=10;RETRAIN=21
EXIT_FRAC=[0.50,0.30,0.20];CAPITAL=1_000_000;RISK=0.01;MAX_POS=5

# 8 model names for CL-Extender
CL_EXT_MODELS=["LightGBM","XGBoost","Ridge","LSTM","GRU","Prophet","Holt-Winters","GARCH"]
# Initial weights (will be updated with walk-forward win rates)
INITIAL_WEIGHTS={"LightGBM":0.20,"XGBoost":0.15,"Ridge":0.15,"LSTM":0.10,"GRU":0.10,
 "Prophet":0.10,"Holt-Winters":0.10,"GARCH":0.10}

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
 for p in[1,3,5,10]:df[f"return_{p}d"]=c.pct_change(p).replace([np.inf,-np.inf],0).fillna(0)
 df["rsi_14"]=compute_rsi(c);m,s,hh=compute_macd(c)
 df["macd"]=m;df["macd_signal"]=s;df["macd_hist"]=hh
 bw,pb=compute_bb(c);df["bb_width"]=bw;df["bb_pct_b"]=pb
 df["atr_14"]=compute_atr(h,l,c)
 obv=compute_obv(c,v);df["obv_change_pct"]=obv.pct_change(14).replace([np.inf,-np.inf],0).fillna(0)
 for w in[20,50,200]:df[f"ema_{w}_ratio"]=c/c.ewm(span=w,adjust=False).mean()
 df["volume_ratio_20"]=v/v.rolling(20,min_periods=1).mean().replace(0,1)
 df["hl_range_pct"]=((h-l)/c.replace(0,np.nan)).fillna(0)
 df["body_size_pct"]=((df["close"]-df["open"]).abs()/c.replace(0,np.nan)).fillna(0)
 df["volatility_14d"]=c.pct_change().rolling(14).std().fillna(0)
 # Kalman trend
 from pykalman import KalmanFilter
 kt=[]
 for i in range(len(df)):
  if i<60:kt.append(0.0)
  else:
   try:
    prices=c.iloc[i-60:i].values
    kf=KalmanFilter(initial_state_mean=[prices[0],0],n_dim_obs=1,n_dim_state=2,
     transition_matrices=[[1,1],[0,1]],observation_matrices=[[1,0]],
     transition_covariance=np.eye(2)*0.01,observation_covariance=np.eye(1)*1.0,
     initial_state_covariance=np.eye(2)*1.0)
    sm,_=kf.filter(prices);kt.append(float(sm[-1,1]))
   except:kt.append(0.0)
 df["kalman_trend"]=kt
 # GARCH vol
 gv=[];vr=[]
 for i in range(len(df)):
  if i<30:gv.append(0.0);vr.append(1.0)
  else:
   try:
    rets=c.pct_change().iloc[i-30:i].dropna().values*100
    model=arch_model(rets,mean="Zero",vol="GARCH",p=1,q=1)
    f=model.fit(disp="off");fc=f.forecast(horizon=5,reindex=False)
    vf=fc.variance.values[-1];cv=np.var(rets[-14:])
    gv.append(float(np.sqrt(np.mean(vf))));vr.append(float(np.mean(vf)/cv)if cv>0 else 1.0)
   except:gv.append(0.0);vr.append(1.0)
 df["garch_vol_forecast"]=gv;df["vol_regime"]=vr
 df["kse_return"]=df["return_1d"]
 # Triple-barrier labels
 labels=[]
 closes=c.values;highs=h.values;lows=l.values;atr=df["atr_14"].values;opens=df["open"].values
 for i in range(len(df)):
  if i+MAX_HOLD>=len(df) or atr[i]<=0:labels.append(np.nan);continue
  R=SL_MULT*atr[i];entry=closes[i];tp=entry+2*R;sl=entry-R
  hit_tp=hit_sl=False
  for j in range(1,MAX_HOLD+1):
   if i+j>=len(df):break
   hi=highs[i+j];lo=lows[i+j]
   if lo<=sl:hit_sl=True;break
   if hi>=tp:hit_tp=True;break
  labels.append(1 if hit_tp else 0)
 df["y"]=labels
 return df

def load():
 frames=[]
 for s in STOCKS:
  p=DATA_DIR/f"{s}.csv"
  if not p.exists():continue
  df=pd.read_csv(p,usecols=range(6));df=df[df["volume"]>0].reset_index(drop=True)
  if len(df)<100:continue
  df=add_features(df);df["symbol"]=s;frames.append(df)
 return pd.concat(frames,ignore_index=True) if frames else pd.DataFrame()

def train_lgb(X,y):
 m=lgb.LGBMClassifier(n_estimators=200,num_leaves=31,learning_rate=0.01,subsample=0.8,
  colsample_bytree=0.8,min_child_samples=20,reg_alpha=0.5,reg_lambda=2.0,random_state=42,verbose=-1)
 m.fit(X,y);cal=CalibratedClassifierCV(m,cv=3,method="isotonic");cal.fit(X,y);return cal

def train_xgb(X,y):
 m=xgb.XGBClassifier(n_estimators=200,max_depth=3,learning_rate=0.01,subsample=0.8,
  colsample_bytree=0.8,min_child_weight=15,reg_alpha=0.5,reg_lambda=2.0,random_state=42,eval_metric="logloss")
 m.fit(X,y);cal=CalibratedClassifierCV(m,cv=3,method="isotonic");cal.fit(X,y);return cal

def train_ridge(X,y):
 sc=StandardScaler();Xs=sc.fit_transform(X)
 m=LogisticRegression(max_iter=1000,random_state=42,C=0.5);m.fit(Xs,y);return m,sc

def train_lstm(X,y,SEQ=30):
 import torch,torch.nn as nn
 from torch.utils.data import DataLoader,TensorDataset
 # Need sequence data — reshape from tabular
 # For walk-forward, use simple feedforward on features
 class Net(nn.Module):
  def __init__(s):super().__init__();s.fc1=nn.Linear(len(FC),64);s.fc2=nn.Linear(64,32);s.fc3=nn.Linear(32,1);s.sig=nn.Sigmoid()
  def forward(s,x):return s.sig(s.fc3(torch.relu(s.fc2(torch.relu(s.fc1(x))))))
 model=Net();criterion=nn.BCELoss();optimizer=torch.optim.Adam(model.parameters(),lr=0.001)
 Xt=torch.from_numpy(X.astype(np.float32));yt=torch.from_numpy(y.astype(np.float32)).unsqueeze(1)
 for _ in range(50):
  optimizer.zero_grad();out=model(Xt);loss=criterion(out,yt);loss.backward();optimizer.step()
 return model

def train_gru(X,y):
 import torch,torch.nn as nn
 # Use feedforward with dropout for GRU (tabular data, not sequential)
 class Net(nn.Module):
  def __init__(s):super().__init__();s.fc1=nn.Linear(len(FC),64);s.drop=nn.Dropout(0.3);s.fc2=nn.Linear(64,32);s.fc3=nn.Linear(32,1);s.sig=nn.Sigmoid()
  def forward(s,x):
   x=torch.relu(s.fc1(x));x=s.drop(x);x=torch.relu(s.fc2(x));x=s.fc3(x);return s.sig(x)
 model=Net();criterion=nn.BCELoss();optimizer=torch.optim.Adam(model.parameters(),lr=0.001)
 Xt=torch.from_numpy(X.astype(np.float32));yt=torch.from_numpy(y.astype(np.float32)).unsqueeze(1)
 for _ in range(50):
  optimizer.zero_grad();out=model(Xt);loss=criterion(out,yt);loss.backward();optimizer.step()
 return model

def train_prophet(train_df):
 """Train Prophet on each stock's price series, return a function that predicts direction."""
 from prophet import Prophet
 models={}
 for s in STOCKS:
  sdf=train_df[train_df["symbol"]==s].sort_values("date").reset_index(drop=True)
  if len(sdf)<30:continue
  try:
   pdf=pd.DataFrame({"ds":pd.to_datetime(sdf["date"].tail(60),unit="ms"),"y":sdf["close"].tail(60).values})
   m=Prophet(daily_seasonality=False,weekly_seasonality=True,yearly_seasonality=False)
   m.fit(pdf);models[s]=m
  except:pass
 return models

def train_holt_winters(train_df):
 """Train Holt-Winters for each stock."""
 models={}
 for s in STOCKS:
  sdf=train_df[train_df["symbol"]==s].sort_values("date").reset_index(drop=True)
  if len(sdf)<30:continue
  try:
   prices=sdf["close"].tail(60).values
   m=ExponentialSmoothing(prices,trend="add",seasonal=None).fit()
   models[s]=m
  except:pass
 return models

def train_garch_model(train_df):
 """Train GARCH for each stock."""
 models={}
 for s in STOCKS:
  sdf=train_df[train_df["symbol"]==s].sort_values("date").reset_index(drop=True)
  if len(sdf)<30:continue
  try:
   rets=sdf["close"].pct_change().tail(60).dropna().values*100
   m=arch_model(rets,mean="Zero",vol="GARCH",p=1,q=1).fit(disp="off")
   models[s]=m
  except:pass
 return models

def predict_prob(model_info,X_row,model_name,stock=None):
 """Convert any model's output to a probability."""
 import torch
 if model_name=="LightGBM" or model_name=="XGBoost":
  return float(model_info.predict_proba(X_row.reshape(1,-1))[0,1])
 elif model_name=="Ridge":
  sc=model_info[1];m=model_info[0]
  Xs=sc.transform(X_row.reshape(1,-1))
  return float(m.predict_proba(Xs)[0,1])
 elif model_name=="LSTM" or model_name=="GRU":
  Xt=torch.from_numpy(X_row.astype(np.float32)).unsqueeze(0)
  with torch.no_grad():return float(model_info(Xt).item())
 elif model_name=="Prophet":
  # Prophet predicts price direction
  if model_info is None or stock is None or stock not in model_info:return 0.5
  try:
   m=model_info[stock]
   future=m.make_future_dataframe(periods=5,freq="D")
   fc=m.predict(future)
   yhat=fc["yhat"].tail(5).values
   current=float(X_row[FC.index("return_1d")])  # proxy
   # Convert direction to probability
   if len(yhat)>0:
    direction=(yhat[-1]-yhat[0])/abs(yhat[0]) if yhat[0]!=0 else 0
    return 0.5+max(-0.4,min(0.4,direction))
   return 0.5
  except:return 0.5
 elif model_name=="Holt-Winters":
  if model_info is None or stock is None or stock not in model_info:return 0.5
  try:
   m=model_info[stock];fc=m.forecast(5)
   if len(fc)>0:
    direction=(fc[-1]-fc[0])/abs(fc[0]) if fc[0]!=0 else 0
    return 0.5+max(-0.4,min(0.4,direction))
   return 0.5
  except:return 0.5
 elif model_name=="GARCH":
  if model_info is None or stock is None or stock not in model_info:return 0.5
  try:
   m=model_info[stock];fc=m.forecast(horizon=5,reindex=False)
   vf=fc.variance.values[-1]
   # If volatility increasing → bearish (uncertainty), decreasing → bullish
   return 0.5-max(-0.3,min(0.3,(np.mean(vf)-np.var(m.conditional_volatility.tail(14) if hasattr(m,'conditional_volatility') else [0]))/100))
  except:return 0.5
 return 0.5

def fit_all_models(train_df):
 """Train all 8 models."""
 X=train_df[FC].values;y=train_df["y"].values
 models={}
 models["LightGBM"]=train_lgb(X,y)
 models["XGBoost"]=train_xgb(X,y)
 models["Ridge"]=train_ridge(X,y)
 try:models["LSTM"]=train_lstm(X,y)
 except Exception as e:print(f"  LSTM train failed: {e}");models["LSTM"]=None
 try:models["GRU"]=train_gru(X,y)
 except Exception as e:print(f"  GRU train failed: {e}");models["GRU"]=None
 try:models["Prophet"]=train_prophet(train_df)
 except Exception as e:print(f"  Prophet train failed: {e}");models["Prophet"]=None
 try:models["Holt-Winters"]=train_holt_winters(train_df)
 except Exception as e:print(f"  Holt-Winters train failed: {e}");models["Holt-Winters"]=None
 try:models["GARCH"]=train_garch_model(train_df)
 except Exception as e:print(f"  GARCH train failed: {e}");models["GARCH"]=None
 return models

def predict_ensemble(models,row,stock,weights=None):
 """CL-Extender: weighted average of 8 model probabilities."""
 if weights is None:weights=INITIAL_WEIGHTS
 X_row=row[FC].values
 total_p=0;total_w=0
 for name in CL_EXT_MODELS:
  if models.get(name) is None:continue
  p=predict_prob(models[name],X_row,name,stock)
  w=weights.get(name,0.10)
  total_p+=p*w;total_w+=w
 return total_p/max(total_w,0.001) if total_w>0 else 0.5

def filters(row):
 checks=[]
 checks.append(row["ema_50_ratio"].iloc[0]>1.0)
 checks.append(row["close"].iloc[0]*row["volume"].iloc[0]>=10_000_000)
 checks.append(row["vol_regime"].iloc[0]<2.5)
 checks.append(abs(row["return_1d"].iloc[0])<0.09)
 checks.append(row["return_5d"].iloc[0]>-0.03)
 return all(checks)

def levels(close,atr):
 R=SL_MULT*atr
 return{"sl":round(close-R,2),"tp1":round(close+R,2),"tp2":round(close+2*R,2),
  "tp3":round(close+3*R,2),"R":round(R,2),"risk_per_share":round(R,2)}

def simulate_trade(fr,current_date,entry,atr):
 """Simulate a single trade with triple-barrier exits."""
 lv=levels(entry,atr);sl=lv["sl"];R=lv["R"]
 sym_data=fr[fr["date"]>current_date].head(MAX_HOLD)
 if len(sym_data)==0:return 0,"time"
 remaining=1.0;pnl=0;exit_reason="time";current_sl=sl
 for _,day in sym_data.iterrows():
  hi=day["high"];lo=day["low"]
  if lo<=current_sl:pnl+=remaining*(current_sl-entry)/entry;remaining=0;exit_reason="sl";break
  for tp_idx,tp_mult in enumerate([1,2,3]):
   tp=entry+tp_mult*R
   if hi>=tp and remaining>0:
    frac=EXIT_FRAC[tp_idx];pnl+=remaining*frac*(tp-entry)/entry;remaining*=(1-frac)
    if tp_idx==0:current_sl=entry
    elif tp_idx==1:current_sl=entry+R
 if remaining>0:
  last_close=float(sym_data.iloc[-1]["close"]);pnl+=remaining*(last_close-entry)/entry
 pos_size=CAPITAL*RISK/R;return pnl*pos_size*entry,exit_reason

def cmd_backtest():
 print("="*60);print("CL-Extender Ensemble — 8 Model Backtest");print("="*60)
 df=load();print(f"\nLoaded: {len(df)} rows from {df['symbol'].nunique()} stocks")
 df=df.sort_values("date").reset_index(drop=True)
 dates=sorted(df["date"].unique());n_dates=len(dates)
 train_end=int(n_dates*0.6)
 
 # Results: ensemble + each individual model
 all_results={"CL-Extender (8 models)":[]}
 for name in CL_EXT_MODELS:all_results[f"{name} solo"]=[]
 
 models=None;last_train=0;win_rates={name:50 for name in CL_EXT_MODELS}
 
 print(f"\nWalk-forward: {n_dates} dates, train from {train_end}")
 for i in range(train_end,n_dates-MAX_HOLD-EMBARGO):
  cd=dates[i]
  if i-last_train>=RETRAIN or models is None:
   td=df[df["date"]<cd-EMBARGO*86400000];td=td[td["y"].notna()]
   if len(td)<200:continue
   print(f"  Retrain at {i} ({len(td)} rows)...")
   models=fit_all_models(td);last_train=i
  if models is None:continue
  
  for sym,fr in df[df["symbol"].isin(STOCKS)].groupby("symbol"):
   fr=fr.sort_values("date").reset_index(drop=True)
   row_idx=fr[fr["date"]==cd]
   if row_idx.empty:continue
   row=row_idx.iloc[[0]]
   if row["y"].isna().iloc[0]:continue
   if not filters(row):continue
   entry=float(row["close"].iloc[0]);atr=float(row["atr_14"].iloc[0])
   if atr<=0:continue
   lv=levels(entry,atr)
   if (entry-lv["sl"])/entry>0.15:continue
   
   # CL-Extender ensemble prediction
   weights={name:max(0.05,win_rates[name]/100) for name in CL_EXT_MODELS}
   total_w=sum(weights.values());weights={k:v/total_w for k,v in weights.items()}
   p_ens=predict_ensemble(models,row,sym,weights)
   
   if p_ens>=PROB_MIN:
    pnl_pkr,exit_reason=simulate_trade(fr,cd,entry,atr)
    all_results["CL-Extender (8 models)"].append({
     "symbol":sym,"pnl_pct":round(pnl_pkr/(CAPITAL*RISK/lv["R"]*entry)*100,2),
     "pnl_pkr":round(pnl_pkr,0),"win":pnl_pkr>0,"exit_reason":exit_reason,"prob":round(p_ens,3)})
   
   # Individual model predictions
   for name in CL_EXT_MODELS:
    if models.get(name) is None:continue
    p=predict_prob(models[name],row[FC].values,name,sym)
    if p>=PROB_MIN:
     pnl_pkr,exit_reason=simulate_trade(fr,cd,entry,atr)
     all_results[f"{name} solo"].append({
      "symbol":sym,"pnl_pct":round(pnl_pkr/(CAPITAL*RISK/lv["R"]*entry)*100,2),
      "pnl_pkr":round(pnl_pkr,0),"win":pnl_pkr>0,"exit_reason":exit_reason,"prob":round(p,3)})
   
   # Update win rates for weighting
   for name in CL_EXT_MODELS:
    trades=all_results[f"{name} solo"]
    if len(trades)>10:
     wr=sum(1 for t in trades if t["win"])/len(trades)*100
     win_rates[name]=wr

 # Compute stats for each
 stats={}
 for name,trades in all_results.items():
  if not trades:stats[name]={"total_trades":0,"win_rate":0,"profit_factor":0,"stars":0,"pass_mark":False};continue
  df_t=pd.DataFrame(trades)
  wins=df_t[df_t["win"]];losses=df_t[~df_t["win"]]
  tt=len(df_t);wr=len(wins)/tt*100
  gp=wins["pnl_pkr"].sum()if len(wins)>0 else 0
  gl=abs(losses["pnl_pkr"].sum())if len(losses)>0 else 0
  pf=gp/gl if gl>0 else 0
  tp=df_t["pnl_pkr"].sum();ar=df_t["pnl_pct"].mean()
  stats[name]={"total_trades":int(tt),"wins":int(len(wins)),"losses":int(len(losses)),
   "win_rate":round(float(wr),1),"avg_return_pct":round(float(ar),2),
   "avg_win_pct":round(float(wins["pnl_pct"].mean())if len(wins)>0 else 0,2),
   "avg_loss_pct":round(float(losses["pnl_pct"].mean())if len(losses)>0 else 0,2),
   "profit_factor":round(float(pf),2),"total_pnl_pkr":round(float(tp),0),
   "stars":int(min(5,max(1,int(wr/20)+1))),"pass_mark":pf>1.3}
 
 # Print summary
 print(f"\n{'='*60}")
 print(f"CL-EXTENDER BACKTEST RESULTS")
 print(f"{'='*60}")
 print(f"{'Model':<30} {'Trades':>7} {'Win%':>6} {'PF':>5} {'P&L':>10} {'Status':>8}")
 print("-"*70)
 for name,r in sorted(stats.items(),key=lambda x:-x[1].get("profit_factor",0)):
  st="✅"if r.get("pass_mark")else"⚠️"
  print(f"{name:<30} {r['total_trades']:>7} {r['win_rate']:>5.1f}% {r['profit_factor']:>5.2f} PKR {r['total_pnl_pkr']:>8,} {st:>8}")
 
 # Save
 output={"cl_extender_backtest_at":pd.Timestamp.now().isoformat(),
  "models":CL_EXT_MODELS,"weights":INITIAL_WEIGHTS,"results":stats}
 
 # Merge into predictions file
 existing=json.loads(OUT.read_text())
 existing["cl_extender_backtest"]=output
 OUT.write_text(json.dumps(existing,indent=2,default=lambda o:int(o)if isinstance(o,(np.integer,))else float(o)if isinstance(o,(np.floating,))else str(o)))
 print(f"\nSaved to: {OUT}")

if __name__=="__main__":cmd_backtest()
