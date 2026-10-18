import{NextResponse}from"next/server";import{promises as fs}from"fs";import path from"path";
import{cacheGetJSON,cacheSetJSON}from"@/lib/latent/cache";
import{ALL_MODELS,type ModelPrediction,majorityVoteEnsemble,probabilityWeightedEnsemble,tierWeightedEnsemble,computeFinalConsensus}from"@/lib/latent/ensemble";
import{MOCK_STOCKS}from"@/lib/latent/mock-stocks";
export const dynamic="force-dynamic";export const maxDuration=30;
const CK=(s:string)=>`ai-model-signals:${s}`;
export async function GET(_req:Request,{params}:{params:Promise<{symbol:string}>}){
 const start=Date.now();const{symbol}=await params;const sym=symbol.toUpperCase();
 const stock=MOCK_STOCKS.find(s=>s.symbol===sym);
 if(!stock)return NextResponse.json({error:`Unknown:${sym}`},{status:404});
 const cached=await cacheGetJSON<any>(CK(sym));if(cached)return NextResponse.json({...cached,cached:true,latencyMs:Date.now()-start});
 let multi:any=null;try{multi=JSON.parse(await fs.readFile(path.join(process.cwd(),"data","ml_predictions_multi.json"),"utf-8"));}catch{return NextResponse.json({error:"Run:python3 scripts/train_all_with_backtesting.py"},{status:503});}
 const predictions:ModelPrediction[]=ALL_MODELS.map(meta=>{
  const lookupName=meta.name.replace(" (CL)","");
  const nk=lookupName.replace(/\s+/g,"");
  const md=multi?.models?.[lookupName]||multi?.models?.[nk]||multi?.models?.[meta.name];
  if(!md?.trained)return{...meta,trained:false,untrainedReason:meta.untrainedReason||multi?.untrained_models?.[meta.name]};
  const p=md.predictions?.[sym];if(!p)return{...meta,trained:true,untrainedReason:`No prediction for${sym}`};
  const bt=multi?.backtesting?.[lookupName]||multi?.backtesting?.[nk]||multi?.backtesting?.[meta.name];
  return{...meta,trained:true,direction:p.direction,signal:p.signal,confidence:p.confidence,currentPrice:p.currentPrice,entry:p.entry,sl:p.sl,tp1:p.tp1,tp2:p.tp2,tp3:p.tp3,avgReturn:p.avgReturn,metrics:md.metrics,backtest:bt};
 });
 const ensembles=[majorityVoteEnsemble(predictions),probabilityWeightedEnsemble(predictions),tierWeightedEnsemble(predictions)];
 const finalConsensus=computeFinalConsensus(ensembles);
 const tiers=["TIER_1","TIER_2","TIER_3","TIER_4","TIER_CL"].map(t=>({tier:t,label:ALL_MODELS.find(m=>m.tier===t)?.tierLabel||t,models:predictions.filter(p=>p.tier===t)}));
 const resp={symbol:sym,stockName:stock.name,currentPrice:stock.price,tiers,ensembles,finalConsensus,
  trainedModelCount:predictions.filter(p=>p.trained).length,totalModelCount:predictions.length,
  trainedAt:multi?.trained_at,
  backtesting:multi?.backtesting||{},
  ensembleBacktesting:multi?.ensemble_backtesting||{},
 };
 await cacheSetJSON(CK(sym),resp,3600);return NextResponse.json({...resp,cached:false,latencyMs:Date.now()-start});}
