import { blocks, tag } from '../lib/xml.js';
const LIST_URL='https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo212L01.do';
const DETAIL_URL='https://www.work24.go.kr/cm/openApi/call/wk/callOpenApiSvcInfo212D01.do';

async function getText(url, params, timeoutMs=9000){
  const u=new URL(url); for(const [k,v] of Object.entries(params)) if(v!==undefined&&v!==null&&v!=='')u.searchParams.set(k,String(v));
  const c=new AbortController();const t=setTimeout(()=>c.abort(),timeoutMs);
  try{const r=await fetch(u,{signal:c.signal,headers:{'user-agent':'today-money-sense/1.0'}});const text=await r.text();if(!r.ok)throw new Error(`Work24 HTTP ${r.status}`);return text;}finally{clearTimeout(t)}
}
export function configured(){return Boolean((process.env.WORK24_API_KEY || process.env.PUBLIC_DATA_API_KEY))}
export async function searchJobs(keyword){
  if(!configured())return[];
  const xml=await getText(LIST_URL,{authKey:(process.env.WORK24_API_KEY || process.env.PUBLIC_DATA_API_KEY),returnType:'XML',target:'JOBCD',srchType:'K',keyword});
  if(/error|invalid|인증/i.test(tag(xml,'message')||'')) throw new Error(tag(xml,'message'));
  return blocks(xml,'jobList').map(b=>({jobCd:tag(b,'jobCd'),jobNm:tag(b,'jobNm'),jobClcdNM:tag(b,'jobClcdNM')})).filter(x=>x.jobCd&&x.jobNm);
}
export async function jobSalary(jobCd){
  const xml=await getText(DETAIL_URL,{authKey:(process.env.WORK24_API_KEY || process.env.PUBLIC_DATA_API_KEY),returnType:'XML',target:'JOBDTL',jobGb:1,jobCd,dtlGb:4});
  return {sal:tag(xml,'sal'),jobSatis:tag(xml,'jobSatis'),jobProspect:tag(xml,'jobProspect')};
}
function salaryWon(text){
  const cleaned=String(text||'').replaceAll(',','');
  const nums=[...cleaned.matchAll(/([0-9]{2,6}(?:\.[0-9]+)?)\s*만원/g)].map(m=>Number(m[1])*10000).filter(Number.isFinite);
  if(!nums.length){
    const raw=[...cleaned.matchAll(/([0-9]{7,9})/g)].map(m=>Number(m[1])).filter(Number.isFinite);
    if(!raw.length)return null; raw.sort((a,b)=>a-b); return raw[Math.floor(raw.length/2)];
  }
  nums.sort((a,b)=>a-b);return nums[Math.floor(nums.length/2)];
}
export async function validateWork24(){
  if(!configured())return{ok:false,configured:false,reason:'PUBLIC_DATA_API_KEY/WORK24_API_KEY missing'};
  try{const jobs=await searchJobs('개발자');return jobs.length?{ok:true,configured:true,sample:jobs[0].jobNm}:{ok:false,configured:true,reason:'No jobs returned'};}catch(e){return{ok:false,configured:true,reason:e.message}}
}
export async function work24SalaryQuestions(){
  if(!configured())return[];
  const keywords=['소프트웨어','간호사','회계사','디자이너','조리사','교사','사회복지사','전기'];
  const out=[];
  for(const kw of keywords){
    try{
      const jobs=await searchJobs(kw);const job=jobs[0];if(!job)continue;
      const d=await jobSalary(job.jobCd);const answer=salaryWon(d.sal);if(!answer||answer<10000000||answer>300000000)continue;
      const step=1000000;
      out.push({id:`work24-${job.jobCd}`,category:'직업·소득',type:'price',title:`${job.jobNm}의 평균 연봉 수준은?`,subtitle:'고용24 직업정보 · 임금/직업만족도/전망',min:Math.max(10000000,Math.floor(answer*.45/step)*step),max:Math.ceil(answer*1.65/step)*step,step,answer,unit:'원',source:`고용24 직업정보 · ${job.jobNm}`,provider:'고용24',live:true,rawSalary:d.sal});
      if(out.length>=6)break;
    }catch{}
  }
  return out;
}
