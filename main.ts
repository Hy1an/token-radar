// token-radar-01 entry: read the sealed snapshot, run the Radar-2 model, write the board.
//
// Node 22+ runs this file directly. Outside the grader's container, point it at the kit:
//   mkdir out; node main.ts --input ../token-radar-01-kit/input/snapshot.json --output out
//
// The model lives in dashboard/model.js, because the page imports the same file and rebuilds every
// implied value from the row's own inputs. One source of truth, visible in the dossier's source text.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);
const { buildRadar, isPreToken } = require('./dashboard/model.js') as {
  buildRadar: (snapshot: unknown) => { board: any[]; radar: any };
  isPreToken: (p: { mcap_usd: number | null; gecko_id: string | null; symbol: string | null }) => boolean;
};
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

function parseSnapshot(text: string): { as_of: string; source: string; floor_usd: number; protocols: Protocol[]; watchlist: string[] } {
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('snapshot is not an object');
  if (typeof raw.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.as_of)) throw new Error('snapshot has no as_of');
  if (typeof raw.source !== 'string') throw new Error('snapshot has no source');
  if (typeof raw.floor_usd !== 'number') throw new Error('snapshot has no floor_usd');
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) throw new Error('snapshot has no protocols or watchlist');
  const protocols = (raw.protocols as Record<string, unknown>[]).map((p, i) => {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') throw new Error(`protocol ${i} lacks slug/name/tvl`);
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? (p.chains as unknown[]).filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: raw.as_of, source: raw.source, floor_usd: raw.floor_usd, protocols, watchlist: raw.watchlist as string[] };
}

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);

// Pre-flight the gate's board rules here, so a bad run fails before it writes a dossier.
function boardIssue(rows: typeof board): string | null {
  if (rows.length < 100 || rows.length > 4000) return `board has ${rows.length} rows (100 to 4000)`;
  const slugs = new Set<string>();
  for (const r of rows) {
    if (slugs.has(r.slug)) return `duplicate slug ${r.slug}`;
    slugs.add(r.slug);
    if (!snapshot.protocols.some((p) => p.slug === r.slug)) return `unknown slug ${r.slug}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `bad implied value for ${r.slug}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} chars`;
    }
  }
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.rank !== i + 1) return `rank ${i + 1} is ${rows[i]!.rank}`;
    if (i > 0 && rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
  }
  if (rows.length > 1 && rows[0]!.implied_value_usd === rows[rows.length - 1]!.implied_value_usd) return 'all implied values are equal';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length) return `missing watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  return null;
}

const issue = boardIssue(board);
if (issue) {
  process.stderr.write(`token radar: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), `window.RADAR=${JSON.stringify(radar)};\n`);

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length}; hand in 3 or 4\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: bad screenshot name ${name}\n`);
    process.exit(1);
  }
}

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const pre = snapshot.protocols.filter(isPreToken).length;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${pre} pre-token, ${snapshot.watchlist.length} watchlist, ${board.length} ranked (${radar.counts.early} early), ${radar.counts.screened} screened out, ${radar.counts.live} live comps\n` +
    `token radar: top ${board.slice(0, 3).map((r) => `${r.name} $${r.implied_value_usd}`).join(' | ')}\n` +
    `token radar: wrote ${join(out, 'board.json')}, data.js, dashboard/, screenshots/ and dossier.json\n`,
);
