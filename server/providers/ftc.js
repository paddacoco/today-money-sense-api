const DEFAULT_BASE = 'https://apis.data.go.kr/1130000/FftcSclasIndutyFntnStatsService';

const OPERATIONS = [
  { path: '/getSclaIndutyFntnSrvcStats', label: '서비스업' },
  { path: '/getSclaIndutyFntnWhrtStats', label: '도소매업' },
  { path: '/getSclaIndutyFntnOutStats',  label: '외식업' },
];

function apiKey() {
  return process.env.DATA_GO_KR_API_KEY || process.env.PUBLIC_DATA_API_KEY || '';
}

function baseUrl() {
  const configured = process.env.FTC_STARTUP_COST_URL || DEFAULT_BASE;
  try {
    const u = new URL(configured);
    u.search = '';
    for (const op of OPERATIONS) {
      if (u.pathname.endsWith(op.path)) {
        u.pathname = u.pathname.slice(0, -op.path.length);
        break;
      }
    }
    return u.toString().replace(/\/$/, '');
  } catch {
    return DEFAULT_BASE;
  }
}

export function configured() {
  return Boolean(apiKey());
}

async function fetchOne(op, timeoutMs = 20000) {
  const u = new URL(baseUrl() + op.path);
  u.searchParams.set('serviceKey', apiKey());
  u.searchParams.set('pageNo', '1');
  u.searchParams.set('numOfRows', '20');
  u.searchParams.set('resultType', 'json');
  u.searchParams.set('yr', process.env.FTC_YEAR || '2021');

  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);

  try {
    const r = await fetch(u, {
      signal: c.signal,
      headers: { 'user-agent': 'today-money-sense/1.0' },
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${op.label} HTTP ${r.status}: ${text.slice(0,220)}`);
    try {
      return { op, json: JSON.parse(text) };
    } catch {
      throw new Error(`${op.label} non-JSON response: ${text.slice(0,220)}`);
    }
  } finally {
    clearTimeout(t);
  }
}

function rowsFrom(obj) {
  const candidates = [
    obj?.response?.body?.items?.item,
    obj?.response?.body?.items,
    obj?.items?.item,
    obj?.items,
    obj?.data,
    obj,
  ];
  for (const x of candidates) {
    if (Array.isArray(x)) return x;
    if (x && typeof x === 'object' && Object.keys(x).length) return [x];
  }
  return [];
}

function num(v) {
  const n = Number(String(v ?? '').replaceAll(',', '').replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function normalizeRows(result) {
  return rowsFrom(result.json).map((row, i) => ({
    ...row,
    __category: result.op.label,
    __i: i
  }));
}

function unitMultiplier(row) {
  const unit = String(row?.crrncyUnitCdNm || '').replace(/\s/g,'');
  if (unit.includes('억원')) return 100000000;
  if (unit.includes('백만원')) return 1000000;
  if (unit.includes('만원')) return 10000;
  if (unit.includes('천원')) return 1000;
  return 1;
}

export async function validateFtc() {
  if (!configured()) {
    return {
      ok: false,
      configured: false,
      reason: 'PUBLIC_DATA_API_KEY/DATA_GO_KR_API_KEY missing'
    };
  }

  const settled = await Promise.allSettled(
    OPERATIONS.map(op => fetchOne(op, 20000))
  );

  const details = settled.map((r, i) => {
    if (r.status === 'fulfilled') {
      const count = rowsFrom(r.value.json).length;
      return {
        category: OPERATIONS[i].label,
        ok: count > 0,
        count
      };
    }
    return {
      category: OPERATIONS[i].label,
      ok: false,
      reason: r.reason?.message || String(r.reason)
    };
  });

  const total = details.reduce((s, x) => s + (x.count || 0), 0);

  return total > 0
    ? { ok: true, configured: true, count: total, details }
    : {
        ok: false,
        configured: true,
        reason: 'No rows returned from FTC endpoints',
        details
      };
}

export async function ftcQuestions() {
  if (!configured()) return [];

  const settled = await Promise.allSettled(
    OPERATIONS.map(op => fetchOne(op, 20000))
  );

  const rows = settled
    .filter(x => x.status === 'fulfilled')
    .flatMap(x => normalizeRows(x.value));

  const out = [];

  for (const r of rows) {
    const industry = String(r.indutyMlsfcNm || '').trim();
    const base = num(r.smtnAmt);
    if (!industry || !base || base <= 0) continue;

    const answer = Math.round(base * unitMultiplier(r));
    if (!Number.isFinite(answer) || answer <= 0) continue;

    const step =
      answer >= 100_000_000 ? 5_000_000 :
      answer >= 10_000_000 ? 1_000_000 :
      answer >= 1_000_000 ? 100_000 :
      10_000;

    const year = String(r.yr || process.env.FTC_YEAR || '2021');

    out.push({
      id: `ftc-${r.__category}-${year}-${industry}-${r.__i}`,
      category: '프랜차이즈',
      type: 'price',
      title: `${industry} 업종의 평균 창업 관련 비용 합계는?`,
      subtitle: `${year}년 · ${r.__category} · 공정위 가맹정보`,
      min: Math.max(step, Math.floor(answer * 0.35 / step) * step),
      max: Math.max(step * 2, Math.ceil(answer * 1.8 / step) * step),
      step,
      answer,
      unit: '원',
      source: `공정거래위원회 가맹정보 · ${year}년`,
      provider: '공정위',
      live: true,
      meta: {
        franchiseFee: num(r.avrgFrcsAmt),
        foundingFee: num(r.avrgFntnAmt),
        otherCost: num(r.avrgJngEtcAmt),
        unit: r.crrncyUnitCdNm || null
      }
    });

    if (out.length >= 18) break;
  }

  return out;
}
