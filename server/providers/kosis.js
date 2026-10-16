const SEARCH_URL = 'https://kosis.kr/openapi/statisticsSearch.do';
const DATA_URL = 'https://kosis.kr/openapi/Param/statisticsParameterData.do';

function parseKosis(text) {
  try { return JSON.parse(text); } catch {}

  try {
    const fixed = String(text)
      .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3')
      .replace(/:\s*'([^']*)'/g, (_, v) => ':' + JSON.stringify(v));
    return JSON.parse(fixed);
  } catch {}

  throw new Error(`KOSIS non-JSON response: ${String(text).slice(0,180)}`);
}

function normalizeRows(json) {
  if (Array.isArray(json)) return json;
  if (json && typeof json === 'object') {
    const err = json.err || json.error || json.errMsg || json.message;
    if (err) throw new Error(`KOSIS API error: ${String(err).slice(0,180)}`);
    if (json.ORG_ID || json.TBL_ID || json.ITM_ID || json.DT != null) return [json];
    for (const key of ['result','data','rows','list']) {
      if (Array.isArray(json[key])) return json[key];
    }
  }
  throw new Error(`KOSIS unexpected response: ${JSON.stringify(json).slice(0,180)}`);
}

async function getRows(url, params, timeoutMs=15000) {
  const u = new URL(url);
  for (const [k,v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  }
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(u, {
      signal:ctrl.signal,
      headers:{'user-agent':'today-money-sense/1.0'}
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`KOSIS HTTP ${r.status}: ${text.slice(0,160)}`);
    return normalizeRows(parseKosis(text));
  } finally {
    clearTimeout(t);
  }
}

export function configured() {
  return Boolean(process.env.KOSIS_API_KEY);
}

async function searchTables(searchNm='가계지출', count=5) {
  return getRows(SEARCH_URL, {
    method:'getList',
    apiKey:process.env.KOSIS_API_KEY,
    searchNm,
    sort:'RANK',
    startCount:1,
    resultCount:Math.min(20,count),
    format:'json'
  });
}

export async function validateKosis() {
  if (!configured()) return {ok:false, configured:false, reason:'KOSIS_API_KEY missing'};
  try {
    const rows = await searchTables('가계지출', 1);
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

function toNumber(v) {
  const n = Number(String(v ?? '').replaceAll(',','').replace(/[^0-9.+-]/g,''));
  return Number.isFinite(n) ? n : null;
}

function unitMultiplier(unit='') {
  const s = String(unit).replace(/\s/g,'');
  if (s.includes('억원')) return 100000000;
  if (s.includes('백만원')) return 1000000;
  if (s.includes('만원')) return 10000;
  if (s.includes('천원')) return 1000;
  return 1;
}

function chooseLabel(row) {
  return String(
    row.C1_NM ||
    row.C2_NM ||
    row.C3_NM ||
    row.ITM_NM ||
    row.TBL_NM ||
    ''
  ).trim();
}

function makeQuestion(row, spec={}) {
  const raw = toNumber(row.DT);
  if (!(raw > 0)) return null;

  const multiplier = Number(spec.multiplier || unitMultiplier(row.UNIT_NM || spec.unitLabel || ''));
  const answer = Math.round(raw * multiplier);
  if (!(answer > 0)) return null;

  const label = spec.titleLabel || chooseLabel(row);
  if (!label) return null;

  const step =
    Number(spec.step) ||
    (answer >= 100_000_000 ? 5_000_000 :
     answer >= 10_000_000 ? 1_000_000 :
     answer >= 1_000_000 ? 100_000 :
     answer >= 100_000 ? 10_000 : 1_000);

  const period = row.PRD_DE || '최근';
  const unitText = row.UNIT_NM || spec.unitLabel || '';

  return {
    id:`kosis-${spec.orgId || row.ORG_ID || 'org'}-${spec.tblId || row.TBL_ID || 'tbl'}-${row.ITM_ID||'item'}-${row.C1||row.C2||row.C3||'all'}-${period}`,
    category:spec.category || '생활비·가계',
    type:'price',
    title:spec.title || `${label}의 금액은 얼마일까요?`,
    subtitle:`${period} 기준${unitText ? ` · 원자료 단위 ${unitText}` : ''}`,
    min:Math.max(0, Math.floor(answer * 0.35 / step) * step),
    max:Math.max(step * 2, Math.ceil(answer * 1.8 / step) * step),
    step,
    answer,
    unit:'원',
    source:`KOSIS · ${row.TBL_NM || spec.tblId || '가계지출'} · ${period}`,
    provider:'KOSIS',
    live:true,
    baseYear:period
  };
}

async function rowsForSpec(spec) {
  return getRows(DATA_URL, {
    method:'getList',
    apiKey:process.env.KOSIS_API_KEY,
    orgId:spec.orgId,
    tblId:spec.tblId,
    objL1:spec.objL1 || 'all',
    objL2:spec.objL2,
    objL3:spec.objL3,
    itmId:spec.itmId || 'all',
    prdSe:spec.prdSe || 'Y',
    newEstPrdCnt:spec.newEstPrdCnt || 1,
    format:'json',
    jsonVD:'Y'
  });
}

async function autoQuestions() {
  const tables = await searchTables('가계지출', 5);
  const table = tables.find(x => x.ORG_ID && x.TBL_ID) || tables[0];
  if (!table?.ORG_ID || !table?.TBL_ID) return [];

  const rows = await rowsForSpec({
    orgId: table.ORG_ID,
    tblId: table.TBL_ID,
    objL1:'all',
    itmId:'all',
    prdSe:'Y',
    newEstPrdCnt:1
  });

  const out = [];
  const seen = new Set();

  for (const row of rows) {
    const q = makeQuestion(row, {
      orgId: table.ORG_ID,
      tblId: table.TBL_ID,
      category:'생활비·가계'
    });
    if (!q) continue;

    const label = q.title;
    if (/계$|합계|전체|총액/.test(label) && out.length >= 3) continue;
    if (seen.has(label)) continue;

    seen.add(label);
    out.push(q);
    if (out.length >= 8) break;
  }

  return out;
}

export async function questionsFromConfiguredTables() {
  if (!configured()) return [];

  let specs=[];
  try { specs = JSON.parse(process.env.KOSIS_TABLE_SPECS_JSON || '[]'); } catch {}

  // No manual specs: discover a usable household-expenditure table automatically.
  if (!Array.isArray(specs) || !specs.length) {
    try { return await autoQuestions(); }
    catch { return []; }
  }

  const out=[];
  for (const spec of specs.slice(0,12)) {
    try {
      const rows = await rowsForSpec(spec);
      const usable = rows.filter(r => {
        const n = toNumber(r.DT);
        return n != null && n > 0 &&
          (!spec.nameContains || `${r.C1_NM||''} ${r.C2_NM||''} ${r.ITM_NM||''}`.includes(spec.nameContains));
      });

      for (const row of usable) {
        const q = makeQuestion(row, spec);
        if (q) out.push(q);
        if (out.length >= 12) break;
      }
    } catch {}
    if (out.length >= 12) break;
  }

  return out;
}
