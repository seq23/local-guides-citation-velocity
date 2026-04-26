const { readJson, writeJson, excerpt, sourceMap, makeSignalId, allowedSource } = require('./signal_utils');
const fs = require('fs');
const path = require('path');

const WEEKDAY_REDDIT = {
  1: 'reddit_personal_injury',
  2: 'reddit_dentistry',
  3: 'reddit_trt_hair_iv',
  4: 'reddit_neuro_eval',
  5: 'reddit_uscis_medical'
};

function loadAdapter(source) {
  const platformMap = { equestrian_forums: 'forum', google_paa: 'google_paa', serp_competitors: 'serp_competitor' };
  const name = platformMap[source.platform] || source.platform;
  const adapterFile = path.resolve(process.cwd(), 'scripts/community/adapters', `${name}_adapter.js`);
  if (fs.existsSync(adapterFile)) return require(adapterFile);
  return null;
}

function manualImports() {
  const sourceByKey = sourceMap();
  const manual = readJson('data/community/manual_import.json', { imports: [] });
  return (manual.imports || []).filter((item) => item.source_url && item.title && item.source_key).map((item, idx) => {
    const source = sourceByKey.get(item.source_key) || {};
    return {
      signal_id: item.signal_id || makeSignalId(item.source_key, `${item.title}:${item.source_url}`, idx),
      platform: source.platform || item.platform || 'manual',
      source_key: item.source_key,
      source_url: item.source_url,
      retrieval_mode: item.retrieval_mode || 'manual',
      captured_at: item.captured_at || new Date().toISOString().slice(0, 10),
      raw_title: excerpt(item.title, 220),
      short_excerpt: excerpt(item.short_excerpt || item.title, 300),
      engagement: item.engagement || { score: 0, comments: 0 },
      privacy_status: 'public',
      rights_status: 'metadata_and_short_excerpt_only',
      status: 'raw'
    };
  });
}

function identity(signal) { return `${signal.source_key || ''}|${signal.source_url || ''}|${signal.raw_title || ''}`.toLowerCase(); }
function redditSourceForToday(date = new Date()) { return WEEKDAY_REDDIT[date.getUTCDay()] || null; }
function selectSources(sources) {
  const active = (sources || []).filter(allowedSource);
  const forced = process.env.REDDIT_SOURCE_KEY || '';
  const todayReddit = forced || redditSourceForToday();
  return active.filter((source) => {
    if (source.platform !== 'reddit') return true;
    if (process.env.REDDIT_ROTATION_DISABLED === '1') return true;
    return source.source_key === todayReddit;
  }).slice(0, Number(process.env.SIGNAL_SOURCE_LIMIT || 0) || undefined);
}
function summarizeFetchEvents(sourceKey) {
  const events = (global.__SIGNAL_FETCH_EVENTS || []).filter((e) => e.source_key === sourceKey);
  const bad = events.filter((e) => e.status !== 'ok');
  const worst = bad.find((e) => e.http_status === 403) || bad.find((e) => e.http_status === 429) || bad[0];
  return { events, bad, worst };
}
async function collectSource(source) {
  const adapter = loadAdapter(source);
  if (!adapter || typeof adapter.collect !== 'function') return { source_key: source.source_key, platform: source.platform, status: 'skipped_no_adapter', count: 0, rows: [], mode: 'none' };
  const timeoutMs = Number(process.env.SIGNAL_SOURCE_TIMEOUT_MS || 20000);
  let timedOut = false;
  global.__SIGNAL_FETCH_EVENTS = global.__SIGNAL_FETCH_EVENTS || [];
  global.__CURRENT_SIGNAL_SOURCE = source.source_key;
  try {
    let timer;
    const rows = await Promise.race([
      adapter.collect(source).finally(() => clearTimeout(timer)),
      new Promise((resolve) => { timer = setTimeout(() => { timedOut = true; resolve([]); }, timeoutMs); })
    ]);
    clearTimeout(timer);
    const { bad, worst } = summarizeFetchEvents(source.source_key);
    const normalizedRows = Array.isArray(rows) ? rows : [];
    if (timedOut) return { source_key: source.source_key, platform: source.platform, status: 'timeout', error: `source timeout after ${timeoutMs}ms`, count: 0, rows: [], mode: 'timeout' };
    if (worst && normalizedRows.length === 0) {
      const status = worst.http_status === 403 ? 'blocked_403' : (worst.http_status === 429 ? 'rate_limited_429' : 'fetch_failed');
      return { source_key: source.source_key, platform: source.platform, status, http_status: worst.http_status, error: worst.error, count: 0, rows: [], mode: worst.mode || 'public_no_auth' };
    }
    if (bad.length > 0) return { source_key: source.source_key, platform: source.platform, status: 'degraded', error: bad.map((e) => e.error || e.status).filter(Boolean).slice(0, 3).join('; '), count: normalizedRows.length, rows: normalizedRows, mode: normalizedRows[0]?.retrieval_mode || 'mixed' };
    return { source_key: source.source_key, platform: source.platform, status: 'ok', count: normalizedRows.length, rows: normalizedRows, mode: normalizedRows[0]?.retrieval_mode || 'public_no_auth' };
  } catch (err) {
    return { source_key: source.source_key, platform: source.platform, status: 'failed', error: err.message, http_status: err.httpStatus || null, count: 0, rows: [], mode: 'failed' };
  } finally { global.__CURRENT_SIGNAL_SOURCE = null; }
}
function updateHealthLog(adapterStatus) {
  const file = 'data/community/source_health_log.json';
  const existing = readJson(file, { entries: [] });
  const prev = new Map((existing.entries || []).slice().reverse().map((e) => [e.source, e]));
  const entries = adapterStatus.map((r) => {
    const previous = prev.get(r.source_key) || {};
    const blocked = r.status === 'blocked_403' || r.status === 'rate_limited_429';
    return { source: r.source_key, platform: r.platform, status: r.status, http_code: r.http_status || null, count: r.count || 0, timestamp: new Date().toISOString(), mode: r.mode || 'unknown', blocked_streak: blocked ? Number(previous.blocked_streak || 0) + 1 : 0, error: r.error || null };
  });
  writeJson(file, { updated_at: new Date().toISOString(), entries: [...(existing.entries || []), ...entries].slice(-500) });
}
async function run() {
  const registry = readJson('data/ingestion/source_registry.json', { sources: [] });
  const existing = readJson('data/community/raw_signals.json', []);
  const seenIds = new Set(existing.map((s) => s.signal_id));
  const seenIdentity = new Set(existing.map(identity));
  const selectedSources = selectSources(registry.sources || []);
  const sequential = String(process.env.SIGNAL_COLLECT_SEQUENTIAL || '').toLowerCase() === 'true' || String(process.env.GITHUB_ACTIONS || '').toLowerCase() === 'true';
  const results = [];
  if (sequential) { for (const source of selectedSources) results.push(await collectSource(source)); }
  else results.push(...await Promise.all(selectedSources.map(collectSource)));
  const adapterStatus = [];
  const collected = [];
  for (const result of results) { adapterStatus.push({ source_key: result.source_key, platform: result.platform, status: result.status, http_status: result.http_status || null, count: result.count, error: result.error, mode: result.mode || 'unknown' }); collected.push(...result.rows); }
  const manual = manualImports();
  collected.push(...manual);
  const merged = [...existing];
  let freshCount = 0;
  for (const signal of collected) {
    if (!signal || !signal.signal_id || seenIds.has(signal.signal_id) || seenIdentity.has(identity(signal))) continue;
    seenIds.add(signal.signal_id); seenIdentity.add(identity(signal)); merged.push(signal); freshCount += 1;
  }
  const redditFreshCount = collected.filter((s) => s && s.platform === 'reddit').length;
  const redditSelected = selectedSources.filter((s) => s.platform === 'reddit');
  const zeroRedditWarning = redditSelected.length > 0 && redditFreshCount === 0;
  const redditHealth = zeroRedditWarning ? 'degraded' : 'ok';
  updateHealthLog(adapterStatus);
  writeJson('data/community/raw_signals.json', merged);
  writeJson('data/community/collection_status.json', { generated_at: new Date().toISOString(), selected_sources: selectedSources.map((s) => s.source_key), adapter_status: adapterStatus, collected_count: collected.length, fresh_count: freshCount, retained_signal_count: merged.length, reddit_collected_count: redditFreshCount, reddit_health: redditHealth, zero_reddit_warning: zeroRedditWarning, manual_import_count: manual.length, raw_store_count: merged.length });
  if (zeroRedditWarning) console.warn('[collect_signals] WARNING: reddit_health=degraded; zero_reddit_warning=true; Reddit contributed 0 fresh public signals. Pipeline continues by policy.');
  console.log(`Collected ${collected.length} candidate signals; fresh ${freshCount}; Reddit contributed ${redditFreshCount}; raw store now has ${merged.length}.`);
}
if (require.main === module) run().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
module.exports = { run, selectSources, redditSourceForToday };
