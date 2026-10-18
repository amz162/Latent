"use client";
import{useEffect,useState}from"react";
import{Card,CardContent,CardHeader,CardTitle}from"@/components/ui/card";
import{Button}from"@/components/ui/button";
import{Badge}from"@/components/ui/badge";
import{Skeleton}from"@/components/ui/skeleton";
import{Dialog,DialogContent,DialogHeader,DialogTitle}from"@/components/ui/dialog";
import{AppNav}from"./AppNav";
import{StockSearch}from"./StockSearch";
import{useLatentStore}from"@/lib/latent/store";
import{Brain,Sparkles,Layers,Cpu,BarChart3}from"lucide-react";
import{toast}from"sonner";

interface MP{name:string;tier:string;tierLabel:string;category:string;trained:boolean;untrainedReason?:string;direction?:"LONG"|"SHORT";signal?:"BUY"|"SELL"|"HOLD";confidence?:number;currentPrice?:number;entry?:number;sl?:number;tp1?:number;tp2?:number;tp3?:number;avgReturn?:number;metrics?:any;backtest?:{totalTrades:number;buySignals:number;sellSignals:number;correctBuys:number;correctSells:number;winRate:number;avgReturnPct:number;maxReturnPct:number;minReturnPct:number;stars:number;};}
interface ER{method:string;methodLabel:string;signal:"BUY"|"SELL"|"HOLD";direction:"LONG"|"SHORT";confidence:number;predictedPrice:number;entry:number;sl:number;tp1:number;tp2:number;tp3:number;modelCount:number;buyCount:number;sellCount:number;holdCount:number;}
interface FC{signal:"BUY"|"SELL"|"HOLD";direction:"LONG"|"SHORT";confidence:number;agreement:number;predictedPriceRange:{min:number;max:number};entry:number;sl:number;tp1:number;tp2:number;tp3:number;}
interface API{symbol:string;stockName:string;currentPrice:number;tiers:{tier:string;label:string;models:MP[]}[];ensembles:ER[];finalConsensus:FC;trainedModelCount:number;totalModelCount:number;trainedAt:string;cached:boolean;latencyMs:number;backtesting:Record<string,any>;ensembleBacktesting:Record<string,any>;}

export function AiModelSignals(){
 const[symbol,setSymbol]=useState("ENGRO");
 const[data,setData]=useState<API|null>(null);
 const[loading,setLoading]=useState(false);
 const[btOpen,setBtOpen]=useState(false);
 const load=async()=>{setLoading(true);try{const r=await fetch(`/api/ai-model-signals/${encodeURIComponent(symbol)}`);if(!r.ok)throw new Error(`Failed(${r.status})`);const j=await r.json();setData(j);toast.success(`${j.trainedModelCount}/${j.totalModelCount} models·${j.finalConsensus.signal}(${j.finalConsensus.confidence}%)`);}catch(e){toast.error(e instanceof Error?e.message:"Failed");}finally{setLoading(false);}};
 useEffect(()=>{load();},[symbol]);
 const sc=(s?:string)=>s==="BUY"?"text-[#00E676]":s==="SELL"?"text-[#FF5C5C]":"text-[#94A3B8]";
 const sb=(s?:string)=>s==="BUY"?"bg-[#00E676]/10 border-[#00E676]/40 text-[#00E676]":s==="SELL"?"bg-[#FF5C5C]/10 border-[#FF5C5C]/40 text-[#FF5C5C]":"bg-white/[0.04] border-white/[0.12] text-[#94A3B8]";
 // Collect backtesting data
 const indBt=data?Object.entries(data.backtesting||{}).map(([name,b]:[string,any])=>({name,...b})).sort((a,b)=>b.winRate-a.winRate):[];
 const ensBt=data?Object.entries(data.ensembleBacktesting||{}).map(([name,b]:[string,any])=>({name,...b})):[];

 return(<div className="min-h-screen bg-[#0A0E1A]"><AppNav/>
 <main className="px-3 md:px-6 py-4 md:py-6 max-w-5xl mx-auto">
  <div className="mb-4 md:mb-6">
   <h1 className="text-xl md:text-2xl font-bold text-[#F4F7FB] flex items-center gap-2"><Brain className="h-5 w-5 md:h-6 md:w-6 text-[#00E676]"/>AI Model Signals</h1>
   <p className="text-xs md:text-sm text-[#94A3B8] mt-1">{data?`${data.trainedModelCount}/${data.totalModelCount} models trained·SL=support·TP1/2/3=5d/10d/21d predictions`:"Loading..."}</p>
  </div>

  <Card className="bg-[#131829] border-white/[0.08] mb-3 md:mb-4"><CardContent className="p-3 md:p-4">
   <div className="flex items-center gap-3 flex-wrap">
    <div className="flex-1 min-w-[180px]"><label className="text-[10px] uppercase tracking-wider text-[#64748B]">Select Stock (any of 361+ PSX-listed companies)</label>
    <div className="mt-1"><StockSearch value={symbol} onChange={(sym)=>setSymbol(sym)} placeholder="Search any PSX stock..." /></div>
    </div>
    {data&&<div className="text-right"><div className="text-[10px] uppercase text-[#64748B]">Current</div><div className="text-xl md:text-2xl font-bold text-[#F4F7FB] font-mono">PKR {data.currentPrice.toFixed(2)}</div></div>}
    <Button size="sm" variant="outline" onClick={load} disabled={loading} className="border-white/[0.12] text-[#94A3B8]">{loading?"...":"Refresh"}</Button>
   </div>
  </CardContent></Card>

  {loading&&!data&&<div className="space-y-3">{[1,2,3].map(i=><Skeleton key={i} className="h-20 md:h-24 bg-white/[0.04]"/>)}</div>}

  {data&&(<>
   <Card className="bg-gradient-to-br from-[#00E676]/[0.07] to-[#131829] border-[#00E676]/30 mb-3 md:mb-4">
    <CardHeader className="pb-2"><CardTitle className="text-sm md:text-base text-[#F4F7FB] flex items-center gap-2"><Sparkles className="h-4 w-4 text-[#00E676]"/>Final Ensemble Consensus</CardTitle></CardHeader>
    <CardContent>
     <div className="grid md:grid-cols-2 gap-3">
      <div><div className="text-[10px] uppercase text-[#64748B] mb-1">Signal</div>
      <div className="flex items-center gap-2"><span className={`text-2xl md:text-3xl font-bold ${sc(data.finalConsensus.signal)}`}>{data.finalConsensus.signal}</span><Badge variant="outline" className={`${sb(data.finalConsensus.signal)} border`}>{data.finalConsensus.direction}</Badge></div>
      <div className="text-xs text-[#94A3B8] mt-2">Conf:<span className="text-[#F4F7FB] font-mono">{data.finalConsensus.confidence}%</span>·Agreement:<span className="text-[#F4F7FB] font-mono">{data.finalConsensus.agreement}%</span></div></div>
      <div><div className="text-[10px] uppercase text-[#64748B] mb-1">Predicted Range</div><div className="text-base md:text-lg font-mono text-[#F4F7FB]">PKR {data.finalConsensus.predictedPriceRange.min.toFixed(2)} — {data.finalConsensus.predictedPriceRange.max.toFixed(2)}</div></div>
     </div>
     <div className="grid grid-cols-3 md:grid-cols-5 gap-2 mt-3">
      <TS label="Entry" v={data.finalConsensus.entry.toFixed(2)}/><TS label="SL(support)" v={data.finalConsensus.sl.toFixed(2)} tone="negative"/><TS label="TP1(5d)" v={data.finalConsensus.tp1.toFixed(2)} tone="positive"/><TS label="TP2(10d)" v={data.finalConsensus.tp2.toFixed(2)} tone="positive"/><TS label="TP3(21d)" v={data.finalConsensus.tp3.toFixed(2)} tone="positive"/>
     </div>
    </CardContent>
   </Card>

   <Card className="bg-[#131829] border-white/[0.08] mb-3 md:mb-4"><CardHeader className="pb-2"><CardTitle className="text-sm md:text-base text-[#F4F7FB] flex items-center gap-2"><Layers className="h-4 w-4 text-[#00E676]"/>Ensemble Methods</CardTitle></CardHeader><CardContent>
    <div className="grid md:grid-cols-3 gap-2 md:gap-3">{data.ensembles.map(en=>(
     <div key={en.method} className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-2.5 md:p-3">
      <div className="text-[10px] uppercase text-[#64748B] mb-1.5">{en.methodLabel}</div>
      <div className={`text-lg md:text-xl font-bold mb-1 ${sc(en.signal)}`}>{en.signal}</div>
      <div className="text-[10px] text-[#94A3B8] mb-1.5">Confidence:<span className="font-mono">{en.confidence}%</span></div>
      <div className="grid grid-cols-2 gap-1 text-[10px]">
       <div><span className="text-[#64748B]">Entry:</span><span className="font-mono text-[#F4F7FB]">{en.entry.toFixed(2)}</span></div>
       <div><span className="text-[#64748B]">SL:</span><span className="font-mono text-[#FF5C5C]">{en.sl.toFixed(2)}</span></div>
       <div><span className="text-[#64748B]">TP1:</span><span className="font-mono text-[#00E676]">{en.tp1.toFixed(2)}</span></div>
       <div><span className="text-[#64748B]">TP2:</span><span className="font-mono text-[#00E676]">{en.tp2.toFixed(2)}</span></div>
       <div><span className="text-[#64748B]">TP3:</span><span className="font-mono text-[#00E676]">{en.tp3.toFixed(2)}</span></div>
       <div><span className="text-[#64748B]">Pred:</span><span className="font-mono text-[#F4F7FB]">{en.predictedPrice.toFixed(2)}</span></div>
      </div>
      <div className="text-[10px] text-[#64748B] mt-1.5 pt-1.5 border-t border-white/[0.04]">{en.buyCount}B·{en.sellCount}S·{en.holdCount}H</div>
     </div>))}</div>
   </CardContent></Card>

   {data.tiers.map(tg=>(
    <Card key={tg.tier} className="bg-[#131829] border-white/[0.08] mb-3 md:mb-4"><CardHeader className="pb-2"><CardTitle className="text-sm md:text-base text-[#F4F7FB] flex items-center gap-2"><Cpu className="h-4 w-4 text-[#00E676]"/>{tg.label}</CardTitle><p className="text-[10px] md:text-xs text-[#94A3B8] mt-0.5">{tg.models.filter(m=>m.trained).length}/{tg.models.length} trained</p></CardHeader><CardContent>
     <div className="space-y-2">{tg.models.map(m=><MC key={m.name} m={m}/>)}</div>
    </CardContent></Card>
   ))}

   {/* Backtesting Button */}
   <div className="text-center py-4 md:py-6">
    <Button onClick={()=>setBtOpen(true)} size="lg" className="bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold">
     <BarChart3 className="h-4 w-4 md:h-5 md:w-5 mr-2"/>Check Backtesting Results
    </Button>
   </div>

   {/* Backtesting Modal */}
   <Dialog open={btOpen} onOpenChange={o=>!o&&setBtOpen(false)}>
    <DialogContent className="bg-[#131829] border-white/[0.12] max-w-3xl max-h-[80vh] overflow-y-auto">
     <DialogHeader><DialogTitle className="text-[#F4F7FB] flex items-center gap-2"><BarChart3 className="h-5 w-5 text-[#00E676]"/>Backtesting Report</DialogTitle></DialogHeader>
     <div className="space-y-4">
      <p className="text-xs text-[#94A3B8]">Backtesting on 20% holdout test set. Star ratings:★★★★★=80%+win,★★★★=60%+,★★★=40%+.</p>

      {/* Ensemble Backtesting Section */}
      <div>
       <h3 className="text-sm font-semibold text-[#00E676] mb-2">Ensemble Backtesting</h3>
       <div className="space-y-2">
        {ensBt.map(m=>(
         <div key={m.name} className="rounded-lg bg-[#0A0E1A] border border-[#00E676]/20 p-3">
          <div className="flex items-center justify-between mb-2">
           <span className="text-sm font-semibold text-[#00E676]">{m.name.replace(/_/g," ")}</span>
           <span className="text-[#FBBF24] text-sm">{"★".repeat(m.stars||0)}<span className="text-[#64748B]">{"★".repeat(5-(m.stars||0))}</span></span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
           <div><div className="text-[10px] uppercase text-[#64748B]">Win Rate</div><div className="font-mono font-bold text-[#00E676]">{m.winRate}%</div></div>
           <div><div className="text-[10px] uppercase text-[#64748B]">Avg Return</div><div className="font-mono text-[#F4F7FB]">{m.avgReturnPct}%</div></div>
           <div><div className="text-[10px] uppercase text-[#64748B]">Best Trade</div><div className="font-mono text-[#00E676]">{m.maxReturnPct}%</div></div>
           <div><div className="text-[10px] uppercase text-[#64748B]">Worst Trade</div><div className="font-mono text-[#FF5C5C]">{m.minReturnPct}%</div></div>
           <div><div className="text-[10px] uppercase text-[#64748B]">Total Trades</div><div className="font-mono text-[#F4F7FB]">{m.totalTrades}</div></div>
          </div>
         </div>
        ))}
        {ensBt.length===0&&<p className="text-xs text-[#64748B] text-center py-4">No ensemble backtesting data.</p>}
       </div>
      </div>

      {/* Individual Model Backtesting Section */}
      <div>
       <h3 className="text-sm font-semibold text-[#00E676] mb-2">Individual Model Backtesting</h3>
       <div className="space-y-2">
        {indBt.map(m=>(
         <div key={m.name} className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3">
          <div className="flex items-center justify-between mb-2">
           <span className="text-sm font-semibold text-[#F4F7FB]">{m.name}</span>
           <span className="text-[#FBBF24] text-sm">{"★".repeat(m.stars||0)}<span className="text-[#64748B]">{"★".repeat(5-(m.stars||0))}</span></span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
           <div><div className="text-[10px] uppercase text-[#64748B]">Win Rate</div><div className="font-mono font-bold text-[#00E676]">{m.winRate}%</div></div>
           <div><div className="text-[10px] uppercase text-[#64748B]">Avg Return</div><div className="font-mono text-[#F4F7FB]">{m.avgReturnPct}%</div></div>
           <div><div className="text-[10px] uppercase text-[#64748B]">Best Trade</div><div className="font-mono text-[#00E676]">{m.maxReturnPct}%</div></div>
           <div><div className="text-[10px] uppercase text-[#64748B]">Worst Trade</div><div className="font-mono text-[#FF5C5C]">{m.minReturnPct}%</div></div>
           <div><div className="text-[10px] uppercase text-[#64748B]">Total Trades</div><div className="font-mono text-[#F4F7FB]">{m.totalTrades}</div></div>
           <div><div className="text-[10px] uppercase text-[#64748B]">Buy Signals</div><div className="font-mono text-[#00E676]">{m.buySignals}</div></div>
           <div><div className="text-[10px] uppercase text-[#64748B]">Correct Buys</div><div className="font-mono text-[#F4F7FB]">{m.correctBuys}</div></div>
           <div><div className="text-[10px] uppercase text-[#64748B]">Sell Signals</div><div className="font-mono text-[#FF5C5C]">{m.sellSignals}</div></div>
          </div>
         </div>
        ))}
        {indBt.length===0&&<p className="text-xs text-[#64748B] text-center py-4">No individual backtesting data.</p>}
       </div>
      </div>
     </div>
    </DialogContent>
   </Dialog>
  </>)}
 </main></div>);
}

function MC({m}:{m:MP}){
 const sc=m.signal==="BUY"?"text-[#00E676]":m.signal==="SELL"?"text-[#FF5C5C]":"text-[#94A3B8]";
 const sb=m.signal==="BUY"?"bg-[#00E676]/10 border-[#00E676]/40 text-[#00E676]":m.signal==="SELL"?"bg-[#FF5C5C]/10 border-[#FF5C5C]/40 text-[#FF5C5C]":"bg-white/[0.04] border-white/[0.12] text-[#94A3B8]";
 if(!m.trained)return(<div className="rounded-md bg-[#0A0E1A]/50 border border-white/[0.04] p-2.5 opacity-70">
  <div className="flex items-center gap-1.5 mb-0.5"><span className="text-xs md:text-sm font-semibold text-[#94A3B8]">{m.name}</span><Badge variant="outline" className="text-[9px] py-0 h-3.5 border-white/[0.08] text-[#64748B]">Not trained</Badge></div>
  <div className="text-[10px] text-[#64748B] mt-0.5">{m.category}</div><div className="text-[10px] text-[#64748B] mb-1.5 mt-1">{m.untrainedReason}</div>
  <div className="grid grid-cols-5 gap-1 text-[10px]">{["Predicted","Entry","SL","TP1","TP2"].map(l=><div key={l}><div className="text-[#64748B]">{l}</div><div className="font-mono text-[#64748B]">—</div></div>)}</div></div>);
 return(<div className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-2.5 md:p-3">
  <div className="flex items-start justify-between gap-2 mb-1.5"><div><div className="flex items-center gap-1.5 flex-wrap">
   <span className="text-xs md:text-sm font-semibold text-[#F4F7FB]">{m.name}</span>
   <Badge className={`text-[9px] py-0 h-3.5 md:h-4 border ${sb}`}>{m.signal}</Badge>
   {m.backtest&&<span className="text-[9px] text-[#FBBF24]">{"★".repeat(m.backtest.stars)}<span className="text-[#64748B]">{"★".repeat(5-m.backtest.stars)}</span></span>}
  </div><div className="text-[10px] text-[#64748B] mt-0.5">{m.category}</div></div>
  <div className="text-right"><div className="text-[9px] text-[#64748B]">TP3</div><div className={`text-xs md:text-sm font-mono font-bold ${sc}`}>PKR {m.tp3?.toFixed(2)}</div></div></div>
  <div className="grid grid-cols-5 gap-1.5 md:gap-2 text-[10px] mt-1.5 pt-1.5 border-t border-white/[0.06]">
   <div><div className="text-[#64748B] uppercase">Entry</div><div className="font-mono text-[#F4F7FB]">{m.entry?.toFixed(2)}</div></div>
   <div><div className="text-[#64748B] uppercase">SL</div><div className="font-mono text-[#FF5C5C]">{m.sl?.toFixed(2)}</div></div>
   <div><div className="text-[#64748B] uppercase">TP1</div><div className="font-mono text-[#00E676]">{m.tp1?.toFixed(2)}</div></div>
   <div><div className="text-[#64748B] uppercase">TP2</div><div className="font-mono text-[#00E676]">{m.tp2?.toFixed(2)}</div></div>
   <div><div className="text-[#64748B] uppercase">TP3</div><div className="font-mono text-[#00E676]">{m.tp3?.toFixed(2)}</div></div>
  </div>
  <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-white/[0.04]">
   <div className="text-[10px] text-[#64748B]">Conf:<span className="font-mono text-[#F4F7FB]">{m.confidence}%</span>{m.avgReturn!==undefined&&<>·Avg:<span className="font-mono text-[#F4F7FB]">{(m.avgReturn*100).toFixed(1)}%</span></>}</div>
   {m.backtest&&<div className="text-[10px] text-[#64748B]">BT:<span className="font-mono text-[#94A3B8]">{m.backtest.winRate}%win</span>·<span className="font-mono text-[#94A3B8]">{m.backtest.avgReturnPct}%avg</span></div>}
  </div></div>);
}

function TS({label,v,tone}:{label:string;v:string;tone?:"positive"|"negative"}){
 const c=tone==="positive"?"text-[#00E676]":tone==="negative"?"text-[#FF5C5C]":"text-[#F4F7FB]";
 return<div className="rounded-md bg-[#0A0E1A] border border-white/[0.06] p-1.5 md:p-2"><div className="text-[9px] md:text-[10px] uppercase text-[#64748B]">{label}</div><div className={`text-xs md:text-sm font-mono font-bold ${c}`}>{v}</div></div>;
}
