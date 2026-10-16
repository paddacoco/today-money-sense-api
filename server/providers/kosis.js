const SEARCH_URL = 'https://kosis.kr/openapi/statisticsSearch.do';
const DATA_URL = 'https://kosis.kr/openapi/Param/statisticsParameterData.do';

function normalizeRows(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const err = json.err || json.error || json.errMsg || json.message;
    if (err) throw new Error(`KOSIS API error: ${String(err).slice(0,180)}`);
    // KOSIS may return a single result object instead of a one-element array.
    if (json.ORG_ID || json.TBL_ID || json.ITM_ID || json.DT != null) return [json];
    for (const key of ['result','data','rows','list']) {
      if (Array.isArray(json[key])) return json[key];
    }
  }
  throw new Error(`KOSIS unexpected response: ${JSON.stringify(json).slice(0,180)}`);
}

async function getJson(url, params, timeoutMs=9000) {
  const u = new URL(url);
  for (const [k,v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  }
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(u, {signal:ctrl.signal, headers:{'user-agent':'today-money-sense/1.0'}});
    const text = await r.text();
    if (!r.ok) throw new Error(`KOSIS HTTP ${r.status}: ${text.slice(0,140)}`);
    let json;
    try { json = JSON.parse(text); }
    catch { throw new Error(`KOSIS non-JSON response: ${text.slice(0,140)}`); }
    return normalizeRows(json);
  } finally {
    clearTimeout(t);
  }
}

export function configured() { return Boolean(process.env.KOSIS_API_KEY); }

export async function validateKosis() {
  if (!configured()) return {ok:false, configured:false, reason:'KOSIS_API_KEY missing'};
  try {
    const rows = await getJson(SEARCH_URL, {
      method:'getList',
      apiKey:process.env.KOSIS_API_KEY,
      searchNm:'가계지출',
      sort:'RANK',
      startCount:1,
      resultCount:1,
      format:'json'
    });
    return {
      ok: rows.length > 0,
      configured:true,
      count: rows.length,
      sample: rows[0]?.TBL_NM || rows[0]?.TBL_ID || null
    };
  } catch (e) {
    return {ok:false, configured:true, reason:e.message};
  }
}

export async function searchKosisTables(searchNm, count=5) {
  if (!configured()) return [];
  return getJson(SEARCH_URL, {
    method:'getList',
    apiKey:process.env.KOSIS_API_KEY,
    searchNm,
    sort:'RANK',
    startCount:1,
    resultCount:Math.min(20,count),
    format:'json'
  });
}

function toNumber(v) {
  const n = Number(String(v ?? '').replaceAll(',','').replace(/[^0-9.+-]/g,''));
  return Number.isFinite(n) ? n : null;
}

export async function questionsFromConfiguredTables() {
  if (!configured()) return [];
  let specs=[];
  try { specs = JSON.parse(process.env.KOSIS_TABLE_SPECS_JSON || '[]'); } catch { return []; }
  if (!Array.isArray(specs) || !specs.length) return [];
  const out=[];
  for (const spec of specs.slice(0,12)) {
    try {
      const rows = await getJson(DATA_URL, {
        method:'getList',
        apiKey:process.env.KOSIS_API_KEY,
        orgId:spec.orgId,
        tblId:spec.tblId,
        objL1:spec.objL1 || 'all',
        objL2:spec.objL2,
        objL3:spec.objL3,
        itmId:spec.itmId || 'all',
        prdSe:spec.prdSe || 'Y',
        newEstPrdCnt:1,
        format:'json',
        jsonVD:'Y'
      });
      const usable = rows.map(r=>({...r,_n:toNumber(r.DT)})).filter(r=>r._n!=null && r._n>0);
      const row = usable.find(r=>!spec.nameContains || `${r.C1_NM||''} ${r.ITM_NM||''}`.includes(spec.nameContains)) || usable[0];
      if (!row) continue;
      const multiplier = Number(spec.multiplier || 1);
      const answer = Math.round(row._n * multiplier);
      if (!(answer>0)) continue;
      out.push({
        id:`kosis-${spec.orgId}-${spec.tblId}-${row.ITM_ID||'item'}-${row.C1||'all'}-${row.PRD_DE||'latest'}`,
        category:spec.category || '대한민국 통계',
        type:'price',
        title:spec.title || `${row.C1_NM || row.ITM_NM || row.TBL_NM}은 얼마일까요?`,
        subtitle:`${row.PRD_DE || '최근'} 기준 · ${row.UNIT_NM || spec.unitLabel || ''}`.trim(),
        min:Math.max(0, Math.floor(answer * 0.35 / (spec.step||1000))*(spec.step||1000)),
        max:Math.ceil(answer * 1.8 / (spec.step||1000))*(spec.step||1000),
        step:Number(spec.step || 1000),
        answer,
        unit:'원',
        source:`KOSIS · ${row.TBL_NM || spec.tblId} · ${row.PRD_DE || '최근'}`,
        provider:'KOSIS',
        live:true,
        baseYear:row.PRD_DE || null
      });
    } catch {}
  }
  return out;
}
