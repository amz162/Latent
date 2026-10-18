import{NextResponse}from"next/server";import{promises as fs}from"fs";import path from"path";
export const dynamic="force-dynamic";export const maxDuration=30;
function num(v:any):number{if(v===null||v===undefined||v===""||v==="-")return 0;const n=parseFloat(String(v).replace(/,/g,""));return isNaN(n)?0:n;}
function find(items:any[],labels:string[]):any|null{for(const item of items||[]){const l=(item.label||"").toLowerCase();if(labels.some(x=>l.includes(x.toLowerCase())))return item;}return null;}
function deriveQ(period:string):{q:number;y:number;pe:string}{
 if(/^\d{4}$/.test(period))return{q:4,y:parseInt(period),pe:`${period}-06-30`};
 if(/^\d{4}-\d{2}-\d{2}$/.test(period)){const yr=parseInt(period.slice(0,4));const mo=parseInt(period.slice(5,7));let q=mo>=1&&mo<=3?3:mo>=4&&mo<=6?4:mo>=7&&mo<=9?1:2;return{q,yr,pe:period};}
 const m=period.match(/^([A-Za-z]{3})-(\d{2})$/);if(m){const mn=m[1];const yy=parseInt(m[2]);const yr=yy>50?1900+yy:2000+yy;const mm:Record<string,{q:number;m:number}>={Jan:{q:3,m:1},Feb:{q:3,m:2},Mar:{q:3,m:3},Apr:{q:4,m:4},May:{q:4,m:5},Jun:{q:4,m:6},Jul:{q:1,m:7},Aug:{q:1,m:8},Sep:{q:1,m:9},Oct:{q:2,m:10},Nov:{q:2,m:11},Dec:{q:2,m:12}};const info=mm[mn];if(info){let fy=yr;if(info.m>=7&&info.m<=12)fy=yr+1;return{q:info.q,y:fy,pe:`${yr}-${String(info.m).padStart(2,"0")}-30`};}}
 return{q:1,y:2020,pe:"2020-01-01"};}
export async function GET(_req:Request,{params}:{params:Promise<{symbol:string}>}){
 const{symbol}=await params;const sym=symbol.toUpperCase();
 let data:any=null;
 try{data=JSON.parse(await fs.readFile(path.join(process.cwd(),"data","financials",`${sym}.json`),"utf-8"));}catch{
  try{const r=await fetch(`https://api.askanalyst.com.pk/api/incomestatement/${encodeURIComponent(sym)}`,{headers:{"User-Agent":"Mozilla/5.0"},signal:AbortSignal.timeout(15000),cache:"no-store"});if(r.ok){data=await r.json();try{const dir=path.join(process.cwd(),"data","financials");await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,`${sym}.json`),JSON.stringify({...data,symbol:sym,fetched_at:new Date().toISOString()},null,2));}catch{}}}catch{}
 }
 if(!data)return NextResponse.json({error:`No financial data for ${sym}`,symbol:sym,results:[]},{status:404});
 const cn=data.company_name||sym;const qItems=data.quarter||[];
 const ns=find(qItems,["Net sales","Revenue","Sales"]);const gp=find(qItems,["Gross profit"]);const pat=find(qItems,["Profit after tax"]);const eps=find(qItems,["EPS - Basic","EPS"]);const dps=find(qItems,["DPS","Dividend per share"]);
 const results:any[]=[];
 if(ns&&ns.data&&ns.data.length>0){
  type IE={idx:number;q:number;y:number;pe:string;};
  const idx:IE[]=ns.data.map((e:any,i:number)=>{const ps=String(e.year||e.period||"");const{q,y,pe}=deriveQ(ps);return{idx:i,q,y,pe};});
  idx.sort((a,b)=>a.pe.localeCompare(b.pe));
  for(const e of idx){
   const rev=num(ns.data[e.idx]?.value);const gpr=num(gp?.data?.[e.idx]?.value);const prof=num(pat?.data?.[e.idx]?.value);const ep=num(eps?.data?.[e.idx]?.value);const dp=num(dps?.data?.[e.idx]?.value);
   const prev=idx.find(x=>x.q===e.q&&x.y===e.y-1);const pr=prev?num(ns.data[prev.idx]?.value):0;const pp=prev?num(pat?.data?.[prev.idx]?.value):0;const pe2=prev?num(eps?.data?.[prev.idx]?.value):0;
   const rY=pr>0?((rev-pr)/pr)*100:0;const pY=pp>0?((prof-pp)/pp)*100:0;const eY=pe2>0?((ep-pe2)/pe2)*100:0;
   const gm=rev>0?(gpr/rev)*100:0;const nm=rev>0?(prof/rev)*100:0;const po=ep>0?(dp/ep)*100:0;
   results.push({symbol:sym,company:cn,period:`Q${e.q} FY${String(e.y).slice(-2)}`,periodEnd:e.pe,metrics:{revenue:rev,profitAfterTax:prof,eps:ep,revenueYoYGrowth:Math.round(rY*10)/10,profitYoYGrowth:Math.round(pY*10)/10,epsYoYGrowth:Math.round(eY*10)/10,grossMargin:Math.round(gm*10)/10,netMargin:Math.round(nm*10)/10,dividendPerShare:dp,dividendPayoutRatio:Math.round(po)}});
  }
 }
 return NextResponse.json({symbol:sym,company:cn,sector:data.sector||"",resultsCount:results.length,results,source:"askanalyst.com.pk"});
}
