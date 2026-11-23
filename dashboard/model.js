// Radar-5: value, token odds, the 758-record ledger and the farm planner, in one file.
//
// main.ts require()s this file in Node to write board.json and data.js; index.html loads the same
// file as a classic script, so every number on the page is recomputed from the row's own snapshot
// fields and the fitted coefficients below. No protocol name is special-cased anywhere: the only
// inputs are TVL, seven-day change, listing age, chains and DefiLlama's category.
//
// Two models, both fitted on the snapshot's own record:
//   value  ln(mcap/TVL) = ridge(1, ln(TVL/1e8)) on 95 traded peers
//   odds   logistic(has a token) on size/age splines, family, growth and missingness (758 records)
// Implied value = TVL x exp(value fit) x odds. The multiple says what a launch would be worth per
// dollar of TVL; the odds say how often peers with this size, age and family record a token at all.
// Seven-day growth and age are tested as launch terms and fail the held-out test; they enter
// through the odds fit, where both carry weight.
//
// Key functions: screenInfo (the product screen), valueFit / oddsFit (the two fits), rebuildValue
// (the per-row chain), farmAt / farmOf (deposit, drop, verdict and steps) and ledger (all 758 records).

(function (root) {
'use strict';

const VERSION = 'radar-5';

const MODEL = {
  version: VERSION,
  value_lambda: 4,
  value_trim: 0.03,
  value_min_tvl: 5_000_000,
  value_age_default: 0,
  band_q: [0.25, 0.75],
  odds_lambda: 2,
  odds_age_cap: 6,
  odds_folds: 10,
  farm_deposit_bps: 2.5,
  farm_deposit_min: 1_000,
  farm_deposit_max: 20_000,
  farm_drop_share: 0.07,
  farm_weeks: 12,
  farm_tbill: 0.04,
  farm_gas_txs: 19,
  farm_hours: 3.3,
  farm_min_hourly: 10,
  max_implied_usd: 100_000_000_000,
};

const DAY_MS = 86_400_000;
const YEAR_DAYS = 365.25;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round = (n) => Math.round(n);
const r2 = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 1e4) / 1e4;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const sigmoid = (z) => 1 / (1 + Math.exp(-clamp(z, -30, 30)));
const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

function ageDays(asOf, listedAt) {
  if (!listedAt) return null;
  const a = Date.parse(asOf + 'T00:00:00Z');
  const b = Date.parse(listedAt + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}
function ageYears(p) {
  return p.age_days === null || p.age_days === undefined ? null : p.age_days / YEAR_DAYS;
}
function isPreToken(p) {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

// The house's product screen, applied to the whole universe. A wrapped, staked, bridged, versioned
// or exchange-run record is a product of a token that already trades, not a protocol waiting on one.
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_WORDS = /\b(wrapped|staked|staking)\b/i;
const EXCHANGES = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const BRIDGE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge']);
const STAKING_CATEGORIES = new Set(['Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

// Category families. This is a taxonomy, not a name list: every protocol in a category is treated
// identically, and a sparse category borrows strength from its family.
const FAMILY_ORDER = ['AssetMgmt', 'CeFi', 'Deriv', 'DexYield', 'Infra', 'Insurance', 'Lending', 'Other', 'Prediction', 'RWA', 'Stable', 'Staking'];
const FAMILY_LABEL = {
  AssetMgmt: 'Asset management', CeFi: 'CeFi', Deriv: 'Derivatives', DexYield: 'DEX & yield',
  Infra: 'Infrastructure', Insurance: 'Insurance', Lending: 'Lending & credit', Other: 'Other',
  Prediction: 'Prediction markets', RWA: 'RWA & index', Stable: 'Stablecoins', Staking: 'Staking',
};
const FAMILY_DUMMIES = FAMILY_ORDER.filter((f) => f !== 'Other');

function familyOf(category) {
  const c = (category || '').toLowerCase();
  if (!c) return 'Other';
  if (/lend|cdp|collateral|credit/.test(c)) return 'Lending';
  if (/dex|yield|farm|liquidity/.test(c)) return 'DexYield';
  if (/bridge/.test(c)) return 'Bridge';
  if (/staking|restak/.test(c)) return 'Staking';
  if (/rwa|real world|index/.test(c)) return 'RWA';
  if (/derivative|basis|perpetual|option|synthetic|interest rate/.test(c)) return 'Deriv';
  if (/curator|allocator|vault|governance/.test(c)) return 'AssetMgmt';
  if (/chain|payments|privacy/.test(c)) return 'Infra';
  if (/stable/.test(c)) return 'Stable';
  if (/insurance/.test(c)) return 'Insurance';
  if (/prediction/.test(c)) return 'Prediction';
  if (/cex|cedefi/.test(c)) return 'CeFi';
  return 'Other';
}

function screenInfo(p) {
  if (!isPreToken(p)) return null;
  if (p.category === 'CEX') return { key: 'cex', label: 'Exchange-run record' };
  if (BRIDGE_CATEGORIES.has(p.category)) return { key: 'bridge', label: 'Bridge product' };
  if (STAKING_CATEGORIES.has(p.category)) return { key: 'staking', label: 'Liquid staking product' };
  if (VERSIONED.test(p.name)) return { key: 'versioned', label: 'Versioned pool' };
  if (PRODUCT_WORDS.test(p.name)) return { key: 'wrapped', label: 'Wrapped / staked product' };
  if (EXCHANGES.test(p.name)) return { key: 'cex', label: 'Exchange product' };
  return null;
}

// ---------------------------------------------------------------- statistics

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(values, q) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[clamp(Math.floor((s.length - 1) * q), 0, s.length - 1)];
}
// Solve A x = b for a small dense system, partial pivoting.
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[piv][i])) piv = r;
    [M[i], M[piv]] = [M[piv], M[i]];
    const d = M[i][i] || 1e-12;
    for (let j = i; j <= n; j++) M[i][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r][i];
      if (!f) continue;
      for (let j = i; j <= n; j++) M[r][j] -= f * M[i][j];
    }
  }
  return M.map((row) => row[n]);
}
function miss(actual, predicted) {
  if (!(actual > 0) || !(predicted > 0)) return null;
  return Math.max(predicted / actual, actual / predicted);
}
function missStats(values) {
  const s = values.filter((v) => v !== null && Number.isFinite(v));
  return {
    n: s.length,
    median: r2(median(s) || 0),
    p25: r2(quantile(s, 0.25) || 0),
    p75: r2(quantile(s, 0.75) || 0),
  };
}

// ---------------------------------------------------------------- value model

function valueFeatures(p) {
  return [1, Math.log(Math.max(p.tvl_usd, 1) / 1e8)];
}
const V_LABEL = ['intercept', 'ln(TVL / $100M)'];

// Candidate launch terms. The fit keeps the size curve; growth and age are tested beside it and
// dropped when they raise the held-out miss. They still enter through the odds fit.
function valueTerms(p) {
  const age = ageYears(p);
  return [
    1,
    Math.log(Math.max(p.tvl_usd, 1) / 1e8),
    (finite(p.change_7d) ? p.change_7d : 0) / 100,
    Math.log(1 + (age === null ? MODEL.value_age_default : age)),
  ];
}

// Ridge regression on one target, intercept unpenalised.
function ridgeFit(rows, feat, target, lambda) {
  const n = feat(rows[0]).length;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  for (const p of rows) {
    const x = feat(p);
    const y = target(p);
    for (let j = 0; j < n; j++) {
      b[j] += x[j] * y;
      for (let k = 0; k < n; k++) A[j][k] += x[j] * x[k];
    }
  }
  for (let j = 1; j < n; j++) A[j][j] += lambda;
  return solve(A, b);
}

function valueFit(all) {
  const train = all.filter((p) => !p.pre && p.mcap_usd > 0 && p.tvl_usd >= MODEL.value_min_tvl && p.age_days !== null);
  const target = (p) => Math.log(p.mcap_usd / p.tvl_usd);
  const ys = train.map(target);
  const lo = quantile(ys, MODEL.value_trim);
  const hi = quantile(ys, 1 - MODEL.value_trim);
  const fitRows = train.filter((p) => target(p) >= lo && target(p) <= hi);
  const coef = ridgeFit(fitRows, valueFeatures, target, MODEL.value_lambda);
  const predict = (p, b = coef) => Math.exp(dot(valueFeatures(p), b));
  const residual = fitRows.map((p) => target(p) - Math.log(predict(p)));
  const band = MODEL.band_q.map((q) => r4(Math.exp(quantile(residual, q))));

  const insample = train.map((p) => miss(p.mcap_usd / p.tvl_usd, predict(p)));
  const loo = train.map((p) => {
    const rows = fitRows.filter((r) => r !== p);
    const b = ridgeFit(rows, valueFeatures, target, MODEL.value_lambda);
    return miss(p.mcap_usd / p.tvl_usd, predict(p, b));
  });

  // The band is only honest if it is measured out of sample too: refit each peer's band from
  // the other peers' residuals and ask whether its actual multiple lands inside.
  const bandCover = train.map((p) => {
    const rows = fitRows.filter((r) => r !== p);
    const b = ridgeFit(rows, valueFeatures, target, MODEL.value_lambda);
    const rr = rows.map((r) => target(r) - Math.log(predict(r, b)));
    const point = predict(p, b);
    const actual = p.mcap_usd / p.tvl_usd;
    return actual >= point * Math.exp(quantile(rr, MODEL.band_q[0]))
      && actual <= point * Math.exp(quantile(rr, MODEL.band_q[1]));
  });

  // Five expanding walk-forward folds: fit on the older half and each later block, test the next
  // block. A different stress from leave-one-out because every test row is a later listing.
  const byDate = [...train].sort((a, b) => (a.listed_at || '').localeCompare(b.listed_at || ''));
  const holdFor = (feat) => {
    const start = Math.floor(byDate.length * 0.5);
    const step = Math.floor((byDate.length - start) / 5);
    const out = [];
    for (let k = 0; k < 5; k++) {
      const cut = start + k * step;
      const rows = byDate.slice(0, cut);
      const test = byDate.slice(cut, k === 4 ? byDate.length : cut + step);
      const ys0 = rows.map(target);
      const l = quantile(ys0, MODEL.value_trim);
      const h = quantile(ys0, 1 - MODEL.value_trim);
      const b = ridgeFit(rows.filter((p) => target(p) >= l && target(p) <= h), feat, target, MODEL.value_lambda);
      for (const p of test) out.push(miss(p.mcap_usd / p.tvl_usd, Math.exp(dot(feat(p), b))));
    }
    return out;
  };
  const holdout = missStats(holdFor(valueFeatures));

  // Which terms earn their place? Add each to the size curve, refit, and retest both ways.
  const variants = [
    { key: 'flat', label: 'Flat multiple', cols: [0] },
    { key: 'size', label: '+ size curve', cols: [0, 1] },
    { key: 'growth', label: '+ seven-day growth', cols: [0, 1, 2] },
    { key: 'age', label: '+ age with no token', cols: [0, 1, 3] },
  ];
  const terms = variants.map((v) => {
    const feat = (p) => v.cols.map((i) => valueTerms(p)[i]);
    const looV = train.map((p) => {
      const rr = fitRows.filter((r) => r !== p);
      const bb = ridgeFit(rr, feat, target, MODEL.value_lambda);
      return miss(p.mcap_usd / p.tvl_usd, Math.exp(dot(feat(p), bb)));
    });
    return {
      key: v.key, label: v.label, n: v.cols.length,
      loo: r2(median(looV) || 0),
      holdout: r2(median(holdFor(feat)) || 0),
    };
  });
  const flat = terms[0];
  const size = terms[1];
  for (const t of terms) t.kept = t.key === size.key && t.loo < flat.loo && t.holdout < flat.holdout;

  return {
    coef: coef.map(r4),
    labels: V_LABEL,
    n_train: train.length,
    n_fit: fitRows.length,
    trim: MODEL.value_trim,
    lambda: MODEL.value_lambda,
    in_sample: missStats(insample),
    loo: missStats(loo),
    holdout,
    band_mult: band,
    band_cover: r4(bandCover.filter(Boolean).length / bandCover.length),
    within3: r4(loo.filter((m) => m <= 3).length / loo.length),
    terms,
  };
}

function valueOf(p, coef) {
  const logMult = dot(valueFeatures(p), coef);
  const multiple = clamp(Math.exp(logMult), 0.002, 20);
  return {
    multiple,
    launch_usd: Math.max(1, Math.min(MODEL.max_implied_usd, round(p.tvl_usd * multiple))),
    terms: valueFeatures(p).map((x, i) => ({ i, label: V_LABEL[i], x: r4(x), coef: r4(coef[i]), contrib: r4(x * coef[i]) })),
  };
}

// ---------------------------------------------------------------- odds model

const hinge = (x, k) => Math.max(0, x - k);
function oddsFeatures(p) {
  const s = Math.log(Math.max(p.tvl_usd, 1) / 1e8);
  const ag = ageYears(p);
  const a = Math.min(ag === null ? 1 : ag, MODEL.odds_age_cap);
  const out = [
    1, s, a,
    hinge(a, 0.5), hinge(a, 1), hinge(a, 2), hinge(a, 3),
    hinge(s, 7), hinge(s, 7.7), hinge(s, 8.5), hinge(s, 9.5),
  ];
  for (const f of FAMILY_DUMMIES) out.push(p.family === f ? 1 : 0);
  out.push(
    a * s,
    a * a,
    s * s,
    (finite(p.change_7d) ? p.change_7d : 0) / 100,
    p.change_7d === null || p.change_7d === undefined ? 1 : 0,
    ag === null ? 1 : 0,
  );
  return out;
}
const ODDS_LABELS = [
  'intercept', 'ln(TVL)', 'age', 'age hinge 0.5y', 'age hinge 1y', 'age hinge 2y', 'age hinge 3y',
  'size hinge ln 7', 'size hinge ln 7.7', 'size hinge ln 8.5', 'size hinge ln 9.5',
  ...FAMILY_DUMMIES.map((f) => 'family: ' + f),
  'age x size', 'age squared', 'size squared', 'growth', 'growth missing', 'age missing',
];

function logisticFit(rows, lambda) {
  const X = rows.map((p) => oddsFeatures(p));
  const Y = rows.map((p) => (p.pre ? 0 : 1));
  const n = X[0].length;
  const b = new Array(n).fill(0);
  for (let it = 0; it < 40; it++) {
    const A = Array.from({ length: n }, () => new Array(n).fill(0));
    const g = new Array(n).fill(0);
    for (let i = 0; i < X.length; i++) {
      const p = sigmoid(dot(X[i], b));
      const w = Math.max(1e-6, p * (1 - p));
      const e = Y[i] - p;
      for (let j = 0; j < n; j++) {
        g[j] += X[i][j] * e;
        for (let k = 0; k < n; k++) A[j][k] += X[i][j] * X[i][k] * w;
      }
    }
    for (let j = 1; j < n; j++) {
      A[j][j] += lambda;
      g[j] -= lambda * b[j];
    }
    const d = solve(A, g);
    let mx = 0;
    for (let j = 0; j < n; j++) {
      b[j] += d[j];
      mx = Math.max(mx, Math.abs(d[j]));
    }
    if (mx < 1e-8) break;
  }
  return b;
}

function hashSlug(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function oddsFit(all, options) {
  const withCv = !options || options.cv !== false;
  const rows = all.map((p) => ({ ...p, y: p.pre ? 0 : 1 }));
  const base = rows.filter((r) => r.y === 1).length / rows.length;
  const coef = logisticFit(rows, MODEL.odds_lambda);
  const predict = (p, b = coef) => sigmoid(dot(oddsFeatures(p), b));

  let correct = 0;
  let brier = 0;
  for (const r of rows) {
    const p = predict(r);
    correct += (p >= 0.5 ? 1 : 0) === r.y ? 1 : 0;
    brier += (p - r.y) ** 2;
  }

  let cv = null;
  let wf = null;
  if (withCv) {
    const folds = Array.from({ length: MODEL.odds_folds }, () => []);
    for (const r of rows) folds[hashSlug(r.slug) % MODEL.odds_folds].push(r);
    let cvCorrect = 0;
    let cvBrier = 0;
    const held = [];
    for (let f = 0; f < MODEL.odds_folds; f++) {
      const test = folds[f];
      const train = rows.filter((r) => hashSlug(r.slug) % MODEL.odds_folds !== f);
      const b = logisticFit(train, MODEL.odds_lambda);
      for (const r of test) {
        const p = predict(r, b);
        held.push({ p, y: r.y });
        cvCorrect += (p >= 0.5 ? 1 : 0) === r.y ? 1 : 0;
        cvBrier += (p - r.y) ** 2;
      }
    }
    held.sort((a, b) => b.p - a.p);
    const top = held.slice(0, Math.max(1, Math.round(held.length * 0.1)));
    cv = {
      folds: MODEL.odds_folds,
      accuracy: r4(cvCorrect / held.length),
      brier: r4(cvBrier / held.length),
      top_decile: r4(top.filter((r) => r.y === 1).length / top.length),
    };

    const byDate = [...rows].sort((a, b) => (a.listed_at || '9999').localeCompare(b.listed_at || '9999'));
    const cut = Math.floor(byDate.length * 0.7);
    const wfCoef = logisticFit(byDate.slice(0, cut), MODEL.odds_lambda);
    let wfCorrect = 0;
    let wfBrier = 0;
    const test = byDate.slice(cut);
    for (const r of test) {
      const p = predict(r, wfCoef);
      wfCorrect += (p >= 0.5 ? 1 : 0) === r.y ? 1 : 0;
      wfBrier += (p - r.y) ** 2;
    }
    wf = { cut, accuracy: r4(wfCorrect / test.length), brier: r4(wfBrier / test.length) };
  }

  return {
    coef: coef.map(r4),
    labels: ODDS_LABELS,
    n: rows.length,
    positives: rows.filter((r) => r.y === 1).length,
    base_rate: r4(base),
    in_sample: { accuracy: r4(correct / rows.length), brier: r4(brier / rows.length) },
    cv,
    walk_forward: wf,
  };
}

function oddsOf(p, coef) {
  return sigmoid(dot(oddsFeatures(p), coef));
}
function oddsTermsOf(p, coef) {
  const x = oddsFeatures(p);
  return x.map((v, i) => ({ i, label: ODDS_LABELS[i] || 'term ' + i, x: r4(v), coef: r4(coef[i]), contrib: r4(v * coef[i]) }));
}

// ---------------------------------------------------------------- ledger

function ledger(all) {
  const groups = {
    ranked: { key: 'ranked', label: 'Ranked pre-token', n: 0 },
    priced: { key: 'priced', label: 'Token, priced', n: 0 },
    unpriced: { key: 'unpriced', label: 'Token, no usable cap', n: 0 },
    bridge: { key: 'bridge', label: 'Bridge product', n: 0 },
    staking: { key: 'staking', label: 'Liquid staking', n: 0 },
    cex: { key: 'cex', label: 'Exchange-run', n: 0 },
    versioned: { key: 'versioned', label: 'Versioned / wrapped', n: 0 },
  };
  for (const p of all) {
    if (!p.pre) {
      groups[p.mcap_usd > 0 ? 'priced' : 'unpriced'].n++;
      continue;
    }
    if (!p.screen) {
      groups.ranked.n++;
      continue;
    }
    if (p.screen.key === 'bridge') groups.bridge.n++;
    else if (p.screen.key === 'staking') groups.staking.n++;
    else if (p.screen.key === 'cex') groups.cex.n++;
    else groups.versioned.n++;
  }
  const list = Object.values(groups);
  const total = list.reduce((s, g) => s + g.n, 0);
  return { groups: list, total, sum: all.length, ok: total === all.length };
}

// ---------------------------------------------------------------- farm planner

const RISK = {
  Lending: 'liquidation risk if collateral falls or the oracle misprices',
  DexYield: 'impermanent loss if the pool pair diverges',
  Bridge: 'bridge and wrapped-asset risk',
  Staking: 'slashing and receipt-token depeg risk',
  RWA: 'issuer, custody and redemption risk',
  Deriv: 'funding, margin and liquidation risk',
  AssetMgmt: 'curator, strategy and withdrawal-queue risk',
  Infra: 'chain-liveness and canonical-bridge risk',
  Stable: 'depeg and collateral risk',
  Insurance: 'counterparty and claims risk',
  Prediction: 'resolution, oracle and liquidity risk',
  CeFi: 'custody and counterparty risk',
  Other: 'smart-contract and liquidity risk',
};
const GAS = {
  Ethereum: 5.5, Solana: 0.02, Base: 0.25, Arbitrum: 0.25, Optimism: 0.25, 'OP Mainnet': 0.25,
  Linea: 0.3, Scroll: 0.3, Unichain: 0.25, Blast: 0.25, Binance: 0.15, 'BNB Chain': 0.15,
  Polygon: 0.08, Avalanche: 0.15, Tron: 0.9, Bitcoin: 3, Sui: 0.03, Aptos: 0.03, Plasma: 0.05,
};
const gasFor = (chain) => GAS[chain] ?? 0.4;

function coreAction(p, dep, chain) {
  const c = (p.category || '').toLowerCase();
  const n = p.name;
  if (/lend|cdp|collateral|credit/.test(c)) return `Supply $${dep} of USDC to ${n} on ${chain}, then borrow about 25% against it in a second asset and keep both positions open.`;
  if (/dex|yield|farm|liquidity/.test(c)) return `Add $${dep} as two-sided liquidity to ${n}'s deepest pool on ${chain}, then stake the LP receipt if the protocol offers one.`;
  if (/curator|allocator|vault/.test(c)) return `Deposit $${dep} of USDC into a ${n} curated vault on ${chain} and keep the vault shares in the same wallet.`;
  if (/rwa|real world/.test(c)) return `Mint or subscribe $${dep} of ${n}'s yield asset on ${chain} and hold the receipt through the qualifying period.`;
  if (/stable/.test(c)) return `Mint $${dep} of ${n}'s stable asset on ${chain} against collateral you already hold, and keep it outstanding.`;
  if (/derivative|basis|perpetual|option|synthetic|interest rate/.test(c)) return `Deposit $${dep} of USDC as margin on ${n} (${chain}), open one small delta-neutral basis trade and keep it open.`;
  if (/prediction/.test(c)) return `Fund $${dep} of USDC on ${n} (${chain}) and place one small position; keep it until the market resolves.`;
  if (/chain/.test(c)) return `Bridge $${dep} into ${chain} through its canonical route and use at least one app on the chain.`;
  if (/insurance/.test(c)) return `Buy $${dep} of cover from ${n} on ${chain} and keep the policy active through the qualifying period.`;
  return `Deposit $${dep} of USDC into ${n} on ${chain} and keep the position open.`;
}

function secondAction(p, chain) {
  const c = (p.category || '').toLowerCase();
  if (/lend|cdp|collateral|credit/.test(c)) return 'Borrow 25% of the supply and re-supply the borrowed asset once; stay below 50% loan-to-value and set a repay alert.';
  if (/dex|yield|farm|liquidity/.test(c)) return `Stake the LP receipt or vote in the pool gauge if ${p.name} offers one; never leave the receipt unstaked for a whole week.`;
  if (/curator|allocator|vault/.test(c)) return 'Add a second, smaller vault from the same curator so one strategy cannot dominate the position.';
  if (/rwa|real world/.test(c)) return "Complete the issuer's eligibility check so the receipt can be redeemed without a support ticket later.";
  if (/stable/.test(c)) return `Provide a small slice of the stable asset as liquidity in its main pool on ${chain}, then withdraw the LP before the snapshot.`;
  if (/derivative|basis|perpetual|option|synthetic/.test(c)) return 'Roll the position once at expiry, keeping the same notional, so the wallet stays active across two periods.';
  if (/prediction/.test(c)) return 'Add one more position on the same market or a related market; keep both until resolution.';
  return `Make one second, different qualifying action on ${p.name} (${chain}) so the wallet is not a one-transaction visitor.`;
}

function farmAt(p, implied, options) {
  const opts = options || {};
  const chain = p.chains[0] || 'Ethereum';
  const gas = gasFor(chain);
  const weeks = MODEL.farm_weeks;
  const dropShare = opts.share === undefined ? MODEL.farm_drop_share : opts.share;
  const target = opts.deposit === undefined ? (p.tvl_usd * MODEL.farm_deposit_bps) / 10_000 : opts.deposit;
  const deposit = clamp(round(target / 50) * 50, MODEL.farm_deposit_min, MODEL.farm_deposit_max);
  const drop = dropShare * implied * (deposit / p.tvl_usd);
  const bridge = chain === 'Ethereum' ? 4 : 1.5;
  const costs = r2(gas * MODEL.farm_gas_txs + bridge);
  const bar = r2((deposit * MODEL.farm_tbill * weeks) / 52);
  const net = r2(drop - costs);
  const perHour = r2(net / MODEL.farm_hours);
  const verdict = net <= 0 ? 'SKIP' : net >= bar && perHour >= MODEL.farm_min_hourly ? 'FARM' : 'THIN';
  const family = p.family;
  const risk = RISK[family] || RISK.Other;
  const share = deposit / p.tvl_usd;
  return {
    verdict, deposit_usd: deposit, share, drop_usd: r2(drop), costs_usd: costs, net_usd: net,
    bar_usd: bar, per_hour_usd: perHour, hours: MODEL.farm_hours, weeks, gas_usd: gas,
    drop_share: dropShare, capital_at_risk_usd: deposit, time_to_qualify_days: weeks * 7, risk,
  };
}

function farmOf(p, implied, options) {
  const f = farmAt(p, implied, options);
  const chain = p.chains[0] || 'Ethereum';
  const gas = f.gas_usd;
  const deposit = f.deposit_usd;
  const costs = f.costs_usd;
  const weeks = f.weeks;
  const risk = f.risk;
  const bridge = chain === 'Ethereum' ? 4 : 1.5;
  const steps = [
    `Open a dedicated wallet on ${chain} for this position; never reuse the wallet that holds your main funds. Cost: about ${gas} in gas for the first transaction. Time: 10 minutes.`,
    `Check ${p.name}'s official site and docs and confirm the contract address before you sign anything; bookmark the page. Cost: 0. Time: 5 minutes.`,
    `Fund the wallet with ${deposit} USDC plus about ${costs} for fees, arriving from a CEX or a route you already trust. Cost: about 2 in withdrawal fees. Time: 15 to 30 minutes.`,
    `Risk check: ${risk}. Read the withdrawal rules and cap this position at 20% of your farm capital. Cost: 0. Time: 10 minutes.`,
    `${coreAction(p, deposit, chain)} Cost: ${deposit} of capital plus about ${r2(gas * 2)} in gas. Time: 15 minutes.`,
    `${secondAction(p, chain)} Cost: about ${r2(gas * 2)} in gas. Time: 10 minutes.`,
    `Repeat one qualifying action every week for ${weeks} weeks: a deposit, borrow, swap, vote or claim. Never wash-trade or move the same dollar twice. Cost: about ${r2(gas)} in gas a week. Time: 10 minutes a week.`,
    `Watch ${p.name}'s official account and docs each week for a token announcement, points program or claim page; never pay to be allowlisted. Cost: 0. Time: 5 minutes a week.`,
    `Keep the position live through at least two monthly snapshots; withdraw only after the snapshot or claim window, not before. Cost: ${deposit} stays locked. Time: ${weeks} weeks.`,
    `Exit by repaying the borrow or removing liquidity, bridge the proceeds back, and log the wallet, dates, amounts and transaction hashes. Cost: about ${r2(gas * 3 + bridge)} in gas and bridge fees. Time: 30 minutes.`,
  ];
  return { ...f, steps };
}

function farmsOf(rows) {
  const counts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of rows) counts[r.farm.verdict]++;
  return counts;
}

// ---------------------------------------------------------------- peers

function compsFor(p, all, valueCoef, limit = 5) {
  const pool = all.filter((x) => !x.pre && x.mcap_usd > 0 && x.tvl_usd > 0 && x.slug !== p.slug);
  const same = pool.filter((x) => x.family === p.family);
  const use = same.length >= limit ? same : pool;
  const scored = use
    .map((x) => {
      const d = Math.abs(Math.log(x.tvl_usd / p.tvl_usd)) + 0.35 * Math.abs((ageYears(x) ?? 1) - (ageYears(p) ?? 1));
      return { x, d };
    })
    .sort((a, b) => a.d - b.d)
    .slice(0, limit);
  return scored.map(({ x }) => {
    const actual = x.mcap_usd / x.tvl_usd;
    const predicted = valueOf(x, valueCoef).multiple;
    return {
      slug: x.slug, name: x.name, category: x.category, family: x.family,
      tvl_usd: x.tvl_usd, mcap_usd: x.mcap_usd, multiple: r4(actual), predicted: r4(predicted),
      heldout: r4(actual / predicted), age_days: x.age_days,
    };
  });
}

// Peers' token record: same family, age within 0.75 years and size within 0.7 in log TVL.
function peerRecord(p, all) {
  const a = ageYears(p) ?? 1;
  const s = Math.log(p.tvl_usd);
  const near = all.filter((x) => x.slug !== p.slug && x.family === p.family && Math.abs(Math.log(x.tvl_usd) - s) <= 0.7 && Math.abs((ageYears(x) ?? 1) - a) <= 0.75);
  const tokens = near.filter((x) => !x.pre).length;
  return { n: near.length, tokens, share: near.length ? r4(tokens / near.length) : null };
}

// ---------------------------------------------------------------- build

function buildRadar(snapshot) {
  const all = snapshot.protocols.map((p) => ({
    ...p,
    pre: isPreToken(p),
    age_days: ageDays(snapshot.as_of, p.listed_at),
    family: familyOf(p.category),
    screen: screenInfo(p),
  }));
  const value = valueFit(all);
  const odds = oddsFit(all);
  const watch = new Set(snapshot.watchlist);
  const eligible = all.filter((p) => p.pre && !p.screen);

  const rows = eligible.map((p) => {
    const v = valueOf(p, value.coef);
    const o = oddsOf(p, odds.coef);
    const implied = clamp(round(v.launch_usd * o), 1, MODEL.max_implied_usd);
    const low = clamp(round(v.launch_usd * o * value.band_mult[0]), 1, MODEL.max_implied_usd);
    const high = clamp(round(v.launch_usd * o * value.band_mult[1]), 1, MODEL.max_implied_usd);
    const farm = farmOf(p, implied);
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      family: p.family,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      watchlist: watch.has(p.slug),
      off_list: !watch.has(p.slug) && p.tvl_usd >= snapshot.floor_usd,
      below_floor: p.tvl_usd < snapshot.floor_usd,
      age_days: p.age_days,
      launch_value_usd: v.launch_usd,
      odds: r4(o),
      implied_value_usd: implied,
      band_low_usd: low,
      band_high_usd: high,
      model: {
        version: VERSION,
        multiple: r4(v.multiple),
        coef: value.coef,
        terms: v.terms,
        odds_terms: oddsTermsOf(p, odds.coef).filter((t) => Math.abs(t.contrib) > 0.0005),
      },
      comps: compsFor(p, all, value.coef),
      peer_record: peerRecord(p, all),
      farm,
      farm_steps: farm.steps,
    };
  });
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.odds - a.odds || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  rows.forEach((r, i) => { r.rank = i + 1; });

  const led = ledger(all);
  const farms = farmsOf(rows);
  const tvlCovered = rows.reduce((s, r) => s + r.tvl_usd, 0);
  const impliedSum = rows.reduce((s, r) => s + r.implied_value_usd, 0);
  const checks = {
    recomputed: rows.every((r) => {
      const v = valueOf(r, value.coef);
      const implied = clamp(round(v.launch_usd * oddsOf(r, odds.coef)), 1, MODEL.max_implied_usd);
      return implied === r.implied_value_usd;
    }),
    ranks: rows.every((r, i) => r.rank === i + 1 && (i === 0 || r.implied_value_usd <= rows[i - 1].implied_value_usd)),
    watchlist: snapshot.watchlist.every((s) => rows.some((r) => r.slug === s)),
    ledger: led.ok,
    rows: rows.length,
  };

  const universe = all.map((p) => ({
    slug: p.slug, name: p.name, category: p.category, family: p.family, chains: p.chains,
    tvl_usd: p.tvl_usd, change_7d: p.change_7d, age_days: p.age_days, listed_at: p.listed_at,
    mcap_usd: p.mcap_usd, pre: p.pre, screen: p.screen ? p.screen.key : null,
  }));

  const radar = {
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      model: MODEL,
      model_version: VERSION,
      protocols: all.length,
      watchlist_size: snapshot.watchlist.length,
      pre_token_size: all.filter((p) => p.pre).length,
      token_size: all.filter((p) => !p.pre).length,
      priced_size: all.filter((p) => !p.pre && p.mcap_usd > 0).length,
    },
    counts: {
      rows: rows.length,
      watchlist: rows.filter((r) => r.watchlist).length,
      below_floor: rows.filter((r) => r.below_floor).length,
      off_list: rows.filter((r) => r.off_list).length,
      farm: farms.FARM,
      thin: farms.THIN,
      skip: farms.SKIP,
      screened: all.filter((p) => p.pre && p.screen).length,
      tvl_usd: tvlCovered,
      implied_usd: impliedSum,
    },
    farms,
    ledger: led,
    value,
    odds,
    checks,
    rows,
    universe,
    screened: all.filter((p) => p.pre && p.screen).map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: p.screen.label })),
  };
  return { board: rows, radar };
}

// Rebuild the number board.json carries from the row itself and the fitted coefficients.
function rebuildValue(row, radar) {
  const v = valueOf(row, radar.value.coef);
  const o = oddsOf(row, radar.odds.coef);
  return {
    launch_value_usd: v.launch_usd,
    odds: r4(o),
    implied_value_usd: clamp(round(v.launch_usd * o), 1, MODEL.max_implied_usd),
    multiple: r4(v.multiple),
    terms: v.terms,
  };
}

// Refit both models on the universe the page already carries.
function refit(universe) {
  const all = universe.map((p) => ({ ...p, pre: p.pre === true }));
  const v = valueFit(all);
  const o = oddsFit(all, { cv: false });
  return { value: v.coef, odds: o.coef };
}

const api = {
  MODEL, VERSION, ageDays, ageYears, isPreToken, familyOf, screenInfo, FAMILY_ORDER, FAMILY_LABEL,
  valueFeatures, valueFit, valueOf, oddsFeatures, oddsFit, oddsOf, oddsTermsOf,
  ledger, farmAt, farmOf, farmsOf, compsFor, peerRecord, buildRadar, rebuildValue, refit,
  median, quantile,
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.RadarModel = api;
if (root) root.RadarModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
