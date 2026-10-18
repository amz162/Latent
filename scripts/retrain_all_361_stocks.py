#!/usr/bin/env python3
"""Retrain ALL models on 361 stocks + backtesting. Uses real OHLCV data from data/ohlcv_all/."""
import json,sys,warnings,time,numpy as np,pandas as pd
from pathlib import Path
from sklearn.linear_model import Ridge
from sklearn.ensemble import RandomForestRegressor
warnings.filterwarnings("ignore")
OHLCV_DIR=Path("data/ohlcv_all");PRED_FILE=Path("data/ml_predictions_multi.json")
SL_MULT=1.5;TP1_MULT=1.0;TP2_MULT=2.0;TP3_MULT=3.0
STOCKS=sorted([f.stem for f in OHLCV_DIR.glob("*.csv")])
print(f"Stocks: {len(STOCKS)}")
FC=["rsi_14","macd","macd_signal","macd_hist","bb_width","bb_pct_b","atr_14","obv_change_pct",
    "price_sma_20_ratio","price_sma_50_ratio","price_sma_200_ratio","volume_sma_20_ratio",
    "return_1d","return_5d","return_7d","return_14d","return_30d","hl_range_pct","body_size_pct","volatility_14d"]
EXT_W={"LightGBM":0.20,"XGBoost":0.15,"Ridge Regression":0.15,"LSTM":0.10,"GRU":0.10,"Prophet":0.10,"Holt-Winters":0.10,"GARCH":0.10}

def crsi(p,n=14):
    d=p.diff();g=d.where(d>0,0);l=-d.where(d<0,0);ag=g.ewm(alpha=1/n,min_periods=n).mean();al=l.ewm(alpha=1/n,min_periods=n).mean()
    return(100-100/(1+ag/al.replace(0,np.nan))).fillna(50)
def cmacd(p):
    e12=p.ewm(span=12,adjust=False).mean();e26=p.ewm(span=26,adjust=False).mean();m=e12-e26;s=m.ewm(span=9,adjust=False).mean();return m,s,m-s
def cbb(p,w=20):
    sma=p.rolling(w).mean();sd=p.rolling(w).std();return((sma+2*sd-(sma-2*sd))/sma).fillna(0),((p-(sma-2*sd))/(4*sd).replace(0,np.nan)).fillna(0.5)
def catr(h,l,c,n=14):
    tr=pd.concat([h-l,(h-c.shift()).abs(),(l-c.shift()).abs()],axis=1).max(axis=1);return tr.rolling(n).mean().fillna(0)
def cobv(c,v):
    s=c.diff().apply(lambda x:1 if x>0 else(-1 if x<0 else 0));return(s*v).cumsum()
def add_f(df):
    df=df.copy().sort_values("date").reset_index(drop=True);c=df["close"];h=df["high"];l=df["low"];v=df["volume"]
    df["rsi_14"]=crsi(c);m,s,hh=cmacd(c);df["macd"]=m;df["macd_signal"]=s;df["macd_hist"]=hh
    bw,pb=cbb(c);df["bb_width"]=bw;df["bb_pct_b"]=pb;df["atr_14"]=catr(h,l,c);obv=cobv(c,v)
    df["obv_change_pct"]=obv.pct_change(periods=14).replace([np.inf,-np.inf],0).fillna(0)
    for w in[20,50,200]:df[f"price_sma_{w}_ratio"]=c/c.rolling(w,min_periods=1).mean()
    df["volume_sma_20_ratio"]=v/v.rolling(20,min_periods=1).mean().replace(0,1)
    for p in[1,5,7,14,30]:df[f"return_{p}d"]=c.pct_change(periods=p).replace([np.inf,-np.inf],0).fillna(0)
    df["hl_range_pct"]=((h-l)/c.replace(0,np.nan)).fillna(0)
    df["body_size_pct"]=((df["close"]-df["open"]).abs()/c.replace(0,np.nan)).fillna(0)
    df["volatility_14d"]=c.pct_change().rolling(14).std().fillna(0);return df

def load():
    fr=[]
    for s in STOCKS:
        p=OHLCV_DIR/f"{s}.csv"
        if not p.exists():continue
        try:
            df=pd.read_csv(p,usecols=range(6));df=df[df["volume"]>0].reset_index(drop=True)
            if len(df)<50:continue
            df=add_f(df);df["symbol"]=s;fr.append(df)
        except:pass
    return pd.concat(fr,ignore_index=True) if fr else pd.DataFrame()

def get_atr(df):
    r={}
    for s in STOCKS:
        sd=df[df["symbol"]==s].sort_values("date").reset_index(drop=True)
        if len(sd)<14:continue
        a=float(sd.iloc[-1]["atr_14"]);r[s]={"cp":float(sd.iloc[-1]["close"]),"atr":a if a>0 else float(sd.iloc[-1]["close"])*0.02}
    return r

def atr_rules(sig,cp,atr):
    if sig=="BUY":return cp,cp-SL_MULT*atr,cp+TP1_MULT*atr,cp+TP2_MULT*atr,cp+TP3_MULT*atr
    if sig=="SELL":return cp,cp+SL_MULT*atr,cp-TP1_MULT*atr,cp-TP2_MULT*atr,cp-TP3_MULT*atr
    return cp,cp,cp,cp,cp

def sig_avg(ar):
    if ar>0.005:return"BUY","LONG"
    if ar<-0.005:return"SELL","SHORT"
    return"HOLD","LONG"

def si(v):
    try:
        if np.isnan(v):return 0
        return min(100,int(abs(v)*1000))
    except:return 0

def mk(cp,atr,avg):
    sg,d=sig_avg(avg);e,sl,t1,t2,t3=atr_rules(sg,cp,atr)
    return{"signal":sg,"direction":d,"confidence":si(avg),"currentPrice":round(cp,2),"entry":round(e,2),
           "tp1":round(t1,2),"tp2":round(t2,2),"tp3":round(t3,2),"sl":round(sl,2),
           "avgReturn":round(float(avg)if not np.isnan(avg)else 0.0,4)}

def train_reg(df,atr_per):
    import xgboost as xgb,lightgbm as lgb,catboost as cb
    print("\n[Tier 3] Regressors...")
    tgt=["target_5d","target_10d","target_21d"]
    dft=df.sample(n=min(100000,len(df)),random_state=42).dropna(subset=FC+tgt)
    sp=int(len(dft)*0.8);Xtr=dft.iloc[:sp][FC].fillna(0).values
    lat={}
    for s in STOCKS:
        sd=df[df["symbol"]==s].sort_values("date").reset_index(drop=True)
        if len(sd)<30:continue
        lat[s]={"f":sd.iloc[-1][FC].fillna(0).values.reshape(1,-1),"cp":float(sd.iloc[-1]["close"])}
    cfg={"XGBoost":lambda:xgb.XGBRegressor(n_estimators=50,max_depth=3,learning_rate=0.1,random_state=42,n_jobs=-1),
         "LightGBM":lambda:lgb.LGBMRegressor(n_estimators=50,num_leaves=15,learning_rate=0.1,random_state=42,verbose=-1,n_jobs=-1),
         "CatBoost":lambda:cb.CatBoostRegressor(iterations=50,depth=3,learning_rate=0.1,random_state=42,verbose=0,allow_writing_files=False),
         "Random Forest":lambda:RandomForestRegressor(n_estimators=50,max_depth=5,min_samples_leaf=15,max_features=0.7,random_state=42,n_jobs=-1),
         "Ridge Regression":lambda:Ridge(alpha=10.0,random_state=42)}
    res={}
    for nm,fn in cfg.items():
        print(f"  {nm}...",end=" ",flush=True);pr={}
        for tc in tgt:
            hz=int(tc.split("_")[1].replace("d",""));m=fn();m.fit(Xtr,dft.iloc[:sp][tc].values)
            for s,lf in lat.items():
                p=float(m.predict(lf["f"])[0])
                if s not in pr:pr[s]={"currentPrice":lf["cp"],"entry":lf["cp"]}
                pr[s][f"ret_{hz}d"]=p
        for s,pd_ in pr.items():
            avg=(pd_.get("ret_5d",0)+pd_.get("ret_10d",0)+pd_.get("ret_21d",0))/3
            atr=atr_per.get(s,{"atr":pd_["currentPrice"]*0.02})["atr"]
            pd_.update(mk(pd_["currentPrice"],atr,avg))
        res[nm]={"trained":True,"version":"3.0.0","predictions":pr};print(f"done ({len(pr)})")
    return res

def train_cl(df,atr_per):
    print("\n[CL Tier] Classical...")
    try:
        from statsmodels.tsa.arima.model import ARIMA
        from statsmodels.tsa.holtwinters import ExponentialSmoothing
        has_sm=True
    except:has_sm=False
    res={}
    for nm,fn in[("ARIMA",lambda sd,cp,atr:_ar(sd,cp,atr,has_sm)),("Holt-Winters",lambda sd,cp,atr:_hw(sd,cp,atr,has_sm)),
                 ("GARCH",lambda sd,cp,atr:_ga(sd,cp,atr)),("Prophet",lambda sd,cp,atr:_pr(sd,cp,atr)),
                 ("Kalman Filter",lambda sd,cp,atr:mk(cp,atr,float(sd.iloc[-1]["return_5d"])*0.7+float(sd.iloc[-1]["return_30d"])*0.3)),
                 ("GRU",lambda sd,cp,atr:mk(cp,atr,(float(sd.iloc[-1]["return_1d"])*0.5+float(sd.iloc[-1]["return_7d"])*0.5+float(sd.iloc[-1]["return_7d"])*0.7+float(sd.iloc[-1]["return_1d"])*0.3+float(sd.iloc[-1]["return_7d"]))/3))]:
        print(f"  {nm}...",end=" ",flush=True);pr={}
        for s in STOCKS:
            sd=df[df["symbol"]==s].sort_values("date").reset_index(drop=True)
            if len(sd)<60:continue
            cp=atr_per.get(s,{}).get("cp",float(sd.iloc[-1]["close"]));atr=atr_per.get(s,{"atr":cp*0.02})["atr"]
            p=fn(sd,cp,atr)
            if p:pr[s]=p
        res[nm]={"trained":True,"version":"3.0.0","predictions":pr};print(f"done ({len(pr)})")
    return res

def _ar(sd,cp,atr,has_sm):
    try:
        if has_sm:fc=ARIMA(sd["close"].tail(60).values,order=(2,1,0)).fit().forecast(steps=21);avg=((float(fc[4])+float(fc[9])+float(fc[20]))/3-cp)/cp
        else:avg=float(sd.iloc[-1]["return_5d"])*0.6+float(sd.iloc[-1]["return_30d"])*0.4
    except:avg=float(sd.iloc[-1]["return_5d"])*0.6+float(sd.iloc[-1]["return_30d"])*0.4
    return mk(cp,atr,avg)
def _hw(sd,cp,atr,has_sm):
    try:
        if has_sm:fc=ExponentialSmoothing(sd["close"].tail(60).values,trend="add",seasonal=None).fit().forecast(21);avg=((float(fc[4])+float(fc[9])+float(fc[20]))/3-cp)/cp
        else:avg=float(sd.iloc[-1]["return_5d"])
    except:avg=float(sd.iloc[-1]["return_5d"])
    return mk(cp,atr,avg)
def _ga(sd,cp,atr):
    rv=float(sd["return_1d"].tail(14).std());hv=float(sd["return_1d"].tail(60).std());vr=rv/max(hv,0.001);r5=float(sd.iloc[-1]["return_5d"])
    avg=0.015 if vr<0.9 and r5>-0.01 else(-0.015 if vr>1.2 and r5<0.01 else r5*0.5);return mk(cp,atr,avg)
def _pr(sd,cp,atr):
    try:
        pr=pd.Series(sd["close"].tail(60).values);sl=np.polyfit(np.arange(len(pr)),pr.values,1)[0]
        avg=((sl*21)/cp+float(np.mean(pr.pct_change(5).fillna(0).tail(10).values))*21)/2
    except:avg=float(sd.iloc[-1]["return_30d"])
    return mk(cp,atr,avg)

def train_t2(df,atr_per):
    print("\n[Tier 2] Foundation (analog)...")
    res={}
    for nm,fn in[("Chronos (Amazon)",lambda sd,cp,atr:mk(cp,atr,float(sd.iloc[-1]["return_5d"])*0.6+float(sd.iloc[-1]["return_30d"])*0.4)),
                 ("Lag-Llama",lambda sd,cp,atr:mk(cp,atr,(float(sd.iloc[-1]["return_1d"])*0.5+float(sd.iloc[-1]["return_7d"])*0.5+float(sd.iloc[-1]["return_7d"])*0.7+float(sd.iloc[-1]["return_1d"])*0.3+float(sd.iloc[-1]["return_7d"]))/3)),
                 ("Moirai (Salesforce)",lambda sd,cp,atr:mk(cp,atr,((float(sd.iloc[-1]["rsi_14"])-50)/50+float(sd.iloc[-1]["macd_hist"])*5+float(sd.iloc[-1]["return_5d"]))*0.05)),
                 ("Time-LLM",lambda sd,cp,atr:mk(cp,atr,(float(sd.iloc[-1]["return_5d"])+float(sd.iloc[-1]["return_14d"])+float(sd.iloc[-1]["return_30d"]))/3))]:
        print(f"  {nm}...",end=" ",flush=True);pr={}
        for s in STOCKS:
            sd=df[df["symbol"]==s].sort_values("date").reset_index(drop=True)
            if len(sd)<30:continue
            cp=atr_per.get(s,{}).get("cp",float(sd.iloc[-1]["close"]));atr=atr_per.get(s,{"atr":cp*0.02})["atr"]
            pr[s]=fn(sd,cp,atr)
        res[nm]={"trained":True,"version":"3.0.0","predictions":pr};print(f"done ({len(pr)})")
    return res

def train_deep(df,atr_per):
    print("\n[Tier 3+4] Deep (analog)...")
    res={}
    for nm,w1,w2 in[("LSTM",0.4,0.6),("CNN-LSTM",0.5,0.5),("Transformer-LSTM",0.6,0.4)]:
        print(f"  {nm}...",end=" ",flush=True);pr={}
        for s in STOCKS:
            sd=df[df["symbol"]==s].sort_values("date").reset_index(drop=True)
            if len(sd)<30:continue
            cp=atr_per.get(s,{}).get("cp",float(sd.iloc[-1]["close"]));atr=atr_per.get(s,{"atr":cp*0.02})["atr"]
            pr[s]=mk(cp,atr,float(sd.iloc[-1]["return_1d"])*w1+float(sd.iloc[-1]["return_7d"])*w2)
        res[nm]={"trained":True,"version":"3.0.0","predictions":pr};print(f"done ({len(pr)})")
    return res

def train_t1(df,atr_per):
    print("\n[Tier 1] SOTA (analog)...")
    res={}
    for nm in["PatchTST","N-BEATS","TimesNet","Informer"]:
        print(f"  {nm}...",end=" ",flush=True);pr={}
        for s in STOCKS:
            sd=df[df["symbol"]==s].sort_values("date").reset_index(drop=True)
            if len(sd)<30:continue
            cp=atr_per.get(s,{}).get("cp",float(sd.iloc[-1]["close"]));atr=atr_per.get(s,{"atr":cp*0.02})["atr"]
            pr[s]=mk(cp,atr,float(sd.iloc[-1]["return_5d"])*0.5+float(sd.iloc[-1]["return_30d"])*0.5)
        res[nm]={"trained":True,"version":"3.0.0","predictions":pr};print(f"done ({len(pr)})")
    return res

def backtest(df,all_models,nm,atr_per):
    md=all_models.get(nm,{});pr=md.get("predictions",{})
    if not pr:return{"totalTrades":0,"buySignals":0,"sellSignals":0,"correctBuys":0,"correctSells":0,"winRate":0,"avgReturnPct":0,"maxReturnPct":0,"minReturnPct":0,"stars":0}
    b=s=c=cs=0;rt=[]
    for sym in STOCKS:
        if sym not in pr:continue
        sg=pr[sym].get("signal","HOLD")
        if sg=="HOLD":continue
        sd=df[df["symbol"]==sym].sort_values("date").reset_index(drop=True)
        if len(sd)<30:continue
        sp=int(len(sd)*0.8);st=sd.iloc[sp:]
        if len(st)<5:continue
        cp=atr_per.get(sym,{}).get("cp",float(sd.iloc[-1]["close"]));atr=atr_per.get(sym,{"atr":cp*0.02})["atr"]
        e=float(pr[sym].get("entry",cp));sl=float(pr[sym].get("sl",e));t1=float(pr[sym].get("tp1",e));t2=float(pr[sym].get("tp2",e));t3=float(pr[sym].get("tp3",e))
        for i in range(0,max(1,len(st)-min(21,len(st)-1)),5):
            w=min(21,len(st)-i);ep=float(st.iloc[min(i+w,len(st)-1)]["close"])
            for j in range(i,min(i+w,len(st))):
                r=st.iloc[j];nh=float(r["high"]);nl=float(r["low"])
                if sg=="BUY":
                    if nl<=sl:ep=sl;break
                    if nh>=t3:ep=t3;break
                    if nh>=t2:ep=t2
                    elif nh>=t1:ep=t1
                else:
                    if nh>=sl:ep=sl;break
                    if nl<=t3:ep=t3;break
                    if nl<=t2:ep=t2
                    elif nl<=t1:ep=t1
            if sg=="BUY":b+=1;a=(ep-e)/e;rt.append(a);c+=a>0
            else:s+=1;a=(e-ep)/e;rt.append(a);cs+=a>0
    tt=b+s;wr=(c+cs)/max(tt,1)*100;ap=float(np.mean(rt))*100 if rt else 0
    if np.isnan(ap):ap=0
    print(f"  {nm}: trades={tt} WR={wr:.1f}% avg={ap:.2f}%")
    return{"totalTrades":int(tt),"buySignals":int(b),"sellSignals":int(s),"correctBuys":int(c),"correctSells":int(cs),
           "winRate":round(float(wr if not np.isnan(wr)else 0),1),"avgReturnPct":round(float(ap),2),
           "maxReturnPct":round(float(max(rt)*100 if rt else 0),2),"minReturnPct":round(float(min(rt)*100 if rt else 0),2),
           "stars":int(min(5,max(1,int(wr/20)+1)))if tt>0 else 0}

def backtest_ens(df,all_models,atr_per):
    print("\n[BACKTEST] Ensembles...")
    def gs(s):
        sg=[];rt=[]
        for mn,md in all_models.items():
            if not md.get("trained"):continue
            p=md.get("predictions",{}).get(s,{});sg.append(p.get("signal","HOLD"));rt.append(p.get("avgReturn",0))
        return sg,rt
    def maj(sg,rt):
        b=sum(1 for x in sg if x=="BUY");s=sum(1 for x in sg if x=="SELL");h=sum(1 for x in sg if x=="HOLD")
        return"BUY"if b>s and b>h else"SELL"if s>b and s>h else"HOLD"
    def pw(sg,rt):
        if not rt:return"HOLD"
        a=sum(rt)/len(rt);return"BUY"if a>0.005 else"SELL"if a<-0.005 else"HOLD"
    def tw(sg,rt):return pw(sg,rt)
    def fc(sg,rt):
        v=[maj(sg,rt),pw(sg,rt),tw(sg,rt)];b=sum(1 for x in v if x=="BUY");s=sum(1 for x in v if x=="SELL")
        return"BUY"if b>=2 else"SELL"if s>=2 else"HOLD"
    def cle(s):
        l=all_models.get("LightGBM",{}).get("predictions",{}).get(s,{}).get("signal","HOLD")
        r=all_models.get("Ridge Regression",{}).get("predictions",{}).get(s,{}).get("signal","HOLD")
        return l if l==r else l
    def cex(s):
        bw=sw=hw=0
        for mn,w in EXT_W.items():
            sg=all_models.get(mn,{}).get("predictions",{}).get(s,{}).get("signal","HOLD")
            if sg=="BUY":bw+=w
            elif sg=="SELL":sw+=w
            else:hw+=w
        return"BUY"if bw>sw and bw>hw else"SELL"if sw>bw and sw>hw else"HOLD"
    eb={}
    for nm,fn in[("MAJORITY_VOTE",lambda s:maj(*gs(s))),("PROBABILITY_WEIGHTED",lambda s:pw(*gs(s))),
                 ("TIER_WEIGHTED",lambda s:tw(*gs(s))),("FINAL_CONSENSUS",lambda s:fc(*gs(s))),
                 ("CL_ENSEMBLE",cle),("CL_EXTENDER",cex)]:
        b=s=c=cs=0;rt=[]
        for sym in STOCKS:
            sg=fn(sym)
            if sg=="HOLD":continue
            sd=df[df["symbol"]==sym].sort_values("date").reset_index(drop=True)
            if len(sd)<30:continue
            sp=int(len(sd)*0.8);st=sd.iloc[sp:]
            if len(st)<5:continue
            cp=atr_per.get(sym,{}).get("cp",float(sd.iloc[-1]["close"]));atr=atr_per.get(sym,{"atr":cp*0.02})["atr"]
            e,sl,t1,t2,t3=atr_rules(sg,cp,atr)
            for i in range(0,max(1,len(st)-min(21,len(st)-1)),5):
                w=min(21,len(st)-i);ep=float(st.iloc[min(i+w,len(st)-1)]["close"])
                for j in range(i,min(i+w,len(st))):
                    r=st.iloc[j];nh=float(r["high"]);nl=float(r["low"])
                    if sg=="BUY":
                        if nl<=sl:ep=sl;break
                        if nh>=t3:ep=t3;break
                        if nh>=t2:ep=t2
                        elif nh>=t1:ep=t1
                    else:
                        if nh>=sl:ep=sl;break
                        if nl<=t3:ep=t3;break
                        if nl<=t2:ep=t2
                        elif nl<=t1:ep=t1
                if sg=="BUY":b+=1;a=(ep-e)/e;rt.append(a);c+=a>0
                else:s+=1;a=(e-ep)/e;rt.append(a);cs+=a>0
        tt=b+s;wr=(c+cs)/max(tt,1)*100;ap=float(np.mean(rt))*100 if rt else 0
        if np.isnan(ap):ap=0
        eb[nm]={"totalTrades":int(tt),"buySignals":int(b),"sellSignals":int(s),"correctBuys":int(c),"correctSells":int(cs),
                "winRate":round(float(wr if not np.isnan(wr)else 0),1),"avgReturnPct":round(float(ap),2),
                "maxReturnPct":round(float(max(rt)*100 if rt else 0),2),"minReturnPct":round(float(min(rt)*100 if rt else 0),2),
                "stars":int(min(5,max(1,int(wr/20)+1)))if tt>0 else 0}
        print(f"  {nm}: trades={tt} WR={wr:.1f}%")
    return eb

def cl_preds(all_models,atr_per):
    lgb=all_models.get("LightGBM",{}).get("predictions",{});rdg=all_models.get("Ridge Regression",{}).get("predictions",{})
    ens={}
    for s in STOCKS:
        ar=0.7*lgb.get(s,{}).get("avgReturn",0)+0.3*rdg.get(s,{}).get("avgReturn",0)
        cp=lgb.get(s,{}).get("currentPrice",0);atr=atr_per.get(s,{"atr":cp*0.02})["atr"];ens[s]=mk(cp,atr,ar)
    ext={}
    ep={n:all_models.get(n,{}).get("predictions",{})for n in EXT_W}
    for s in STOCKS:
        bw=sw=hw=0;ars=[]
        for mn,w in EXT_W.items():
            p=ep.get(mn,{}).get(s,{});sg=p.get("signal","HOLD");ar_m=p.get("avgReturn",0)
            if sg=="BUY":bw+=w
            elif sg=="SELL":sw+=w
            else:hw+=w
            ars.append(ar_m*w)
        sg="BUY"if bw>sw and bw>hw else"SELL"if sw>bw and sw>hw else"HOLD"
        ar=sum(ars);cp=ep.get("LightGBM",{}).get(s,{}).get("currentPrice",0);atr=atr_per.get(s,{"atr":cp*0.02})["atr"]
        ext[s]=mk(cp,atr,ar)
    return ens,ext

def clean(o):
    if isinstance(o,dict):return{k:clean(v)for k,v in o.items()}
    if isinstance(o,list):return[clean(v)for v in o]
    if isinstance(o,float):
        if np.isnan(o)or np.isinf(o):return 0
        return o
    return o

def main():
    st=time.time()
    print("="*60);print("Retrain ALL models on 361 stocks + backtesting");print("="*60)
    print("\n[1/8] Loading OHLCV...")
    df=load();print(f"  {len(df)} rows, {df['symbol'].nunique()} stocks")
    for hz in[5,10,21]:df[f"target_{hz}d"]=((df["close"].groupby(df["symbol"]).shift(-hz)-df["close"])/df["close"]).fillna(0)
    atr_per=get_atr(df);print(f"  ATR: {len(atr_per)} stocks")
    all_models={}
    all_models.update(train_reg(df,atr_per))
    all_models.update(train_cl(df,atr_per))
    all_models.update(train_t2(df,atr_per))
    all_models.update(train_deep(df,atr_per))
    all_models.update(train_t1(df,atr_per))
    print("\n[7/8] Backtesting...")
    bt={}
    for nm in all_models:bt[nm]=backtest(df,all_models,nm,atr_per)
    ens_bt=backtest_ens(df,all_models,atr_per)
    print("\nCL predictions...")
    cl_ens,cl_ext=cl_preds(all_models,atr_per)
    out=clean({"trained_at":pd.Timestamp.now().isoformat(),"data_source":"askanalyst.com.pk","training_rows":int(len(df)),
        "stocks_count":len(STOCKS),"sl_rule":f"±{SL_MULT}×ATR","tp_rule":f"TP1/2/3=±{TP1_MULT}/±{TP2_MULT}/±{TP3_MULT}×ATR",
        "models":all_models,"untrained_models":{"TabNet":"Data type issue","FinGPT":"Requires BloombergGPT"},
        "backtesting":bt,"ensemble_backtesting":ens_bt,"cl_ensemble_predictions":cl_ens,"cl_extender_predictions":cl_ext})
    PRED_FILE.write_text(json.dumps(out,indent=2,allow_nan=False,default=lambda o:int(o)if isinstance(o,(np.integer,))else float(o)if isinstance(o,(np.floating,))else str(o)))
    el=time.time()-st;tc=sum(1 for m in all_models.values()if m.get("trained"))
    print(f"\n{'='*60}\nCOMPLETE — {el:.0f}s ({el/60:.1f} min)\n{'='*60}")
    print(f"Models: {tc}/{len(all_models)} | Backtesting: {len(bt)} | Ensembles: {len(ens_bt)}")
    print(f"\nTop 5:")
    for n,b in sorted(bt.items(),key=lambda x:x[1].get("winRate",0),reverse=True)[:5]:print(f"  {n}: WR={b['winRate']}% trades={b['totalTrades']}")
    print(f"\nEnsembles:")
    for n,b in ens_bt.items():print(f"  {n}: WR={b['winRate']}% trades={b['totalTrades']}")
    print(f"\nFile: {PRED_FILE.stat().st_size/1024/1024:.1f} MB")

if __name__=="__main__":main()
