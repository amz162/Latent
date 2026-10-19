// Pattern detection engine — no mock data, real data fetched on-demand
export interface QuarterMetric { revenue:number;profitAfterTax:number;eps:number;revenueYoYGrowth:number;profitYoYGrowth:number;epsYoYGrowth:number;grossMargin:number;netMargin:number;dividendPerShare:number;dividendPayoutRatio:number; }
export interface QuarterlyResult { symbol:string;company:string;period:string;periodEnd:string;metrics:QuarterMetric;notes?:string; }
export interface DetectedPattern { type:string;label:string;severity:"positive"|"negative"|"neutral";confidence:number;detail:string;affectedQuarters:string[];laymanSummary?:string; }
export interface QuarterSummary { quarter:1|2|3|4;quarterLabel:string;monthsLabel:string;avgRevenuePctOfTotal:number;avgProfitPctOfTotal:number;avgNetMargin:number;typicalPattern:"low"|"rising"|"peak"|"moderate";summary:string;causeSummary:string; }
export const MOCK_COMPANY_RESULTS:QuarterlyResult[]=[];

// ────────────────────────────────────────────────────────────────────────────
// Issue 11: Sector-specific seasonal cause summaries
// Maps PSX ticker symbols → sector → per-quarter cause explanation. Falls back
// to a generic Pakistan-monsoon narrative when symbol is unknown.
// ────────────────────────────────────────────────────────────────────────────

const SECTOR_SYMBOL_MAP: { sector: string; symbols: string[] }[] = [
  { sector: "Cement", symbols: ["LUCK", "DGKC", "MLCF", "FCCL", "KOHC", "ACPL", "PIOC", "CHCC", "GWLC", "DCL", "BEST", "FECT", "INCE", "DGIC"] },
  { sector: "Fertilizer", symbols: ["ENGRO", "EFERT", "FFBL", "FATIMA", "DAWH"] },
  { sector: "Oil & Gas", symbols: ["OGDC", "PPL", "POL", "MARI", "EPL"] },
  { sector: "Power", symbols: ["HUBC", "NPL", "KAPCO", "JPGL", "SPWL", "NCPL", "KEL", "LPL"] },
  { sector: "Banking", symbols: ["MEBL", "BAFL", "MCB", "UBL", "HBL", "ABL", "BOP", "BAHL", "SCBPL", "SNBL", "AKBL", "BISE", "AICL", "MEBB"] },
  { sector: "Technology", symbols: ["SYS", "AVN", "TRSM", "HUMNL", "PTC", "AVANT"] },
  { sector: "Oil Marketing", symbols: ["PSO", "APL", "SNGP", "SPL", "SSGC"] },
  { sector: "Refinery/Petrochemical", symbols: ["LOTCHEM", "ATRL", "NRL", "PRL", "BYCO", "SHEZ", "EPCL"] },
];

export function classifySector(symbol?: string): string {
  if (!symbol) return "Conglomerate";
  const up = symbol.toUpperCase();
  for (const m of SECTOR_SYMBOL_MAP) if (m.symbols.includes(up)) return m.sector;
  return "Conglomerate";
}

const SECTOR_CAUSES: Record<string, { 1: string; 2: string; 3: string; 4: string }> = {
  Cement: {
    1: "Pakistan's Q1 (Jul–Sep) is monsoon season — heavy rains disrupt construction sites, clinker transport, and outdoor pours. Cement dispatches typically dip 15–20% as builders delay pours; LUCK/DGKC/MLCF all see the seasonal trough here.",
    2: "Q2 (Oct–Dec) is post-monsoon recovery — dry, cool weather drives peak construction season. Cement demand rises 20%+ as North-bound infrastructure projects resume and rural housing ramps up; dispatch numbers lift sharply.",
    3: "Q3 (Jan–Mar) — winter peak construction continues in the south while the north slows from cold. Companies push hard on dispatches to hit FY targets; LUCK often books the year's largest profit here.",
    4: "Q4 (Apr–Jun) — pre-monsoon slowdown as heat builds, water scarcity affects curing, and builders wrap up before rains. Companies finalize annual results; dispatches moderate, final dividends declared here.",
  },
  Fertilizer: {
    1: "Pakistan's Q1 (Jul–Sep) — Kharif harvest ending softens urea offtake as sowing winds down. ENGRO/EFERT see weaker demand, but inventory builds for the next sowing season.",
    2: "Q2 (Oct–Dec) — Rabi sowing peak. Urea demand spikes as wheat cultivation starts across Punjab and Sindh. Fertilizer companies book some of their highest dispatches of the year here.",
    3: "Q3 (Jan–Mar) — mid-Rabi. Top-dressing applications continue, urea offtake stays firm. ENGRO/EFERT often book strong profits; this is also when interim dividends are announced.",
    4: "Q4 (Apr–Jun) — transition from Rabi harvest to Kharif sowing prep; urea demand moderate. Companies finalize annual results, declare final dividends, and reposition inventory for the next sowing cycle.",
  },
  "Oil & Gas": {
    1: "Pakistan's Q1 (Jul–Sep) — summer gas consumption peaks (ACs, industry) but wellhead production from OGDC/PPL/MARI stays steady. Royalty flows and gas tariffs support revenue; this is a high-cash quarter.",
    2: "Q2 (Oct–Dec) — winter gas consumption peaks as heating loads rise and CNG/power demand increases. OGDC/PPL typically book strong profits; gas infrastructure stays near full utilization.",
    3: "Q3 (Jan–Mar) — winter demand continues in the north, gas consumption stays high. Companies often declare interim dividends here; production plateaus at mature fields but new wells add incremental flow.",
    4: "Q4 (Apr–Jun) — transition to summer; residential heating demand drops, but power-sector gas offtake rises as AC load grows. Companies finalize annual results and declare final dividends.",
  },
  Power: {
    1: "Pakistan's Q1 (Jul–Sep) — mild weather means lower heating/cooling demand; HUBC and other IPPs see lower dispatches as grid load eases. Capacity payments still flow, but merchant profits moderate.",
    2: "Q2 (Oct–Dec) — winter heating demand lifts power offtake; IPPs run at higher capacity factors. HUBC typically books stronger revenue and profits here.",
    3: "Q3 (Jan–Mar) — winter peak demand continues in the north; power sector stays at high utilization. Companies often declare interim dividends here as cash builds.",
    4: "Q4 (Apr–Jun) — summer cooling demand begins ramping up as AC load rises; power demand approaches annual peak. Companies finalize annual results and declare final dividends.",
  },
  Banking: {
    1: "Pakistan's Q1 (Jul–Sep) — banks see lower fee income as post-budget slowdown hits corporate activity. ADR spreads stay healthy, but loan growth is tepid; MEBL's fee line typically softens here.",
    2: "Q2 (Oct–Dec) — post-monsoon pickup in trade financing and corporate lending; banks see stronger fee income and FX income from imports. MEBL typically books stronger profits here.",
    3: "Q3 (Jan–Mar) — mid-fiscal-year. Banks push lending targets. Many banks declare interim dividends here; MEBL's quarterly profit often peaks as fee income and ADR spreads combine.",
    4: "Q4 (Apr–Jun) — fiscal year-end. Banks finalize annual results, declare final dividends + bonus shares, and clean up balance sheets. MEBL often pays its largest dividend here, plus a stock bonus.",
  },
  Technology: {
    1: "Pakistan's Q1 (Jul–Sep) — new software/IT contracts typically start at the beginning of the fiscal year. SYS and peers ramp up revenue recognition as client budgets open; deals inked in Q4 start billing.",
    2: "Q2 (Oct–Dec) — delivery milestones hit on multi-quarter engagements; revenue scales up as resources ramp. Tech firms often see their highest quarterly revenue of the year here as project execution peaks.",
    3: "Q3 (Jan–Mar) — continued execution; client renewals and contract extensions come in. SYS often books strong profits here; interim dividends (if any) declared.",
    4: "Q4 (Apr–Jun) — year-end push to recognize deferred revenue and lock in new multi-year deals before fiscal close. Tech firms accelerate bookings; final dividends and bonuses declared.",
  },
  "Oil Marketing": {
    1: "Pakistan's Q1 (Jul–Sep) — monsoon disruptions hit fuel logistics and retail offtake. PSO and APL see moderate demand; inventory builds as imports arrive but dispatch lags in wet weather.",
    2: "Q2 (Oct–Dec) — winter demand lifts furnace oil (for power) and HSD; oil marketing companies see higher volumes as industrial activity resumes. PSO often books strong gross profits here.",
    3: "Q3 (Jan–Mar) — peak winter fuel demand continues; PSO/APL dispatches stay high. Companies often declare interim dividends here as receivables clear from circular-debt flow.",
    4: "Q4 (Apr–Jun) — year-end inventory build as companies prep for summer driving season and AC-driven power demand. Companies finalize annual results and declare final dividends.",
  },
  "Refinery/Petrochemical": {
    1: "Pakistan's Q1 (Jul–Sep) — monsoon season softens fuel demand; refinery throughput dips slightly as logistics and downstream offtake slow. LOTCHEM/ATRL see moderate margins.",
    2: "Q2 (Oct–Dec) — winter heating and post-monsoon industrial activity lift furnace oil and diesel demand; refinery utilization rises. Crack spreads typically stay healthy.",
    3: "Q3 (Jan–Mar) — winter peak demand for heating fuels; refinery margins stay firm. Companies often declare interim dividends here.",
    4: "Q4 (Apr–Jun) — summer AC-driven power demand lifts furnace oil offtake; refineries prep for higher throughput. Companies finalize annual results and declare final dividends.",
  },
  Conglomerate: {
    1: "Pakistan's Q1 (Jul–Sep) coincides with monsoon season — heavy rains disrupt construction, transport, and outdoor activity, while the Kharif-harvest ending softens fertilizer and agri-input offtake. Summer heat also curbs industrial output, so most cyclical sectors see weaker demand.",
    2: "Q2 (Oct–Dec) brings post-monsoon recovery: dry cool weather drives peak construction (cement, steel lift), Rabi sowing boosts fertilizer demand, and Eid/festive spending lifts consumer goods. Banks also see stronger fee income — that seasonal tailwind is why volumes jump.",
    3: "Q3 (Jan–Mar) is mid-fiscal-year. Winter peak continues for construction and industry, companies push hard to meet annual targets, and many declare interim dividends here — that's why this quarter often books the year's largest profits.",
    4: "Q4 (Apr–Jun) is fiscal year-end. Companies finalize annual results, declare final dividends, and clean up balance sheets. Meanwhile summer heat and pre-monsoon conditions start slowing construction and agri-input demand — making this a natural transition quarter.",
  },
};

export function getSectorCauseSummary(sector: string, quarter: 1 | 2 | 3 | 4): string {
  const causes = SECTOR_CAUSES[sector] || SECTOR_CAUSES.Conglomerate;
  return causes[quarter];
}

export function detectPatterns(r:QuarterlyResult[]):DetectedPattern[]{if(r.length<2)return[];const p:DetectedPattern[]=[];
{let run=0;const a:string[]=[];for(const x of r){if(x.metrics.epsYoYGrowth>10){run++;a.push(x.period);}else break;}if(run>=3)p.push({type:"EPS_GROWTH_STREAK",label:"Profits Rising Quarter After Quarter",severity:"positive",confidence:Math.min(95,60+run*3),detail:`${run} consecutive quarters of double-digit YoY EPS growth.`,affectedQuarters:a.slice(-run),laymanSummary:"Profits going up every quarter — strong momentum."});}
{let run=0;const a:string[]=[];let pv=r[0].metrics.netMargin;for(let i=1;i<r.length;i++){const x=r[i];if(x.metrics.netMargin<pv-0.5){run++;a.push(x.period);}else break;pv=x.metrics.netMargin;}if(run>=2)p.push({type:"MARGIN_COMPRESSION",label:"Profit Margin Shrinking",severity:"negative",confidence:Math.min(85,50+run*12),detail:`${run} quarters of declining profit margin.`,affectedQuarters:a,laymanSummary:"Company keeping less profit per rupee of sales."});}
{let run=0;const a:string[]=[];let pv=r[0].metrics.netMargin;for(let i=1;i<r.length;i++){const x=r[i];if(x.metrics.netMargin>pv+0.5){run++;a.push(x.period);}else break;pv=x.metrics.netMargin;}if(run>=2)p.push({type:"MARGIN_EXPANSION",label:"Profit Margin Growing",severity:"positive",confidence:Math.min(85,50+run*12),detail:`${run} quarters of expanding profit margin.`,affectedQuarters:a,laymanSummary:"Company keeping more profit per rupee of sales."});}
if(r.length>=3){const l=r[r.length-1].metrics.epsYoYGrowth;const pv=r[r.length-2].metrics.epsYoYGrowth;if(l>pv+5&&l>10)p.push({type:"EPS_ACCELERATION",label:"Profit Growth Speeding Up",severity:"positive",confidence:70,detail:`Growth accelerated from ${pv}% to ${l}%.`,affectedQuarters:[r[r.length-2].period,r[r.length-1].period],laymanSummary:"Profit growth getting faster — momentum building."});}
if(r.length>=3){const l=r[r.length-1].metrics.epsYoYGrowth;const pv=r[r.length-2].metrics.epsYoYGrowth;if(l<pv-10)p.push({type:"EPS_DECELERATION",label:"Profit Growth Slowing Down",severity:"negative",confidence:65,detail:`Growth slowed from ${pv}% to ${l}%.`,affectedQuarters:[r[r.length-2].period,r[r.length-1].period],laymanSummary:"Profit growth slowing down — momentum fading."});}
if(r.length>=2){const a=r[r.length-2];const b=r[r.length-1];const rg=((b.metrics.revenue-a.metrics.revenue)/a.metrics.revenue)*100;const pg=((b.metrics.profitAfterTax-a.metrics.profitAfterTax)/a.metrics.profitAfterTax)*100;if(Math.abs(rg)<3&&pg<-8)p.push({type:"REV_PLATEAU_PROF_DECLINE",label:"Sales Flat, Profits Falling",severity:"negative",confidence:72,detail:`Sales flat (${rg.toFixed(1)}%) but profit dropped ${pg.toFixed(1)}%.`,affectedQuarters:[a.period,b.period],laymanSummary:"Sales flat but profits falling — cost pressure."});}
if(r.length>=2){const l=r[r.length-1].metrics.dividendPayoutRatio;const pv=r[r.length-2].metrics.dividendPayoutRatio;if(l>pv+10&&l>40)p.push({type:"PAYOUT_INCREASE",label:"Paying Out More Cash",severity:"positive",confidence:68,detail:`Payout rose from ${pv}% to ${l}%.`,affectedQuarters:[r[r.length-2].period,r[r.length-1].period],laymanSummary:"Company paying more of its profit as dividends."});}
{let run=0;const a:string[]=[];for(const x of r){if(x.metrics.profitYoYGrowth<-5){run++;a.push(x.period);}else break;}if(run>=2)p.push({type:"PROFIT_DECLINE_STREAK",label:"Profits Falling Quarter After Quarter",severity:"negative",confidence:Math.min(80,45+run*15),detail:`${run} quarters of YoY profit decline.`,affectedQuarters:a,laymanSummary:"Profits falling every quarter — earnings recession."});}
if(r.length>=3){const o=r[r.length-3].metrics.profitYoYGrowth;const l=r[r.length-1].metrics.profitYoYGrowth;if(o<-5&&l>15)p.push({type:"TURNAROUND",label:"Profits Bouncing Back",severity:"positive",confidence:78,detail:`From ${o.toFixed(0)}% to ${l.toFixed(0)}% YoY.`,affectedQuarters:[r[r.length-3].period,r[r.length-1].period],laymanSummary:"Profits bounced back from decline — recovery."});}
if(r.length>=1){const x=r[r.length-1];if(x.metrics.dividendPerShare>0&&x.metrics.dividendPayoutRatio>=50&&x.metrics.dividendPayoutRatio<=85&&x.metrics.profitYoYGrowth>5)p.push({type:"SUSTAINABLE_HIGH_PAYOUT",label:"Healthy Dividend Payer",severity:"positive",confidence:75,detail:`Pays ${x.metrics.dividendPayoutRatio}% with profit growing ${x.metrics.profitYoYGrowth}% YoY.`,affectedQuarters:[x.period],laymanSummary:"Pays good dividend AND profits still growing."});}
if(r.length>=8){const f=r[0];const l=r[r.length-1];const y=(new Date(l.periodEnd).getTime()-new Date(f.periodEnd).getTime())/(365*24*60*60*1000);if(y>1&&f.metrics.revenue>0){const c=(Math.pow(l.metrics.revenue/f.metrics.revenue,1/y)-1)*100;if(c>12)p.push({type:"REV_CAGR_5Y",label:"Sales Growing Steadily Over Many Years",severity:"positive",confidence:80,detail:`Revenue CAGR ${c.toFixed(1)}% over ${y.toFixed(1)} years.`,affectedQuarters:[f.period,l.period],laymanSummary:"Sales growing 12%+ per year for years."});else if(c<0)p.push({type:"REV_DECLINE_5Y",label:"Sales Shrinking Over Many Years",severity:"negative",confidence:75,detail:`Revenue contracted at ${c.toFixed(1)}% CAGR.`,affectedQuarters:[f.period,l.period],laymanSummary:"Sales shrinking year after year."});}}
if(r.length>=8){const f=r[0];const l=r[r.length-1];const y=(new Date(l.periodEnd).getTime()-new Date(f.periodEnd).getTime())/(365*24*60*60*1000);if(y>1&&f.metrics.eps>0){const c=(Math.pow(l.metrics.eps/f.metrics.eps,1/y)-1)*100;if(c>15)p.push({type:"EPS_CAGR_5Y",label:"Per-Share Profit Growing Strongly Long-Term",severity:"positive",confidence:82,detail:`EPS CAGR ${c.toFixed(1)}% over ${y.toFixed(1)} years.`,affectedQuarters:[f.period,l.period],laymanSummary:"Per-share profit growing 15%+ per year for years."});}}
if(r.length>=8){const ms=r.map(x=>x.metrics.netMargin);const n=ms.length;const xs=Array.from({length:n},(_,i)=>i);const mX=xs.reduce((a,b)=>a+b,0)/n;const mY=ms.reduce((a,b)=>a+b,0)/n;let num=0,den=0;for(let i=0;i<n;i++){num+=(xs[i]-mX)*(ms[i]-mY);den+=(xs[i]-mX)**2;}const s=den>0?num/den:0;if(s>0.15)p.push({type:"MARGIN_UPTREND_5Y",label:"Profit Margin Expanding Over Many Years",severity:"positive",confidence:85,detail:`Margin expanding ${s.toFixed(2)}pp/quarter.`,affectedQuarters:[r[0].period,r[n-1].period],laymanSummary:"Profit margin expanding steadily for years."});else if(s<-0.15)p.push({type:"MARGIN_DOWNTREND_5Y",label:"Profit Margin Compressing Over Many Years",severity:"negative",confidence:82,detail:`Margin shrinking ${Math.abs(s).toFixed(2)}pp/quarter.`,affectedQuarters:[r[0].period,r[n-1].period],laymanSummary:"Profit margin shrinking for years."});}
{const dq=r.filter(x=>x.metrics.dividendPerShare>0);if(dq.length>=4){const l4=dq.slice(-4);const inc=l4.every((x,i)=>i===0||x.metrics.dividendPerShare>=l4[i-1].metrics.dividendPerShare);p.push({type:"CONSISTENT_DIV_PAYER",label:"Reliable Dividend Payer",severity:"positive",confidence:inc?88:78,detail:`${dq.length} quarters of dividends${inc?' with increases':''}.`,affectedQuarters:l4.map(x=>x.period),laymanSummary:"Pays dividends consistently — shareholder-friendly."});}}
if(r.length>=8){const eg=r.map(x=>x.metrics.epsYoYGrowth);const mn=eg.reduce((a,b)=>a+b,0)/eg.length;const v=eg.reduce((s,v2)=>s+(v2-mn)**2,0)/eg.length;const sd=Math.sqrt(v);if(sd>15)p.push({type:"HIGH_VOLATILITY",label:"Profits Unpredictable",severity:"negative",confidence:70,detail:`Std dev ${sd.toFixed(1)}pp.`,affectedQuarters:[r[0].period,r[r.length-1].period],laymanSummary:"Profits swing wildly — unpredictable earnings."});}
return p;}
export function groupByCompany(r:QuarterlyResult[]):{symbol:string;company:string;results:QuarterlyResult[]}[]{const m=new Map<string,QuarterlyResult[]>();for(const x of r){if(!m.has(x.symbol))m.set(x.symbol,[]);m.get(x.symbol)!.push(x);}return Array.from(m.entries()).map(([s,rs])=>({symbol:s,company:rs[0].company,results:rs.sort((a,b)=>new Date(a.periodEnd).getTime()-new Date(b.periodEnd).getTime())}));}
export function computeCAGR(s:number,e:number,y:number):number{if(s<=0||e<=0||y<=0)return 0;return(Math.pow(e/s,1/y)-1)*100;}
export function computeStdDev(v:number[]):number{if(v.length<2)return 0;const m=v.reduce((a,b)=>a+b,0)/v.length;return Math.sqrt(v.reduce((s,x)=>s+(x-m)**2,0)/v.length);}
export function computeSlope(v:number[]):number{const n=v.length;if(n<2)return 0;const xs=Array.from({length:n},(_,i)=>i);const mX=xs.reduce((a,b)=>a+b,0)/n;const mY=v.reduce((a,b)=>a+b,0)/n;let num=0,den=0;for(let i=0;i<n;i++){num+=(xs[i]-mX)*(v[i]-mY);den+=(xs[i]-mX)**2;}return den>0?num/den:0;}
export function generateQuarterlySummary(r:QuarterlyResult[], symbol?:string):QuarterSummary[]{if(r.length<4)return[];const sector=classifySector(symbol);const byQ:Record<number,QuarterResult[]>={1:[],2:[],3:[],4:[]};const byY=new Map<string,QuarterResult[]>();for(const x of r){const mo=new Date(x.periodEnd).getMonth()+1;let q:1|2|3|4=mo>=7&&mo<=9?1:mo>=10&&mo<=12?2:mo>=1&&mo<=3?3:4;byQ[q].push(x);const fy=x.period.replace(/.*FY/,"");if(!byY.has(fy))byY.set(fy,[]);byY.get(fy)!.push(x);}const sums:QuarterSummary[]=[];for(const qNum of[1,2,3,4]as const){const qs=byQ[qNum];if(!qs.length)continue;let tr=0,tv=0;for(const[_,yr]of Array.from(byY.entries())){const yt=yr.reduce((s,x)=>s+x.metrics.revenue,0);const qr=yr.find(x=>{const m=new Date(x.periodEnd).getMonth()+1;return(m>=7&&m<=9&&qNum===1)||(m>=10&&m<=12&&qNum===2)||(m>=1&&m<=3&&qNum===3)||(m>=4&&m<=6&&qNum===4);});if(qr&&yt>0){tr+=qr.metrics.revenue/yt;tv++;}}const arP=tv>0?(tr/tv)*100:25;let tp=0,tpv=0;for(const[_,yr]of Array.from(byY.entries())){const yt=yr.reduce((s,x)=>s+x.metrics.profitAfterTax,0);const qr=yr.find(x=>{const m=new Date(x.periodEnd).getMonth()+1;return(m>=7&&m<=9&&qNum===1)||(m>=10&&m<=12&&qNum===2)||(m>=1&&m<=3&&qNum===3)||(m>=4&&m<=6&&qNum===4);});if(qr&&yt>0){tp+=qr.metrics.profitAfterTax/yt;tpv++;}}const apP=tpv>0?(tp/tpv)*100:25;const am=qs.reduce((s,x)=>s+x.metrics.netMargin,0)/qs.length;let tp_:QuarterSummary["typicalPattern"];if(arP<22)tp_="low";else if(arP>28)tp_="peak";else if(qNum===1)tp_="low";else if(qNum===4)tp_="peak";else if(qNum===2)tp_="rising";else tp_="moderate";const pq=qNum===1?4:qNum-1;const pqs=byQ[pq]||[];const par=pqs.length>0?pqs.reduce((s,x)=>s+x.metrics.revenue,0)/pqs.length:0;const car=qs.reduce((s,x)=>s+x.metrics.revenue,0)/qs.length;const st=par>0?(car>par*1.03?"up":car<par*0.97?"down":"flat"):"flat";const ppr=pqs.length>0?pqs.reduce((s,x)=>s+x.metrics.profitAfterTax,0)/pqs.length:0;const cap=qs.reduce((s,x)=>s+x.metrics.profitAfterTax,0)/qs.length;const pt=ppr>0?(cap>ppr*1.03?"up":cap<ppr*0.97?"down":"flat"):"flat";const sd=st==="up"?"go UP":st==="down"?"go DOWN":"stay FLAT";const pd=pt==="up"?"go UP":pt==="down"?"go DOWN":"stay FLAT";const ml=qNum===1?"Jul-Sep":qNum===2?"Oct-Dec":qNum===3?"Jan-Mar":"Apr-Jun";let s="";switch(tp_){case"low":s=`In Q${qNum}, sales typically ${sd} from the previous quarter. This is the off-season — lower volumes. Profits usually ${pd} too.`;break;case"rising":s=`In Q${qNum}, sales ${sd} strongly — the seasonal tailwind kicks in. Profits ${pd} as the company scales up.`;break;case"peak":s=`In Q${qNum}, sales ${sd} and often peak for the year. The company books its largest profit. Management often declares dividends here.`;break;case"moderate":s=`In Q${qNum}, sales ${sd} — stabilizing at moderate levels. Profits ${pd}. Transition quarter.`;break;}const cs=getSectorCauseSummary(sector,qNum);sums.push({quarter:qNum,quarterLabel:`Q${qNum}`,monthsLabel:ml,avgRevenuePctOfTotal:arP,avgProfitPctOfTotal:apP,avgNetMargin:am,typicalPattern:tp_,summary:s,causeSummary:cs});}return sums;}
