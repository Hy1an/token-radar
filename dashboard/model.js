// Radar-2: the value model, the screen and the farm planner, in one file.
//
// main.ts runs these functions on /input/snapshot.json to write /output/board.json and data.js.
// The page imports rebuildValue() and farmPlanOf() from this same file, so the number a reader sees
// is recomputed in the browser from the row's own snapshot inputs. No protocol name is special-cased:
// the model only reads TVL, seven-day change, listing age, chains and category, and its peer
// multiples are calibrated from the snapshot's own live-token protocols.

// One file, two runtimes: main.ts require()s it in Node, and index.html loads it as a classic script.
(function (root) {
'use strict';

const MODEL = {
  version: 'radar-2',
  prior_weight: 5,
  momentum_weight: 0.3,
  momentum_floor: -60,
  momentum_cap: 120,
  maturity_floor: 0.7,
  maturity_range: 0.45,
  maturity_days: 2190,
  unknown_age_days: 365,
  breadth_step: 0.03,
  breadth_cap: 6,
  min_comp_tvl: 5_000_000,
  max_implied_usd: 100_000_000_000,
  early_min_tvl: 5_000_000,
};

const DAY_MS = 86_400_000;
const round = (n) => Math.round(n);
const r4 = (n) => Math.round(n * 1e4) / 1e4;

function ageDays(asOf, listedAt) {
  if (!listedAt) return null;
  const a = Date.parse(asOf + 'T00:00:00Z');
  const b = Date.parse(listedAt + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

function isPreToken(p) {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

// The house's product screen, applied to the whole universe: a wrapped, staked, bridged,
// versioned or exchange-run record is not a protocol still waiting on its own token.
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_WORDS = /\b(wrapped|staked|staking)\b/i;
const EXCHANGES = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const PRODUCT_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

function screenReason(p) {
  if (!isPreToken(p)) return null;
  if (p.category === 'CEX') return 'Exchange-run record';
  if (PRODUCT_CATEGORIES.has(p.category)) return 'Wrapped / staked / bridged product';
  if (VERSIONED.test(p.name)) return 'Versioned pool of another protocol';
  if (PRODUCT_WORDS.test(p.name)) return 'Wrapped / staked product';
  if (EXCHANGES.test(p.name)) return 'Exchange product';
  return null;
}

// Category families: sparse categories borrow a prior from their closest siblings. This is a
// taxonomy, not a name list: every protocol in a category is treated identically.
function familyOf(category) {
  const c = (category || '').toLowerCase();
  if (!c) return 'Other';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('credit')) return 'Lending & credit';
  if (c.includes('dex') || c.includes('yield') || c.includes('farm') || c.includes('liquidity')) return 'DEX & yield';
  if (c.includes('bridge')) return 'Bridges';
  if (c.includes('staking') || c.includes('restak')) return 'Staking';
  if (c.includes('rwa') || c.includes('real world') || c.includes('index')) return 'RWA & index';
  if (c.includes('derivative') || c.includes('basis') || c.includes('perpetual') || c.includes('option') || c.includes('synthetic') || c.includes('interest rate')) return 'Derivatives';
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault') || c.includes('governance')) return 'Asset management';
  if (c.includes('chain') || c.includes('payments') || c.includes('privacy')) return 'Infrastructure';
  if (c.includes('stable')) return 'Stablecoins';
  if (c.includes('insurance')) return 'Insurance';
  if (c.includes('prediction')) return 'Prediction markets';
  if (c.includes('cex') || c.includes('cedefi')) return 'CeFi';
  return 'Other';
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(values, q) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor((s.length - 1) * q)))];
}

// One bucket of live-token comparables: the snapshot's protocols whose token already trades.
function bucket(list) {
  const multiples = list.map((p) => p.mcap_usd / p.tvl_usd).filter((m) => Number.isFinite(m) && m > 0);
  return {
    n: multiples.length,
    median: median(multiples),
    p25: quantile(multiples, 0.25),
    p75: quantile(multiples, 0.75),
    members: list,
  };
}

// Peer calibration: every live protocol with a market cap and TVL contributes one mcap/TVL
// multiple. A category with a thin sample is shrunk toward its family, then toward the whole
// market, with the prior weighted at MODEL.prior_weight observations.
function peerTables(protocols) {
  const live = protocols.filter((p) => !isPreToken(p) && p.mcap_usd > 0 && p.tvl_usd >= MODEL.min_comp_tvl);
  const global = bucket(live);
  const categories = new Map();
  const families = new Map();
  for (const p of live) {
    const c = p.category || 'Other';
    const f = familyOf(p.category);
    if (!categories.has(c)) categories.set(c, []);
    if (!families.has(f)) families.set(f, []);
    categories.get(c).push(p);
    families.get(f).push(p);
  }
  const globalMedian = global.median ?? 0.2;
  const blend = (b) => (b.n > 0 ? (b.n * b.median + MODEL.prior_weight * globalMedian) / (b.n + MODEL.prior_weight) : globalMedian);
  const catStats = new Map();
  for (const [name, list] of categories) {
    const b = bucket(list);
    const f = families.get(familyOf(name));
    const fb = bucket(f);
    let source = 'global';
    let multiple = globalMedian;
    let n = b.n;
    if (b.n >= 2) {
      source = 'category';
      multiple = blend(b);
    } else if (fb.n >= 2) {
      source = 'family';
      multiple = blend(fb);
      n = fb.n;
    }
    catStats.set(name, {
      name,
      family: familyOf(name),
      n,
      category_n: b.n,
      family_n: fb.n,
      source,
      multiple,
      p25: b.p25,
      p75: b.p75,
      median: b.median,
      members: b.members,
    });
  }
  return { global, globalMedian, families, categories: catStats, live };
}

function peerFor(category, tables) {
  return tables.categories.get(category || 'Other') || {
    name: category || 'Other',
    family: familyOf(category),
    n: 0,
    category_n: 0,
    family_n: 0,
    source: 'global',
    multiple: tables.globalMedian,
    p25: tables.global.p25,
    p75: tables.global.p75,
  };
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

// The model, in one place. Every multiplier is a function of one snapshot field.
function scoreProtocol(p, asOf, tables) {
  const age = ageDays(asOf, p.listed_at);
  const peer = peerFor(p.category, tables);
  const growth = clamp(typeof p.change_7d === 'number' ? p.change_7d : 0, MODEL.momentum_floor, MODEL.momentum_cap);
  const momentum = 1 + (growth / 100) * MODEL.momentum_weight;
  const ageForModel = age === null ? MODEL.unknown_age_days : age;
  const maturity = MODEL.maturity_floor + (Math.min(ageForModel, MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
  const breadth = 1 + Math.min(p.chains.length, MODEL.breadth_cap) * MODEL.breadth_step;
  const raw = p.tvl_usd * peer.multiple * momentum * maturity * breadth;
  const implied = Math.max(1, Math.min(MODEL.max_implied_usd, round(raw)));

  let confidence = 30;
  confidence += Math.min(peer.n, 10) * 2.5;
  if (age !== null) confidence += 10;
  if (age !== null && age >= 365) confidence += 10;
  if (p.tvl_usd >= 1_000_000_000) confidence += 15;
  else if (p.tvl_usd >= 100_000_000) confidence += 10;
  if (typeof p.change_7d === 'number') confidence += 5;
  if (p.chains.length >= 2) confidence += 5;
  confidence = Math.round(clamp(confidence, 5, 95));
  const spread = 0.55 - (0.3 * (confidence - 5)) / 90;

  return {
    age,
    growth,
    peer,
    momentum,
    maturity,
    breadth,
    implied,
    band_low: Math.max(1, round(implied * (1 - spread))),
    band_high: Math.max(1, round(implied * (1 + spread))),
    confidence,
    confidence_label: confidence >= 70 ? 'high' : confidence >= 45 ? 'medium' : 'low',
  };
}

// Rebuild the exact number board.json carries, from the inputs the row itself states.
function rebuildValue(row) {
  const m = row.model || {};
  return Math.max(1, Math.min(MODEL.max_implied_usd, round(row.tvl_usd * m.peer_multiple * m.momentum_multiplier * m.maturity_multiplier * m.breadth_multiplier)));
}

// A second, independent path: rebuild the peer multiple from the live comps the page carries,
// then apply the model to the row's raw snapshot fields. This is the check the detail view shows.
function rebuildFromLive(row, live) {
  const tables = peerTables(live);
  const peer = peerFor(row.category, tables);
  const growth = clamp(typeof row.change_7d === 'number' ? row.change_7d : 0, MODEL.momentum_floor, MODEL.momentum_cap);
  const age = row.age_days === null || row.age_days === undefined ? MODEL.unknown_age_days : row.age_days;
  const momentum = 1 + (growth / 100) * MODEL.momentum_weight;
  const maturity = MODEL.maturity_floor + (Math.min(age, MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
  const breadth = 1 + Math.min((row.chains || []).length, MODEL.breadth_cap) * MODEL.breadth_step;
  const implied = Math.max(1, Math.min(MODEL.max_implied_usd, round(row.tvl_usd * peer.multiple * momentum * maturity * breadth)));
  return { implied, peer_multiple: peer.multiple, peer_source: peer.source, peer_n: peer.n, momentum, maturity, breadth };
}

const RISK = {
  'Lending & credit': 'liquidation risk if collateral falls or the oracle misprices',
  'DEX & yield': 'impermanent loss if the pool pair diverges',
  Bridges: 'bridge and wrapped-asset risk',
  Staking: 'slashing and receipt-token depeg risk',
  'RWA & index': 'issuer, custody and redemption risk',
  Derivatives: 'funding, margin and liquidation risk',
  'Asset management': 'curator, strategy and withdrawal-queue risk',
  Infrastructure: 'chain-liveness and canonical-bridge risk',
  Stablecoins: 'depeg and collateral risk',
  Insurance: 'counterparty and claims risk',
  'Prediction markets': 'resolution, oracle and liquidity risk',
  CeFi: 'custody and counterparty risk',
  Other: 'smart-contract and liquidity risk',
};

const GAS = {
  Ethereum: 8,
  Solana: 0.05,
  Base: 0.3,
  Arbitrum: 0.3,
  Optimism: 0.3,
  'OP Mainnet': 0.3,
  Linea: 0.4,
  Scroll: 0.4,
  Unichain: 0.3,
  Blast: 0.3,
  Binance: 0.2,
  Polygon: 0.1,
  Avalanche: 0.2,
  Tron: 1,
  Bitcoin: 3,
  Sui: 0.05,
  Aptos: 0.05,
};

function gasFor(chain) {
  return GAS[chain] ?? 1;
}

function capitalFor(p) {
  if (p.tvl_usd >= 2_000_000_000) return 250;
  if (p.tvl_usd >= 500_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdFor(age) {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function weeksFor(age) {
  if (age === null) return 6;
  if (age < 180) return 12;
  if (age < 365) return 8;
  return 6;
}

function coreAction(p, capital, chain) {
  const c = (p.category || '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${n} on ${chain}, then borrow about 25% against it in a second asset and keep both positions open.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('farm') || c.includes('liquidity')) {
    return `Add $${capital} as two-sided liquidity to ${n}'s deepest pool on ${chain}, then stake the LP receipt if the protocol offers it.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC to ${chain} through ${n} and deploy the bridged funds in the protocol's own app.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of ${chain}'s native asset through ${n} and hold the liquid receipt token.`;
  }
  if (c.includes('derivative') || c.includes('basis') || c.includes('perpetual') || c.includes('option') || c.includes('synthetic') || c.includes('interest rate')) {
    return `Deposit $${capital} of USDC as margin on ${n} (${chain}), open one small delta-neutral basis trade, and keep it open.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) {
    return `Deposit $${capital} of USDC into a ${n} curated vault on ${chain} and keep the vault shares.`;
  }
  if (c.includes('rwa')) {
    return `Mint or subscribe $${capital} of ${n}'s yield asset on ${chain} and hold the receipt in the same wallet.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of ${n}'s stable asset on ${chain} and keep the position open.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${n} on ${chain} and keep the policy active through the qualifying period.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} of USDC and place one small position on ${n} (${chain}); keep it until the market resolves.`;
  }
  if (c.includes('chain')) {
    return `Bridge $${capital} into ${chain} through its canonical route and use at least one app on the chain.`;
  }
  return `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open.`;
}

function step(text, cost, time) {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Check the protocol's own page before you act.`;
  return s;
}

// A farm plan, derived from category, chain, TVL and age: eight steps, each with cost and time.
function farmPlanOf(p, score) {
  const chain = p.chains[0] || '';
  const chainLabel = chain || "the protocol's main chain";
  const capital = capitalFor(p);
  const gas = gasFor(chain);
  const hold = holdFor(score.age);
  const weeks = weeksFor(score.age);
  const gasBudget = Math.round((gas * (2 + weeks * 2 + 4) + (chain === 'Ethereum' || chain === 'Solana' ? 0 : 8)) * 100) / 100;
  const family = familyOf(p.category);
  const steps = [
    step(`Open a dedicated wallet on ${chainLabel} for this position and never reuse the wallet that holds your main funds.`, `~$${gas} gas for the first transaction`, '5 minutes'),
    step(`Fund it with $${capital + 20} of USDC, arriving from a CEX or a route you already trust.`, chain === 'Ethereum' || chain === 'Solana' ? `~$2 in withdrawal fees` : `~$2-6 in bridge and gas fees`, chain === 'Ethereum' || chain === 'Solana' ? '15 minutes' : '15-30 minutes'),
    step(coreAction(p, capital, chainLabel), `$${capital} of capital plus ~$${gas * 2} gas`, '15 minutes to set up'),
    step(`Repeat one qualifying action every week for ${weeks} weeks — a deposit, borrow, swap, vote or claim — and never wash-trade.`, `~$${gas * 2} a week in gas`, '10 minutes a week'),
    step(`Keep the position live for at least ${hold} days so it appears in more than one snapshot.`, `$${capital} stays locked in the position`, `${hold} days`),
    step(`Check ${p.name}'s official app and docs every two weeks for points, allowlists and claim dates; never pay to be allowlisted.`, '$0', '10 minutes per check'),
    step(`Keep this position under 20% of your farm capital and set an alert for ${RISK[family] || RISK.Other}.`, '$0', '5 minutes'),
    step(`Exit by repaying the borrow or removing liquidity, bridge the proceeds back, and log wallet, dates, amounts and tx hashes.`, `~$${gas * 2} gas`, '30 minutes'),
  ];
  return {
    capital_usd: capital,
    hold_days: hold,
    cadence_weeks: weeks,
    weekly_minutes: 10,
    gas_budget_usd: gasBudget,
    time_to_qualify_days: hold,
    risk: RISK[family] || RISK.Other,
    steps,
  };
}

function compsFor(p, tables, limit = 4) {
  const peer = peerFor(p.category, tables);
  const pool = peer.members && peer.members.length ? peer.members : tables.live;
  const scored = pool
    .filter((x) => x.slug !== p.slug && x.mcap_usd > 0 && x.tvl_usd > 0)
    .map((x) => ({ x, d: Math.abs(Math.log(x.tvl_usd / p.tvl_usd)) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit);
  return scored.map(({ x }) => ({
    name: x.name,
    slug: x.slug,
    tvl_usd: x.tvl_usd,
    mcap_usd: x.mcap_usd,
    multiple: r4(x.mcap_usd / x.tvl_usd),
  }));
}

// Every protocol that records no token, minus the house's product screen. The watchlist is always
// in, even if a record would otherwise be screened; the radar adds every below-floor protocol that
// passes the same screen, so the board is the whole eligible universe, not a fixed top slice.
function buildBoard(snapshot) {
  const tables = peerTables(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const chosen = [];
  const screened = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    if (watch.has(p.slug)) {
      chosen.push(p);
      continue;
    }
    if (p.tvl_usd < MODEL.early_min_tvl) continue;
    const reason = screenReason(p);
    if (reason) screened.push({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason });
    else chosen.push(p);
  }
  const scored = chosen.map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, tables) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || b.s.confidence - a.s.confidence || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  const rows = scored.map(({ p, s }, i) => {
    const farm = farmPlanOf(p, s);
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
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
      age_days: s.age,
      implied_value_usd: s.implied,
      band_low_usd: s.band_low,
      band_high_usd: s.band_high,
      confidence: s.confidence,
      confidence_label: s.confidence_label,
      peer: {
        multiple: r4(s.peer.multiple),
        n: s.peer.n,
        category_n: s.peer.category_n,
        family_n: s.peer.family_n,
        source: s.peer.source,
        family: s.peer.family,
      },
      model: {
        version: MODEL.version,
        peer_multiple: s.peer.multiple,
        momentum_multiplier: s.momentum,
        maturity_multiplier: s.maturity,
        breadth_multiplier: s.breadth,
        growth_pct: s.growth,
        age_days: s.age,
      },
      comps: compsFor(p, tables),
      farm,
      farm_steps: farm.steps,
    };
  });
  screened.sort((a, b) => b.tvl_usd - a.tvl_usd);
  return { rows, screened, tables };
}

function categorySummary(rows, screened, tables, snapshot) {
  const map = new Map();
  const get = (c) => {
    const k = c || 'Other';
    if (!map.has(k)) {
      const peer = peerFor(k, tables);
      map.set(k, {
        name: k,
        family: peer.family,
        peer_multiple: r4(peer.multiple),
        comps_n: peer.n,
        source: peer.source,
        category_n: peer.category_n,
        family_n: peer.family_n,
        live_n: 0,
        board_n: 0,
        watchlist_n: 0,
        screened_n: 0,
        tvl_usd: 0,
      });
    }
    return map.get(k);
  };
  for (const p of snapshot.protocols) {
    if (!isPreToken(p) && p.mcap_usd > 0) get(p.category).live_n++;
  }
  for (const r of rows) {
    const c = get(r.category);
    c.board_n++;
    c.tvl_usd += r.tvl_usd;
    if (r.watchlist) c.watchlist_n++;
  }
  for (const s of screened) get(s.category).screened_n++;
  return [...map.values()]
    .filter((c) => c.board_n > 0 || c.watchlist_n > 0)
    .sort((a, b) => b.board_n - a.board_n || b.tvl_usd - a.tvl_usd);
}

function buildRadar(snapshot) {
  const { rows, screened, tables } = buildBoard(snapshot);
  const live = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd > 0)
    .sort((a, b) => b.mcap_usd - a.mcap_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: r4(p.mcap_usd / p.tvl_usd),
    }));
  const screenedCounts = {};
  for (const s of screened) screenedCounts[s.reason] = (screenedCounts[s.reason] || 0) + 1;
  const radar = {
    meta: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      model: MODEL,
      model_version: MODEL.version,
      protocols: snapshot.protocols.length,
      watchlist_size: snapshot.watchlist.length,
      pre_token_size: snapshot.protocols.filter(isPreToken).length,
      live_size: live.length,
      global_peer_multiple: r4(tables.globalMedian),
      global_comps_n: tables.global.n,
    },
    counts: {
      rows: rows.length,
      watchlist: snapshot.watchlist.length,
      early: rows.filter((r) => !r.watchlist).length,
      screened: screened.length,
      live: live.length,
    },
    screened_counts: screenedCounts,
    rows,
    live,
    screened: screened.slice(0, 120),
    categories: categorySummary(rows, screened, tables, snapshot),
  };
  return { board: rows, radar, tables };
}

const api = { MODEL, ageDays, isPreToken, screenReason, familyOf, peerTables, peerFor, scoreProtocol, rebuildValue, rebuildFromLive, farmPlanOf, buildBoard, buildRadar };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.RadarModel = api;
if (root) root.RadarModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
