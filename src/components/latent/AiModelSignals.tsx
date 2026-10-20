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
import{Brain,Sparkles,Layers,Cpu,BarChart3,DollarSign,Play}from"lucide-react";
import{toast}from"sonner";

interface MP{name:string;tier:string;tierLabel:string;category:string;trained:boolean;untrainedReason?:string;direction?:"LONG"|"SHORT";signal?:"BUY"|"SELL"|"HOLD";confidence?:number;currentPrice?:number;entry?:number;sl?:number;tp1?:number;tp2?:number;tp3?:number;avgReturn?:number;raw_prob?:number;exp_win_rate?:number;agreement?:number;metrics?:any;backtest?:{totalTrades:number;buySignals:number;sellSignals:number;correctBuys:number;correctSells:number;winRate:number;avgReturnPct:number;maxReturnPct:number;minReturnPct:number;stars:number;};}
interface ER{method:string;methodLabel:string;signal:"BUY"|"SELL"|"HOLD";direction:"LONG"|"SHORT";confidence:number;predictedPrice:number;entry:number;sl:number;tp1:number;tp2:number;tp3:number;modelCount:number;buyCount:number;sellCount:number;holdCount:number;raw_prob?:number;exp_win_rate?:number;agreement?:number;total_score?:number;pillars?:any;expected_return?:number;r_pct?:number;strategy_signals?:any;}
interface FC{signal:"BUY"|"SELL"|"HOLD";direction:"LONG"|"SHORT";confidence:number;agreement:number;predictedPriceRange:{min:number;max:number};entry:number;sl:number;tp1:number;tp2:number;tp3:number;}
interface API{symbol:string;stockName:string;currentPrice:number;tiers:{tier:string;label:string;models:MP[]}[];ensembles:ER[];finalConsensus:FC;trainedModelCount:number;totalModelCount:number;trainedAt:string;cached:boolean;latencyMs:number;backtesting:Record<string,any>;ensembleBacktesting:Record<string,any>;}

export function AiModelSignals(){
 const selectedSymbol=useLatentStore(s=>s.selectedSymbol);
 const[symbol,setSymbol]=useState(selectedSymbol||"ENGRO");
 const[data,setData]=useState<API|null>(null);
 const[loading,setLoading]=useState(false);
 const[btOpen,setBtOpen]=useState(false);
 const[simOpen,setSimOpen]=useState(false);
 const[simAmount,setSimAmount]=useState("100000");
 const[simDays,setSimDays]=useState("0");
 const[simTrades,setSimTrades]=useState("");
 const[simData,setSimData]=useState<any>(null);
 const[simLoading,setSimLoading]=useState(false);
 const[detailOpen,setDetailOpen]=useState(false);
 const[detailData,setDetailData]=useState<any>(null);
 const[detailLoading,setDetailLoading]=useState(false);
 // When the user navigates here from another view (e.g. SignalSection's
 // "View in depth" button → setView("ai_model_signals") after selectSymbol),
 // pick up the newly-selected symbol.
 useEffect(()=>{if(selectedSymbol)setSymbol(selectedSymbol);},[selectedSymbol]);
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
    {data&&<div className="text-right"><div className="text-[10px] uppercase text-[#64748B]">Current Price</div><div className="text-xl md:text-2xl font-bold text-[#F4F7FB] font-mono">PKR {data.currentPrice.toFixed(2)}</div></div>}
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
      {en.raw_prob!=null&&en.exp_win_rate!=null&&en.agreement!=null&&(
       <div className="text-[10px] text-[#64748B] mt-1 pt-1 border-t border-white/[0.04]">
        <div className="flex items-center justify-between"><span>raw_prob:</span><span className="font-mono text-[#94A3B8]">{typeof en.raw_prob==="number"?en.raw_prob.toFixed(3):String(en.raw_prob)}</span></div>
        <div className="flex items-center justify-between"><span>exp_win_rate:</span><span className="font-mono text-[#00E676]">{typeof en.exp_win_rate==="number"?(en.exp_win_rate*100).toFixed(1)+"%":String(en.exp_win_rate)}</span></div>
        <div className="flex items-center justify-between"><span>agreement:</span><span className="font-mono text-[#F4F7FB]">{typeof en.agreement==="number"?(en.agreement*100).toFixed(0)+"%":String(en.agreement)}</span></div>
       </div>
      )}
      {en.total_score!=null&&en.pillars!=null&&typeof en.total_score==="number"&&(
       <div className="text-[10px] text-[#64748B] mt-1 pt-1 border-t border-white/[0.04]">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[#94A3B8] font-semibold">GM 4-Pillar Score:</span>
          <span className={`font-mono font-bold ${en.total_score>=0.45?"text-[#00E676]":en.total_score<=-0.45?"text-[#FF5C5C]":"text-[#94A3B8]"}`}>{en.total_score>=0?"+":""}{en.total_score.toFixed(3)}</span>
        </div>
        {typeof en.pillars.tech_score==="number"&&<div className="flex items-center justify-between"><span>Tech (35%):</span><span className="font-mono text-[#00E676]">{en.pillars.tech_score>=0?"+":""}{en.pillars.tech_score.toFixed(3)}</span></div>}
        {typeof en.pillars.anno_score==="number"&&<div className="flex items-center justify-between"><span>Anno (30%):</span><span className="font-mono text-[#00E676]">{en.pillars.anno_score>=0?"+":""}{en.pillars.anno_score.toFixed(3)}</span></div>}
        {typeof en.pillars.fund_score==="number"&&<div className="flex items-center justify-between"><span>Fund (20%):</span><span className="font-mono text-[#00E676]">{en.pillars.fund_score>=0?"+":""}{en.pillars.fund_score.toFixed(3)}</span></div>}
        {typeof en.pillars.macro_score==="number"&&<div className="flex items-center justify-between"><span>Macro (15%):</span><span className="font-mono text-[#00E676]">{en.pillars.macro_score>=0?"+":""}{en.pillars.macro_score.toFixed(3)}</span></div>}
       </div>
      )}
      {typeof en.expected_return==="number"&&typeof en.r_pct==="number"&&(
       <div className="text-[10px] text-[#64748B] mt-1 pt-1 border-t border-white/[0.04]">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[#94A3B8] font-semibold">CG Cost-Aware:</span>
          <span className={`font-mono font-bold ${en.expected_return>0?"text-[#00E676]":"text-[#FF5C5C]"}`}>{en.expected_return>=0?"+":""}{(en.expected_return*100).toFixed(2)}%</span>
        </div>
        <div className="flex items-center justify-between"><span>R (risk/share):</span><span className="font-mono text-[#94A3B8]">{(en.r_pct*100).toFixed(2)}%</span></div>
        <div className="text-[9px] text-[#64748B] mt-0.5 italic">net of 50bps round-trip + 15% CGT on gains</div>
       </div>
      )}
      {en.strategy_signals!=null&&typeof en.strategy_signals==="object"&&(
       <div className="text-[10px] text-[#64748B] mt-1 pt-1 border-t border-white/[0.04]">
        <div className="text-[#94A3B8] font-semibold mb-0.5">X 10-Strategy Signals:</div>
        {Object.entries(en.strategy_signals).slice(0,10).map(([sname,sval]:[string,any])=>(
          <div key={sname} className="flex items-center justify-between">
            <span className="truncate">{sval===1?"✓":"✗"} {sname}</span>
            <span className={`font-mono ${sval===1?"text-[#00E676]":"text-[#64748B]"}`}>{sval===1?"BUY":"—"}</span>
          </div>
        ))}
       </div>
      )}
     </div>))}</div>
   </CardContent></Card>

   {data.tiers.map(tg=>(
    <Card key={tg.tier} className="bg-[#131829] border-white/[0.08] mb-3 md:mb-4"><CardHeader className="pb-2"><CardTitle className="text-sm md:text-base text-[#F4F7FB] flex items-center gap-2"><Cpu className="h-4 w-4 text-[#00E676]"/>{tg.label}</CardTitle><p className="text-[10px] md:text-xs text-[#94A3B8] mt-0.5">{tg.models.filter(m=>m.trained).length}/{tg.models.length} trained</p></CardHeader><CardContent>
     <div className="space-y-2">{tg.models.map(m=><MC key={m.name} m={m}/>)}</div>
    </CardContent></Card>
   ))}

   {/* Action Buttons */}
   <div className="text-center py-4 md:py-6 flex gap-3 justify-center flex-wrap">
    <Button onClick={()=>setBtOpen(true)} size="lg" className="bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881] font-semibold">
     <BarChart3 className="h-4 w-4 md:h-5 md:w-5 mr-2"/>Check Backtesting Results
    </Button>
    <Button onClick={()=>setSimOpen(true)} size="lg" variant="outline" className="border-[#00E676]/40 text-[#00E676] hover:bg-[#00E676]/10 font-semibold">
     <DollarSign className="h-4 w-4 md:h-5 md:w-5 mr-2"/>Portfolio Simulation
    </Button>
   </div>

   {/* Simulation Modal */}
   <Dialog open={simOpen} onOpenChange={o=>!o&&setSimOpen(false)}>
    <DialogContent className="bg-[#131829] border-white/[0.12] max-w-4xl max-h-[85vh] overflow-y-auto">
     <DialogHeader><DialogTitle className="text-[#F4F7FB] flex items-center gap-2"><DollarSign className="h-5 w-5 text-[#00E676]"/>Portfolio Simulation</DialogTitle></DialogHeader>
     <div className="space-y-4">
      <p className="text-xs text-[#94A3B8]">Enter your capital amount (full amount used per trade). Optional: set number of days and/or number of trades. If trades specified, ALL ensembles use the same trade count for fair comparison. Costs (50 bps + 15% CGT) included.</p>
      
      {/* Input controls */}
      <div className="flex gap-3 flex-wrap items-end">
       <div>
        <label className="text-[10px] uppercase tracking-wider text-[#64748B] block mb-1">Capital Amount (PKR) *</label>
        <input type="number" value={simAmount} onChange={e=>setSimAmount(e.target.value)} placeholder="100000" className="bg-[#0A0E1A] border border-white/[0.12] rounded px-3 py-2 text-[#F4F7FB] font-mono text-sm w-[180px]" />
       </div>
       <div>
        <label className="text-[10px] uppercase tracking-wider text-[#64748B] block mb-1">No. of Days (0=all)</label>
        <input type="number" value={simDays} onChange={e=>setSimDays(e.target.value)} placeholder="0" className="bg-[#0A0E1A] border border-white/[0.12] rounded px-3 py-2 text-[#F4F7FB] font-mono text-sm w-[120px]" />
       </div>
       <div>
        <label className="text-[10px] uppercase tracking-wider text-[#64748B] block mb-1">No. of Trades (optional)</label>
        <input type="number" value={simTrades} onChange={e=>setSimTrades(e.target.value)} placeholder="e.g. 500" className="bg-[#0A0E1A] border border-white/[0.12] rounded px-3 py-2 text-[#F4F7FB] font-mono text-sm w-[140px]" />
       </div>
       <Button onClick={async () => {
         setSimLoading(true);
         try {
           const params = new URLSearchParams({ amount: simAmount, numDays: simDays || "0", detail_summary: "1" });
           if (simTrades) params.set("numTrades", simTrades);
           const r = await fetch(`/api/simulate?${params}`);
           const d = await r.json();
           // Filter out ensembles with 0 gross profit AND 0 gross loss — these
           // are useless entries (no actual trades were generated, e.g. ensembles
           // with no BUY signals or naturalBuyTrades=0). Re-sort the survivors by
           // netPnL so the rank order is preserved after filtering.
           const filtered = (d.results || []).filter((r: any) => !(r.grossProfitPKR === 0 && r.grossLossPKR === 0));
           filtered.sort((a: any, b: any) => b.netPnL - a.netPnL);
           const filteredData = { ...d, results: filtered, count: filtered.length, filteredOut: (d.results || []).length - filtered.length };
           setSimData(filteredData);
           toast.success(`Simulated ${filteredData.count} ensembles · PKR ${parseInt(simAmount).toLocaleString()}${filteredData.filteredOut > 0 ? ` · ${filteredData.filteredOut} empty removed` : ""}`);
         } catch (e) { toast.error("Simulation failed"); } finally { setSimLoading(false); }
       }} disabled={simLoading} size="sm" className="bg-[#00E676] text-[#0A0E1A] hover:bg-[#22E881]">
        {simLoading ? "Running..." : "Run Simulation"}<Play className="h-3 w-3 ml-2"/>
       </Button>
      </div>
      
      {simData&&simData.results&&(
       <>
       {/* Summary */}
       <div className="rounded-lg bg-[#0A0E1A] border border-[#00E676]/20 p-3">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
         <div><div className="text-[10px] uppercase text-[#64748B]">Starting Capital</div><div className="font-mono font-bold text-[#F4F7FB]">PKR {simData.amount.toLocaleString()}</div></div>
         <div><div className="text-[10px] uppercase text-[#64748B]">Full Amount/Trade</div><div className="font-mono font-bold text-[#F4F7FB]">PKR {simData.positionSize.toLocaleString()}</div></div>
         <div><div className="text-[10px] uppercase text-[#64748B]">Days</div><div className="font-mono font-bold text-[#00E676]">{simData.numDays||"All (~619)"}</div></div>
         <div><div className="text-[10px] uppercase text-[#64748B]">Fixed Trades?</div><div className="font-mono font-bold text-[#94A3B8]">{simData.useFixedTrades?`Yes (${simData.fixedTrades})`:"No (natural)"}</div></div>
         <div><div className="text-[10px] uppercase text-[#64748B]">BUY Only?</div><div className="font-mono font-bold text-[#00E676]">Yes</div></div>
         <div><div className="text-[10px] uppercase text-[#64748B]">Ensembles</div><div className="font-mono font-bold text-[#00E676]">{simData.count}</div></div>
        </div>
       </div>
       
       {/* Results table */}
       <div className="overflow-x-auto">
        <table className="w-full text-xs">
         <thead>
          <tr className="border-b border-white/[0.08] text-[#64748B]">
           <th className="text-left py-2 px-1">Ensemble</th>
           <th className="text-right py-2 px-1">Trades</th>
           <th className="text-right py-2 px-1">Days</th>
           <th className="text-right py-2 px-1">Win/Loss</th>
           <th className="text-right py-2 px-1">Gross Profit</th>
           <th className="text-right py-2 px-1">Gross Loss</th>
           <th className="text-right py-2 px-1">Net P&L</th>
           <th className="text-right py-2 px-1">Final Value</th>
           <th className="text-right py-2 px-1">ROI%</th>
           <th className="text-right py-2 px-1">Max DD</th>
           <th className="text-right py-2 px-1">PF</th>
          </tr>
         </thead>
         <tbody>
          {simData.results.map((r:any)=>(
           <tr key={r.name} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
            <td className="py-2 px-1 text-[#94A3B8]">{r.name}</td>
            <td className="text-right py-2 px-1 font-mono text-[#F4F7FB]">{r.totalTrades}</td>
            <td className="text-right py-2 px-1 font-mono text-[#94A3B8]">{r.daysUsed}</td>
            <td className="text-right py-2 px-1 font-mono"><span className="text-[#00E676]">{r.winTrades}</span>/<span className="text-[#FF5C5C]">{r.lossTrades}</span></td>
            <td className="text-right py-2 px-1 font-mono text-[#00E676]">{r.grossProfitPKR.toLocaleString()}</td>
            <td className="text-right py-2 px-1 font-mono text-[#FF5C5C]">{r.grossLossPKR.toLocaleString()}</td>
            <td className={`text-right py-2 px-1 font-mono font-bold ${r.netPnL>=0?"text-[#00E676]":"text-[#FF5C5C]"}`}>{r.netPnL>=0?"+":""}{r.netPnL.toLocaleString()}</td>
            <td className={`text-right py-2 px-1 font-mono font-bold ${r.finalValue>=simData.amount?"text-[#00E676]":"text-[#FF5C5C]"}`}>{r.finalValue.toLocaleString()}</td>
            <td className={`text-right py-2 px-1 font-mono ${r.roiPct>=0?"text-[#00E676]":"text-[#FF5C5C]"}`}>{r.roiPct>=0?"+":""}{r.roiPct}%</td>
            <td className="text-right py-2 px-1 font-mono text-[#FF5C5C]">{r.maxDDpct}%</td>
            <td className={`text-right py-2 px-1 font-mono ${r.profitFactor>=1.3?"text-[#00E676]":r.profitFactor>=1?"text-[#FBBF24]":"text-[#FF5C5C]"}`}>{r.profitFactor}</td>
           </tr>
          ))}
         </tbody>
        </table>
       </div>
       
       {/* Top 5 detail cards */}
       <div>
        <h3 className="text-sm font-semibold text-[#00E676] mb-2">Top 5 by Net P&L — Detailed Breakdown</h3>
        <div className="space-y-2">
         {simData.results.slice(0,5).map((r:any,i:number)=>(
          <div key={r.name} className="rounded-lg bg-[#0A0E1A] border border-[#00E676]/20 p-3">
           <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-[#00E676]">#{i+1} {r.name}</span>
            <div className="flex items-center gap-2">
             <span className={`font-mono font-bold text-sm ${r.netPnL>=0?"text-[#00E676]":"text-[#FF5C5C]"}`}>{r.netPnL>=0?"+":""}PKR {r.netPnL.toLocaleString()}</span>
             <span className="text-[#FBBF24] text-sm">{"★".repeat(r.stars)}<span className="text-[#64748B]">{"★".repeat(5-r.stars)}</span></span>
            </div>
           </div>
           <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div><div className="text-[10px] uppercase text-[#64748B]">Starting Capital</div><div className="font-mono text-[#F4F7FB]">PKR {r.startingCapital.toLocaleString()}</div></div>
            <div><div className="text-[10px] uppercase text-[#64748B]">Amount Per Trade</div><div className="font-mono text-[#F4F7FB]">PKR {r.positionSize.toLocaleString()}</div></div>
            <div><div className="text-[10px] uppercase text-[#64748B]">Total Trades (BUY only)</div><div className="font-mono text-[#F4F7FB]">{r.totalTrades}{r.naturalTrades!==r.totalTrades?` (natural: ${r.naturalTrades})`:""}</div></div>
            <div><div className="text-[10px] uppercase text-[#64748B]">Days</div><div className="font-mono text-[#F4F7FB]">{r.daysUsed} days ({r.tradesPerDay}/day)</div></div>
            <div><div className="text-[10px] uppercase text-[#64748B]">Win Rate</div><div className="font-mono text-[#00E676]">{r.winRate}%</div></div>
            <div><div className="text-[10px] uppercase text-[#64748B]">Win / Loss Trades</div><div className="font-mono"><span className="text-[#00E676]">{r.winTrades}</span> / <span className="text-[#FF5C5C]">{r.lossTrades}</span></div></div>
            <div><div className="text-[10px] uppercase text-[#64748B]">Avg Win</div><div className="font-mono text-[#00E676]">+{r.avgWinPct}%</div></div>
            <div><div className="text-[10px] uppercase text-[#64748B]">Avg Loss</div><div className="font-mono text-[#FF5C5C]">{r.avgLossPct}%</div></div>
            <div><div className="text-[10px] uppercase text-[#64748B]">Gross Profit</div><div className="font-mono text-[#00E676]">PKR {r.grossProfitPKR.toLocaleString()}</div></div>
            <div><div className="text-[10px] uppercase text-[#64748B]">Gross Loss</div><div className="font-mono text-[#FF5C5C]">PKR {r.grossLossPKR.toLocaleString()}</div></div>
            <div><div className="text-[10px] uppercase text-[#64748B]">Total Costs (50bps+CGT)</div><div className="font-mono text-[#94A3B8]">PKR {r.totalCostsPKR.toLocaleString()}</div></div>
            <div><div className="text-[10px] uppercase text-[#64748B]">Gross Before Costs</div><div className="font-mono text-[#94A3B8]">PKR {r.grossBeforeCosts.toLocaleString()}</div></div>
            <div><div className="text-[10px] uppercase text-[#64748B]">Net P&L (after costs)</div><div className={`font-mono font-bold ${r.netPnL>=0?"text-[#00E676]":"text-[#FF5C5C]"}`}>{r.netPnL>=0?"+":""}PKR {r.netPnL.toLocaleString()}</div></div>
            <div><div className="text-[10px] uppercase text-[#64748B]">Final Portfolio Value</div><div className={`font-mono font-bold ${r.finalValue>=r.startingCapital?"text-[#00E676]":"text-[#FF5C5C]"}`}>PKR {r.finalValue.toLocaleString()}</div></div>
            <div><div className="text-[10px] uppercase text-[#64748B]">ROI</div><div className={`font-mono font-bold ${r.roiPct>=0?"text-[#00E676]":"text-[#FF5C5C]"}`}>{r.roiPct>=0?"+":""}{r.roiPct}%</div></div>
            <div><div className="text-[10px] uppercase text-[#64748B]">Max Drawdown</div><div className="font-mono text-[#FF5C5C]">PKR {r.maxDDPKR.toLocaleString()} ({r.maxDDpct}%)</div></div>
            <div><div className="text-[10px] uppercase text-[#64748B]">Profit Factor</div><div className={`font-mono ${r.profitFactor>=1.3?"text-[#00E676]":r.profitFactor>=1?"text-[#FBBF24]":"text-[#FF5C5C]"}`}>{r.profitFactor}</div></div>
            <div><div className="text-[10px] uppercase text-[#64748B]">Sharpe / Sortino</div><div className="font-mono text-[#94A3B8]">{r.sharpe} / {r.sortino}</div></div>
           </div>
           <Button size="sm" variant="outline" className="mt-3 border-[#00E676]/40 text-[#00E676] hover:bg-[#00E676]/10 w-full" onClick={async()=>{setDetailLoading(true);setDetailOpen(true);try{const params=new URLSearchParams({amount:String(simData.amount),numDays:simData.numDays?String(simData.numDays):"0",detail:"1"});if(simData.useFixedTrades)params.set("numTrades",String(simData.fixedTrades));const r2=await fetch(`/api/simulate?${params}`);const d2=await r2.json();const found=d2.results.find((x:any)=>x.name===r.name);if(found)setDetailData(found);else toast.error("No detail data found");}catch(e){toast.error("Failed to load detail");}finally{setDetailLoading(false);}}}>
            <Layers className="h-3 w-3 mr-1"/>View in Depth — Trade by Trade
           </Button>
          </div>
         ))}
        </div>
       </div>
       
       {/* All other ensembles with View in Depth */}
       {simData.results.length > 5 && (
        <div>
         <h3 className="text-sm font-semibold text-[#00E676] mb-2">All Other Ensembles</h3>
         <div className="space-y-1">
          {simData.results.slice(5).map((r:any,i:number)=>(
           <div key={r.name} className="flex items-center justify-between rounded bg-[#0A0E1A] border border-white/[0.06] px-3 py-2">
            <div className="flex items-center gap-3">
             <span className="text-xs text-[#94A3B8]">#{i+6}</span>
             <span className="text-xs font-semibold text-[#F4F7FB]">{r.name}</span>
             <span className="text-[10px] font-mono text-[#64748B]">{r.totalTrades} trades</span>
             <span className="text-[10px] font-mono text-[#64748B]">WR {r.winRate}%</span>
             <span className="text-[10px] font-mono text-[#64748B]">PF {r.profitFactor}</span>
            </div>
            <div className="flex items-center gap-2">
             <span className={`text-xs font-mono font-bold ${r.netPnL>=0?"text-[#00E676]":"text-[#FF5C5C]"}`}>{r.netPnL>=0?"+":""}PKR {r.netPnL.toLocaleString()}</span>
             <Button size="sm" variant="ghost" className="h-6 text-[10px] text-[#00E676] hover:bg-[#00E676]/10" onClick={async()=>{setDetailLoading(true);setDetailOpen(true);try{const params=new URLSearchParams({amount:String(simData.amount),numDays:simData.numDays?String(simData.numDays):"0",detail:"1"});if(simData.useFixedTrades)params.set("numTrades",String(simData.fixedTrades));const r2=await fetch(`/api/simulate?${params}`);const d2=await r2.json();const found=d2.results.find((x:any)=>x.name===r.name);if(found)setDetailData(found);else toast.error("No detail data");}catch(e){toast.error("Failed");}finally{setDetailLoading(false);}}}>
              <Layers className="h-3 w-3 mr-1"/>View in Depth
             </Button>
            </div>
           </div>
          ))}
         </div>
        </div>
       )}
       
       <div className="rounded-lg bg-[#0A0E1A] border border-white/[0.06] p-3 text-[11px] text-[#64748B] leading-relaxed">
        <span className="text-[#94A3B8] font-semibold">Simulation notes:</span> Full capital amount used per trade (non-compounding).
        {simData.useFixedTrades?` All ensembles use ${simData.fixedTrades} trades for fair comparison.`:" Each ensemble uses its natural trade count."}
        {" "}Days estimated from test period (~619 trading days). Gross profit/loss derived from PF and avg return. Net P&L includes 50bps round-trip + 15% CGT. Max drawdown = maxDD% × peak value. Past performance does not guarantee future returns.
       </div>
       </>
      )}
      
      {!simData&&(
       <div className="text-center py-8">
        <DollarSign className="h-10 w-10 text-[#00E676]/30 mx-auto mb-3"/>
        <p className="text-sm text-[#94A3B8]">Enter your capital, optional days/trades, and click "Run Simulation".</p>
       </div>
      )}
     </div>
    </DialogContent>
   </Dialog>

   {/* Trade-by-trade Detail Modal */}
   <Dialog open={detailOpen} onOpenChange={o=>!o&&setDetailOpen(false)}>
    <DialogContent className="bg-[#131829] border-white/[0.12] max-w-5xl max-h-[90vh] overflow-y-auto">
     <DialogHeader><DialogTitle className="text-[#F4F7FB] flex items-center gap-2"><Layers className="h-5 w-5 text-[#00E676]"/>Trade-by-Trade Breakdown{detailData?` — ${detailData.name}`:""}</DialogTitle></DialogHeader>
     {detailLoading?(
      <div className="text-center py-8"><Skeleton className="h-20 bg-white/[0.04]"/></div>
     ):detailData&&detailData.trades?(
      <div className="space-y-3">
       {/* Summary bar */}
       <div className="rounded-lg bg-[#0A0E1A] border border-[#00E676]/20 p-3">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
         <div><div className="text-[10px] uppercase text-[#64748B]">Ensemble</div><div className="font-mono font-bold text-[#00E676]">{detailData.name}</div></div>
         <div><div className="text-[10px] uppercase text-[#64748B]">Total Trades</div><div className="font-mono text-[#F4F7FB]">{detailData.totalTrades}{detailData.totalTradesShown<detailData.totalTrades?` (showing ${detailData.totalTradesShown})`:""}</div></div>
         <div><div className="text-[10px] uppercase text-[#64748B]">Invest/Trade</div><div className="font-mono text-[#F4F7FB]">PKR {detailData.positionSize.toLocaleString()}</div></div>
         <div><div className="text-[10px] uppercase text-[#64748B]">Net P&L</div><div className={`font-mono font-bold ${detailData.netPnL>=0?"text-[#00E676]":"text-[#FF5C5C]"}`}>{detailData.netPnL>=0?"+":""}PKR {detailData.netPnL.toLocaleString()}</div></div>
         <div><div className="text-[10px] uppercase text-[#64748B]">Final Value</div><div className={`font-mono font-bold ${detailData.finalValue>=detailData.startingCapital?"text-[#00E676]":"text-[#FF5C5C]"}`}>PKR {detailData.finalValue.toLocaleString()}</div></div>
        </div>
       </div>
       {/* Trade table */}
       <div className="overflow-x-auto">
        <table className="w-full text-[10px]">
         <thead>
          <tr className="border-b border-white/[0.08] text-[#64748B]">
           <th className="text-left py-1.5 px-1">#</th>
           <th className="text-left py-1.5 px-1">Symbol</th>
           <th className="text-center py-1.5 px-1">Signal</th>
           <th className="text-right py-1.5 px-1">Entry</th>
           <th className="text-right py-1.5 px-1">Close</th>
           <th className="text-right py-1.5 px-1">SL</th>
           <th className="text-center py-1.5 px-1">Best TP</th>
           <th className="text-right py-1.5 px-1">TP1</th>
           <th className="text-right py-1.5 px-1">TP2</th>
           <th className="text-right py-1.5 px-1">TP3</th>
           <th className="text-right py-1.5 px-1">Invested</th>
           <th className="text-center py-1.5 px-1">Result</th>
           <th className="text-right py-1.5 px-1">P&L</th>
           <th className="text-right py-1.5 px-1">Portfolio</th>
          </tr>
         </thead>
         <tbody>
          {detailData.trades.map((t:any,i:number)=>(
           <tr key={i} className={`border-b border-white/[0.02] ${t.result==="WIN"?"bg-[#00E676]/[0.03]":"bg-[#FF5C5C]/[0.03]"}`}>
            <td className="py-1 px-1 font-mono text-[#64748B]">{t.tradeNum}</td>
            <td className="py-1 px-1 font-semibold text-[#F4F7FB]">{t.symbol}</td>
            <td className="py-1 px-1 text-center"><span className="text-[#00E676] text-[9px] font-bold">BUY</span></td>
            <td className="py-1 px-1 text-right font-mono text-[#F4F7FB]">{t.entry.toFixed(2)}</td>
            <td className="py-1 px-1 text-right font-mono text-[#94A3B8]">{t.close.toFixed(2)}</td>
            <td className="py-1 px-1 text-right font-mono text-[#FF5C5C]">{t.sl.toFixed(2)}</td>
            <td className="py-1 px-1 text-center"><span className={`text-[9px] font-bold ${t.bestTP==="TP3"?"text-[#00E676]":t.bestTP==="TP2"?"text-[#00E676]":"text-[#94A3B8]"}`}>{t.bestTP||"TP1"}</span></td>
            <td className="py-1 px-1 text-right font-mono text-[#00E676]">{t.tp1.toFixed(2)}</td>
            <td className="py-1 px-1 text-right font-mono text-[#00E676]">{t.tp2.toFixed(2)}</td>
            <td className="py-1 px-1 text-right font-mono text-[#00E676]">{t.tp3.toFixed(2)}</td>
            <td className="py-1 px-1 text-right font-mono text-[#94A3B8]">{t.investAmount.toLocaleString()}</td>
            <td className="py-1 px-1 text-center"><span className={t.result==="WIN"?"text-[#00E676]":"text-[#FF5C5C]"}>{t.result==="WIN"?"✓ W":"✗ L"}</span></td>
            <td className={`py-1 px-1 text-right font-mono font-bold ${t.pnl>=0?"text-[#00E676]":"text-[#FF5C5C]"}`}>{t.pnl>=0?"+":""}{t.pnl.toLocaleString()}</td>
            <td className="py-1 px-1 text-right font-mono text-[#F4F7FB] font-bold">{t.portfolioValue.toLocaleString()}</td>
           </tr>
          ))}
         </tbody>
        </table>
       </div>
       <p className="text-[10px] text-[#64748B]">Note: COMPOUNDING — each trade invests the FULL current portfolio value (not fixed amount). Win → portfolio grows → next trade invests more. Loss → portfolio shrinks → next trade invests less. BEST TP: checks TP3 → TP2 → TP1 in order and exits at the highest TP that was actually hit (max profit). Close price = BEST TP hit for wins, SL for losses. Net P&L = (last trade's portfolio value) − (starting investment). Past performance does not guarantee future returns.</p>
      </div>
     ):(
      <div className="text-center py-8"><p className="text-sm text-[#94A3B8]">No detail data available.</p></div>
     )}
    </DialogContent>
   </Dialog>

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
           {typeof m.winTrades==="number"&&<div><div className="text-[10px] uppercase text-[#64748B]">Win Trades</div><div className="font-mono font-bold text-[#00E676]">{m.winTrades}</div></div>}
           {typeof m.lossTrades==="number"&&<div><div className="text-[10px] uppercase text-[#64748B]">Loss Trades</div><div className="font-mono font-bold text-[#FF5C5C]">{m.lossTrades}</div></div>}
           {typeof m.profitFactor==="number"&&<div><div className="text-[10px] uppercase text-[#64748B]">Profit Factor</div><div className={`font-mono font-bold ${m.profitFactor>=1.3?"text-[#00E676]":m.profitFactor>=1.0?"text-[#FBBF24]":"text-[#FF5C5C]"}`}>{m.profitFactor}</div></div>}
           {typeof m.sharpe==="number"&&<div><div className="text-[10px] uppercase text-[#64748B]">Sharpe</div><div className="font-mono text-[#94A3B8]">{m.sharpe}</div></div>}
           {typeof m.sortino==="number"&&<div><div className="text-[10px] uppercase text-[#64748B]">Sortino</div><div className="font-mono text-[#94A3B8]">{m.sortino}</div></div>}
           {typeof m.maxDrawdownPct==="number"&&<div><div className="text-[10px] uppercase text-[#64748B]">Max Drawdown</div><div className="font-mono text-[#FF5C5C]">{m.maxDrawdownPct}%</div></div>}
           {typeof m.tp1HitRate==="number"&&<div><div className="text-[10px] uppercase text-[#64748B]">TP1 Hit Rate</div><div className="font-mono text-[#00E676]">{(m.tp1HitRate*100).toFixed(1)}%</div></div>}
           {typeof m.costBps==="number"&&<div><div className="text-[10px] uppercase text-[#64748B]">Cost (bps)</div><div className="font-mono text-[#94A3B8]">{m.costBps}</div></div>}
          </div>
          {m.reliabilityTable&&m.reliabilityTable.length>0&&(
           <div className="mt-2 pt-2 border-t border-white/[0.04]">
            <div className="text-[10px] uppercase text-[#64748B] mb-1">Reliability Table (predicted vs actual hit rate)</div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-1 text-[10px]">
             {m.reliabilityTable.map((r:any)=>{
              // CL-2 / PI use "predicted_prob"; GM uses "avg_score". Handle both.
              const predLabel = r.predicted_prob!=null?"pred":(r.avg_score!=null?"score":"pred");
              const predVal = typeof r.predicted_prob==="number"?r.predicted_prob:(typeof r.avg_score==="number"?r.avg_score:0);
              const actVal = typeof r.actual_hit_rate==="number"?r.actual_hit_rate:0;
              return (
               <div key={r.bin} className="rounded bg-[#0A0E1A] border border-white/[0.06] px-1.5 py-1">
                <div className="text-[#64748B] text-[9px]">bin{r.bin}·n={r.count}</div>
                <div className="font-mono text-[#94A3B8]">{predLabel} {predVal.toFixed(2)}</div>
                <div className="font-mono text-[#F4F7FB]">act {actVal.toFixed(2)}</div>
               </div>
              );
             })}
            </div>
           </div>
          )}
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
