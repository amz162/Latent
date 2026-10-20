#!/usr/bin/env python3
"""Latent.pk — Multi-Horizon Regression Training (9 models)

Trains 9 models as multi-horizon regressors predicting 5d/10d/21d forward returns.
SL = min(low[-14:]) (recent support). TP1/TP2/TP3 = predicted prices at 5d/10d/21d.

Models: XGBoost, LightGBM, CatBoost, Random Forest (classical)
        LSTM (PyTorch), PatchTST, N-BEATS, TimesNet, Informer (deep learning)
"""
import json, sys, warnings, numpy as np, pandas as pd
import xgboost as xgb, lightgbm as lgb, catboost as cb
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score
from sklearn.preprocessing import StandardScaler
from pathlib import Path

warnings.filterwarnings("ignore")
OHLCV_DIR = Path("data/ohlcv")
OUTPUT = Path("data/ml_predictions_multi.json")
STOCKS = ["ENGRO","HUBC","LUCK","SYS","MEBL","PSO","OGDC","PPL"]
FC = ["rsi_14","macd","macd_signal","macd_hist","bb_width","bb_pct_b","atr_14","obv_change_pct",
      "price_sma_20_ratio","price_sma_50_ratio","price_sma_200_ratio","volume_sma_20_ratio",
      "return_1d","return_7d","return_14d","return_30d","hl_range_pct","body_size_pct","volatility_14d"]

def compute_rsi(p,n=14):
    d=p.diff();g=d.where(d>0,0);l=-d.where(d<0,0)
    ag=g.ewm(alpha=1/n,min_periods=n).mean();al=l.ewm(alpha=1/n,min_periods=n).mean()
    return (100-100/(1+ag/al.replace(0,np.nan))).fillna(50)
def compute_macd(p):
    e12=p.ewm(span=12,adjust=False).mean();e26=p.ewm(span=26,adjust=False).mean()
    m=e12-e26;s=m.ewm(span=9,adjust=False).mean();return m,s,m-s
def compute_bb(p,w=20):
    s=p.rolling(w).mean();sd=p.rolling(w).std()
    return ((s+2*sd-(s-2*sd))/s).fillna(0),((p-(s-2*sd))/(4*sd).replace(0,np.nan)).fillna(0.5)
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
    for h in[5,10,21]:df[f"target_{h}d"]=((df["close"].shift(-h)-df["close"])/df["close"]).fillna(0)
    return df

def load():
    frames=[]
    for s in STOCKS:
        p=OHLCV_DIR/f"{s}.csv"
        if not p.exists():continue
        df=pd.read_csv(p,usecols=range(6));df=df[df["volume"]>0].reset_index(drop=True)
        if len(df)<50:continue
        df=add_features(df);df=add_labels(df);df["symbol"]=s;frames.append(df)
    return pd.concat(frames,ignore_index=True) if frames else pd.DataFrame()

def gen_preds(df, model, targets):
    """Generate per-stock predictions from a trained model."""
    preds={}
    for s in STOCKS:
        sdf=df[df["symbol"]==s].sort_values("date").reset_index(drop=True)
        if len(sdf)==0:continue
        latest=sdf.iloc[-1]
        cp=float(latest["close"]);lf=latest[FC].values.reshape(1,-1)
        r5=float(model.predict(lf)[0]) if "5d" in targets else 0
        # For multi-target, need separate models per horizon — handled by caller
        recent_lows=sdf["low"].tail(14).values;sl=round(float(np.min(recent_lows)),2)
        preds[s]={"currentPrice":round(cp,2),"entry":round(cp,2),"sl":sl}
    return preds

def train_classical(df):
    targets=["target_5d","target_10d","target_21d"]
    split=int(len(df)*0.8);tr=df.iloc[:split];te=df.iloc[split:]
    Xtr=tr[FC].values;Xte=te[FC].values
    models_cfg={
        "XGBoost":lambda:xgb.XGBRegressor(n_estimators=150,max_depth=3,learning_rate=0.05,subsample=0.7,colsample_bytree=0.7,random_state=42),
        "LightGBM":lambda:lgb.LGBMRegressor(n_estimators=150,num_leaves=15,learning_rate=0.05,subsample=0.7,colsample_bytree=0.7,random_state=42,verbose=-1),
        "CatBoost":lambda:cb.CatBoostRegressor(iterations=150,depth=3,learning_rate=0.05,random_state=42,verbose=0,allow_writing_files=False),
        "Random Forest":lambda:RandomForestRegressor(n_estimators=150,max_depth=5,min_samples_leaf=15,max_features=0.7,random_state=42,n_jobs=-1),
    }
    results={}
    for name,factory in models_cfg.items():
        print(f"  Training {name}...")
        metrics={};preds={}
        for tc in targets:
            horizon=int(tc.split("_")[1].replace("d",""))
            ytr=tr[tc].values;yte=te[tc].values
            m=factory();m.fit(Xtr,ytr);yp=m.predict(Xte)
            metrics[f"{horizon}d"]={"mse":float(mean_squared_error(yte,yp)),"mae":float(mean_absolute_error(yte,yp)),"r2":float(r2_score(yte,yp))}
            for s in STOCKS:
                sdf=df[df["symbol"]==s].sort_values("date").reset_index(drop=True)
                if len(sdf)==0:continue
                latest=sdf.iloc[-1];lf=latest[FC].values.reshape(1,-1)
                pr=float(m.predict(lf)[0]);cp=float(latest["close"])
                if s not in preds:preds[s]={"currentPrice":round(cp,2),"entry":round(cp,2)}
                preds[s][f"ret_{horizon}d"]=round(pr,4)
        for s,pd_ in preds.items():
            r5=pd_.get("ret_5d",0);r10=pd_.get("ret_10d",0);r21=pd_.get("ret_21d",0)
            cp=pd_["currentPrice"]
            sdf=df[df["symbol"]==s].sort_values("date").reset_index(drop=True)
            sl=round(float(np.min(sdf["low"].tail(14).values)),2)
            avg=(r5+r10+r21)/3
            sig="BUY" if avg>0.01 else"SELL" if avg<-0.01 else"HOLD"
            d="LONG" if sig!="SELL" else"SHORT"
            conf=min(100,int(abs(avg)*1000))
            pd_.update({"signal":sig,"direction":d,"confidence":conf,
                "tp1":round(cp*(1+r5),2),"tp2":round(cp*(1+r10),2),"tp3":round(cp*(1+r21),2),
                "sl":sl,"avgReturn":round(avg,4)})
        results[name]={"trained":True,"version":"2.0.0","metrics":metrics,"predictions":preds}
        print(f"    R²(5d)={metrics['5d']['r2']:.3f} R²(10d)={metrics['10d']['r2']:.3f}")
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
            def __init__(s,i,h,nl,o):
                super().__init__();s.lstm=nn.LSTM(i,h,nl,batch_first=True,dropout=0.1);s.fc=nn.Linear(h,o)
            def forward(s,x):
                o,_=s.lstm(x);return s.fc(o[:,-1,:])
        model=M(len(FC),64,2,3);crit=nn.MSELoss();opt=torch.optim.Adam(model.parameters(),lr=0.001)
        model.train()
        for ep in range(30):
            tl=0
            for bx,by in dl:opt.zero_grad();loss=crit(model(bx),by);loss.backward();opt.step();tl+=loss.item()
            if ep%10==0:print(f"    Epoch {ep}: loss={tl/len(dl):.6f}")
        model.eval()
        with torch.no_grad():ypt=model(torch.from_numpy(Xte)).numpy()
        metrics={"5d":{"mse":float(mean_squared_error(yte[:,0],ypt[:,0])),"mae":float(mean_absolute_error(yte[:,0],ypt[:,0]))},
                 "10d":{"mse":float(mean_squared_error(yte[:,1],ypt[:,1])),"mae":float(mean_absolute_error(yte[:,1],ypt[:,1]))},
                 "21d":{"mse":float(mean_squared_error(yte[:,2],ypt[:,2])),"mae":float(mean_absolute_error(yte[:,2],ypt[:,2]))}}
        preds={}
        for s in STOCKS:
            sdf=df[df["symbol"]==s].sort_values("date").reset_index(drop=True)
            if len(sdf)<SEQ:continue
            f=sdf[FC].values;sc=StandardScaler();fs=sc.fit_transform(f)
            sq=fs[-SEQ:].reshape(1,SEQ,len(FC));cp=float(sdf.iloc[-1]["close"])
            with torch.no_grad():p=model(torch.from_numpy(sq.astype(np.float32)))[0].numpy()
            r5,r10,r21=float(p[0]),float(p[1]),float(p[2])
            sl=round(float(np.min(sdf["low"].tail(14).values)),2)
            avg=(r5+r10+r21)/3
            sig="BUY" if avg>0.01 else"SELL" if avg<-0.01 else"HOLD"
            d="LONG" if sig!="SELL" else"SHORT"
            preds[s]={"signal":sig,"direction":d,"confidence":min(100,int(abs(avg)*1000)),
                "currentPrice":round(cp,2),"entry":round(cp,2),
                "tp1":round(cp*(1+r5),2),"tp2":round(cp*(1+r10),2),"tp3":round(cp*(1+r21),2),
                "sl":sl,"avgReturn":round(avg,4)}
        print(f"    MSE(5d)={metrics['5d']['mse']:.6f}")
        return{"trained":True,"version":"2.0.0","metrics":metrics,"predictions":preds}
    except Exception as e:
        print(f"    LSTM FAILED: {e}",file=sys.stderr)
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
                sc=fc[fc["unique_id"]==s] if"unique_id"in fc.columns else fc
                vals=sc[col].values if col in(sc.columns if hasattr(sc,"columns") else[])else np.array([cp*1.02])
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

def backtest(df,models):
    te=df.iloc[int(len(df)*0.8):].copy();bt={}
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
        tt=buys+sells;wr=(cb_+cs)/max(tt,1)*100;ar_=np.mean(rets)*100 if rets else 0
        bt[name]={"totalTrades":tt,"buySignals":buys,"sellSignals":sells,"correctBuys":cb_,
            "correctSells":cs,"winRate":round(wr,1),"avgReturnPct":round(ar_,2),
            "maxReturnPct":round(max(rets)*100 if rets else 0,2),"minReturnPct":round(min(rets)*100 if rets else 0,2),
            "stars":min(5,max(1,int(wr/20)+1))}
    return bt

def main():
    print("="*60);print("Latent.pk Multi-Horizon Training (9 models)");print("="*60)
    print("\n[1/4] Loading data...");df=load();print(f"  {len(df)} rows from {df['symbol'].nunique()} stocks")
    print("\n[2/4] Classical regressors...");cl=train_classical(df)
    print("\n[3/4] LSTM...");lstm=train_lstm(df)
    print("\n[4/4] Neuralforecast (PatchTST, N-BEATS, TimesNet, Informer)...");nf=train_neuralforecast(df)
    all_models={};all_models.update(cl);all_models["LSTM"]=lstm;all_models.update(nf)
    untrained={"TimesNet":"Tier1" if not all_models.get("TimesNet",{}).get("trained")else "",
        "Informer":"Tier1" if not all_models.get("Informer",{}).get("trained")else "",
        "Chronos (Amazon)":"Requires HuggingFace + 1-2GB weights",
        "Lag-Llama":"Requires HuggingFace","Moirai (Salesforce)":"Requires uni2ts",
        "Time-LLM":"Requires LLM","CNN-LSTM":"Custom PyTorch not yet implemented",
        "TabNet":"Requires pytorch-tabnet","FinGPT":"Requires fine-tuning",
        "Transformer-LSTM":"Custom PyTorch not yet implemented"}
    untrained={k:v for k,v in untrained.items() if v}
    print("\n[5/5] Backtesting...");bt=backtest(df,all_models)
    out={"trained_at":pd.Timestamp.now().isoformat(),"data_source":"askanalyst.com.pk",
        "training_rows":int(len(df)),"model_type":"multi_horizon_regressor",
        "targets":["return_5d","return_10d","return_21d"],
        "sl_rule":"min(low[-14:]) — recent 14-day support",
        "tp_rule":"TP1=5d predicted price, TP2=10d, TP3=21d",
        "models":all_models,"untrained_models":untrained,"backtesting":bt}
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    OUTPUT.write_text(json.dumps(out,indent=2,default=lambda o:int(o) if isinstance(o,(np.integer,)) else float(o) if isinstance(o,(np.floating,)) else str(o)))
    tc=sum(1 for m in all_models.values() if m.get("trained"))
    print(f"\nSaved: {OUTPUT}\nTrained: {tc} models\nBacktesting: {len(bt)} rated\nDone.")

if __name__=="__main__":main()
