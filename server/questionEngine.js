import { QUESTION_POOL } from '../src/questions.js';
import { questionsFromConfiguredTables } from './providers/kosis.js';
import { ftcQuestions } from './providers/ftc.js';

const FALLBACK = QUESTION_POOL.map(q=>({...q, provider:'예비 데이터', live:false}));

function hash(s){
  let h=2166136261;
  for(let i=0;i<s.length;i++){
    h^=s.charCodeAt(i);
    h=Math.imul(h,16777619);
  }
  return h>>>0;
}

function shuffle(a,seed){
  const x=[...a];
  let n=hash(seed)||1;
  const rand=()=>{
    n^=n<<13;
    n^=n>>>17;
    n^=n<<5;
    return(n>>>0)/4294967296;
  };
  for(let i=x.length-1;i>0;i--){
    const j=Math.floor(rand()*(i+1));
    [x[i],x[j]]=[x[j],x[i]];
  }
  return x;
}

function dedupe(qs){
  const s=new Set();
  return qs.filter(q=>q?.id&&!s.has(q.id)&&(s.add(q.id),true));
}

export async function buildPool(){
  const settled = await Promise.allSettled([
    questionsFromConfiguredTables(),
    ftcQuestions()
  ]);
  const live = settled.flatMap(x=>x.status==='fulfilled'?x.value:[]);
  return dedupe([...live,...FALLBACK]);
}

export async function dailyQuestions(date){
  const pool=await buildPool();
  return {
    questions:shuffle(pool,`daily:${date}`).slice(0,5),
    poolSize:pool.length,
    liveCount:pool.filter(q=>q.live).length,
    sources:[...new Set(pool.filter(q=>q.live).map(q=>q.provider))]
  };
}

export async function practiceQuestions(date,exclude=[]){
  const pool=await buildPool();
  const ex=new Set(exclude);
  const available=pool.filter(q=>!ex.has(q.id));
  return {
    questions:shuffle(available,`practice:${date}:${exclude.join(',')}:${Date.now()}`).slice(0,5),
    poolSize:pool.length,
    remaining:available.length,
    liveCount:pool.filter(q=>q.live).length,
    sources:[...new Set(pool.filter(q=>q.live).map(q=>q.provider))]
  };
}
