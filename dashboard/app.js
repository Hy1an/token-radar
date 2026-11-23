// Token Radar: a no-network console over the sealed DefiLlama snapshot.
// The page reads window.RADAR (written beside dashboard/ by main.ts), loads the same model.js the
// program uses, and re-derives every implied value from the row's own snapshot inputs.

const { rebuildValue, rebuildFromLive, familyOf, MODEL } = window.RadarModel;

const D = window.RADAR;
const app = document.getElementById('app');
const FAMILY_COLOR = {
  'Lending & credit': '#7df3c6',
  'DEX & yield': '#6fc7ff',
  Bridges: '#b89bff',
  Staking: '#f4c26a',
  'RWA & index': '#ff9f6e',
  Derivatives: '#f27ea9',
  'Asset management': '#9bd35a',
  Infrastructure: '#6fe3d0',
  Stablecoins: '#d6c86a',
  Insurance: '#c7a8ff',
  'Prediction markets': '#ff8a72',
  CeFi: '#8fa8b8',
  Other: '#82a099',
};

const state = { tab: 'board', q: '', category: 'all', chain: 'all', watch: false, sort: 'implied', dir: -1, detail: null };

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
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a';
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
  if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + Math.round(n);
};
const exactUsd = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0);
const pct = (n) => (n === null || n === undefined || !Number.isFinite(n) ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%');
const age = (d) => (d === null || d === undefined ? 'n/a' : d >= 365 ? (d / 365).toFixed(1) + 'y' : Math.round(d) + 'd');
const mult = (n) => (Number.isFinite(n) ? n.toFixed(n >= 10 ? 1 : 2) + 'x' : 'n/a');
const signedMult = (n) => (Number.isFinite(n) ? '×' + n.toFixed(3) : 'n/a');
const cls = (n) => (n === null || n === undefined ? 'flat' : n > 0 ? 'pos' : n < 0 ? 'neg' : 'flat');
const color = (cat) => FAMILY_COLOR[familyOf(cat)] || FAMILY_COLOR.Other;

function readHash() {
  const h = window.location.hash.replace(/^#/, '');
  const p = new URLSearchParams(h);
  state.tab = p.get('tab') === 'live' ? 'live' : p.get('tab') === 'method' ? 'method' : 'board';
  state.q = p.get('q') || '';
  state.category = p.get('category') || 'all';
  state.chain = p.get('chain') || 'all';
  state.watch = p.get('watch') === '1';
  state.detail = p.get('p') || null;
  if (state.detail) state.tab = 'board';
  if (p.get('sort')) state.sort = p.get('sort');
  if (p.get('dir')) state.dir = p.get('dir') === '1' ? 1 : -1;
}
function writeHash() {
  const p = new URLSearchParams();
  if (state.tab !== 'board' && !state.detail) p.set('tab', state.tab);
  if (state.q) p.set('q', state.q);
  if (state.category !== 'all') p.set('category', state.category);
  if (state.chain !== 'all') p.set('chain', state.chain);
  if (state.watch) p.set('watch', '1');
  if (state.sort !== 'implied') p.set('sort', state.sort);
  if (state.dir !== -1) p.set('dir', '1');
  if (state.detail) p.set('p', state.detail);
  const next = p.toString();
  history.replaceState(null, '', next ? '#' + next : location.pathname);
}

function activeFilters() {
  const out = [];
  if (state.q) out.push({ k: 'q', label: 'search', value: state.q });
  if (state.category !== 'all') out.push({ k: 'category', label: 'category', value: state.category });
  if (state.chain !== 'all') out.push({ k: 'chain', label: 'chain', value: state.chain });
  if (state.watch) out.push({ k: 'watch', label: 'scope', value: 'watchlist only' });
  return out;
}

function filtered() {
  const q = state.q.trim().toLowerCase();
  let rows = D.rows;
  if (state.watch) rows = rows.filter((r) => r.watchlist);
  if (state.category !== 'all') rows = rows.filter((r) => (r.category || 'Other') === state.category);
  if (state.chain !== 'all') rows = rows.filter((r) => (r.chains || []).includes(state.chain));
  if (q) {
    rows = rows.filter((r) => (r.name + ' ' + r.slug + ' ' + (r.category || '') + ' ' + (r.chains || []).join(' ')).toLowerCase().includes(q));
  }
  return rows;
}

function sorted(rows) {
  const key = state.sort;
  const get = (r) => {
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'category') return (r.category || '').toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
    if (key === 'age') return r.age_days === null ? Infinity : r.age_days;
    if (key === 'peer') return r.peer.multiple;
    if (key === 'conf') return r.confidence;
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
    el('button', { role: 'tab', 'aria-selected': state.tab === id ? 'true' : 'false', text: label, onclick: () => { state.detail = null; state.tab = id; writeHash(); render(); window.scrollTo(0, 0); } });
  return el('header', { class: 'topbar' },
    el('div', { class: 'brand' }, el('div', { class: 'mark', 'aria-hidden': 'true' }, el('i')), el('div', { class: 'brand-txt' }, el('b', { text: 'TOKEN RADAR' }), el('span', { text: 'pre-launch intelligence' }))),
    el('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Views' }, tab('board', 'Board'), tab('live', 'Live comps'), tab('method', 'Method')),
    el('div', { class: 'top-meta' },
      el('div', null, el('b', { text: 'SNAPSHOT ' + D.meta.as_of }), el('span', { text: 'sealed input' })),
      el('div', null, el('b', { text: 'DEFILLAMA · ' + D.meta.protocols + ' PROTOCOLS' }), el('span', { text: 'fetched once' })),
      el('div', null, el('b', { text: 'RADAR-' + D.meta.model.version.split('-')[1] }), el('span', { text: 'comparables model' }))
    )
  );
}

function drawScope(canvas, rows) {
  const size = 236;
  const dpr = 2;
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(125,243,198,.13)';
  ctx.lineWidth = 1;
  for (const r of [29, 53, 77, 101, 113]) {
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.strokeStyle = i % 6 === 0 ? 'rgba(125,243,198,.16)' : 'rgba(125,243,198,.06)';
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * 30, c + Math.sin(a) * 30);
    ctx.lineTo(c + Math.cos(a) * 115, c + Math.sin(a) * 115);
    ctx.stroke();
  }
  const sweep = -0.55;
  const grad = ctx.createLinearGradient(c, c, c + Math.cos(sweep) * 112, c + Math.sin(sweep) * 112);
  grad.addColorStop(0, 'rgba(125,243,198,.30)');
  grad.addColorStop(1, 'rgba(125,243,198,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(c, c);
  ctx.arc(c, c, 113, sweep - 0.34, sweep, false);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(125,243,198,.55)';
  ctx.beginPath();
  ctx.moveTo(c, c);
  ctx.lineTo(c + Math.cos(sweep) * 113, c + Math.sin(sweep) * 113);
  ctx.stroke();
  const n = rows.length;
  rows.forEach((r, i) => {
    const a = i * 2.399963 + 0.8;
    const rad = 26 + 86 * Math.sqrt((i + 1) / n);
    const x = c + Math.cos(a) * rad;
    const y = c + Math.sin(a) * rad;
    const isTop = i < 6;
    const sizeDot = r.watchlist ? 2.3 : 1.5;
    ctx.globalAlpha = isTop ? 1 : 0.55;
    ctx.fillStyle = color(r.category);
    ctx.beginPath();
    ctx.arc(x, y, sizeDot, 0, Math.PI * 2);
    ctx.fill();
    if (isTop) {
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(125,243,198,.9)';
  ctx.beginPath();
  ctx.arc(c, c, 3, 0, Math.PI * 2);
  ctx.fill();
}

function rail() {
  const rows = D.rows;
  const tvl = rows.reduce((a, r) => a + r.tvl_usd, 0);
  const canvas = el('canvas', { class: 'scope', 'aria-label': 'Radar plot: one dot per ranked protocol; closer to the centre is a higher rank.' });
  const catRows = D.categories.filter((c) => c.board_n > 0).slice(0, 7);
  const maxMult = Math.max(...catRows.map((c) => c.peer_multiple), 0.5);
  return el('aside', { class: 'rail' },
    el('div', { class: 'scope-wrap' }, canvas),
    el('div', { class: 'scope-tag' }, el('b', { text: D.counts.rows + ' SIGNALS' }), 'distance = rank · dot = protocol'),
    el('div', { class: 'rail-stats' },
      el('div', { class: 'rail-stat' }, el('span', { text: 'ranked' }), el('b', { text: String(D.counts.rows) })),
      el('div', { class: 'rail-stat' }, el('span', { text: 'watchlist' }), el('b', { text: D.counts.watchlist + '/' + D.counts.watchlist })),
      el('div', { class: 'rail-stat' }, el('span', { text: 'early finds' }), el('b', { text: String(D.counts.early) })),
      el('div', { class: 'rail-stat' }, el('span', { text: 'tvl covered' }), el('b', null, usd(tvl).replace('$', '$'))),
      el('div', { class: 'rail-stat' }, el('span', { text: 'screened out' }), el('b', { text: String(D.counts.screened) })),
      el('div', { class: 'rail-stat' }, el('span', { text: 'live comps' }), el('b', { text: String(D.counts.live) }))
    ),
    el('div', { class: 'rail-block' },
      el('h3', null, 'Top signals', el('span', { text: 'by implied value' })),
      rows.slice(0, 4).map((r) => el('div', { class: 'signal', onclick: () => openDetail(r.slug), title: exactUsd(r.implied_value_usd) },
        el('span', { class: 'rk', text: String(r.rank).padStart(2, '0') }),
        el('span', { class: 'sig-name' }, el('b', { text: r.name }), el('em', { text: r.category || 'Other' })),
        el('em', { class: 'sig-val', text: usd(r.implied_value_usd) })
      ))
    ),
    el('div', { class: 'rail-block' },
      el('h3', null, 'Peer multiples', el('span', { text: 'mcap / tvl' })),
      catRows.slice(0, 4).map((c) => el('div', { class: 'mult-row', onclick: () => { state.category = c.name; state.detail = null; writeHash(); render(); }, title: c.comps_n + ' live comps · ' + c.source },
        el('span', { text: c.name }),
        el('span', { class: 'bar' }, el('i', { style: 'width:' + Math.max(3, Math.round((c.peer_multiple / maxMult) * 100)) + '%' })),
        el('b', { text: mult(c.peer_multiple) })
      ))
    )
  );
}

function filterBar() {
  const cats = [...new Set(D.rows.map((r) => r.category || 'Other'))].sort();
  const chainCount = new Map();
  for (const r of D.rows) for (const ch of r.chains || []) chainCount.set(ch, (chainCount.get(ch) || 0) + 1);
  const chains = [...chainCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map((x) => x[0]).sort();
  const q = el('input', { id: 'q', type: 'search', value: state.q, placeholder: 'Search protocol, slug, category or chain', 'aria-label': 'Search' });
  q.addEventListener('input', () => { state.q = q.value; writeHash(); render(); });
  const cat = el('select', { id: 'category', 'aria-label': 'Category' }, el('option', { value: 'all', text: 'All categories' }),
    cats.map((c) => el('option', { value: c, text: c, selected: state.category === c })));
  cat.addEventListener('change', () => { state.category = cat.value; writeHash(); render(); });
  const chain = el('select', { id: 'chain', 'aria-label': 'Chain' }, el('option', { value: 'all', text: 'All chains' }),
    chains.map((c) => el('option', { value: c, text: c, selected: state.chain === c })));
  chain.addEventListener('change', () => { state.chain = chain.value; writeHash(); render(); });
  const watch = el('button', { class: 'toggle', type: 'button', 'aria-pressed': state.watch, text: 'watchlist only', onclick: () => { state.watch = !state.watch; writeHash(); render(); } });
  const reset = activeFilters().length ? el('button', { class: 'toggle mint', type: 'button', text: 'clear', onclick: resetFilters }) : null;
  const count = filtered().length;
  return el('div', { class: 'filterbar' },
    el('div', { class: 'field' }, el('label', { text: 'search' }), q),
    el('div', { class: 'field' }, el('label', { text: 'category' }), cat),
    el('div', { class: 'field' }, el('label', { text: 'chain' }), chain),
    watch,
    reset,
    el('span', { class: 'filter-count' }, el('b', { text: count }), ' of ' + D.rows.length + ' rows')
  );
}

function resetFilters() {
  state.q = '';
  state.category = 'all';
  state.chain = 'all';
  state.watch = false;
  state.sort = 'implied';
  state.dir = -1;
  state.detail = null;
  writeHash();
  render();
}

function chips() {
  const fs = activeFilters();
  if (!fs.length) return null;
  return el('div', { class: 'chips' }, fs.map((f) => el('span', { class: 'chip' },
    f.label + ': ', el('b', { text: f.value }),
    el('button', { type: 'button', 'aria-label': 'Remove ' + f.label, text: '×', onclick: () => {
      if (f.k === 'q') state.q = '';
      if (f.k === 'category') state.category = 'all';
      if (f.k === 'chain') state.chain = 'all';
      if (f.k === 'watch') state.watch = false;
      writeHash();
      render();
    } })
  )));
}

function sortTh(key, label, right) {
  const on = state.sort === key;
  return el('th', { class: right ? 'num' : null, 'aria-sort': on ? (state.dir < 0 ? 'descending' : 'ascending') : 'none' },
    el('button', { type: 'button', onclick: () => {
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = -1; }
      writeHash();
      render();
    } }, el('span', { class: on ? 'on' : '', text: label }), el('span', { text: on ? (state.dir < 0 ? '↓' : '↑') : '' }))
  );
}

function table(rows) {
  const tbody = el('tbody');
  const max = Math.max(...rows.map((r) => r.implied_value_usd), 1);
  rows.forEach((r) => {
    const tr = el('tr', { tabindex: '0', 'data-selected': state.detail === r.slug, onclick: () => openDetail(r.slug), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
      el('td', { class: 'c-rank' }, el('span', { class: 'rank ' + (r.rank === 1 ? 'p1' : r.rank <= 3 ? 'top' : ''), text: String(r.rank).padStart(2, '0') })),
      el('td', { class: 'c-proto' }, el('div', { class: 'proto' },
        el('div', { class: 'proto-line' }, el('b', { text: r.name }), r.watchlist ? el('span', { class: 'flag w', text: 'W' }) : r.off_list ? el('span', { class: 'flag o', text: 'OFF' }) : null),
        el('span', { text: r.slug + ' · ' + ((r.chains || []).slice(0, 3).join(' / ') || 'chain n/a') })
      )),
      el('td', { class: 'c-cat' }, el('span', { class: 'cat' }, el('i', { class: 'dot', style: 'color:' + color(r.category) + ';background:' + color(r.category) }), el('span', { text: r.category || 'Other' }))),
      el('td', { class: 'c-tvl num', text: usd(r.tvl_usd) }),
      el('td', { class: 'c-grow num ' + cls(r.change_7d), text: pct(r.change_7d) }),
      el('td', { class: 'c-age num', text: age(r.age_days) }),
      el('td', { class: 'c-peer num', text: mult(r.peer.multiple) }),
      el('td', { class: 'c-val' }, el('div', { class: 'val' },
        el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.max(3, Math.round(Math.sqrt(r.implied_value_usd / max) * 100)) + '%' })),
        el('b', { text: usd(r.implied_value_usd) })
      )),
      el('td', { class: 'c-conf' }, el('span', { class: 'conf ' + r.confidence_label, text: String(r.confidence) }))
    );
    tbody.append(tr);
  });
  return el('div', { class: 'tablecard' }, el('div', { class: 'table-wrap' },
    el('table', null,
      el('colgroup', null,
        el('col', { style: 'width:50px' }), el('col'), el('col', { style: 'width:146px' }), el('col', { style: 'width:82px' }),
        el('col', { style: 'width:66px' }), el('col', { style: 'width:58px' }), el('col', { style: 'width:76px' }),
        el('col', { style: 'width:156px' }), el('col', { style: 'width:50px' })
      ),
      el('thead', null, el('tr', null,
        sortTh('implied', 'Rank'), sortTh('name', 'Protocol'), sortTh('category', 'Category'), sortTh('tvl', 'TVL', true),
        sortTh('growth', '7d', true), sortTh('age', 'Age', true), sortTh('peer', 'Peer', true), sortTh('implied', 'Implied value', true), sortTh('conf', 'Conf', true)
      )),
      tbody
    )
  ));
}

function boardView() {
  const rows = sorted(filtered());
  const head = el('div', { class: 'page-head' },
    el('div', null,
      el('p', { class: 'kicker', text: 'THE BOARD · ' + D.meta.as_of }),
      el('h1', null, 'Every pre-token protocol,', el('br'), el('em', { text: 'priced against the market.' })),
      el('p', { class: 'lede' }, el('b', { text: String(D.counts.rows) }), ' protocols: the ', el('b', { text: D.counts.watchlist + '-protocol watchlist' }),
        ' plus ', el('b', { text: String(D.counts.early) }), ' below-floor finds that pass the same product screen. Implied value = TVL × peer mcap/TVL × momentum × maturity × chain breadth; ',
        el('b', { text: D.counts.live + ' live-token protocols' }), ' calibrate the peer multiple. No name is hand-picked.')
    ),
    el('div', { class: 'head-stat' }, el('b', { text: String(D.counts.rows) }), el('span', { text: 'ranked by implied value' }))
  );
  const main = el('main', { class: 'main' }, head, filterBar(), chips(), table(rows),
    el('div', { class: 'foot' },
      el('span', null, el('b', { text: 'SOURCE' }), ' ' + D.meta.source.replace('DefiLlama ', 'DefiLlama · ')),
      el('span', null, el('b', { text: 'MODEL' }), ' ' + D.meta.model.version + ' · peer median shrunk to the market · band and confidence shown per row')
    )
  );
  const shell = el('div', { class: 'shell' }, rail(), main);
  const canvas = shell.querySelector('canvas');
  drawScope(canvas, D.rows);
  return shell;
}

function factorRow(label, note, value, raw, max) {
  return el('div', { class: 'factor' },
    el('span', null, label, ' ', el('b', { text: note })),
    el('div', { class: 'track' }, el('i', { style: 'width:' + Math.max(3, Math.min(100, Math.round((raw / max) * 100))) + '%' })),
    el('b', { text: value })
  );
}

function detailView(row) {
  const band = usd(row.band_low_usd) + ' – ' + usd(row.band_high_usd);
  const rc = rebuildFromLive ? rebuildFromLive(row, D.live).implied : rebuildValue(row);
  const compWord = row.peer.n === 1 ? 'comp' : 'comps';
  const peerNote = row.peer.source === 'category'
    ? row.peer.n + ' live ' + compWord + ' in category'
    : row.peer.source === 'family'
      ? row.peer.n + ' live ' + compWord + ' in family'
      : row.peer.n + ' live ' + compWord + ' market-wide';
  const m = row.model;
  const hero = el('div', { class: 'detail-hero' },
    el('div', null,
      el('p', { class: 'kicker', text: 'RANK ' + String(row.rank).padStart(2, '0') + ' / ' + D.counts.rows + ' · ' + (row.category || 'Other').toUpperCase() }),
      el('h1', { text: row.name }),
      el('p', { class: 'chains', text: (row.chains || []).join(' · ') || 'chain not recorded' }),
      el('div', { class: 'badges' },
        row.watchlist ? el('span', { class: 'badge w', text: 'house watchlist' }) : el('span', { class: 'badge', text: row.off_list ? 'off-list · parent record not carried' : 'below the floor' }),
        el('span', { class: 'badge mint', text: 'records no token' }),
        el('span', { class: 'badge', text: age(row.age_days) + ' with no token' }),
        el('span', { class: 'badge', text: (row.chains || []).length + ' chains' })
      )
    ),
    el('div', { class: 'hero-value' },
      el('span', { text: 'implied launch value' }),
      el('b', { text: usd(row.implied_value_usd) }),
      el('em', { text: 'band ' + band + ' · confidence ' + row.confidence + '/100' })
    )
  );
  const model = el('section', { class: 'card' },
    el('h2', { text: 'How the number is built' }),
    el('p', { class: 'sub', text: 'Every row runs the same five-input function. Inputs below are the snapshot\'s own record for this protocol.' }),
    factorRow('TVL', usd(row.tvl_usd), usd(row.tvl_usd), Math.log10(row.tvl_usd), Math.log10(15e9)),
    factorRow('Peer mcap/TVL', peerNote, mult(row.peer.multiple), Math.min(m.peer_multiple, 1.2), 1.2),
    factorRow('7d momentum', pct(row.change_7d), signedMult(m.momentum_multiplier), Math.min(m.momentum_multiplier, 1.4), 1.4),
    factorRow('Maturity', age(row.age_days), signedMult(m.maturity_multiplier), Math.min(m.maturity_multiplier, 1.2), 1.2),
    factorRow('Chain breadth', (row.chains || []).length + ' chains', signedMult(m.breadth_multiplier), Math.min(m.breadth_multiplier, 1.2), 1.2),
    el('div', { class: 'formula' }, usd(row.tvl_usd), ' × ', m.peer_multiple.toFixed(3), ' peer × ', m.momentum_multiplier.toFixed(3), ' momentum × ',
      m.maturity_multiplier.toFixed(3), ' maturity × ', m.breadth_multiplier.toFixed(3), ' breadth = ', el('b', { text: usd(row.implied_value_usd) })),
    el('p', { class: 'verify' }, 'Rebuilt from the ', el('b', { text: String(D.meta.live_size) }), ' live comps in data.js: ', el('b', { text: usd(rc) }), rc === row.implied_value_usd ? ' — exact match with board.json.' : ' — mismatch: stale data.')
  );
  const comps = el('section', { class: 'card' },
    el('h2', { text: 'Comparable live tokens' }),
    el('p', { class: 'sub', text: 'Nearest live-token protocols in ' + (row.category || 'the market') + ', by TVL. This row is priced by the ' + (row.peer.source === 'category' ? 'category' : row.peer.source === 'family' ? 'family' : 'market') + ' median.' }),
    el('table', { class: 'comps' },
      el('thead', null, el('tr', null, el('th', { text: 'Protocol' }), el('th', { class: 'num', text: 'Mcap' }), el('th', { class: 'num', text: 'M/TVL' }))),
      el('tbody', null, row.comps.length ? row.comps.map((c) => el('tr', null,
        el('td', { class: 'n', text: c.name, title: c.slug }),
        el('td', { class: 'num', text: usd(c.mcap_usd) }),
        el('td', { class: 'm', text: mult(c.multiple) })
      )) : el('tr', null, el('td', { colspan: '3', class: 'mini-note', text: 'No live-token comp in this category; the market-wide median applies.' })))
    ),
    el('p', { class: 'mini-note', text: 'Multiples are market cap ÷ TVL, one observation per live protocol. A category with 2+ comps uses its own median; a thinner category borrows its family median, then the market median, each shrunk toward the market with a 5-observation prior.' })
  );
  const brief = el('section', { class: 'card' },
    el('h2', { text: 'Position brief' }),
    el('p', { class: 'sub', text: 'The plan in four numbers, before the step-by-step.' }),
    el('div', { class: 'brief' },
      el('div', null, el('span', { text: 'capital' }), el('b', { text: '$' + row.farm.capital_usd })),
      el('div', null, el('span', { text: 'hold to qualify' }), el('b', { text: row.farm.hold_days + ' days' })),
      el('div', null, el('span', { text: 'cadence' }), el('b', { text: row.farm.cadence_weeks + ' weeks' })),
      el('div', null, el('span', { text: 'gas budget' }), el('b', { text: '~$' + row.farm.gas_budget_usd })),
      el('div', null, el('span', { text: 'time / week' }), el('b', { text: row.farm.weekly_minutes + ' min' })),
      el('div', null, el('span', { text: 'model band' }), el('b', { text: band }))
    ),
    el('p', { class: 'mini-note', text: 'Main risk: ' + row.farm.risk + '. This is a farm plan for a protocol whose token is not recorded — not a promise that one launches.' })
  );
  const farm = el('section', { class: 'card farm-card' },
    el('h2', { text: 'Farm plan · ' + row.farm.steps.length + ' steps' }),
    el('p', { class: 'sub', text: '$' + row.farm.capital_usd + ' capital · ' + row.farm.cadence_weeks + ' weekly actions · ' + row.farm.hold_days + ' days to qualify · derived from ' + (row.category || 'category') + ', ' + (row.chains[0] || 'chain') + ' gas and listing age.' }),
    el('ol', { class: 'steps' }, row.farm.steps.map((s) => {
      const at = s.indexOf(' Cost: ');
      const action = at >= 0 ? s.slice(0, at) : s;
      const tail = at >= 0 ? s.slice(at + 7) : '';
      const tm = tail.indexOf('. Time: ');
      const cost = tm >= 0 ? tail.slice(0, tm) : tail;
      const time = tm >= 0 ? tail.slice(tm + 8).replace(/\.$/, '') : '';
      return el('li', null, action, cost ? el('span', { class: 'cost' }, el('br'), el('b', { text: 'Cost' }), ' ' + cost + (time ? ' · ' + time : '')) : null);
    }))
  );
  return el('main', { class: 'detail' },
    el('button', { class: 'back', type: 'button', text: '← Back to the board', onclick: () => { state.detail = null; writeHash(); render(); window.scrollTo(0, 0); } }),
    hero,
    el('div', { class: 'detail-grid' }, model, comps, farm, brief)
  );
}

function liveView() {
  const rows = D.live;
  const cats = D.categories.filter((c) => c.live_n > 0).sort((a, b) => b.peer_multiple - a.peer_multiple).slice(0, 12);
  const max = Math.max(...cats.map((c) => c.peer_multiple), 0.5);
  const head = el('div', { class: 'page-head' },
    el('div', null,
      el('p', { class: 'kicker', text: 'LIVE COMPS · THE MARKET\'S OWN MULTIPLES' }),
      el('h1', null, 'The tokens that', el('br'), el('em', { text: 'already price the market.' })),
      el('p', { class: 'lede' }, 'These ', el('b', { text: String(D.meta.live_size) }), ' protocols already trade and report a market cap. Their market cap ÷ TVL anchors the board, and they are never mixed into the pre-token ranking. Global median: ',
        el('b', { text: mult(D.meta.global_peer_multiple) }), ' across ', el('b', { text: String(D.meta.global_comps_n) }), ' observations.')
    ),
    el('div', { class: 'head-stat' }, el('b', { text: mult(D.meta.global_peer_multiple) }), el('span', { text: 'median mcap / tvl' }))
  );
  const tbody = el('tbody');
  rows.forEach((r, i) => {
    tbody.append(el('tr', null,
      el('td', { class: 'c-rank' }, el('span', { class: 'rank', text: String(i + 1).padStart(2, '0') })),
      el('td', { class: 'c-proto' }, el('div', { class: 'proto' }, el('b', { text: r.name }), el('span', { text: r.slug + ' · ' + (r.chains || []).slice(0, 3).join(' / ') }))),
      el('td', { class: 'c-cat' }, el('span', { class: 'cat' }, el('i', { class: 'dot', style: 'color:' + color(r.category) + ';background:' + color(r.category) }), el('span', { text: r.category || 'Other' }))),
      el('td', { class: 'c-tvl num', text: usd(r.tvl_usd) }),
      el('td', { class: 'c-tvl num', text: usd(r.mcap_usd) }),
      el('td', { class: 'c-grow num ' + cls(r.change_7d), text: pct(r.change_7d) }),
      el('td', { class: 'c-peer num', text: mult(r.multiple) })
    ));
  });
  const main = el('main', { class: 'main' }, head,
    el('div', { class: 'grid2' },
      el('div', { class: 'tablecard' }, el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { text: '' }), el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: 'Market cap' }), el('th', { class: 'num', text: '7d' }), el('th', { class: 'num', text: 'M/TVL' }))),
          tbody
        )
      )),
      el('div', { class: 'card catbars' },
        el('h2', { text: 'Calibration by category' }),
        el('p', { class: 'sub', text: 'Median mcap/TVL among live protocols, with the sample the board uses.' }),
        cats.map((c) => el('div', { class: 'mult-row', onclick: () => { state.category = c.name; state.tab = 'board'; writeHash(); render(); } },
          el('span', { text: c.name }),
          el('span', { class: 'bar' }, el('i', { style: 'width:' + Math.max(3, Math.round((c.peer_multiple / max) * 100)) + '%' })),
          el('b', { text: mult(c.peer_multiple) }),
          el('span', { class: 'num', text: c.comps_n + 'n' })
        )),
        el('p', { class: 'panel-note', text: 'The board shrinks a thin category toward its family and then the market median, so one outlier cannot price a whole sector. The full screened-out record is on the board rail.' })
      )
    )
  );
  return main;
}

function methodView() {
  const c = D.categories.slice(0, 6);
  return el('main', { class: 'main' },
    el('div', { class: 'page-head' },
      el('div', null,
        el('p', { class: 'kicker', text: 'METHOD · RADAR-2' }),
        el('h1', null, 'A value model with', el('br'), el('em', { text: 'a paper trail.' }))
      ),
      el('div', { class: 'head-stat' }, el('b', { text: String(D.counts.screened) }), el('span', { text: 'records screened out' }))
    ),
    el('div', { class: 'grid2' },
      el('div', { class: 'method-copy' },
        el('h2', { text: '1. The universe' }),
        el('p', null, 'The snapshot holds ', el('b', { text: String(D.meta.protocols) }), ' protocols at or above $5M TVL. ', el('b', { text: String(D.meta.pre_token_size) }),
          ' record no token at all. The board starts with the house watchlist (', el('b', { text: String(D.counts.watchlist) }), ' protocols), then adds every below-floor protocol that passes the same product screen, giving ',
          el('b', { text: String(D.counts.early) }), ' early rows. Products of a token that already trades — CEX, wrapped, staked, bridged, versioned pools — are screened out (', el('b', { text: String(D.counts.screened) }), ' records) and listed separately, never ranked.'),
        el('h2', { text: '2. The peer multiple' }),
        el('p', null, 'For every live-token protocol with a market cap, mcap ÷ TVL is one comparable. A category with at least two observations uses its own median; a thinner category borrows its family median; anything thinner uses the market median (',
          el('b', { text: mult(D.meta.global_peer_multiple) }), '). Every estimate is shrunk toward the market with a five-observation prior, so a single 400× outlier cannot set the price.'),
        el('h2', { text: '3. The score' }),
        el('p', null, 'Implied value = TVL × peer multiple × momentum × maturity × chain breadth. Momentum is the seven-day TVL change, capped at −60% and +120%, weighted 0.30. Maturity rewards time listed without a token, from 0.70 at launch to 1.15 at six years. Breadth adds 3% per chain, capped at six chains. No protocol name appears in the model.'),
        el('h2', { text: '4. What the page shows' }),
        el('p', null, 'Each row carries its inputs, not just its output: TVL, seven-day change, listing age, peer multiple, the four multipliers, a model band and a confidence score. The detail view re-runs the same arithmetic in the browser and checks it against board.json. The farm plan is derived from category, chain, TVL and age — capital, cadence, hold period, gas budget and risk all follow from the record.'),
        el('h2', { text: '5. Limits' }),
        el('p', null, 'This is an implied value, not a promise of a token or a price. DefiLlama does not carry parentProtocol in this snapshot, so an off-list protocol may be a sub-protocol whose parent is not visible; those rows are marked OFF. TVL is not revenue, and a seven-day move is noisy. The band and confidence are there to be read, not ignored.')
      ),
      el('div', null,
        el('div', { class: 'card' },
          el('h2', { text: 'Model constants' }),
          el('p', { class: 'sub', text: 'Visible in dashboard/model.js and reproducible in the page.' }),
          el('div', { class: 'formula' },
            'implied = round( tvl × peer × (1 + clamp(7d, ', String(MODEL.momentum_floor), ', ', String(MODEL.momentum_cap), ') / 100 × ', String(MODEL.momentum_weight), ') × (',
            String(MODEL.maturity_floor), ' + min(age, ', String(MODEL.maturity_days), ') / ', String(MODEL.maturity_days), ' × ', String(MODEL.maturity_range), ') × (1 + min(chains, ', String(MODEL.breadth_cap), ') × ', String(MODEL.breadth_step), ') )'
          ),
          el('div', { class: 'brief', style: 'margin-top:12px' },
            el('div', null, el('span', { text: 'prior weight' }), el('b', { text: MODEL.prior_weight + ' obs' })),
            el('div', null, el('span', { text: 'min comp TVL' }), el('b', { text: '$5M' })),
            el('div', null, el('span', { text: 'implied cap' }), el('b', { text: '$100B' })),
            el('div', null, el('span', { text: 'unknown age' }), el('b', { text: MODEL.unknown_age_days + 'd' }))
          )
        ),
        el('div', { class: 'card catbars', style: 'margin-top:14px' },
          el('h2', { text: 'The calibration set' }),
          el('p', { class: 'sub', text: 'Top categories by ranked rows; the full table is on the live view.' }),
          c.map((x) => el('div', { class: 'mult-row' },
            el('span', { text: x.name }),
            el('span', { class: 'bar' }, el('i', { style: 'width:' + Math.min(100, Math.round((x.peer_multiple / 0.6) * 100)) + '%' })),
            el('b', { text: mult(x.peer_multiple) }),
            el('span', { class: 'num', text: x.comps_n + 'n' })
          )),
          el('p', { class: 'panel-note', text: 'Snapshot ' + D.meta.as_of + ' · ' + D.meta.source })
        )
      )
    ),
    el('div', { class: 'foot' }, el('span', null, el('b', { text: 'REPRODUCE' }), ' node main.ts --input snapshot.json --output out'), el('span', null, el('b', { text: 'NO NETWORK' }), ' every byte is in data.js'))
  );
}

function openDetail(slug) {
  state.detail = slug;
  writeHash();
  render();
  window.scrollTo(0, 0);
}

function render() {
  if (!D) {
    app.textContent = 'data.js is missing: run main.ts first.';
    return;
  }
  const active = document.activeElement;
  const focusId = active && active.id ? active.id : null;
  const caret = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
  const row = state.detail ? D.rows.find((r) => r.slug === state.detail) : null;
  app.textContent = '';
  app.append(topbar());
  if (row) app.append(detailView(row));
  else if (state.tab === 'live') app.append(liveView());
  else if (state.tab === 'method') app.append(methodView());
  else app.append(boardView());
  app.setAttribute('aria-busy', 'false');
  if (focusId) {
    const next = document.getElementById(focusId);
    if (next) {
      next.focus({ preventScroll: true });
      if (caret !== null && typeof next.setSelectionRange === 'function') next.setSelectionRange(caret, caret);
    }
  }
}

readHash();
render();
window.addEventListener('hashchange', () => { readHash(); render(); });
