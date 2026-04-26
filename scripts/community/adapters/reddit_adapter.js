const { buildRawSignal, fetchJson, fetchText, slugify, recordFetchEvent, userAgent } = require('../signal_utils');

const REDDIT_CONFIG = {
  delay_base_ms: 8000,
  jitter_ms: 7000,
  max_posts: 5,
  max_terms: 2,
  timeout_ms: 18000
};

function getTodayVertical() {
  const day = new Date().getDay();
  const map = {
    1: 'pi',
    2: 'dentistry',
    3: 'trt',
    4: 'neuro',
    5: 'uscis'
  };
  return map[day] || null;
}

function isCi() { return String(process.env.GITHUB_ACTIONS || '').toLowerCase() === 'true'; }
function subredditFromBaseUrl(baseUrl, sourceKey = '', source = {}) {
  if (source.subreddit) return source.subreddit;
  const match = String(baseUrl || '').match(/reddit\.com\/r\/([^/]+)/i);
  if (match) return match[1];
  const fallback = { reddit_personal_injury: 'legaladvice', reddit_dentistry: 'askdentists', reddit_trt_hair_iv: 'trt', reddit_neuro_eval: 'ADHD', reddit_uscis_medical: 'USCIS' };
  return fallback[sourceKey] || null;
}
function compactQuery(term) { return String(term || '').replace(/\s+/g, '+').replace(/[^a-zA-Z0-9+_-]/g, '').slice(0, 120); }
function postUrl(permalink) { if (!permalink) return ''; return /^https?:\/\//i.test(permalink) ? permalink : `https://www.reddit.com${permalink}`; }
function htmlDecode(value) { return String(value || '').replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'); }
function textBetween(entry, tag) { const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'); const match = entry.match(re); return match ? htmlDecode(match[1]).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : ''; }
function parseRedditRss(source, xml, offset = 0) {
  const entries = String(xml || '').split(/<entry[\s>]/i).slice(1).map((chunk) => '<entry>' + chunk);
  return entries.map((entry, idx) => { const title = textBetween(entry, 'title'); const linkMatch = entry.match(/<link[^>]+href="([^"]+)"/i); const href = linkMatch ? htmlDecode(linkMatch[1]) : ''; const updated = textBetween(entry, 'updated'); const content = textBetween(entry, 'content') || title; if (!title || !href) return null; return buildRawSignal(source, { title, source_url: href, short_excerpt: content, score: 0, comment_count: 0, captured_at: updated ? updated.slice(0, 10) : undefined, retrieval_mode: 'reddit_rss' }, offset + idx); }).filter(Boolean);
}
function postToSignal(source, post, idx, mode = 'reddit_json') { const data = post && post.data ? post.data : post; if (!data || data.stickied) return null; const title = data.title || ''; const permalink = data.permalink || data.url || ''; if (!title || !permalink) return null; return buildRawSignal(source, { title, source_url: postUrl(permalink), short_excerpt: data.selftext || data.title || '', score: data.score || 0, comment_count: data.num_comments || 0, captured_at: data.created_utc ? new Date(data.created_utc * 1000).toISOString().slice(0, 10) : undefined, retrieval_mode: mode }, idx); }
async function redditOAuthToken() {
  const id = process.env.REDDIT_CLIENT_ID; const secret = process.env.REDDIT_CLIENT_SECRET; const refresh = process.env.REDDIT_REFRESH_TOKEN;
  if (!id || !secret || !refresh) return null;
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh });
  const res = await fetch('https://www.reddit.com/api/v1/access_token', { method: 'POST', headers: { 'Authorization': `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'User-Agent': userAgent(), 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) { recordFetchEvent({ url: 'https://www.reddit.com/api/v1/access_token', status: 'http_error', http_status: res.status, error: `OAuth token HTTP ${res.status}`, mode: 'reddit_oauth' }); return null; }
  const json = await res.json(); return json.access_token || null;
}
async function oauthJson(path) { const token = await redditOAuthToken(); if (!token) return null; return fetchJson(`https://oauth.reddit.com${path}`, { reddit: true, mode: 'reddit_oauth', headers: { Authorization: `Bearer ${token}` }, accept: 'application/json' }); }
async function collectOAuthNew(source, subreddit, limit, offset) { const json = await oauthJson(`/r/${encodeURIComponent(subreddit)}/new?limit=${limit}`); if (!json) return []; const children = json?.data?.children || []; return children.map((post, idx) => postToSignal(source, post, offset + idx, 'reddit_oauth')).filter(Boolean); }
async function collectOAuthSearch(source, subreddit, term, limit, offset) { const q = compactQuery(term); if (!q) return []; const json = await oauthJson(`/r/${encodeURIComponent(subreddit)}/search?q=${q}&restrict_sr=1&sort=new&limit=${limit}`); if (!json) return []; const children = json?.data?.children || []; return children.map((post, idx) => postToSignal(source, post, offset + idx, 'reddit_oauth')).filter(Boolean); }
async function collectJsonNew(source, subreddit, limit, offset) { const json = await fetchJson(`https://www.reddit.com/r/${encodeURIComponent(subreddit)}/new.json?limit=${limit}`, { reddit: true, mode: 'reddit_json' }); const children = json?.data?.children || []; return children.map((post, idx) => postToSignal(source, post, offset + idx, 'reddit_json')).filter(Boolean); }
async function collectJsonSearch(source, subreddit, term, limit, offset) { const q = compactQuery(term); if (!q) return []; const json = await fetchJson(`https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search.json?q=${q}&restrict_sr=1&sort=new&limit=${limit}`, { reddit: true, mode: 'reddit_json' }); const children = json?.data?.children || []; return children.map((post, idx) => postToSignal(source, post, offset + idx, 'reddit_json')).filter(Boolean); }
async function collectRssNew(source, subreddit, offset) { return parseRedditRss(source, await fetchText(`https://www.reddit.com/r/${encodeURIComponent(subreddit)}/new/.rss`, { reddit: true, mode: 'reddit_rss' }), offset); }
async function collectRssSearch(source, subreddit, term, offset) { const q = compactQuery(term); if (!q) return []; return parseRedditRss(source, await fetchText(`https://www.reddit.com/r/${encodeURIComponent(subreddit)}/search.rss?q=${q}&restrict_sr=on&sort=new`, { reddit: true, mode: 'reddit_rss' }), offset); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function delayMs() { const base = Number(process.env.REDDIT_PUBLIC_DELAY_MS || REDDIT_CONFIG.delay_base_ms); const jitter = Number(process.env.REDDIT_PUBLIC_JITTER_MS || REDDIT_CONFIG.jitter_ms); return base + Math.floor(Math.random() * (jitter + 1)); }
async function backoff(err, source = {}) { const status = Number(err.httpStatus || 0); if (status === 403) { source.status = 'blocked_403'; await sleep(30000 + Math.random() * 60000); return 'stop'; } if (status === 429) { await sleep(60000); return 'stop'; } return 'continue'; }
async function trySource(label, fn) { try { const rows = await fn(); await sleep(delayMs()); return rows; } catch (err) { console.warn(`[reddit_adapter] ${label} unavailable: ${err.message}`); const action = await backoff(err, global.__CURRENT_REDDIT_SOURCE || {}); if (action === 'stop') { err.stopRedditSource = true; throw err; } await sleep(delayMs()); return []; } }
async function collect(source) {
  global.__CURRENT_REDDIT_SOURCE = source;
  const todayVertical = getTodayVertical();
  if (todayVertical && source.vertical && source.vertical !== todayVertical) return [];
  const subreddit = subredditFromBaseUrl(source.base_url, source.source_key, source); if (!subreddit) { console.warn(`[reddit_adapter] missing subreddit for ${source.source_key}`); return []; }
  const limit = Number(process.env.REDDIT_PUBLIC_LIMIT || REDDIT_CONFIG.max_posts); const maxSignals = Number(process.env.REDDIT_PUBLIC_MAX_SIGNALS || REDDIT_CONFIG.max_posts); const termLimit = Number(process.env.REDDIT_PUBLIC_TERM_LIMIT || REDDIT_CONFIG.max_terms); const terms = Array.isArray(source.search_terms) ? source.search_terms.slice(0, termLimit) : []; const all = [];
  const preferRss = String(process.env.REDDIT_PUBLIC_PREFER_RSS || '').toLowerCase() === 'true' || isCi(); const oauthEnabled = Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET && process.env.REDDIT_REFRESH_TOKEN);
  const strategies = oauthEnabled ? ['oauth', preferRss ? 'rss' : 'json', preferRss ? 'json' : 'rss'] : [preferRss ? 'rss' : 'json', preferRss ? 'json' : 'rss'];
  for (const mode of strategies) { if (all.length > 0) break; try { if (mode === 'oauth') all.push(...await trySource(`${source.source_key} OAuth new`, () => collectOAuthNew(source, subreddit, limit, 0))); if (mode === 'rss') all.push(...await trySource(`${source.source_key} RSS new`, () => collectRssNew(source, subreddit, 0))); if (mode === 'json') all.push(...await trySource(`${source.source_key} JSON new`, () => collectJsonNew(source, subreddit, limit, 0))); } catch (err) { if (err.stopRedditSource) return []; } }
  for (let i = 0; i < terms.length && all.length < maxSignals; i++) { const offset = (i + 1) * limit; for (const mode of strategies) { try { const rows = mode === 'oauth' ? await trySource(`${source.source_key} OAuth search:${terms[i]}`, () => collectOAuthSearch(source, subreddit, terms[i], limit, offset)) : mode === 'rss' ? await trySource(`${source.source_key} RSS search:${terms[i]}`, () => collectRssSearch(source, subreddit, terms[i], offset)) : await trySource(`${source.source_key} JSON search:${terms[i]}`, () => collectJsonSearch(source, subreddit, terms[i], limit, offset)); if (rows.length > 0) { all.push(...rows); break; } } catch (err) { if (err.stopRedditSource) return all; } } }
  const seen = new Set(); const rows = all.filter((signal) => { if (!signal || !signal.source_url) return false; const key = `${slugify(signal.raw_title)}|${signal.source_url}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, maxSignals);
  if (rows.length === 0 && isCi()) console.warn(`[reddit_adapter] ${source.source_key} returned 0 rows in GitHub Actions; reddit_health=degraded warning only.`);
  return rows;
}
module.exports = { collect, REDDIT_CONFIG, getTodayVertical };
