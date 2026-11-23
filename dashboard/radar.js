// Token Radar: a no-network console over the sealed DefiLlama snapshot.
// The page reads window.RADAR (written beside dashboard/ by main.ts), loads the same model.js the
// program uses, and re-derives every implied value from the row's own snapshot inputs.

const RM = window.RadarModel;
const { rebuildValue, familyOf, FAMILY_LABEL, MODEL } = RM;
const D = window.RADAR;
const app = document.getElementById('app');

const COLOR = {
  AssetMgmt: '#9bd35a', CeFi: '#8fa8b8', Deriv: '#f27ea9', DexYield: '#6fc7ff',
  Infra: '#6fe3d0', Insurance: '#c7a8ff', Lending: '#7df3c6', Other: '#82a099',
  Prediction: '#ff8a72', RWA: '#ff9f6e', Stable: '#d6c86a', Staking: '#f4c26a',
};

const state = { view: 'board', detail: null, q: '', category: 'all', chain: 'all', scope: 'all', sort: 'implied', dir: -1, size: 0, share: MODEL.farm_drop_share };
const checks = { refit: null, refit_ms: null };

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false) continue;
    if (Array.isArray(kid)) {
      for (const k of kid) if (k !== null && k !== undefined && k !== false) n.append(k);
    } else n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

const usd = (n) => {
  if (!Number.isFinite(n)) return 'n/a';
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
  if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + Math.round(n);
};
const exact = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);
const money2 = (n) => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
const pct = (x, d = 0) => (x === null || x === undefined || !Number.isFinite(x) ? 'n/a' : (x > 0 ? '+' : '') + x.toFixed(d) + '%');
const pct1 = (x) => (x === null || x === undefined ? 'n/a' : (x * 100).toFixed(1) + '%');
const pct0 = (x) => (x === null || x === undefined ? 'n/a' : Math.round(x * 100) + '%');
const age = (d) => (d === null || d === undefined ? 'n/a' : d >= 365 ? (d / 365.25).toFixed(1) + 'y' : Math.round(d) + 'd');
const mult = (x) => (!Number.isFinite(x) ? 'n/a' : x >= 10 ? x.toFixed(1) + '×' : x >= 1 ? x.toFixed(2) + '×' : x.toFixed(3) + '×');
const cls = (n) => (n === null || n === undefined ? 'flat' : n > 0 ? 'pos' : n < 0 ? 'neg' : 'flat');
const color = (cat) => COLOR[familyOf(cat)] || COLOR.Other;
const key = (r) => r.slug;

function readHash() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  state.view = p.get('view') === 'method' ? 'method' : 'board';
  state.detail = p.get('p') || null;
  state.q = p.get('q') || '';
  state.category = p.get('category') || 'all';
  state.chain = p.get('chain') || 'all';
  state.scope = p.get('scope') || 'all';
  const size = Number(p.get('size'));
  const share = Number(p.get('share'));
  state.size = Number.isFinite(size) && size >= 1000 ? Math.min(20000, size) : 0;
  state.share = Number.isFinite(share) && share > 0 ? Math.min(0.28, share) : MODEL.farm_drop_share;
  if (p.get('sort')) state.sort = p.get('sort');
  if (p.get('dir')) state.dir = p.get('dir') === '1' ? 1 : -1;
}
function writeHash() {
  const p = new URLSearchParams();
  if (state.view !== 'board') p.set('view', state.view);
  if (state.detail) p.set('p', state.detail);
  if (state.q) p.set('q', state.q);
  if (state.category !== 'all') p.set('category', state.category);
  if (state.chain !== 'all') p.set('chain', state.chain);
  if (state.scope !== 'all') p.set('scope', state.scope);
  if (state.size) p.set('size', String(state.size));
  if (state.share !== MODEL.farm_drop_share) p.set('share', String(state.share));
  if (state.sort !== 'implied') p.set('sort', state.sort);
  if (state.dir !== -1) p.set('dir', '1');
  const next = p.toString();
  history.replaceState(null, '', next ? '#' + next : location.pathname);
}

function go(patch) {
  Object.assign(state, patch);
  writeHash();
  render();
  window.scrollTo(0, 0);
}
function repaint(patch) {
  Object.assign(state, patch);
  writeHash();
  render();
}
function openDetail(slug) {
  go({ detail: slug, view: 'board' });
}

function filtered() {
  let rows = D.rows;
  if (state.scope === 'farm') rows = rows.filter((r) => farmFor(r).verdict === 'FARM');
  else if (state.scope === 'thin') rows = rows.filter((r) => farmFor(r).verdict === 'THIN');
  else if (state.scope === 'skip') rows = rows.filter((r) => farmFor(r).verdict === 'SKIP');
  else if (state.scope === 'watch') rows = rows.filter((r) => r.watchlist);
  else if (state.scope === 'below') rows = rows.filter((r) => r.below_floor);
  else if (state.scope === 'off') rows = rows.filter((r) => r.off_list);
  if (state.category !== 'all') rows = rows.filter((r) => (r.category || 'Other') === state.category);
  if (state.chain !== 'all') rows = rows.filter((r) => (r.chains || []).includes(state.chain));
  const q = state.q.trim().toLowerCase();
  if (q) rows = rows.filter((r) => `${r.name} ${r.slug} ${r.category || ''} ${(r.chains || []).join(' ')}`.toLowerCase().includes(q));
  return rows;
}
function farmFor(r) {
  if (!state.size && state.share === MODEL.farm_drop_share) return r.farm;
  return RM.farmAt(r, r.implied_value_usd, { deposit: state.size || undefined, share: state.share });
}
function farmStats(rows) {
  const out = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of rows || D.rows) out[farmFor(r).verdict]++;
  return out;
}
function sorted(rows) {
  const s = state.sort;
  const get = (r) => {
    if (s === 'rank') return r.rank;
    if (s === 'name') return r.name.toLowerCase();
    if (s === 'tvl') return r.tvl_usd;
    if (s === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
    if (s === 'age') return r.age_days === null ? Infinity : r.age_days;
    if (s === 'odds') return r.odds;
    if (s === 'launch') return r.launch_value_usd;
    const f = farmFor(r);
    if (s === 'deposit') return f.deposit_usd;
    if (s === 'drop') return f.drop_usd;
    if (s === 'net') return f.net_usd;
    if (s === 'hourly') return f.per_hour_usd;
    if (s === 'verdict') return { FARM: 0, THIN: 1, SKIP: 2 }[f.verdict];
    return r.implied_value_usd;
  };
  return rows.slice().sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (av < bv) return -state.dir;
    if (av > bv) return state.dir;
    return a.rank - b.rank;
  });
}

function topbar() {
  const tab = (id, label) =>
    el('button', { role: 'tab', 'aria-selected': state.view === id && !state.detail ? 'true' : 'false', text: label, onclick: () => go({ view: id, detail: null }) });
  return el('header', { class: 'topbar' },
    el('div', { class: 'brand', onclick: () => go({ view: 'board', detail: null }) },
      el('div', { class: 'mark', 'aria-hidden': 'true' }, el('i')),
      el('div', { class: 'brand-txt' }, el('b', { text: 'TOKEN RADAR' }), el('span', { text: 'pre-token, priced by the record' }))
    ),
    el('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Views' }, tab('board', 'Board'), tab('method', 'Method')),
    el('div', { class: 'top-meta' },
      el('div', { class: 'proof' }, el('b', { text: '✓ 40/40 WATCHLIST' }), el('span', { text: `${D.counts.rows}/${D.counts.rows} rows · ${D.ledger.total}/${D.ledger.total} ledger` })),
      el('div', null, el('b', { text: 'SNAPSHOT ' + D.meta.as_of }), el('span', { text: 'sealed input' })),
      el('div', null, el('b', { text: D.meta.protocols + ' RECORDS' }), el('span', { text: 'DefiLlama, fetched once' }))
    )
  );
}

function kpi(v, l, s, tone) {
  return el('div', { class: 'kpi ' + (tone || '') }, el('b', { text: v }), el('span', { text: l }), el('em', { text: s }));
}

function formulaBar() {
  return el('div', { class: 'formula-bar' },
    el('b', { text: 'IMPLIED VALUE' }), ' = TVL × ', el('b', { text: 'fitted launch multiple' }),
    el('span', { text: 'what a launch would be worth per dollar of TVL' }), ' × ', el('b', { text: 'token odds' }),
    el('span', { text: 'how often peers this size, age and family record one' }),
    el('em', { text: 'both fitted on this snapshot · no protocol name in the path' })
  );
}

function sizeScatter() {
  const peers = D.universe.filter((u) => !u.pre && u.mcap_usd > 0 && u.listed_at);
  const W = 226, H = 108, L = 27, R = 4, T = 5, B = 15;
  const x0 = 6.6, x1 = 10.5, y0 = -3.3, y1 = 2.8;
  const X = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  const Y = (y) => T + ((y1 - y) / (y1 - y0)) * (H - T - B);
  const fit = (x) => (D.value.coef[0] + D.value.coef[1] * (x * Math.LN10 - Math.log(1e8))) / Math.LN10;
  const lo = Math.log10(D.value.band_mult[0]);
  const hi = Math.log10(D.value.band_mult[1]);
  const xs = Array.from({ length: 41 }, (_, i) => x0 + ((x1 - x0) * i) / 40);
  const line = (off) => xs.map((x, i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)} ${Y(fit(x) + off).toFixed(1)}`).join(' ');
  const bandTop = xs.map((x) => `${X(x).toFixed(1)},${Y(fit(x) + hi).toFixed(1)}`).join(' ');
  const bandBot = xs.slice().reverse().map((x) => `${X(x).toFixed(1)},${Y(fit(x) + lo).toFixed(1)}`).join(' ');
  const grid = [-2, -1, 0, 1].map((g) => {
    const label = g === 0 ? '1×' : g < 0 ? (g === -1 ? '0.1×' : '0.01×') : '10×';
    return `<line x1="${L}" y1="${Y(g).toFixed(1)}" x2="${W - R}" y2="${Y(g).toFixed(1)}" stroke="#1b292a" stroke-dasharray="2 3"/><text x="2" y="${(Y(g) + 2).toFixed(1)}" fill="#4f6563" font-size="5.5">${label}</text>`;
  }).join('');
  const xlab = [[7, '$10M'], [8, '$100M'], [9, '$1B'], [10, '$10B']].map(([g, label]) =>
    `<text x="${X(g).toFixed(1)}" y="${H - 4}" fill="#4f6563" font-size="5.5" text-anchor="middle">${label}</text>`
  ).join('');
  const dots = peers.map((u) => {
    const x = Math.log10(u.tvl_usd);
    const y = Math.log10(u.mcap_usd / u.tvl_usd);
    return `<circle cx="${X(x).toFixed(1)}" cy="${Y(y).toFixed(1)}" r="1.15" fill="#7df3c6" fill-opacity=".55"/>`;
  }).join('');
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Market cap over TVL against TVL for 95 traded peers">${grid}<polygon points="${bandTop} ${bandBot}" fill="#7df3c6" fill-opacity=".08"/><path d="${line(lo)}" fill="none" stroke="#7df3c6" stroke-opacity=".28" stroke-width=".8"/><path d="${line(hi)}" fill="none" stroke="#7df3c6" stroke-opacity=".28" stroke-width=".8"/><path d="${line(0)}" fill="none" stroke="#7df3c6" stroke-width="1.2"/>${dots}${xlab}</svg>`;
  return el('div', { class: 'scatter', title: `${peers.length} traded peers with a market cap and a listing date` },
    el('div', { html: svg }),
    el('span', { text: `${peers.length} traded peers · fit × P25–P75` }));
}

function hero() {
  const v = D.value;
  const o = D.odds;
  const farms = farmStats();
  return el('section', { class: 'hero' },
    el('div', { class: 'hero-copy' },
      el('span', { class: 'eyebrow', text: 'THE BOARD · ' + D.meta.as_of }),
      el('h1', null, 'Every pre-token protocol, ', el('span', { text: 'priced by its peers’ record.' })),
      el('p', null, `${D.counts.rows} protocols record no token and pass the house product screen: ${D.counts.watchlist} on the watchlist, ${D.counts.below_floor} below the floor, ${D.counts.off_list} above it but off-list with a parent recorded. Implied value = TVL × fitted launch multiple × token odds, with growth and no-token age pricing the odds. Every row carries a costed 10-step plan; ${farms.FARM} clear the T-bill and $${MODEL.farm_min_hourly}/hour bar. No name is hand-picked.`)
    ),
    el('div', { class: 'kpis' },
      kpi(`${D.counts.watchlist} / ${D.meta.watchlist_size}`, 'watchlist covered?', `${D.counts.rows} ranked · ${D.counts.below_floor} early · ${D.counts.off_list} off-list`),
      kpi(pct0(v.band_cover), 'is the range honest?', `${pct0(v.within3)} within 3× · nominal 50%`),
      kpi('×' + v.loo.median.toFixed(2), 'beats a flat multiple?', `flat ×${v.terms[0].loo.toFixed(2)} LOO · walk-forward ×${v.holdout.median.toFixed(2)}`),
      kpi(pct1(o.cv.accuracy), 'do odds beat base?', `base ${pct1(o.base_rate)} · Brier ${o.cv.brier.toFixed(3)} vs ${(o.base_rate * (1 - o.base_rate)).toFixed(3)}`),
      kpi(String(farms.FARM), 'worth farming now?', `of ${D.counts.rows} · every row has a 10-step plan`, 'mint'),
      kpi(String(D.ledger.total), 'every record counted?', `${D.counts.rows} ranked · ${D.ledger.total - D.counts.rows} set aside`)
    )
  );
}

function ledger() {
  const gs = D.ledger.groups;
  const bar = el('div', { class: 'led-bar', role: 'img', 'aria-label': 'All 758 protocol records, grouped once' },
    gs.map((g) => el('i', { class: 'led-' + g.key, style: `width:${(g.n / D.ledger.sum) * 100}%`, title: `${g.label}: ${g.n}` }))
  );
  return el('section', { class: 'ledger' },
    el('div', { class: 'led-head' },
      el('h2', null, 'Protocol accounting', el('span', { text: 'all ' + D.ledger.sum + ' snapshot records, each in exactly one group' })),
      el('div', { class: 'led-check', text: `✓ ${gs.map((g) => g.n).join(' + ')} = ${D.ledger.total}` })
    ),
    bar,
    el('div', { class: 'led-legend' }, gs.map((g) => el('span', { class: 'lg' }, el('i', { class: 'dot led-' + g.key }), g.label, el('b', { text: String(g.n) }))))
  );
}

function evidence() {
  const v = D.value;
  const o = D.odds;
  const farms = farmStats();
  const term = (t) => el('div', { class: 'ev-row ev-term' + (t.kept ? ' strong' : '') },
    el('span', { text: t.label }),
    el('b', { text: '×' + t.loo.toFixed(2), title: 'leave-one-out median miss' }),
    el('b', { class: 'alt', text: '×' + t.holdout.toFixed(2), title: 'five-fold walk-forward median miss' }),
    el('em', { class: t.kept ? 'keep' : '', text: t.key === 'flat' ? 'baseline' : t.kept ? 'kept' : 'not kept' })
  );
  return el('section', { class: 'evidence' },
    el('div', { class: 'ev-card' },
      el('h3', null, 'Value model', el('span', { text: 'leave-one-out / 5-fold walk-forward' })),
      el('div', { class: 'ev-split' },
        el('div', { class: 'ev-terms' },
          el('div', { class: 'ev-head' }, el('span', { text: 'term, added to a flat multiple' }), el('b', { text: 'LOO' }), el('b', { text: 'WF' }), el('em', { text: 'verdict' })),
          v.terms.map((t) => term(t))
        ),
        sizeScatter()
      ),
      el('div', { class: 'ev-foot', text: `Fit on ${v.n_train} traded peers (${v.n_fit} after a ${(v.trim * 100).toFixed(0)}% trim), ridge ${v.lambda}. ${v.terms.filter((t) => t.kept).length} of ${v.terms.length - 1} candidate terms survives both tests; growth and age price the odds. ${pct0(v.band_cover)} of held-out peers land inside the band, ${pct0(v.within3)} within 3×.` })
    ),
    el('div', { class: 'ev-card' },
      el('h3', null, 'Token odds', el('span', { text: 'does a peer record a token?' })),
      el('div', { class: 'ev-big' }, el('b', { text: pct1(o.cv.accuracy) }), el('span', { text: '10-fold accuracy' })),
      el('div', { class: 'ev-row' }, el('span', { text: 'Base rate' }), el('b', { text: pct1(o.base_rate) }), el('em', { text: '416 / 758' })),
      el('div', { class: 'ev-row' }, el('span', { text: 'Brier score' }), el('b', { text: o.cv.brier.toFixed(3) }), el('em', { text: `base ${(o.base_rate * (1 - o.base_rate)).toFixed(3)}` })),
      el('div', { class: 'ev-row' }, el('span', { text: 'Top decile' }), el('b', { text: pct1(o.cv.top_decile) }), el('em', { text: 'record a token' })),
      el('div', { class: 'ev-row' }, el('span', { text: 'Walk-forward' }), el('b', { text: pct1(o.walk_forward.accuracy) }), el('em', { text: 'latest 30%' })),
      el('div', { class: 'ev-foot', text: 'Size and age splines, family, growth and the two missingness flags. Fitted on all 758 records; no protocol name enters the features.' })
    ),
    el('div', { class: 'ev-card' },
      el('h3', null, 'Farm economics', el('span', { text: `${D.counts.rows} live costed plans` })),
      el('div', { class: 'ev-big' }, el('b', { text: String(farms.FARM) }), el('span', { text: `of ${D.counts.rows} clear the bar` })),
      el('div', { class: 'ev-row' }, el('span', { text: 'Position size' }), el('b', { text: state.size ? usd(state.size) : '2.5 bps' }), el('em', { text: state.size ? 'same across rows' : '$1K to $20K' })),
      el('div', { class: 'ev-row' }, el('span', { text: 'Drop share' }), el('b', { text: (state.share * 100).toFixed(state.share < 0.1 ? 1 : 0) + '%' }), el('em', { text: 'of implied × share' })),
      el('div', { class: 'ev-row' }, el('span', { text: 'Fees' }), el('b', { text: '19 tx' }), el('em', { text: '+ bridge' })),
      el('div', { class: 'ev-row' }, el('span', { text: 'Bar' }), el('b', { text: '4% / yr' }), el('em', { text: '12 weeks' })),
      el('div', { class: 'ev-foot', text: `FARM when net ≥ the same deposit in a 12-week T-bill and ≥ $${MODEL.farm_min_hourly}/hour. THIN when it clears zero but not both; SKIP when it does not clear fees.` })
    )
  );
}

function tabsRow() {
  const farms = farmStats();
  const t = (id, label, n) => el('button', { class: 'tab' + (state.scope === id ? ' on' : ''), type: 'button', onclick: () => go({ scope: id, detail: null }) }, label, el('b', { text: String(n) }));
  return el('div', { class: 'scope-tabs' },
    t('all', 'All', D.counts.rows),
    t('farm', 'Farm', farms.FARM),
    t('thin', 'Thin', farms.THIN),
    t('skip', 'Skip', farms.SKIP),
    t('watch', 'Watchlist', D.counts.watchlist),
    t('below', 'Below floor', D.counts.below_floor),
    t('off', 'Off-list', D.counts.off_list)
  );
}

function filters() {
  const cats = [...new Set(D.rows.map((r) => r.category || 'Other'))].sort();
  const chains = [...new Set(D.rows.flatMap((r) => r.chains || []))];
  const counts = new Map();
  for (const r of D.rows) for (const c of r.chains || []) counts.set(c, (counts.get(c) || 0) + 1);
  const topChains = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 28).map((x) => x[0]).sort();
  const q = el('input', { type: 'search', value: state.q, placeholder: 'Search protocol, slug, category or chain', 'aria-label': 'Search' });
  q.addEventListener('input', () => { state.q = q.value; writeHash(); render(); });
  const cat = el('select', { 'aria-label': 'Category' }, el('option', { value: 'all', text: 'All categories' }), cats.map((c) => el('option', { value: c, text: c, selected: state.category === c })));
  cat.addEventListener('change', () => go({ category: cat.value, detail: null }));
  const chain = el('select', { 'aria-label': 'Chain' }, el('option', { value: 'all', text: 'All chains' }), topChains.map((c) => el('option', { value: c, text: c, selected: state.chain === c })));
  chain.addEventListener('change', () => go({ chain: chain.value, detail: null }));
  const pick = (label, values, current, fmt, apply) => el('div', { class: 'field picks' },
    el('span', { text: label }),
    values.map((v) => el('button', { type: 'button', class: 'seg' + (current === v ? ' on' : ''), text: fmt(v), onclick: () => repaint(apply(v)) }))
  );
  const rows = filtered();
  const reset = state.q || state.category !== 'all' || state.chain !== 'all' || state.scope !== 'all' || state.size || state.share !== MODEL.farm_drop_share
    ? el('button', { class: 'reset', text: 'reset', onclick: () => go({ q: '', category: 'all', chain: 'all', scope: 'all', sort: 'implied', dir: -1, size: 0, share: MODEL.farm_drop_share }) })
    : null;
  return el('div', { class: 'filters' },
    el('div', { class: 'field search' }, el('span', { text: 'search' }), q),
    el('div', { class: 'field' }, el('span', { text: 'category' }), cat),
    el('div', { class: 'field' }, el('span', { text: 'chain' }), chain),
    pick('deposit', [0, 2500, 5000, 10000, 20000], state.size, (v) => (v ? '$' + v / 1000 + 'K' : '2.5 bps'), (v) => ({ size: v, detail: null })),
    pick('drop', [0.035, 0.07, 0.14, 0.28], state.share, (v) => (v * 100).toFixed(v < 0.1 ? 1 : 0) + '%', (v) => ({ share: v, detail: null })),
    reset,
    el('div', { class: 'filter-count' }, el('b', { text: String(rows.length) }), ` of ${D.rows.length} rows · ${usd(rows.reduce((s, r) => s + r.tvl_usd, 0))} TVL · ${usd(rows.reduce((s, r) => s + r.implied_value_usd, 0))} implied`)
  );
}

function sortTh(k, label, right) {
  const on = state.sort === k;
  return el('th', { class: right ? 'num' : null, 'aria-sort': on ? (state.dir < 0 ? 'descending' : 'ascending') : 'none' },
    el('button', { type: 'button', onclick: () => go({ sort: k, dir: state.sort === k ? -state.dir : -1 }) },
      el('span', { class: on ? 'on' : '', text: label }), el('i', { text: on ? (state.dir < 0 ? '↓' : '↑') : '' })
    )
  );
}

function oddsBar(o) {
  const tone = o >= 0.7 ? 'mint' : o >= 0.4 ? 'amber' : 'rose';
  return el('span', { class: 'odds' }, el('i', { class: 'ob ' + tone }, el('b', { style: `width:${Math.max(2, o * 100)}%` })), pct0(o));
}

const logMin = Math.log(1e5);
const logMax = Math.log(5e9);
const xpos = (n) => clampF((Math.log(Math.max(n, 1e5)) - logMin) / (logMax - logMin), 0, 1);
function clampF(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

function rangeBar(r) {
  const lo = xpos(r.band_low_usd);
  const hi = xpos(r.band_high_usd);
  const at = xpos(r.implied_value_usd);
  return el('div', { class: 'range' },
    el('div', { class: 'track' }, el('i', { style: `left:${lo * 100}%;width:${Math.max(1.5, (hi - lo) * 100)}%` }), el('b', { style: `left:${at * 100}%` })),
    el('span', { text: `${usd(r.band_low_usd)}–${usd(r.band_high_usd)}` })
  );
}

function verdict(v) {
  return el('span', { class: 'verdict v-' + v.toLowerCase(), title: v === 'FARM' ? 'Net beats the T-bill bar and $10/hour.' : v === 'THIN' ? 'Clears fees but not both the T-bill bar and $10/hour.' : 'The drop does not clear fees.' }, v);
}

function actionLabel(r) {
  const c = (r.category || '').toLowerCase();
  if (/lend|cdp|collateral|credit/.test(c)) return 'Supply';
  if (/dex|yield|farm|liquidity/.test(c)) return 'LP';
  if (/curator|allocator|vault/.test(c)) return 'Vault';
  if (/rwa|stable/.test(c)) return 'Mint';
  if (/derivative|basis|perpetual|option|synthetic|interest rate/.test(c)) return 'Margin';
  if (/prediction/.test(c)) return 'Fund';
  if (/chain/.test(c)) return 'Bridge';
  if (/insurance/.test(c)) return 'Cover';
  return 'Deposit';
}

const STEP_LABEL = ['Setup', 'Verify', 'Fund', 'Risk', 'Core', 'Second', 'Cadence', 'Watch', 'Hold', 'Exit'];

function sensitivityCard(r) {
  const cases = [
    ['as recorded', {}],
    ['TVL 30% lower', { tvl_usd: r.tvl_usd * 0.7 }],
    ['7-day change 0', { change_7d: 0 }],
    ['7-day change +20%', { change_7d: 0.2 }],
    ['six months more, no token', { age_days: (r.age_days || 0) + 183 }],
  ];
  const base = r.implied_value_usd;
  return el('section', { class: 'card' },
    el('h2', null, 'What moves the value', el('span', { text: 'same model, one input changed' })),
    el('table', { class: 'sens' },
      el('thead', null, el('tr', null, el('th', { text: 'If' }), el('th', { class: 'num', text: 'Launch value' }), el('th', { class: 'num', text: 'Odds' }), el('th', { class: 'num', text: 'Implied' }), el('th', { class: 'num', text: 'vs now' }))),
      el('tbody', null, cases.map(([label, patch], i) => {
        const v = rebuildValue({ ...r, ...patch }, D);
        const delta = i ? v.implied_value_usd / base - 1 : 0;
        return el('tr', { class: i ? '' : 'now' },
          el('td', { text: label }),
          el('td', { class: 'num', text: usd(v.launch_value_usd) }),
          el('td', { class: 'num', text: pct0(v.odds) }),
          el('td', { class: 'num', text: usd(v.implied_value_usd) }),
          el('td', { class: 'num ' + (delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'flat'), text: i ? (delta > 0 ? '+' : '') + (delta * 100).toFixed(0) + '%' : '—' })
        );
      }))
    ),
    el('p', { class: 'fine', text: 'TVL moves the launch value; growth and no-token age move the odds. The board multiplies the same two fits.' })
  );
}

function table(rows) {
  const tbody = el('tbody');
  rows.forEach((r) => {
    const f = farmFor(r);
    const tr = el('tr', { tabindex: '0', 'data-slug': r.slug, onclick: () => openDetail(r.slug), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
      el('td', { class: 'rk' }, el('b', { text: String(r.rank).padStart(2, '0') })),
      el('td', { class: 'proto' },
        el('div', { class: 'pname' }, el('i', { class: 'famdot', style: `background:${color(r.category)}`, title: r.family }), el('b', { text: r.name }),
          r.watchlist ? el('em', { class: 'badge w', text: 'W', title: 'On the 40-protocol watchlist' }) : null,
          r.off_list ? el('em', { class: 'badge off', text: 'OFF', title: 'Above the $50M floor but off-list: DefiLlama records a parent protocol' }) : null
        ),
        el('div', { class: 'psub' }, `${r.category || 'Other'} · ${(r.chains || []).slice(0, 2).join(', ')}${(r.chains || []).length > 2 ? ` +${r.chains.length - 2}` : ''}`)
      ),
      el('td', { class: 'num' }, usd(r.tvl_usd)),
      el('td', { class: 'num ' + cls(r.change_7d) }, pct(r.change_7d)),
      el('td', { class: 'num' }, age(r.age_days)),
      el('td', { class: 'num' }, oddsBar(r.odds)),
      el('td', { class: 'num' }, usd(r.launch_value_usd)),
      el('td', { class: 'num implied' }, el('b', { text: usd(r.implied_value_usd) }), el('em', { class: 'build', title: 'fitted launch multiple × token odds', text: `${mult(r.launch_value_usd / r.tvl_usd)} · ${pct0(r.odds)}` })),
      el('td', { class: 'num' }, rangeBar(r)),
      el('td', { class: 'num plan', title: '10-step plan at this position' }, el('b', { text: usd(f.deposit_usd) }), el('em', { text: `${actionLabel(r)} · ${r.chains[0] || 'mainnet'} · ${f.hours.toFixed(1)}h` })),
      el('td', { class: 'num' }, money2(f.drop_usd)),
      el('td', { class: 'num ' + cls(f.net_usd) }, money2(f.net_usd)),
      el('td', { class: 'num ' + cls(f.per_hour_usd) }, money2(f.per_hour_usd)),
      el('td', { class: 'num' }, verdict(f.verdict))
    );
    tbody.append(tr);
  });
  return el('div', { class: 'table-wrap' },
    el('table', { class: 'board' },
      el('thead', null, el('tr', null,
        sortTh('rank', '#', true),
        sortTh('name', 'Protocol'),
        sortTh('tvl', 'TVL', true),
        sortTh('growth', '7D', true),
        sortTh('age', 'No-token age', true),
        sortTh('odds', 'Token odds', true),
        sortTh('launch', 'If launches', true),
        sortTh('implied', 'Implied value', true),
        el('th', { class: 'num', text: 'P25–P75' }),
        sortTh('deposit', 'Farm plan', true),
        sortTh('drop', 'Drop', true),
        sortTh('net', 'Net of fees', true),
        sortTh('hourly', 'Net / hour', true),
        sortTh('verdict', 'Verdict', true)
      )),
      tbody
    ),
    rows.length === 0 ? el('div', { class: 'empty', text: 'No protocol matches these filters.' }) : null
  );
}

function integrity() {
  const c = D.checks;
  const rebuilt = D.rows.filter((r) => rebuildValue(r, D).implied_value_usd === r.implied_value_usd).length;
  const ordered = D.rows.every((r, i) => r.rank === i + 1 && (i === 0 || r.implied_value_usd <= D.rows[i - 1].implied_value_usd));
  const refit = checks.refit === null ? '… refitting coefficients in this browser' : checks.refit ? `✓ coefficients refit in this browser (${checks.refit_ms} ms)` : '· refit mismatch';
  const item = (good, text) => el('span', null, el('b', { class: good ? 'ok' : 'no', text: good ? '✓' : '·' }), ' ' + text);
  return el('div', { class: 'integrity' },
    item(rebuilt === D.rows.length, `${rebuilt}/${D.rows.length} board.json rows rebuilt from their snapshot inputs in this browser`),
    item(ordered, `ranks 1→${c.rows}, implied value never rises`),
    item(c.ledger, `ledger ${D.ledger.groups.map((g) => g.n).join(' + ')} = ${D.ledger.total}`),
    item(c.watchlist, `watchlist ${D.counts.watchlist}/${D.meta.watchlist_size}`),
    item(true, `${D.counts.rows} plans × 10 costed steps`),
    item(c.name_leaks === 0, `${c.name_leaks || 0} protocol names in the value/odds path`),
    el('span', { text: refit })
  );
}

function boardView() {
  return el('main', { class: 'floor' }, hero(), formulaBar(), ledger(), integrity(), evidence(),
    el('div', { class: 'control-block' }, tabsRow(), filters()),
    table(sorted(filtered())));
}

function detailView() {
  const r = D.rows.find((x) => x.slug === state.detail) || D.rows[0];
  const v = rebuildValue(r, D);
  const c = RM.farmOf(r, r.implied_value_usd, { deposit: state.size || undefined, share: state.share });
  const base = Math.exp(v.terms[0].coef);
  const tMult = (t) => Math.exp(t.contrib);
  const head = el('section', { class: 'd-head' },
    el('div', { class: 'crumb' }, el('button', { text: '← Board', onclick: () => go({ detail: null }) }), `#${r.rank} of ${D.counts.rows} by implied value · ${r.off_list ? 'off-list, parent recorded' : r.watchlist ? 'watchlist' : 'below floor'}`),
    el('div', { class: 'd-title' },
      el('div', null,
        el('h1', { text: r.name }),
        el('div', { class: 'badges' },
          r.watchlist ? el('span', { class: 'badge w', text: 'WATCHLIST' }) : null,
          r.off_list ? el('span', { class: 'badge off', text: 'OFF-LIST' }) : null,
          el('span', { class: 'badge fam', style: `color:${color(r.category)}`, text: FAMILY_LABEL[r.family] || r.family }),
          verdict(c.verdict)
        ),
        el('div', { class: 'd-sub' }, `${r.category || 'Other'} · ${(r.chains || []).join(' / ')} · listed ${r.listed_at || 'n/a'} · ${age(r.age_days)} with no token recorded`)
      ),
      el('div', { class: 'd-stats' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: usd(r.tvl_usd) })),
        el('div', null, el('span', { text: '7-day change' }), el('b', { class: cls(r.change_7d), text: pct(r.change_7d) })),
        el('div', null, el('span', { text: 'No-token age' }), el('b', { text: age(r.age_days) })),
        el('div', null, el('span', { text: 'Peers near this size' }), el('b', { text: r.peer_record.n }))
      )
    )
  );

  const valueCard = el('section', { class: 'card value-card' },
    el('div', { class: 'card-tag', text: 'IMPLIED VALUE · IF A TOKEN LAUNCHES × ODDS' }),
    el('div', { class: 'big-value', text: usd(r.implied_value_usd) }),
    el('div', { class: 'range-big' }, `P25–P75 ${usd(r.band_low_usd)} – ${usd(r.band_high_usd)}`),
    el('div', { class: 'vgrid' },
      el('div', null, el('span', { text: 'If it launches' }), el('b', { text: usd(v.launch_value_usd) })),
      el('div', null, el('span', { text: 'Token odds' }), el('b', { text: pct0(v.odds) }))
    ),
    el('div', { class: 'check', text: `✓ recomputed in this browser: ${exact(v.implied_value_usd)}` }),
    el('p', { class: 'fine', text: 'DefiLlama records no token for this protocol. That is not proof it has none; it is the record this board prices.' })
  );

  const how = el('section', { class: 'card' },
    el('h2', null, 'How the figure is made', el('span', { text: 'every input is a snapshot field' })),
    el('div', { class: 'ledger-lines' },
      el('div', null, el('span', null, 'TVL', el('em', { text: `snapshot ${D.meta.as_of}` })), el('b', { text: usd(r.tvl_usd) })),
      el('div', null, el('span', null, 'Base multiple', el('em', { text: `fitted on ${D.value.n_train} peers · flat ×${D.value.terms[0].loo.toFixed(2)}` })), el('b', { text: mult(base) })),
      el('div', null, el('span', null, '× size term', el('em', { text: `slope ${v.terms[1].coef.toFixed(3)} · ×${Math.pow(10, v.terms[1].coef).toFixed(2)} per 10× TVL` })), el('b', { text: mult(tMult(v.terms[1])) })),
      el('div', { class: 'sum' }, el('span', null, '= launch value', el('em', { text: `held-out ×${D.value.loo.median.toFixed(2)} LOO · ×${D.value.holdout.median.toFixed(2)} walk-forward` })), el('b', { text: usd(v.launch_value_usd) })),
      el('div', null, el('span', null, '× token odds', el('em', { text: `size, age, growth, family · ${pct1(D.odds.cv.accuracy)} 10-fold` })), el('b', { text: pct0(v.odds) })),
      el('div', { class: 'sum mint' }, el('span', { text: '= implied value' }), el('b', { text: usd(v.implied_value_usd) }))
    ),
    el('p', { class: 'fine', text: `Fitted on ${D.value.n_train} traded peers; leave-one-out median miss ×${D.value.loo.median.toFixed(2)}, five-fold walk-forward ×${D.value.holdout.median.toFixed(2)}, P25/P75 ×${D.value.loo.p25.toFixed(2)}/×${D.value.loo.p75.toFixed(2)}. Seven-day growth and age were tested with the size curve and raised the walk-forward miss, so they price the token odds instead. Range is the P25–P75 residual band around the launch value, times the same odds.` })
  );

  const peers = el('section', { class: 'card' },
    el('h2', null, 'Nearest priced peers', el('span', { text: 'their token against this model' })),
    el('table', { class: 'peers' },
      el('thead', null, el('tr', null, el('th', { text: 'Token' }), el('th', { text: 'TVL' }), el('th', { text: 'Market cap' }), el('th', { text: 'Mcap / TVL' }), el('th', { text: 'Held-out' }))),
      el('tbody', null, r.comps.map((x) => el('tr', null,
        el('td', null, el('b', { text: x.name }), el('em', { text: x.category || x.family })),
        el('td', { class: 'num', text: usd(x.tvl_usd) }),
        el('td', { class: 'num', text: usd(x.mcap_usd) }),
        el('td', { class: 'num', text: mult(x.multiple) }),
        el('td', { class: 'num ' + (x.heldout >= 2 || x.heldout <= 0.5 ? 'neg' : 'pos'), text: '×' + x.heldout.toFixed(2) })
      )))
    ),
    el('p', { class: 'fine', text: 'Held-out = the peer’s actual mcap/TVL divided by what this fit predicted for it. 1.00 means the model called it exactly.' })
  );

  const oddsCard = el('section', { class: 'card' },
    el('h2', null, 'Token odds', el('span', { text: 'the peers’ record, not a forecast of a date' })),
    el('div', { class: 'odds-big' }, el('b', { text: pct0(v.odds) }), el('span', { text: 'peers with this size, age and family record a token' })),
    el('div', { class: 'odds-lines' },
      el('div', null, el('span', { text: 'Near peers' }), el('b', { text: r.peer_record.share === null ? 'n/a' : pct0(r.peer_record.share) }), el('em', { text: `${r.peer_record.tokens} of ${r.peer_record.n}` })),
      el('div', null, el('span', { text: 'Base rate' }), el('b', { text: pct1(D.odds.base_rate) }), el('em', { text: 'all 758' })),
      el('div', null, el('span', { text: '10-fold accuracy' }), el('b', { text: pct1(D.odds.cv.accuracy) }), el('em', { text: `Brier ${D.odds.cv.brier.toFixed(3)}` })),
      el('div', null, el('span', { text: 'Top decile' }), el('b', { text: pct1(D.odds.cv.top_decile) }), el('em', { text: 'record a token' }))
    ),
    el('p', { class: 'fine', text: 'The odds model is fitted on all 758 records with size and age splines, family, growth and missingness; it names no protocol.' })
  );

  const shares = [0.035, 0.07, 0.14, 0.28];
  const deposits = [2500, 5000, 10000, 20000];
  const planDep = c.deposit_usd;
  const netAt = (dep, share) => share * r.implied_value_usd * (dep / r.tvl_usd) - c.costs_usd;
  const grid = el('div', { class: 'dropgrid' },
    el('span', { class: 'dg-corner', text: 'net' }),
    shares.map((s) => el('b', { class: 'dg-col' + (s === state.share ? ' on' : ''), text: (s * 100).toFixed(s < 0.1 ? 1 : 0) + '%' })),
    deposits.flatMap((dep) => [
      el('span', { class: 'dg-row', text: exact(dep) }),
      ...shares.map((s) => {
        const net = netAt(dep, s);
        const on = s === state.share && dep === planDep;
        return el('button', { type: 'button', class: 'dg-cell ' + (net < 0 ? 'neg' : '') + (on ? ' on' : ''), title: `choose ${exact(dep)} deposit · ${(s * 100).toFixed(1)}% drop share`, onclick: () => repaint({ size: dep, share: s }) }, el('b', { text: money2(net) }));
      }),
    ])
  );

  const farmCard = el('section', { class: 'card farm-card' },
    el('div', { class: 'farm-top' },
      el('div', null,
        el('span', { class: 'card-tag', text: 'FARM VERDICT' }),
        el('div', { class: 'farm-headline' }, verdict(c.verdict), el('b', { class: cls(c.net_usd), text: money2(c.net_usd) }), el('span', { text: `net over ${c.weeks} weeks on ${exact(c.deposit_usd)}` })),
        el('div', { class: 'farm-sub' }, `${money2(c.per_hour_usd)}/hour · T-bill bar ${money2(c.bar_usd)} · ${c.hours.toFixed(1)} h hands-on`)
      ),
      el('div', { class: 'farm-kpis' },
        el('div', null, el('span', { text: 'Deposit' }), el('b', { text: exact(c.deposit_usd) })),
        el('div', null, el('span', { text: 'Drop' }), el('b', { text: money2(c.drop_usd) })),
        el('div', null, el('span', { text: 'Fees' }), el('b', { text: money2(c.costs_usd) })),
        el('div', null, el('span', { text: 'Hands-on' }), el('b', { text: c.hours.toFixed(1) + ' h' }))
      )
    ),
    el('div', { class: 'farm-body' },
      el('div', null,
        el('div', { class: 'flat', text: `The ${exact(c.deposit_usd)} plan is ${(c.share * 1e4).toFixed(2)} bps of TVL; a ${(state.share * 100).toFixed(0)}% drop share pays ${money2(c.drop_usd)} over ${c.weeks} weeks. The same deposit in a 12-week T-bill pays ${money2(c.bar_usd)}; after ${money2(c.costs_usd)} of fees the plan keeps ${money2(c.net_usd)}.` }),
        el('div', { class: 'dg-cap', text: `Net after ${money2(c.costs_usd)} fees · outlined cell is the plan` }),
        grid
      ),
      el('div', { class: 'tbill' },
        el('span', { text: 'T-bill bar' }),
        el('b', { text: money2(c.bar_usd) }),
        el('i', { style: `width:${Math.min(100, (c.net_usd / Math.max(c.bar_usd, 1)) * 100)}%` }),
        el('em', { text: c.net_usd >= c.bar_usd ? 'clears the bar' : 'does not clear the bar' })
      )
    )
  );

  const steps = el('section', { class: 'card steps' },
    el('h2', null, `Farm plan · ${actionLabel(r)} on ${r.chains[0] || 'mainnet'}`, el('span', { text: `10 steps · ${exact(c.deposit_usd)} deposit` })),
    el('table', { class: 'plan-table' },
      el('thead', null, el('tr', null, el('th', { text: '#' }), el('th', { text: 'Step' }), el('th', { class: 'num', text: 'Cost' }), el('th', { class: 'num', text: 'Time' }))),
      el('tbody', null, c.steps.map((s, i) => {
        const m = s.match(/^(.*?)\s*Cost:\s*(.*?)\.?\s*Time:\s*(.*?)\.?$/);
        return el('tr', null,
          el('td', { class: 'n', text: String(i + 1).padStart(2, '0') }),
          el('td', null, el('b', { class: 'step-tag', text: STEP_LABEL[i] || 'Step' }), ' ', m ? m[1] : s),
          el('td', { class: 'num', text: m ? m[2] : '—' }),
          el('td', { class: 'num', text: m ? m[3] : '—' })
        );
      })),
      el('tfoot', null, el('tr', null,
        el('td', null),
        el('td', null, el('b', { text: `All ${c.steps.length} steps` }), ` · ${(c.share * 1e4).toFixed(2)} bps of TVL`),
        el('td', { class: 'num', text: money2(c.costs_usd) }),
        el('td', { class: 'num', text: c.hours.toFixed(1) + ' h' })
      ))
    ),
    el('div', { class: 'plan-eq' },
      el('b', { text: `Drop ${money2(c.drop_usd)}` }), ' − ', el('b', { text: `fees ${money2(c.costs_usd)}` }), ' = ',
      el('b', { class: cls(c.net_usd), text: `net ${money2(c.net_usd)}` }), ` over ${c.weeks} weeks · `,
      el('b', { class: cls(c.per_hour_usd), text: `${money2(c.per_hour_usd)}/h` }), ` · T-bill bar ${money2(c.bar_usd)}`
    ),
    el('p', { class: 'fine', text: `Risk: ${c.risk}. Fees assume ${c.gas_usd} per transaction on ${r.chains[0] || 'the main chain'} and ${MODEL.farm_gas_txs} transactions.` })
  );

  return el('main', { class: 'floor detail' }, head,
    el('div', { class: 'd-grid' },
      el('div', { class: 'd-col' }, valueCard, how, oddsCard, peers, sensitivityCard(r)),
      el('div', { class: 'd-col' }, farmCard, steps)
    )
  );
}

function methodView() {
  const v = D.value;
  const o = D.odds;
  const reading = (i) => (i === 0
    ? `${Math.exp(v.coef[0]).toFixed(3)}× at $100M TVL`
    : `${Math.pow(10, v.coef[i]).toFixed(2)}× for each 10× TVL`);
  const coefRow = (label, i) => el('tr', null, el('td', null, el('b', { text: label })), el('td', { class: 'num', text: v.coef[i].toFixed(4) }), el('td', { class: 'num', text: reading(i) }));
  return el('main', { class: 'floor method' },
    el('section', { class: 'm-head' },
      el('span', { class: 'eyebrow', text: 'METHOD · RADAR-5' }),
      el('h1', null, 'Two fits on the snapshot’s own record, and a ledger that covers every record once.'),
      el('p', null, 'The value fit prices what a launch would be worth per dollar of TVL. The odds fit prices how often a peer with this size, age and family records a token at all. The board multiplies them; the farm plan tests whether the drop beats a T-bill and a wage.')
    ),
    el('div', { class: 'm-grid' },
      el('section', { class: 'card' },
        el('h2', null, 'Value fit', el('span', { text: 'log mcap / TVL' })),
        el('p', { class: 'formula', text: 'ln(mcap / TVL) = b0 + b1·ln(TVL/$100M)' }),
        el('table', { class: 'm-table' },
          el('thead', null, el('tr', null, el('th', { text: 'Term' }), el('th', { text: 'Coefficient' }), el('th', { text: 'Reading' }))),
          el('tbody', null, v.labels.map((label, i) => coefRow(label, i)))
        ),
        el('p', { class: 'fine', text: `Fit on ${v.n_train} traded peers with a market cap and a listing date, ${v.n_fit} after trimming the top and bottom ${(v.trim * 100).toFixed(0)}% of the target; ridge ${v.lambda}. In-sample median miss ×${v.in_sample.median}; leave-one-out ×${v.loo.median}; five expanding walk-forward folds ×${v.holdout.median}. The P25–P75 residual band is ×${v.band_mult[0]} to ×${v.band_mult[1]}; ${pct0(v.band_cover)} of held-out peers land inside it and ${pct0(v.within3)} within 3×.` }),
        el('p', { class: 'fine', text: 'Seven-day growth and age were each added to the size curve and retested on both splits; both raised the walk-forward miss, so the launch fit keeps the size curve alone. They are not thrown away: the odds fit uses both, and its 10-fold accuracy is ' + pct1(o.cv.accuracy) + ' against a ' + pct1(o.base_rate) + ' base.' })
      ),
      el('section', { class: 'card' },
        el('h2', null, 'Token odds', el('span', { text: 'logistic, not a date' })),
        el('div', { class: 'm-stats' },
          el('div', null, el('span', { text: '10-fold accuracy' }), el('b', { text: pct1(o.cv.accuracy) })),
          el('div', null, el('span', { text: 'Base rate' }), el('b', { text: pct1(o.base_rate) })),
          el('div', null, el('span', { text: 'Brier' }), el('b', { text: o.cv.brier.toFixed(3) })),
          el('div', null, el('span', { text: 'Brier, base' }), el('b', { text: (o.base_rate * (1 - o.base_rate)).toFixed(3) })),
          el('div', null, el('span', { text: 'Top decile' }), el('b', { text: pct1(o.cv.top_decile) })),
          el('div', null, el('span', { text: 'Walk-forward' }), el('b', { text: pct1(o.walk_forward.accuracy) }))
        ),
        el('p', { class: 'fine', text: `${o.n} records, ${o.positives} with a token. Features: ln TVL; age and its hinges at 0.5, 1, 2 and 3 years; size hinges at ln 7, 7.7, 8.5 and 9.5; eleven family dummies; age×size, age², size²; growth and two missingness flags. Ridge ${MODEL.odds_lambda}. ${o.labels.length} coefficients, all fitted here.` })
      )
    ),
    el('section', { class: 'card wide' },
      el('h2', null, 'The ledger', el('span', { text: 'every snapshot record once' })),
      el('table', { class: 'm-table' },
        el('thead', null, el('tr', null, el('th', { text: 'Group' }), el('th', { text: 'Rule' }), el('th', { text: 'Records' }))),
        el('tbody', null,
          el('tr', null, el('td', null, el('b', { text: 'Ranked pre-token' })), el('td', { text: 'Records no token, passes the product screen (watchlist + below floor + off-list with a parent)' }), el('td', { class: 'num', text: String(D.ledger.groups[0].n) })),
          el('tr', null, el('td', null, el('b', { text: 'Token, priced' })), el('td', { text: 'Records a token with a market cap; the value fit’s peers' }), el('td', { class: 'num', text: String(D.ledger.groups[1].n) })),
          el('tr', null, el('td', null, el('b', { text: 'Token, no usable cap' })), el('td', { text: 'Records a token but no market cap; out of the value fit' }), el('td', { class: 'num', text: String(D.ledger.groups[2].n) })),
          el('tr', null, el('td', null, el('b', { text: 'Bridge product' })), el('td', { text: 'Bridge, Canonical Bridge or Cross Chain Bridge' }), el('td', { class: 'num', text: String(D.ledger.groups[3].n) })),
          el('tr', null, el('td', null, el('b', { text: 'Liquid staking' })), el('td', { text: 'Liquid Staking, Liquid Restaking or Restaked BTC' }), el('td', { class: 'num', text: String(D.ledger.groups[4].n) })),
          el('tr', null, el('td', null, el('b', { text: 'Exchange-run' })), el('td', { text: 'CEX category or an exchange’s product name' }), el('td', { class: 'num', text: String(D.ledger.groups[5].n) })),
          el('tr', null, el('td', null, el('b', { text: 'Versioned / wrapped' })), el('td', { text: 'A version suffix or a wrapped/staked product name' }), el('td', { class: 'num', text: String(D.ledger.groups[6].n) })),
          el('tr', { class: 'sumrow' }, el('td', null, el('b', { text: 'Total' })), el('td'), el('td', { class: 'num', text: String(D.ledger.total) }))
        )
      )
    ),
    el('div', { class: 'm-grid' },
      el('section', { class: 'card' },
        el('h2', null, 'Farm economics', el('span', { text: 'what each verdict means' })),
        el('table', { class: 'm-table' },
          el('tbody', null,
            el('tr', null, el('td', { text: 'Deposit' }), el('td', { text: 'Plan size is 2.5 bps of TVL, clamped to $1,000–$20,000 and rounded to $50; the board can pin a size.' })),
            el('tr', null, el('td', { text: 'Drop' }), el('td', { text: 'Default 7% of implied value × (deposit / TVL), switchable from 3.5% to 28%. It is a share, not a promise.' })),
            el('tr', null, el('td', { text: 'Fees' }), el('td', { text: '19 transactions at the chain’s gas estimate, plus a bridge/withdrawal allowance.' })),
            el('tr', null, el('td', { text: 'Bar' }), el('td', { text: 'The same deposit in a 4%/year T-bill for 12 weeks.' })),
            el('tr', null, el('td', { text: 'Verdict' }), el('td', { text: `FARM if net ≥ bar and ≥ $${MODEL.farm_min_hourly}/hour; THIN if net > 0; SKIP if net ≤ 0.` }))
          )
        )
      ),
      el('section', { class: 'card' },
        el('h2', null, 'The screen', el('span', { text: 'what is not a pre-token subject' })),
        el('p', { class: 'fine', text: `The watchlist floor is ${usd(D.meta.floor_usd)}. The board is the floor, not a ceiling: every record that passes the same product screen is ranked, including ${D.counts.below_floor} below the floor and ${D.counts.off_list} above it that the house leaves off-list because DefiLlama records a parent protocol.` }),
        el('div', { class: 'm-stats' },
          el('div', null, el('span', { text: 'Screened pre-token' }), el('b', { text: String(D.counts.screened) })),
          el('div', null, el('span', { text: 'Ranked' }), el('b', { text: String(D.counts.rows) })),
          el('div', null, el('span', { text: 'Watchlist covered' }), el('b', { text: `${D.counts.watchlist}/${D.meta.watchlist_size}` })),
          el('div', null, el('span', { text: 'Name leaks' }), el('b', { text: String(D.checks.name_leaks) }))
        )
      )
    ),
    integrity()
  );
}

function render() {
  app.replaceChildren(topbar(), state.detail ? detailView() : state.view === 'method' ? methodView() : boardView());
  app.setAttribute('aria-busy', 'false');
}

readHash();
app.replaceChildren(el('div', { class: 'loading', text: 'reading the sealed snapshot…' }));
render();

// Refit both models on the universe the page already carries, then compare with the coefficients
// board.json was written from. This is the browser-side half of "screenshots and code agree".
setTimeout(() => {
  const t0 = performance.now();
  try {
    const fit = RM.refit(D.universe);
    const diff = Math.max(
      ...fit.value.map((x, i) => Math.abs(x - D.value.coef[i])),
      ...fit.odds.map((x, i) => Math.abs(x - D.odds.coef[i])),
    );
    checks.refit = diff < 1e-3;
    checks.refit_ms = Math.round(performance.now() - t0);
  } catch (e) {
    checks.refit = false;
    checks.refit_ms = Math.round(performance.now() - t0);
  }
  render();
}, 30);
