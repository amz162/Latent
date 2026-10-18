import{NextResponse}from"next/server";import{promises as fs}from"fs";import path from"path";
export const dynamic="force-dynamic";export const maxDuration=30;
export async function GET(_req:Request,{params}:{params:Promise<{symbol:string}>}){
 const{symbol}=await params;const sym=symbol.toUpperCase();
 try{const data=JSON.parse(await fs.readFile(path.join(process.cwd(),"data","financials",`${sym}.json`),"utf-8"));
  return NextResponse.json({symbol:sym,source:"local-cache",annual:data.annual||[],quarter:data.quarter||[],company_name:data.company_name||sym,sector:data.sector||"",cached:true});
 }catch{}
 try{const r=await fetch(`https://api.askanalyst.com.pk/api/incomestatement/${encodeURIComponent(sym)}`,{headers:{"User-Agent":"Mozilla/5.0","Accept":"application/json"},signal:AbortSignal.timeout(15000),cache:"no-store"});
  if(r.ok){const data=await r.json();
   try{const dir=path.join(process.cwd(),"data","financials");await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,`${sym}.json`),JSON.stringify({...data,symbol:sym,fetched_at:new Date().toISOString()},null,2));}catch{}
   return NextResponse.json({symbol:sym,source:"askanalyst.com.pk",annual:data.annual||[],quarter:data.quarter||[],company_name:sym,sector:"",cached:false});}
 }catch{}
 return NextResponse.json({error:`No income statement for ${sym}`,symbol:sym,annual:[],quarter:[]},{status:404});
}
