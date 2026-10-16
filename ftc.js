export function configured(){return Boolean((process.env.DATA_GO_KR_API_KEY || process.env.PUBLIC_DATA_API_KEY) && process.env.FTC_STARTUP_COST_URL)}

async function fetchJson(timeoutMs=9000){
  const base=process.env.FTC_STARTUP_COST_URL;if(!base)throw new Error('FTC_STARTUP_COST_URL missing');
  const u=new URL(base);u.searchParams.set('serviceKey',(process.env.DATA_GO_KR_API_KEY || process.env.PUBLIC_DATA_API_KEY)||'');u.searchParams.set('pageNo','1');u.searchParams.set('numOfRows','100');u.searchParams.set('type','json');u.searchParams.set('_type','json');
  const c=new AbortController();const t=setTimeout(()=>c.abort(),timeoutMs);
  try{const r=await fetch(u,{signal:c.signal,headers:{'user-agent':'today-money-sense/1.0'}});const text=await r.text();if(!r.ok)throw new Error(`FTC HTTP ${r.status}`);try{return JSON.parse(text)}catch{throw new Error(`FTC non-JSON response: ${text.slice(0,120)}`)}}finally{clearTimeout(t)}
}
function rowsFrom(obj){
  const candidates=[obj?.response?.body?.items?.item,obj?.response?.body?.items,obj?.items?.item,obj?.items,obj?.data,obj];
  for(const x of candidates){if(Array.isArray(x))return x;if(x&&typeof x==='object'&&Object.keys(x).length)return[x]}
  return[];
}
function num(v){const n=Number(String(v??'').replaceAll(',','').replace(/[^0-9.+-]/g,''));return Number.isFinite(n)?n:null}
function first(row,names){for(const n of names)if(row?.[n]!=null&&row[n]!=='')return row[n];return null}
export async function validateFtc(){
  if(!(process.env.DATA_GO_KR_API_KEY || process.env.PUBLIC_DATA_API_KEY))return{ok:false,configured:false,reason:'PUBLIC_DATA_API_KEY/DATA_GO_KR_API_KEY missing'};
  if(!process.env.FTC_STARTUP_COST_URL)return{ok:false,configured:false,reason:'FTC endpoint not set yet'};
  try{const j=await fetchJson();const rows=rowsFrom(j);return rows.length?{ok:true,configured:true,count:rows.length}:{ok:false,configured:true,reason:'No rows returned'};}catch(e){return{ok:false,configured:true,reason:e.message}}
}
export async function ftcQuestions(){
  if(!configured())return[];
  let j;try{j=await fetchJson()}catch{return[]}
  const out=[];
  for(const [i,r] of rowsFrom(j).entries()){
    const name=first(r,['indutyLclasNm','indutyNm','brandNm','frcsNm','corpNm','bizNm','업종대분류명','브랜드명'])||`가맹 업종 ${i+1}`;
    const parts=[first(r,['avgFrcsGrntyAmt','avgGrntyAmt','평균가맹보증금액']),first(r,['avgFrcsEduAmt','avgEduAmt','평균가맹교육금액']),first(r,['avgFrcsEtcAmt','avgEtcAmt','평균가맹기타금액']),first(r,['avgFrcsAmt','frcsAmt','가맹금액'])].map(num).filter(x=>x!=null&&x>=0);
    let answer=parts.length?parts.reduce((a,b)=>a+b,0):num(first(r,['startupAmt','totAmt','sumAmt','창업비용']));
    if(!answer||answer<1000000)continue;
    if(answer<1000000*5 && String(first(r,['moneyUnit','unitNm'])||'').includes('천'))answer*=1000;
    const step=1000000;
    out.push({id:`ftc-${i}-${String(name).slice(0,30)}`,category:'프랜차이즈',type:'price',title:`${name}의 평균 창업 관련 비용은?`,subtitle:'가맹비·교육비·보증금 등 공개 항목 합산',min:Math.max(1000000,Math.floor(answer*.35/step)*step),max:Math.ceil(answer*1.8/step)*step,step,answer:Math.round(answer),unit:'원',source:'공정거래위원회 가맹정보',provider:'공정위',live:true});
    if(out.length>=10)break;
  }
  return out;
}
