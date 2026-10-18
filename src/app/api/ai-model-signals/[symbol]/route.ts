import{NextResponse}from"next/server";import{promises as fs}from"fs";import path from"path";
import{cacheGetJSON,cacheSetJSON,cacheDelete}from"@/lib/latent/cache";
import{ALL_MODELS,type ModelPrediction,majorityVoteEnsemble,probabilityWeightedEnsemble,tierWeightedEnsemble,computeFinalConsensus}from"@/lib/latent/ensemble";
import{MOCK_STOCKS}from"@/lib/latent/mock-stocks";
export const dynamic="force-dynamic";export const maxDuration=30;
const CK=(s:string)=>`ai-model-signals:${s}`;
export async function GET(req:Request,{params}:{params:Promise<{symbol:string}>}){
 const start=Date.now();const{symbol}=await params;const sym=symbol.toUpperCase();
 const stock=MOCK_STOCKS.find(s=>s.symbol===sym);
 let stockName=stock?.name||sym;let currentPrice=stock?.price||0;
 if(!stock){
  try{const ohlcvText=await fs.readFile(path.join(process.cwd(),"data","ohlcv_all",`${sym}.csv`),"utf-8");const lines=ohlcvText.trim().split("\n");if(lines.length>1){const lastLine=lines[lines.length-1].split(",");currentPrice=parseFloat(lastLine[4])||0;}}catch{
   try{const finText=await fs.readFile(path.join(process.cwd(),"data","financials",`${sym}.json`),"utf-8");const finData=JSON.parse(finText);stockName=finData.company_name||finData.symbol||sym;}catch{}
  }
 }
 const url=new URL(req.url);const refresh=url.searchParams.get("refresh")==="1";
 if(refresh){await cacheDelete(CK(sym));}
 const cached=refresh?null:await cacheGetJSON<any>(CK(sym));
 if(cached)return NextResponse.json({...cached,cached:true,latencyMs:Date.now()-start});
 let multi:any=null;try{multi=JSON.parse(await fs.readFile(path.join(process.cwd(),"data","ml_predictions_multi.json"),"utf-8"));}catch{return NextResponse.json({error:"Run:python3 scripts/train_all_with_backtesting.py"},{status:503});}
 const predictions:ModelPrediction[]=ALL_MODELS.map(meta=>{
  const lookupName=meta.name.replace(" (CL)","");const nk=lookupName.replace(/\s+/g,"");
  const md=multi?.models?.[lookupName]||multi?.models?.[nk]||multi?.models?.[meta.name];
  if(!md?.trained)return{...meta,trained:false,untrainedReason:meta.untrainedReason||multi?.untrained_models?.[meta.name]};
  const p=md.predictions?.[sym];if(!p)return{...meta,trained:true,untrainedReason:`No prediction for${sym}`};
  const bt=multi?.backtesting?.[lookupName]||multi?.backtesting?.[nk]||multi?.backtesting?.[meta.name];
  return{...meta,trained:true,direction:p.direction,signal:p.signal,confidence:p.confidence,currentPrice:p.currentPrice,entry:p.entry,sl:p.sl,tp1:p.tp1,tp2:p.tp2,tp3:p.tp3,avgReturn:p.avgReturn,metrics:md.metrics,backtest:bt};
 });
 const baseEnsembles=[majorityVoteEnsemble(predictions),probabilityWeightedEnsemble(predictions),tierWeightedEnsemble(predictions)];
 const clEnsPred=multi?.cl_ensemble_predictions?.[sym];const clExtPred=multi?.cl_extender_predictions?.[sym];
 const clEnsEntry=clEnsPred?{method:"CL_ENSEMBLE",methodLabel:"D. CL-Ensemble (LGB70+Log30)",signal:clEnsPred.signal as any,direction:clEnsPred.direction as any,confidence:clEnsPred.confidence,predictedPrice:clEnsPred.tp3,entry:clEnsPred.entry,sl:clEnsPred.sl,tp1:clEnsPred.tp1,tp2:clEnsPred.tp2,tp3:clEnsPred.tp3,modelCount:2,buyCount:0,sellCount:0,holdCount:0}:null;
 const clExtEntry=clExtPred?{method:"CL_EXTENDER",methodLabel:"E. CL-Extender (8-model weighted)",signal:clExtPred.signal as any,direction:clExtPred.direction as any,confidence:clExtPred.confidence,predictedPrice:clExtPred.tp3,entry:clExtPred.entry,sl:clExtPred.sl,tp1:clExtPred.tp1,tp2:clExtPred.tp2,tp3:clExtPred.tp3,modelCount:8,buyCount:0,sellCount:0,holdCount:0}:null;
 const ensembles=[...baseEnsembles];if(clEnsEntry)ensembles.push(clEnsEntry);if(clExtEntry)ensembles.push(clExtEntry);
 const finalConsensus=computeFinalConsensus(ensembles);
 const tiers=["TIER_1","TIER_2","TIER_3","TIER_4","TIER_CL"].map(t=>({tier:t,label:ALL_MODELS.find(m=>m.tier===t)?.tierLabel||t,models:predictions.filter(p=>p.tier===t)}));
 const resp={symbol:sym,stockName,currentPrice,tiers,ensembles,finalConsensus,
  trainedModelCount:predictions.filter(p=>p.trained).length,totalModelCount:predictions.length,
  trainedAt:multi?.trained_at,backtesting:multi?.backtesting||{},ensembleBacktesting:multi?.ensemble_backtesting||{},
  walkForward:multi?.walk_forward_backtesting||{},clEnsemble:multi?.cl_ensemble_backtest||{},
  clEnsembleAll:multi?.cl_ensemble_backtest_all||{},clExtender:multi?.cl_extender_backtest||{},
  clEnsemblePredictions:multi?.cl_ensemble_predictions||{},clExtenderPredictions:multi?.cl_extender_predictions||{},
 };
 await cacheSetJSON(CK(sym),resp,3600);return NextResponse.json({...resp,cached:false,latencyMs:Date.now()-start});}
