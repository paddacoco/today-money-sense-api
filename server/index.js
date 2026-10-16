import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dailyQuestions, practiceQuestions } from './questionEngine.js';
import { validateKosis } from './providers/kosis.js';
import { validateFtc } from './providers/ftc.js';

const app = express();
const port = Number(process.env.PORT || 8787);
const allowed = process.env.ALLOWED_ORIGIN || '*';

app.disable('x-powered-by');
app.use((req,res,next)=>{
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control','no-store');
  if(req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({limit:'32kb'}));

const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date());

app.get('/health',(req,res)=>res.json({
  ok:true,
  service:'today-money-sense-api',
  version:'1.1.0'
}));

app.get('/api/providers/health', async (req,res)=>{
  const [kosis, ftc] = await Promise.all([validateKosis(), validateFtc()]);
  res.json({
    ok:true,
    kosis,
    ftc,
    providers:['KOSIS','공정위'],
    note:'Work24 integration removed. No API key values are returned.'
  });
});

app.get('/api/questions/daily',async(req,res)=>{
  try{
    const date = String(req.query.date || today()).slice(0,10);
    res.json({ok:true,date,...await dailyQuestions(date)});
  }catch(e){
    res.status(500).json({ok:false,error:'QUESTION_BUILD_FAILED',message:e.message});
  }
});

app.post('/api/questions/practice',async(req,res)=>{
  try{
    const date = String(req.body?.date || today()).slice(0,10);
    const exclude = Array.isArray(req.body?.exclude) ? req.body.exclude.slice(0,500) : [];
    res.json({ok:true,date,...await practiceQuestions(date,exclude)});
  }catch(e){
    res.status(500).json({ok:false,error:'QUESTION_BUILD_FAILED',message:e.message});
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname,'../dist');
app.use(express.static(dist));
app.get(/.*/, (req,res,next)=>{
  if(req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(dist,'index.html'),err=>{if(err)next()});
});

app.listen(port,()=>console.log(`today-money-sense API :${port}`));
