import { blocks, tag } from '../lib/xml.js';

const LIST_URL='https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo212L01.do';
// dtlGb=4 (임금/직업만족도/전망) 전용 endpoint
const DETAIL_URL='https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo212D04.do';

function key(){ return process.env.WORK24_API_KEY || process.env.PUBLIC_DATA_API_KEY || ''; }

async function getText(url, params, timeoutMs=9000){
  const u=new URL(url);
  for(const [k,v] of Object.entries(params)) {
    if(v!==undefined&&v!==null&&v!=='')u.searchParams.set(k,String(v));
  }
  const c=new AbortController();
  const t=setTimeout(()=>c.abort(),timeoutMs);
  try{
    const r=await fetch(u,{signal:c.signal,headers:{'user-agent':'today-money-sense/1.0'}});
    const text=await r.text();
    if(!r.ok) throw new Error(`Work24 HTTP ${r.status}: ${text.slice(0,180)}`);
    return text;
  } finally { clearTimeout(t); }
}

function apiError(xml){
  const candidates=['message','errMsg','returnAuthMsg','returnMsg','errorMessage','resultMsg'];
  for(const n of candidates){
    const v=tag(xml,n);
    if(v && /error|invalid|인증|키|권한|실패/i.test(v)) return v;
  }
  return '';
}

export function configured(){ return Boolean(key()); }

export async function searchJobs(keyword=''){
  if(!configured())return[];
  const params={
    authKey:key(),
    returnType:'XML',
    target:'JOBCD',
    srchType:'K'
  };
  if(keyword) params.keyword=keyword;
  const xml=await getText(LIST_URL,params);
  const err=apiError(xml);
  if(err) throw new Error(err);
  return blocks(xml,'jobList')
    .map(b=>({
      jobCd:tag(b,'jobCd'),
      jobNm:tag(b,'jobNm'),
      jobClcdNM:tag(b,'jobClcdNM')
    }))
    .filter(x=>x.jobCd&&x.jobNm);
}

export async function jobSalary(jobCd){
  const xml=await getText(DETAIL_URL,{
    authKey:key(),
    returnType:'XML',
    target:'JOBDTL',
    jobGb:1,
    jobCd,
    dtlGb:4
  });
  const err=apiError(xml);
  if(err) throw new Error(err);
  return {
    sal:tag(xml,'sal'),
    jobSatis:tag(xml,'jobSatis'),
    jobProspect:tag(xml,'jobProspect')
  };
}

function salaryWon(text){
  const cleaned=String(text||'').replaceAll(',','');
  const nums=[...cleaned.matchAll(/([0-9]{2,6}(?:\.[0-9]+)?)\s*만원/g)]
    .map(m=>Number(m[1])*10000).filter(Number.isFinite);
  if(!nums.length){
    const raw=[...cleaned.matchAll(/([0-9]{7,9})/g)]
      .map(m=>Number(m[1])).filter(Number.isFinite);
    if(!raw.length)return null;
    raw.sort((a,b)=>a-b);
    return raw[Math.floor(raw.length/2)];
  }
  nums.sort((a,b)=>a-b);
  return nums[Math.floor(nums.length/2)];
}

export async function validateWork24(){
  if(!configured()) return {ok:false,configured:false,reason:'WORK24_API_KEY/PUBLIC_DATA_API_KEY missing'};
  try{
    // First test the mandatory-only request. This separates API-key problems
    // from a keyword that simply has zero matches.
    let jobs=await searchJobs('');
    if(!jobs.length) jobs=await searchJobs('소프트웨어');
    return jobs.length
      ? {ok:true,configured:true,count:jobs.length,sample:jobs[0].jobNm}
      : {ok:false,configured:true,reason:'Work24 returned zero jobList rows'};
  }catch(e){
    return {ok:false,configured:true,reason:e.message};
  }
}

export async function work24SalaryQuestions(){
  if(!configured())return[];
  const keywords=['소프트웨어','간호사','회계사','디자이너','조리사','교사','사회복지사','전기'];
  const out=[];
  for(const kw of keywords){
    try{
      const jobs=await searchJobs(kw);
      const job=jobs[0];
      if(!job)continue;
      const d=await jobSalary(job.jobCd);
      const answer=salaryWon(d.sal);
      if(!answer||answer<10000000||answer>300000000)continue;
      const step=1000000;
      out.push({
        id:`work24-${job.jobCd}`,
        category:'직업·소득',
        type:'price',
        title:`${job.jobNm}의 평균 연봉 수준은?`,
        subtitle:'고용24 직업정보 · 임금/직업만족도/전망',
        min:Math.max(10000000,Math.floor(answer*.45/step)*step),
        max:Math.ceil(answer*1.65/step)*step,
        step,
        answer,
        unit:'원',
        source:`고용24 직업정보 · ${job.jobNm}`,
        provider:'고용24',
        live:true,
        rawSalary:d.sal
      });
      if(out.length>=6)break;
    }catch{}
  }
  return out;
}
