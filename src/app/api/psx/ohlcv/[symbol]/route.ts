import{NextResponse}from"next/server";import{promises as fs}from"fs";import path from"path";
export const dynamic="force-dynamic";export const maxDuration=30;
export async function GET(req:Request,{params}:{params:Promise<{symbol:string}>}){
 const{symbol}=await params;const sym=symbol.toUpperCase();const start=Date.now();
 for(const dir of["data/ohlcv_all","data/ohlcv"]){
  try{const p=path.join(process.cwd(),dir,`${sym}.csv`);const text=await fs.readFile(p,"utf-8");
   const rows=text.trim().split("\n").slice(1).map(l=>{const p=l.split(",");return{date:parseInt(p[0]),open:parseFloat(p[1]),high:parseFloat(p[2]),low:parseFloat(p[3]),close:parseFloat(p[4]),volume:parseFloat(p[5])};}).filter(r=>!isNaN(r.date));
   if(rows.length>0)return NextResponse.json({symbol:sym,source:`local-cache (${dir})`,rowsCount:rows.length,firstDate:rows[0].date,lastDate:rows[rows.length-1].date,ohlcv:rows,latencyMs:Date.now()-start,cached:true});
  }catch{}
 }
 try{const TO=Date.now();const FROM=TO-10*365*24*60*60*1000;
  const r=await fetch(`https://api.askanalyst.com.pk/api/technicalchart/day/${FROM}/${TO}/${sym}`,{headers:{"User-Agent":"Mozilla/5.0"},signal:AbortSignal.timeout(15000)});
  if(r.ok){const text=await r.text();const rows=text.trim().split("\n").slice(1).map(l=>{const p=l.split(",");return{date:parseInt(p[0]),open:parseFloat(p[1]),high:parseFloat(p[2]),low:parseFloat(p[3]),close:parseFloat(p[4]),volume:parseFloat(p[5])};}).filter(x=>!isNaN(x.date));
   if(rows.length>0)return NextResponse.json({symbol:sym,source:"askanalyst.com.pk",rowsCount:rows.length,firstDate:rows[0].date,lastDate:rows[rows.length-1].date,ohlcv:rows,latencyMs:Date.now()-start,cached:false});}
 }catch{}
 return NextResponse.json({error:`No OHLCV data for ${sym}`,symbol:sym},{status:404});
}
