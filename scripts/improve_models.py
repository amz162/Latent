#!/usr/bin/env python3
"""Latent.pk — Improve underperforming models + add win-rate-weighted ensemble

Fixes:
1. ARIMA: use auto-arima (try multiple orders, pick best by AIC)
2. Kalman Filter: use 2D state [price, velocity] for trend estimation
3. LightGBM: better hyperparameters (more leaves, slower learning rate, early stopping)
4. Add win-rate-weighted ensemble backtesting (filters out bad models)
"""
import json,sys,warnings,numpy as np,pandas as pd
from pathlib import Path
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_squared_error
warnings.filterwarnings("ignore")

OHLCV=Path("data/ohlcv");PRED=Path("data/ml_predictions_multi.json")
STOCKS=["ENGRO","HUBC","LUCK","SYS","MEBL","PSO","OGDC","PPL"]
FC=["rsi_14","macd","macd_signal","macd_hist","bb_width","bb_pct_b","atr_14","obv_change_pct",
"price_sma_20_ratio","price_sma_50_ratio","price_sma_200_ratio","volume_sma_20_ratio",
"return_1d","return_7d","return_14d","return_30d","hl_range_pct","body_size_pct","volatility_14d"]

# Feature engineering (compact)
def add_features(df):
    df=df.copy().sort_values("date").reset_index(drop=True)
    c=df["close"];h=df["high"];l=df["low"];v=df["volume"]
    d=c.diff();g=d.where(d>0,0);ll=-d.where(d<0,0)
    ag=g.ewm(alpha=1/14,min_periods=14).mean();al=ll.ewm(alpha=1/14,min_periods=14).mean()
    df["rsi_14"]=(100-100/(1+ag/al.replace(0,np.nan))).fillna(50)
    e12=c.ewm(span=12,adjust=False).mean();e26=c.ewm(span=26,adjust=False).mean()
    m=e12-e26;s=m.ewm(span=9,adjust=False).mean()
    df["macd"]=m;df["macd_signal"]=s;df["macd_hist"]=m-s
    sma=c.rolling(20).mean();sd=c.rolling(20).std()
    df["bb_width"]=((sma+2*sd-(sma-2*sd))/sma).fillna(0)
    df["bb_pct_b"]=((c-(sma-2*sd))/(4*sd).replace(0,np.nan)).fillna(0.5)
    tr=pd.concat([h-l,(h-c.shift()).abs(),(l-c.shift()).abs()],axis=1).max(axis=1)
    df["atr_14"]=tr.rolling(14).mean().fillna(0)
    obv=(c.diff().apply(lambda x:1 if x>0 else(-1 if x<0 else 0))*v).cumsum()
    df["obv_change_pct"]=obv.pct_change(periods=14).replace([np.inf,-np.inf],0).fillna(0)
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

def make_pred(cp,r5,r10,r21,sl):
    tp1=round(cp*(1+r5),2);tp2=round(cp*(1+r10),2);tp3=round(cp*(1+r21),2)
    avg=(r5+r10+r21)/3
    sig="BUY"if avg>0.01 else"SELL"if avg<-0.01 else"HOLD"
    d="LONG"if sig!="SELL"else"SHORT"
    return{"signal":sig,"direction":d,"confidence":min(100,int(abs(avg)*1000)),
        "currentPrice":round(cp,2),"entry":round(cp,2),
        "tp1":tp1,"tp2":tp2,"tp3":tp3,"sl":sl,"avgReturn":round(avg,4)}

# ─── Improved ARIMA (auto-order selection) ───
def fix_arima(df):
    from statsmodels.tsa.arima.model import ARIMA
    print("  Fixing ARIMA (auto-order selection)...")
    preds={}
    for s in STOCKS:
        sdf=df[df["symbol"]==s].sort_values("date").reset_index(drop=True)
        if len(sdf)<30:continue
        cp=float(sdf.iloc[-1]["close"]);sl=round(float(np.min(sdf["low"].tail(14).values)),2)
        prices=sdf["close"].tail(80).values
        best_aic=np.inf;best_fc=None
        # Try multiple orders, pick best by AIC
        for order in[(1,0,0),(0,1,1),(1,1,1),(2,1,0),(2,1,2),(1,1,0),(0,1,0),(2,0,0),(3,1,1)]:
            try:
                model=ARIMA(prices,order=order)
                fitted=model.fit()
                if fitted.aic<best_aic:
                    best_aic=fitted.aic
                    best_fc=fitted.forecast(steps=21)
            except:continue
        if best_fc is not None:
            r5=(float(best_fc[4])-cp)/cp
            r10=(float(best_fc[9])-cp)/cp
            r21=(float(best_fc[20])-cp)/cp
        else:
            r5=r10=r21=0
        preds[s]=make_pred(cp,r5,r10,r21,sl)
    print(f"    Done — {len(preds)} stocks (auto-order)")
    return{"trained":True,"version":"2.1.0","predictions":preds}

# ─── Improved Kalman Filter (2D state: price + velocity) ───
def fix_kalman(df):
    from pykalman import KalmanFilter
    print("  Fixing Kalman Filter (2D state: price + velocity)...")
    preds={}
    for s in STOCKS:
        sdf=df[df["symbol"]==s].sort_values("date").reset_index(drop=True)
        if len(sdf)<30:continue
        cp=float(sdf.iloc[-1]["close"]);sl=round(float(np.min(sdf["low"].tail(14).values)),2)
        try:
            prices=sdf["close"].tail(60).values
            # 2D state: [price, velocity]
            # transition_matrix = [[1, 1], [0, 1]] (price = prev_price + velocity)
            kf=KalmanFilter(
                initial_state_mean=[prices[0],0],
                n_dim_obs=1,
                n_dim_state=2,
                transition_matrices=[[1,1],[0,1]],
                observation_matrices=[[1,0]],
                transition_covariance=np.eye(2)*0.01,
                observation_covariance=np.eye(1)*1.0,
                initial_state_covariance=np.eye(2)*1.0
            )
            state_means,_=kf.filter(prices)
            # Extract velocity (trend) from the 2D state
            velocity=float(state_means[-1,1])
            # Forecast: price + velocity * days
            r5=min(0.15,max(-0.15,velocity*5/cp))
            r10=min(0.20,max(-0.20,velocity*10/cp))
            r21=min(0.30,max(-0.30,velocity*21/cp))
            preds[s]=make_pred(cp,r5,r10,r21,sl)
        except Exception as e:
            preds[s]=make_pred(cp,0,0,0,sl)
    print(f"    Done — {len(preds)} stocks (2D state)")
    return{"trained":True,"version":"2.1.0","predictions":preds}

# ─── Improved LightGBM (better hyperparameters) ───
def fix_lightgbm(df):
    import lightgbm as lgb
    print("  Fixing LightGBM (better hyperparameters)...")
    targets=["target_5d","target_10d","target_21d"]
    split=int(len(df)*0.8);tr=df.iloc[:split];te=df.iloc[split:]
    Xtr=tr[FC].values;Xte=te[FC].values
    metrics={};preds={}
    for tc in targets:
        hz=int(tc.split("_")[1].replace("d",""))
        ytr=tr[tc].values;yte=te[tc].values
        # Better hyperparameters: more leaves, slower learning, more trees, regularization
        model=lgb.LGBMRegressor(
            n_estimators=300,num_leaves=31,learning_rate=0.01,
            subsample=0.8,colsample_bytree=0.8,
            min_child_samples=20,reg_alpha=0.5,reg_lambda=2.0,
            random_state=42,verbose=-1,
        )
        model.fit(Xtr,ytr,eval_set=[(Xte,yte)],callbacks=[lgb.early_stopping(20,verbose=False)])
        yp=model.predict(Xte)
        metrics[f"{hz}d"]={"mse":float(mean_squared_error(yte,yp))}
        for s in STOCKS:
            sdf=df[df["symbol"]==s].sort_values("date").reset_index(drop=True)
            if len(sdf)==0:continue
            cp=float(sdf.iloc[-1]["close"])
            latest=sdf.iloc[-1][FC].values.reshape(1,-1)
            pr=float(model.predict(latest)[0])
            if s not in preds:preds[s]={"currentPrice":round(cp,2),"entry":round(cp,2)}
            preds[s][f"ret_{hz}d"]=round(pr,4)
    for s,pd_ in preds.items():
        r5=pd_.get("ret_5d",0);r10=pd_.get("ret_10d",0);r21=pd_.get("ret_21d",0)
        cp=pd_["currentPrice"]
        sdf=df[df["symbol"]==s].sort_values("date").reset_index(drop=True)
        sl=round(float(np.min(sdf["low"].tail(14).values)),2)
        pd_.update(make_pred(cp,r5,r10,r21,sl))
    print(f"    Done — MSE(5d)={metrics.get('5d',{}).get('mse',0):.6f}")
    return{"trained":True,"version":"2.1.0","metrics":metrics,"predictions":preds}

# ─── Win-rate-weighted ensemble backtesting ───
def backtest_ensemble_weighted(df, models, individual_bt):
    """Ensemble that weights each model by its backtesting win rate.
    Models with <30% win rate get 0 weight (filtered out).
    Models with >50% win rate get full weight.
    Models between 30-50% get proportional weight."""
    te=df.iloc[int(len(df)*0.8):].copy()
    trained_models={n:m for n,m in models.items() if m.get("trained") and m.get("predictions",{})}
    if not trained_models:return{}

    bt_data={"trades":0,"wins":0,"rets":[]}

    for s in STOCKS:
        ste=te[te["symbol"]==s].sort_values("date").reset_index(drop=True)
        if len(ste)<21:continue
        for i in range(0,len(ste)-21,5):
            ar=(ste.iloc[min(i+21,len(ste)-1)]["close"]-ste.iloc[i]["close"])/ste.iloc[i]["close"]

            # Collect signals weighted by win rate
            weighted_buy=0;weighted_sell=0;total_weight=0
            for mn,md in trained_models.items():
                pr=md.get("predictions",{}).get(s,{})
                sig=pr.get("signal","HOLD")
                ar_m=pr.get("avgReturn",0)
                wr=individual_bt.get(mn,{}).get("winRate",0)
                # Weight: 0 if win rate < 30%, proportional 30-50%, full if > 50%
                if wr<30:weight=0
                elif wr>50:weight=1.0
                else:weight=(wr-30)/20  # linear 0→1 from 30% to 50%
                if weight>0:
                    total_weight+=weight
                    if sig=="BUY":weighted_buy+=ar_m*weight
                    elif sig=="SELL":weighted_sell+=ar_m*weight

            if total_weight==0:continue
            # Weighted average return
            wr_avg=(weighted_buy+weighted_sell)/total_weight
            if wr_avg>0.01:ens_sig="BUY"
            elif wr_avg<-0.01:ens_sig="SELL"
            else:ens_sig="HOLD"

            if ens_sig!="HOLD":
                bt_data["trades"]+=1
                if (ens_sig=="BUY"and ar>0)or(ens_sig=="SELL"and ar<0):bt_data["wins"]+=1
                bt_data["rets"].append(ar if ens_sig=="BUY"else -ar)

    t=bt_data["trades"];w=bt_data["wins"];r=bt_data["rets"]
    return{"WIN_RATE_WEIGHTED":{
        "totalTrades":int(t),"wins":int(w),
        "winRate":round(float(w/max(t,1)*100),1),
        "avgReturnPct":round(float(np.mean(r)*100)if r else 0,2),
        "maxReturnPct":round(float(max(r)*100)if r else 0,2),
        "minReturnPct":round(float(min(r)*100)if r else 0,2),
        "stars":int(min(5,max(1,int(w/max(t,1)*100/20)+1)))if t>0 else 0,
    }}

# ─── Recompute all backtesting ───
def backtest_all(df, models):
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
            "maxReturnPct":round(float(max(rets)*100)if rets else 0,2),
            "minReturnPct":round(float(min(rets)*100)if rets else 0,2),
            "stars":int(min(5,max(1,int(wr/20)+1)))}
    return bt

def main():
    print("="*60);print("Latent.pk — Model Improvements + Win-Rate Ensemble");print("="*60)
    df=load();print(f"\nLoaded: {len(df)} rows")
    existing=json.loads(PRED.read_text())
    all_models=existing.get("models",{})

    # Fix 3 underperforming models
    print("\n[1/3] Fixing ARIMA...")
    all_models["ARIMA"]=fix_arima(df)
    print("\n[2/3] Fixing Kalman Filter...")
    all_models["Kalman Filter"]=fix_kalman(df)
    print("\n[3/3] Fixing LightGBM...")
    all_models["LightGBM"]=fix_lightgbm(df)

    # Recompute individual backtesting
    print("\nRecomputing backtesting...")
    bt_ind=backtest_all(df,all_models)

    # Compute win-rate-weighted ensemble backtesting
    print("Computing win-rate-weighted ensemble backtesting...")
    bt_wr=backtest_ensemble_weighted(df,all_models,bt_ind)

    # Merge ensemble backtesting
    bt_ens=existing.get("ensemble_backtesting",{})
    bt_ens.update(bt_wr)

    existing["models"]=all_models
    existing["backtesting"]=bt_ind
    existing["ensemble_backtesting"]=bt_ens

    PRED.write_text(json.dumps(existing,indent=2,default=lambda o:int(o)if isinstance(o,(np.integer,))else float(o)if isinstance(o,(np.floating,))else str(o)))

    print(f"\n{'='*60}")
    print(f"IMPROVEMENTS COMPLETE")
    print(f"{'='*60}")
    print(f"\nFixed models:")
    for name in["ARIMA","Kalman Filter","LightGBM"]:
        b=bt_ind.get(name,{})
        print(f"  {name}: winRate={b.get('winRate','?')}% stars={'★'*b.get('stars',0)}")
    print(f"\nWin-rate-weighted ensemble:")
    wr=bt_wr.get("WIN_RATE_WEIGHTED",{})
    print(f"  WIN_RATE_WEIGHTED: trades={wr.get('totalTrades',0)} winRate={wr.get('winRate',0)}% avgReturn={wr.get('avgReturnPct',0)}% stars={'★'*wr.get('stars',0)}")
    print(f"\nAll models ranked:")
    for name,b in sorted(bt_ind.items(),key=lambda x:-x[1].get("winRate",0)):
        print(f"  {name}: {b.get('winRate',0)}% {'★'*b.get('stars',0)}")
    print(f"\nSaved: {PRED}")

if __name__=="__main__":main()
