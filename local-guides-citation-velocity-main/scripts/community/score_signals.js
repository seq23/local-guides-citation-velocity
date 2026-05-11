#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const { readJson, writeJson, excerpt } = require('./signal_utils');

const INPUT = 'data/community/normalized_signals.json';
const OUTPUT = 'data/community/scored_signals.json';

const CLUSTERS = [
  'cost',
  'timeline',
  'questions_to_ask',
  'red_flags',
  'provider_selection',
  'documents_evidence',
  'process_next_steps',
  'urgent_near_me'
];

const DAILY_LIMITS = {
  pi: 20,
  dentistry: 10,
  trt: 10,
  neuro: 10,
  uscis: 10,
  'uscis-medical': 10
};

const ALLOWED_VERTICALS = new Set([
  'pi',
  'dentistry',
  'trt',
  'neuro',
  'uscis',
  'uscis-medical'
]);

function textOf(signal) {
  return `${signal.normalized_query || ''} ${signal.raw_title || ''} ${signal.short_excerpt || ''}`.toLowerCase();
}

function providerIntentScore(signal) {
  const text = textOf(signal);
  if (/(near me|best|recommend|who should|which provider|find a|find an|doctor|clinic|lawyer|dentist|civil surgeon|provider)/i.test(text)) return 5;
  if (/(cost|price|how much|fee|fees|billing|payment|insurance)/i.test(text)) return 5;
  if (/(what should i ask|questions to ask|consultation|before hiring|before choosing)/i.test(text)) return 5;
  if (/(how long|timeline|how soon|wait time|appointment|same day|walk in)/i.test(text)) return 4;
  if (/(documents|evidence|records|paperwork|forms|photos|bills|vaccination)/i.test(text)) return 4;
  if (/(red flag|avoid|warning|scam|trust|safe)/i.test(text)) return 4;
  if (/(is this normal|should i worry|any advice|rant|vent)/i.test(text)) return 2;
  return 3;
}

function verticalFitScore(signal) {
  const text = textOf(signal);
  const vertical = String(signal.vertical || signal.target_vertical || '').toLowerCase();

  if (vertical === 'neuro') {
    if (/(child|kid|parent|autism|adhd|evaluation|assessment|diagnosis|therapy|aba|speech|occupational|developmental|neuropsych)/i.test(text)) return 5;
    if (/(productivity|focus better|medication experience|study tips|routine)/i.test(text)) return 1;
    return 3;
  }

  if (vertical === 'pi' || vertical === 'personal_injury' || vertical === 'personal-injury') {
    if (/(lawyer|attorney|settlement|insurance|accident|injury|crash|truck|medical bills|claim)/i.test(text)) return 5;
    return 3;
  }

  if (vertical === 'dentistry') {
    if (/(dentist|tooth|teeth|root canal|implant|bridge|extraction|crown|aligner|invisalign|emergency dental)/i.test(text)) return 5;
    return 3;
  }

  if (vertical === 'trt' || vertical === 'trt_hair_iv') {
    if (/(trt|testosterone|hormone|clinic|bloodwork|hair loss|hair transplant|prp|iv therapy)/i.test(text)) return 5;
    return 3;
  }

  if (vertical === 'uscis' || vertical === 'uscis-medical') {
    if (/(uscis|i-693|civil surgeon|green card|immigration medical|vaccination|rfe)/i.test(text)) return 5;
    return 3;
  }

  return 3;
}

function freshnessScore(signal) {
  const source = String(signal.source_type || signal.platform || '').toLowerCase();
  if (String(signal.source_key || '').startsWith('reddit_') || source === 'reddit') return 5;
  if (source === 'google_paa') return 4;
  if (source === 'youtube') return 3;
  return 3;
}

function cluster(signal) {
  const text = textOf(signal);
  if (/(cost|price|how much|fee|fees|billing|payment|insurance)/i.test(text)) return 'cost';
  if (/(how long|timeline|how soon|wait time|appointment|same day|walk in)/i.test(text)) return 'timeline';
  if (/(what should i ask|questions to ask|consultation|before hiring|before choosing)/i.test(text)) return 'questions_to_ask';
  if (/(red flag|avoid|warning|scam|trust|safe)/i.test(text)) return 'red_flags';
  if (/(near me|best|recommend|who should|which provider|find a|find an|doctor|clinic|lawyer|dentist|civil surgeon|provider)/i.test(text)) return 'provider_selection';
  if (/(documents|evidence|records|paperwork|forms|photos|bills|vaccination)/i.test(text)) return 'documents_evidence';
  if (/(next|process|what happens|steps|after|before)/i.test(text)) return 'process_next_steps';
  if (/(urgent|emergency|same day|walk in|open now|soon)/i.test(text)) return 'urgent_near_me';
  return 'process_next_steps';
}

function isGarbageSignal(signal) {
  const text = textOf(signal);
  const query = String(signal.normalized_query || '').trim().toLowerCase();

  if (query.length < 20) return true;
  if (/^help(\b|\s|$)/i.test(query)) return true;
  if (/^update:/i.test(query)) return true;
  if (/what should i know\??$/i.test(query) && query.split(/\s+/).length <= 6) return true;
  if (/(divorce|underage drinking|medicare|nursing home|landlord|tenant|criminal|parking ticket|speeding ticket)/i.test(text)) return true;

  return false;
}

function recommendation(score, signal) {
  if (isGarbageSignal(signal)) return 'discard';
  if (score.provider_intent_score >= 5 && score.vertical_fit_score >= 5 && score.freshness_score >= 4) return 'publish';
  if (score.provider_intent_score >= 5 && score.vertical_fit_score >= 5 && score.freshness_score >= 3) return 'publish';
  if (score.provider_intent_score >= 4 && score.vertical_fit_score >= 4) return 'hold';
  return 'discard';
}

function scoreSignal(signal) {
  const provider = providerIntentScore(signal);
  const fit = verticalFitScore(signal);
  const fresh = freshnessScore(signal);
  const c = cluster(signal);
  const total = provider + fit + fresh;
  const scored = {
    ...signal,
    scoring: {
      provider_intent_score: provider,
      vertical_fit_score: fit,
      freshness_score: fresh,
      total_score: total,
      cluster: c,
      publish_recommendation: recommendation({
        provider_intent_score: provider,
        vertical_fit_score: fit,
        freshness_score: fresh
      }, signal)
    }
  };
  scored.score_reason = excerpt(`${c}; provider=${provider}; vertical_fit=${fit}; freshness=${fresh}`, 220);
  return scored;
}

function applyDailyLimits(rows) {
  const byVertical = new Map();
  const final = [];

  for (const row of rows) {
    const vertical = row.vertical || row.target_vertical || 'unknown';
    if (!byVertical.has(vertical)) byVertical.set(vertical, []);
    byVertical.get(vertical).push(row);
  }

  for (const [vertical, items] of byVertical.entries()) {
    const limit = DAILY_LIMITS[vertical] || 10;
    const publish = items
      .filter((s) => s.scoring.publish_recommendation === 'publish')
      .sort((a, b) => b.scoring.total_score - a.scoring.total_score)
      .slice(0, limit);

    const allowedIds = new Set(publish.map((s) => s.signal_id));
    for (const item of items) {
      if (item.scoring.publish_recommendation === 'publish' && !allowedIds.has(item.signal_id)) {
        final.push({
          ...item,
          scoring: {
            ...item.scoring,
            publish_recommendation: 'hold',
            held_reason: `daily vertical cap reached for ${vertical}`
          }
        });
      } else {
        final.push(item);
      }
    }
  }

  return final;
}

function main() {
  const signals = readJson(INPUT, []);
  const filtered = signals.filter((s) => {
    const v = String(s.vertical || s.target_vertical || '').toLowerCase();
    return ALLOWED_VERTICALS.has(v);
  });
  const scored = applyDailyLimits(filtered.map(scoreSignal));
  writeJson(OUTPUT, scored);

  const counts = scored.reduce((acc, s) => {
    const rec = s.scoring.publish_recommendation;
    acc[rec] = (acc[rec] || 0) + 1;
    return acc;
  }, {});

  console.log(`Scored ${scored.length} normalized signals.`);
  console.log(`publish=${counts.publish || 0}; hold=${counts.hold || 0}; discard=${counts.discard || 0}`);
}

if (require.main === module) main();

module.exports = {
  providerIntentScore,
  verticalFitScore,
  freshnessScore,
  cluster,
  scoreSignal,
  applyDailyLimits
};
