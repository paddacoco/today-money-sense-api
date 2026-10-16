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

async function fetchOne(op, timeoutMs = 9000) {
  const u = new URL(baseUrl() + op.path);
  u.searchParams.set('serviceKey', apiKey());
  u.searchParams.set('pageNo', '1');
  u.searchParams.set('numOfRows', '100');
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

    if (!r.ok) {
      throw new Error(`${op.label} HTTP ${r.status}: ${text.slice(0, 220)}`);
    }

    try {
      return { op, json: JSON.parse(text) };
    } catch {
      throw new Error(`${op.label} non-JSON response: ${text.slice(0, 220)}`);
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

function first(row, names) {
  for (const n of names) {
    if (row?.[n] != null && row[n] !== '') return row[n];
  }
  return null;
}

function normalizeRows(result) {
  return rowsFrom(result.json).map((row, i) => ({ ...row, __category: result.op.label, __i: i }));
}

export async function validateFtc() {
  if (!configured()) {
    return { ok: false, configured: false, reason: 'PUBLIC_DATA_API_KEY/DATA_GO_KR_API_KEY missing' };
  }

  const settled = await Promise.allSettled(OPERATIONS.map(fetchOne));
  const details = settled.map((r, i) => {
    if (r.status === 'fulfilled') {
      const count = rowsFrom(r.value.json).length;
      return { category: OPERATIONS[i].label, ok: count > 0, count };
    }
    return { category: OPERATIONS[i].label, ok: false, reason: r.reason?.message || String(r.reason) };
  });

  const total = details.reduce((s, x) => s + (x.count || 0), 0);
  return total > 0
    ? { ok: true, configured: true, count: total, details }
    : { ok: false, configured: true, reason: 'No rows returned from FTC endpoints', details };
}

export async function ftcQuestions() {
  if (!configured()) return [];

  const settled = await Promise.allSettled(OPERATIONS.map(fetchOne));
  const rows = settled
    .filter(x => x.status === 'fulfilled')
    .flatMap(x => normalizeRows(x.value));

  const out = [];

  for (const r of rows) {
    const name =
      first(r, [
        'indutyLclasNm', 'indutyMlsfcNm', 'indutySclasNm',
        'indutyNm', 'bizNm', 'brandNm', 'frcsNm', 'corpNm',
        '업종대분류명', '업종중분류명', '업종소분류명', '업종명', '브랜드명'
      ]) || `${r.__category} 업종 ${r.__i + 1}`;

    const parts = [
      first(r, ['avgFrcsGrntyAmt', 'avgGrntyAmt', 'frcsGrntyAmt', '평균가맹보증금액']),
      first(r, ['avgFrcsEduAmt', 'avgEduAmt', 'frcsEduAmt', '평균가맹교육금액']),
      first(r, ['avgFrcsEtcAmt', 'avgEtcAmt', 'frcsEtcAmt', '평균가맹기타금액']),
      first(r, ['avgFrcsAmt', 'frcsAmt', '평균가맹금액']),
    ].map(num).filter(x => x != null && x >= 0);

    let answer = parts.length
      ? parts.reduce((a, b) => a + b, 0)
      : num(first(r, ['startupAmt', 'totAmt', 'sumAmt', '창업비용', '평균창업비용']));

    if (!answer || answer <= 0) continue;

    // API가 천원 단위일 가능성에 대비
    const unitText = String(first(r, ['moneyUnit', 'unitNm', '단위']) || '');
    if (unitText.includes('천') && answer < 1_000_000) answer *= 1000;

    // 지나치게 작은 값이면 천원 단위 데이터로 간주
    if (answer < 100_000) answer *= 1000;

    const step = answer >= 100_000_000 ? 5_000_000 : 1_000_000;

    out.push({
      id: `ftc-${r.__category}-${r.__i}-${String(name).slice(0, 30)}`,
      category: '프랜차이즈',
      type: 'price',
      title: `${name}의 평균 창업 관련 비용은?`,
      subtitle: `${r.__category} · 가맹보증금·교육비·기타비용 등 공개 항목`,
      min: Math.max(step, Math.floor(answer * 0.35 / step) * step),
      max: Math.max(step * 2, Math.ceil(answer * 1.8 / step) * step),
      step,
      answer: Math.round(answer),
      unit: '원',
      source: '공정거래위원회 가맹정보',
      provider: '공정위',
      live: true,
    });

    if (out.length >= 18) break;
  }

  return out;
}
