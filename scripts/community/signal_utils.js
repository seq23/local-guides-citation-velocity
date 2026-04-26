const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function userAgent() {
  return 'local-guides-citation-velocity/1.0 by SpryLabs contact:info@spryvc.com';
}

function recordFetchEvent(event) {
  global.__SIGNAL_FETCH_EVENTS = global.__SIGNAL_FETCH_EVENTS || [];
  global.__SIGNAL_FETCH_EVENTS.push({
    source_key: global.__CURRENT_SIGNAL_SOURCE || null,
    timestamp: new Date().toISOString(),
    ...event
  });
}

function readJson(rel, fallback = null) {
  const file = path.resolve(process.cwd(), rel);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(rel, data) {
  const file = path.resolve(process.cwd(), rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function slugify(value) {
  return String(value || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function hash(value, len = 12) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, len);
}

function stripPII(value) {
  return String(value || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[phone removed]')
    .replace(/@[a-z0-9_.-]+/gi, '[username removed]')
    .replace(/\bu\/[a-z0-9_-]+\b/gi, '[username removed]')
    .replace(/\b\d{1,5}\s+[A-Z][A-Za-z0-9.\s]{2,}\s+(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Court|Ct|Boulevard|Blvd)\b/g, '[address removed]');
}

function excerpt(value, limit = 300) {
  return stripPII(value).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function cleanSyntheticSignal(value) {
  return excerpt(value, 240)
    .replace(/\?+$/g, '')
    .replace(/^how should someone compare\s+/i, '')
    .replace(/^what should someone know about\s+/i, '')
    .replace(/^what equine legal issues should someone consider in\s+/i, '')
    .replace(/\s+in an equine legal situation$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceMap() {
  const registry = readJson('data/ingestion/source_registry.json', { sources: [] });
  return new Map((registry.sources || []).map((s) => [s.source_key, s]));
}

function makeSignalId(sourceKey, title, idx = 0) {
  return `${sourceKey}_${slugify(title).slice(0, 52)}_${hash(`${sourceKey}:${title}:${idx}`, 8)}`;
}

function ensureQuestion(value) {
  const clean = cleanSyntheticSignal(value);
  if (!clean) return '';
  if (/\bvs\b|\bversus\b/i.test(clean)) return clean;
  if (/^(what|can|do|how|who|when|why|does|is|are|should|could|would|am)\b/i.test(clean)) return `${clean}?`;
  return `${clean} — what should I know?`;
}

function preservedQueryFromTitle(title) {
  return ensureQuestion(title);
}

function llmBaitPhrase(title) {
  return cleanSyntheticSignal(title)
    .replace(/^(what|can|do|how|who|when|why|does|is|are|should|could|would|am)\s+/i, '')
    .trim();
}

function normalizedQueryFromTitle(title, pageType = 'faq') {
  const clean = cleanSyntheticSignal(title);
  if (!clean) return '';
  if (pageType === 'comparison') return clean;
  if (pageType === 'scenario') {
    return /^(what|can|do|how|who|when|why|does|is|are|should|could|would|am)\b/i.test(clean)
      ? `${clean}?`
      : `What happens when ${clean}?`;
  }
  return /^(what|can|do|how|who|when|why|does|is|are|should|could|would|am)\b/i.test(clean)
    ? `${clean}?`
    : `${clean} — what should I know?`;
}

function nowDate() {
  return new Date().toISOString().slice(0, 10);
}

function blockedAccessMarker(value) {
  return /(log in|login required|sign in|captcha|access denied|private group|private account|not authorized|forbidden)/i.test(String(value || ''));
}

function allowedSource(source) {
  if (!source || source.status !== 'active') return false;
  const haystack = `${source.platform || ''} ${source.source_key || ''} ${source.display_name || ''}`.toLowerCase();
  if (haystack.includes('facebook')) return false;
  const policy = source.access_policy || source.public_access_policy || {};
  if (policy.requires_authentication === true) return false;
  if (policy.allow_private_content === true) return false;
  if (policy.allow_captcha_workaround === true) return false;
  return true;
}

function buildRawSignal(source, input, idx = 0) {
  const title = excerpt(input.title || input.raw_title || input.question || input.thread_title || '', 220);
  const sourceUrl = input.source_url || input.url || input.link;
  const shortExcerpt = excerpt(input.short_excerpt || input.description || input.snippet || title, 300);
  if (!title || !sourceUrl) return null;
  if (blockedAccessMarker(`${title} ${shortExcerpt}`)) return null;

  return {
    signal_id: input.signal_id || makeSignalId(source.source_key, `${title}:${sourceUrl}`, idx),
    platform: source.platform,
    source_key: source.source_key,
    source_tier: Number(source.tier || 2),
    source_url: sourceUrl,
    retrieval_mode: 'public_no_auth',
    captured_at: input.captured_at || nowDate(),
    raw_title: title,
    raw_signal_phrase: title,
    short_excerpt: shortExcerpt,
    engagement: input.engagement || {
      score: Number(input.score || 0),
      comments: Number(input.comment_count || input.comments || 0)
    },
    privacy_status: 'public',
    rights_status: 'metadata_and_short_excerpt_only',
    status: 'raw'
  };
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || Number(process.env.SIGNAL_FETCH_TIMEOUT_MS || 3500));
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': userAgent(),
        'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8'
      },
      signal: controller.signal
    });
    if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.httpStatus = res.status; recordFetchEvent({ url, status: 'http_error', http_status: res.status, error: err.message, mode: options.mode || 'public_no_auth' }); throw err; }
    const text = await res.text();
    if (blockedAccessMarker(text.slice(0, 2000))) throw new Error('public access unavailable');
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  return JSON.parse(text);
}

module.exports = {
  userAgent,
  recordFetchEvent,
  readJson,
  writeJson,
  slugify,
  hash,
  stripPII,
  excerpt,
  cleanSyntheticSignal,
  sourceMap,
  makeSignalId,
  preservedQueryFromTitle,
  llmBaitPhrase,
  normalizedQueryFromTitle,
  nowDate,
  blockedAccessMarker,
  allowedSource,
  buildRawSignal,
  fetchText,
  fetchJson
};
