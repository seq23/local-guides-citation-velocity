#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  ROOT,
  TODAY,
  readJson,
  writeJson,
  writeText,
  hash,
  slugify,
  countIndexableRoutes,
  countSitemapUrls,
  countLlmsEntries,
  citationPolicy
} = require('./pipeline_lib');

const { ShardedJsonWriter } = require('../lib/sharded_json');

// The 100K governor is policy, not a code literal. It used to be
// `const TARGET = 100000` here, and that same constant was then written into
// `generated_fanout_records` and `citation_ready_opportunities_current` - the
// two fields the 100K gates measure. Reading it from
// data/strategy/citation_strategy_profile.json means a policy change moves the
// target and the gates together, and a missing policy value stops the run
// instead of quietly defaulting.
const POLICY = citationPolicy();
const TARGET = POLICY.citation_ready_target;
const HORIZON_DAYS = POLICY.time_horizon_days;

const STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho',
  'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine',
  'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi',
  'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
  'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
  'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia',
  'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'
];

const VERTICAL_SEEDS = {
  dentistry: {
    label: 'dentistry',
    entities: [
      'dentist', 'dental implant office', 'emergency dentist', 'cosmetic dentist',
      'oral surgeon', 'pediatric dentist', 'clear aligner provider', 'root canal dentist'
    ],
    situations: [
      'implant cost', 'dental anxiety', 'emergency tooth pain', 'insurance billing',
      'second opinion', 'sedation options', 'family dental care', 'red flags'
    ]
  },
  neuro: {
    label: 'neuropsychological evaluation',
    entities: [
      'neuropsychologist', 'ADHD evaluation provider', 'autism evaluation provider',
      'child psychologist', 'adult ADHD evaluator', 'therapy provider',
      'school documentation provider', 'evaluation clinic'
    ],
    situations: [
      'waitlist', 'insurance coverage', 'school accommodations', 'adult diagnosis',
      'report quality', 'provider credentials', 'testing timeline', 'red flags'
    ]
  },
  'personal-injury': {
    label: 'personal injury',
    entities: [
      'personal injury lawyer', 'car accident lawyer', 'truck accident lawyer',
      'slip and fall lawyer', 'workers compensation lawyer', 'brain injury lawyer',
      'insurance claim lawyer', 'settlement attorney'
    ],
    situations: [
      'settlement offer', 'medical bills', 'fault dispute', 'insurance adjuster',
      'case timeline', 'evidence checklist', 'switching lawyers', 'fee agreement'
    ]
  },
  uscis: {
    label: 'USCIS medical exam',
    entities: [
      'civil surgeon', 'I-693 doctor', 'immigration medical exam office',
      'green card medical exam provider', 'vaccination record provider',
      'sealed envelope provider', 'RFE response provider', 'USCIS exam clinic'
    ],
    situations: [
      'I-693 correction', 'RFE', 'vaccination record', 'sealed envelope',
      'exam validity', 'cost and timing', 'panel physician confusion', 'form mistake'
    ]
  },
  trt: {
    label: 'hormone and hair loss',
    entities: [
      'TRT clinic', 'testosterone provider', 'hair loss clinic', 'peptide clinic',
      'hormone doctor', 'telehealth TRT provider', 'PRP hair provider', 'lab testing clinic'
    ],
    situations: [
      'lab monitoring', 'side effects', 'hair shedding', 'clinic red flags',
      'cost comparison', 'online clinic review', 'plateau', 'treatment timeline'
    ]
  }
};

const INTENTS = [
  { id: 'cost', phrase: 'what should someone compare before paying for' },
  { id: 'verification', phrase: 'how can someone verify' },
  { id: 'red_flags', phrase: 'what red flags matter when choosing' },
  { id: 'timeline', phrase: 'what timeline should someone expect for' },
  { id: 'questions_to_ask', phrase: 'what questions should someone ask before booking' },
  { id: 'comparison', phrase: 'how should someone compare options for' },
  { id: 'documentation', phrase: 'what documents should someone prepare for' },
  { id: 'second_opinion', phrase: 'when should someone get a second opinion about' },
  { id: 'local_fit', phrase: 'what makes a local provider a good fit for' },
  { id: 'aftercare', phrase: 'what should someone know after starting' }
];

const PAGE_FAMILIES = [
  'literal_question',
  'state_support',
  'comparison',
  'guide',
  'checklist',
  'red_flag',
  'faq_atom',
  'internal_link_opportunity'
];

const MODIFIERS = [
  'near me', 'same week', 'with insurance', 'without insurance', 'for anxious patients',
  'for parents', 'for adults', 'with financing', 'with documentation', 'before booking',
  'after a bad experience', 'when comparing providers', 'for second opinions',
  'when the first answer is unclear', 'with state-specific rules', 'with urgent timing',
  'without making a rushed decision', 'with transparent pricing', 'with clear next steps',
  'with trustworthy review signals'
];

function routeInventory() {
  const routes = [];
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', '.next', 'dist'].includes(ent.name)) continue;
      const absPath = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(absPath);
      else if (ent.name.endsWith('.html')) {
        const rel = path.relative(ROOT, absPath).replace(/\\/g, '/');
        if (rel === '404.html') continue;
        const route = rel.endsWith('/index.html')
          ? `/${rel.slice(0, -'index.html'.length)}`
          : `/${rel.replace(/\.html$/, '')}`;
        routes.push({ rel, route });
      }
    }
  }
  walk(ROOT);
  return routes.sort((a, b) => a.route.localeCompare(b.route));
}

function existingRouteFor(vertical, family, index, routes) {
  const verticalRoutes = routes.filter((r) => r.route.includes(`/${vertical}/`) || r.route === `/${vertical}/`);
  const pool = verticalRoutes.length ? verticalRoutes : routes;
  if (!pool.length) return null;
  return pool[(index + family.length) % pool.length].route;
}

function makeFanoutRecord(index, routes, verticalKeys) {
  // Mixed-radix enumeration guarantees that every materialized query tuple is
  // distinct before any page-strategy admission happens. Page family is a
  // planning classification and is deliberately not allowed to manufacture a
  // duplicate wording of the same query opportunity.
  let cursor = index;
  const vertical = verticalKeys[cursor % verticalKeys.length];
  cursor = Math.floor(cursor / verticalKeys.length);
  const state = STATES[cursor % STATES.length];
  cursor = Math.floor(cursor / STATES.length);
  const intent = INTENTS[cursor % INTENTS.length];
  cursor = Math.floor(cursor / INTENTS.length);
  const seed = VERTICAL_SEEDS[vertical];
  const entity = seed.entities[cursor % seed.entities.length];
  cursor = Math.floor(cursor / seed.entities.length);
  const situation = seed.situations[cursor % seed.situations.length];
  cursor = Math.floor(cursor / seed.situations.length);
  const modifier = MODIFIERS[cursor % MODIFIERS.length];
  const pageFamily = PAGE_FAMILIES[index % PAGE_FAMILIES.length];
  const query = `${intent.phrase} ${entity} for ${situation} in ${state} ${modifier}?`;
  const routeCandidate = `/${vertical}/opportunities/${slugify(`${state}-${intent.id}-${entity}-${situation}-${modifier}`).slice(0, 120)}/`;
  const existingRoute = existingRouteFor(vertical, pageFamily, index, routes);
  const directOwnedSurface = routes.some((r) => r.route === routeCandidate);
  const score = 50
    + (intent.id === 'cost' || intent.id === 'red_flags' ? 10 : 0)
    + (pageFamily === 'literal_question' || pageFamily === 'comparison' ? 8 : 0)
    + (modifier.includes('insurance') || modifier.includes('urgent') ? 5 : 0);
  return {
    opportunity_id: `lgcv_100k_${String(index + 1).padStart(6, '0')}_${hash(`${query}:${pageFamily}`, 8)}`,
    status: directOwnedSurface ? 'owned_surface_exists' : 'citation_ready_opportunity',
    proof_boundary: 'opportunity_not_external_citation',
    vertical,
    state,
    intent: intent.id,
    entity,
    situation,
    modifier,
    page_family: pageFamily,
    query,
    route_candidate: routeCandidate,
    supporting_existing_route: existingRoute,
    direct_owned_surface_exists: directOwnedSurface,
    source_basis: 'repo_local_query_fanout_and_public_owned_crawl_only',
    zero_dollar_test_basis: [
      'owned route inventory',
      'sitemap presence',
      'llms surface count',
      'existing source and claim registries',
      'manual/provider telemetry if later supplied'
    ],
    priority_score: score,
    action_decision: directOwnedSurface ? 'refresh_or_internal_link' : 'candidate_for_future_safe_content_or_atom'
  };
}

function loadObservedWins() {
  const wins = readJson('data/citation_velocity/wins.json', { wins: [] }).wins || [];
  return wins.map((win) => ({
    id: win.id,
    status: 'historical_observed_win_record',
    proof_boundary: 'existing_repo_monitor_record_not_new_live_telemetry',
    vertical: win.vertical,
    date: win.date,
    pages: win.pages || [],
    engine: win.engine || null,
    successful_change: win.successful_change || null
  }));
}

function buildRepairQueue(records, routes) {
  const routeByVertical = new Map();
  for (const r of routes) {
    const key = r.route.split('/').filter(Boolean)[0] || 'root';
    if (!routeByVertical.has(key)) routeByVertical.set(key, []);
    routeByVertical.get(key).push(r.route);
  }
  const selected = [];
  const seen = new Set();
  for (const record of records) {
    if (selected.length >= 250) break;
    const key = `${record.vertical}:${record.intent}:${record.state}:${record.page_family}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push({
      repair_id: `freewin_${hash(key, 12)}`,
      opportunity_id: record.opportunity_id,
      vertical: record.vertical,
      state: record.state,
      action: record.direct_owned_surface_exists ? 'refresh_existing_surface' : 'prepare_safe_owned_surface_or_answer_atom',
      safe_to_auto_repair: record.direct_owned_surface_exists,
      protected_action: false,
      why_it_can_help: 'Improves answer-extractable coverage, internal-link depth, and local query fit without paid data.',
      competitor_free_win_angle: 'Cover a public high-intent query family with clearer direct answers, source boundaries, and internal links.',
      supporting_existing_route: record.supporting_existing_route,
      route_candidate: record.route_candidate,
      validation_required: [
        'duplicate intent check',
        'source/claim boundary check',
        'canonical and sitemap check',
        'citation honesty check'
      ],
      status: record.direct_owned_surface_exists ? 'safe_refresh_candidate' : 'future_release_candidate'
    });
  }
  return selected;
}

function repairCandidateState() {
  return { selected: [], seen: new Set() };
}

function considerRepairCandidate(record, state) {
  if (state.selected.length >= 250) return;
  const key = `${record.vertical}:${record.intent}:${record.state}:${record.page_family}`;
  if (state.seen.has(key)) return;
  state.seen.add(key);
  state.selected.push({
    repair_id: `freewin_${hash(key, 12)}`,
    opportunity_id: record.opportunity_id,
    vertical: record.vertical,
    state: record.state,
    action: record.direct_owned_surface_exists ? 'refresh_existing_surface' : 'prepare_safe_owned_surface_or_answer_atom',
    safe_to_auto_repair: record.direct_owned_surface_exists,
    protected_action: false,
    why_it_can_help: 'Improves answer-extractable coverage, internal-link depth, and local query fit without paid data.',
    competitor_free_win_angle: 'Cover a public high-intent query family with clearer direct answers, source boundaries, and internal links.',
    supporting_existing_route: record.supporting_existing_route,
    route_candidate: record.route_candidate,
    validation_required: [
      'duplicate intent check',
      'source/claim boundary check',
      'canonical and sitemap check',
      'citation honesty check'
    ],
    status: record.direct_owned_surface_exists ? 'safe_refresh_candidate' : 'future_release_candidate'
  });
}

function run() {
  const profile = readJson('data/strategy/citation_strategy_profile.json', {});
  const verticalKeys = (profile.verticals || Object.keys(VERTICAL_SEEDS)).filter((v) => VERTICAL_SEEDS[v]);
  const routes = routeInventory();
  const generatedAt = `${TODAY}T00:00:00.000Z`;
  const repairState = repairCandidateState();
  const shardWriter = new ShardedJsonWriter('data/queries/citation_fanout_opportunities_100k', {
    recordsPerShard: 5000,
    maxBytesPerShard: 8 * 1024 * 1024,
    compression: 'gzip',
    metadata: {
      repo: 'local-guides-citation-velocity',
      generated_at: generatedAt,
      target: TARGET,
      proof_boundary: 'query_fanout_opportunities_not_external_citations',
      generator: 'scripts/citation_intelligence/build_100k_citation_runway.js'
    }
  });

  for (let i = 0; i < TARGET; i += 1) {
    const record = makeFanoutRecord(i, routes, verticalKeys);
    shardWriter.add(record);
    considerRepairCandidate(record, repairState);
  }
  const shardIndex = shardWriter.finalize();
  // The number that gets published is the number of records that actually
  // reached disk. It used to be TARGET - the goal itself was written into the
  // fields the two 100K gates measure, so an 80% generation shortfall (patch
  // the loop to 20,000 and 20,000 records land) still reported 100,000 and both
  // gates passed. ShardedJsonWriter.finalize() has returned the true
  // record_count all along; nothing was reading it.
  const generatedFanoutRecords = Number(shardIndex.record_count);
  if (!Number.isFinite(generatedFanoutRecords) || generatedFanoutRecords < 1) {
    throw new Error('fanout generation produced no records; refusing to publish a fanout count');
  }
  const legacyMonolith = path.join(ROOT, 'data/queries/citation_fanout_opportunities_100k.json');
  if (fs.existsSync(legacyMonolith)) fs.rmSync(legacyMonolith, { force: true });

  const ownedSurfaceCount = countIndexableRoutes();
  const sitemapUrls = countSitemapUrls();
  const llmsEntries = countLlmsEntries();
  const observedWins = loadObservedWins();
  const strategy = {
    schema_version: '2.1',
    repo: 'seq23/local-guides-citation-velocity',
    repo_name: 'local-guides-citation-velocity',
    target: {
      citation_ready_opportunities_or_surfaces: TARGET,
      time_horizon_days: HORIZON_DAYS,
      time_horizon_label: '180 days or less',
      hard_guarantee: false,
      target_is_external_citation_claim: false
    },
    cadence: {
      autonomy_model: 'FULL_SAFE_AUTONOMY_FOR_SAFE_LOCAL_AUTHORITY_ACTIONS',
      new_page_cadence: 'process qualified distinct-intent candidates within daily safety budgets; never manufacture pages to satisfy a quota',
      refresh_cadence: 'daily self-heal candidates plus weekly operator observation',
      content_atom_cadence: 'daily answer atom or internal-link candidates when qualified',
      internal_link_cadence: 'after every safe publish or refresh batch',
      flagship_asset_cadence: 'monthly or quarterly vertical guides when source depth supports'
    },
    measurement_boundaries: {
      owned_surfaces: 'repo-created pages, answers, atoms, schema, sitemap and llms surfaces',
      citation_opportunities: 'query/fanout opportunities positioned for future owned surfaces or refreshes',
      submitted_urls: 'provider-gated IndexNow/GSC/Bing records only when authorized',
      indexed_urls: 'telemetry/manual verification only',
      observed_wins: 'historical monitor records or future verified manual/provider checks',
      external_citations: 'never claimed without evidence'
    },
    zero_dollar_lane: {
      enabled: true,
      sources: [
        'repo-local crawl',
        'sitemap and llms counts',
        'offline fixture/manual imports',
        'source and claim registries',
        'public route/fanout structure',
        'provider telemetry only when credentials exist'
      ],
      forbidden: [
        'fake rankings',
        'fake indexing',
        'fake external citations',
        'fake provider rosters',
        'fake competitor displacement'
      ]
    },
    exclusions: [
      'verified provider claims without source authority',
      'legal/medical advice beyond neutral educational boundaries',
      'paid/provider mutations without credentials and owner authority',
      'one thin page per wording variation',
      'publication solely to satisfy a daily page quota'
    ],
    fanout_storage: {
      format: 'indexed_json_shards',
      index: 'data/queries/citation_fanout_opportunities_100k/index.json',
      shard_count: shardIndex.shard_count,
      record_count: generatedFanoutRecords,
      aggregate_sha256: shardIndex.aggregate_sha256
    },
    generated_at: generatedAt
  };
  const scoreboard = {
    schema_version: '2.1',
    repo: 'local-guides-citation-velocity',
    generated_at: generatedAt,
    target_citation_ready_opportunities_or_surfaces: TARGET,
    time_horizon_days: HORIZON_DAYS,
    hard_guarantee: false,
    owned_surfaces_current: ownedSurfaceCount,
    sitemap_urls_current: sitemapUrls,
    llms_entries_current: llmsEntries,
    citation_ready_opportunities_current: generatedFanoutRecords,
    generated_fanout_records: generatedFanoutRecords,
    generated_fanout_records_basis: 'measured_shard_index_record_count',
    fanout_shortfall_against_target: Math.max(0, TARGET - generatedFanoutRecords),
    fanout_shard_count: shardIndex.shard_count,
    fanout_aggregate_sha256: shardIndex.aggregate_sha256,
    submitted_urls_current: readJson('data/seo/search_submission_registry.json', { domains: [] }).domains?.filter((d) => d.submission_record).length || 0,
    indexed_urls_current: 0,
    observed_wins_current: observedWins.length,
    observed_external_citations_current: observedWins.length,
    observed_external_citations_new_this_run: 0,
    external_telemetry_present: false,
    buckets: {
      owned_surfaces_are_not_external_citations: true,
      opportunities_are_not_wins: true,
      submissions_are_not_indexing: true,
      observed_wins_require_evidence: true
    },
    status: 'PASS_WITH_EXTERNAL_TELEMETRY_ABSENT'
  };
  const zeroDollarLedger = {
    schema_version: '2.1',
    repo: 'local-guides-citation-velocity',
    generated_at: generatedAt,
    mode: 'repo_local_zero_dollar_intelligence',
    live_paid_data_used: false,
    external_telemetry_present: false,
    tests: [
      { id: 'owned-route-crawl', status: 'PASS', count: ownedSurfaceCount, meaning: 'Counts crawlable local HTML surfaces.' },
      { id: 'sitemap-count', status: sitemapUrls > 0 ? 'PASS' : 'WARN', count: sitemapUrls, meaning: 'Counts submitted/discoverable sitemap entries, not indexing.' },
      { id: 'llms-count', status: llmsEntries > 0 ? 'PASS' : 'WARN', count: llmsEntries, meaning: 'Counts owned llms.txt entries, not LLM surfacing.' },
      { id: 'source-registry', status: fs.existsSync(path.join(ROOT, 'data/evidence/source_registry.json')) ? 'PASS' : 'WARN', meaning: 'Checks whether source registry exists for claim support.' },
      { id: 'claim-registry', status: fs.existsSync(path.join(ROOT, 'data/evidence/claim_registry.json')) ? 'PASS' : 'WARN', meaning: 'Checks whether claim registry exists for evidence boundaries.' },
      { id: 'provider-telemetry', status: 'SKIPPED_EXTERNAL_ACCESS_REQUIRED', meaning: 'GSC/Bing/live ranking data is not invented in artifact mode.' }
    ],
    safe_actions_from_tests: [
      'prioritize answer-extractable pages with existing source depth',
      'refresh pages attached to repeated high-intent query families',
      'improve internal links from existing vertical hubs to free-win candidates',
      'keep unsupported external outcome claims blocked until telemetry exists'
    ]
  };
  const repairQueue = repairState.selected;
  const validation = {
    schema_version: '2.1',
    validator: 'citation-100k-runway',
    repo: 'local-guides-citation-velocity',
    generated_at: generatedAt,
    status: generatedFanoutRecords >= TARGET ? 'PASS' : 'FAIL_FANOUT_SHORTFALL',
    target: TARGET,
    target_source: 'data/strategy/citation_strategy_profile.json:citation_strategy.citation_ready_target',
    time_horizon_days: HORIZON_DAYS,
    fanout_records: generatedFanoutRecords,
    fanout_records_basis: 'measured_shard_index_record_count',
    fanout_index: 'data/queries/citation_fanout_opportunities_100k/index.json',
    fanout_shards: shardIndex.shard_count,
    fanout_aggregate_sha256: shardIndex.aggregate_sha256,
    owned_surfaces_current: ownedSurfaceCount,
    repair_candidates: repairQueue.length,
    observed_external_citations_current: observedWins.length,
    external_telemetry_present: false,
    notes: [
      '100K is a citation-ready opportunity/surface target, not a proven citation claim.',
      'External outcomes remain evidence-ledger only.',
      'Fanout records are planning intelligence; they do not justify thin pages.',
      'Fanout records are stored as deterministic indexed shards, not a monolithic JSON file.'
    ]
  };
  writeJson('data/strategy/citation_growth_strategy.json', strategy);
  writeJson('data/measurement/citation_honesty_scoreboard.json', scoreboard);
  writeJson('data/measurement/zero_dollar_citation_test_ledger.json', zeroDollarLedger);
  writeJson('data/measurement/free_win_self_heal_queue.json', {
    schema_version: '2.1',
    repo: 'local-guides-citation-velocity',
    generated_at: generatedAt,
    count: repairQueue.length,
    queue: repairQueue
  });
  writeJson('data/measurement/observed_external_citation_evidence.json', {
    schema_version: '2.0',
    repo: 'local-guides-citation-velocity',
    generated_at: generatedAt,
    count: observedWins.length,
    proof_boundary: 'historical_repo_monitor_records_only',
    records: observedWins
  });
  writeJson('artifacts/validation/citation-100k-runway.json', validation);
  writeText('reports/citation-100k-runway.md', `# 100K Citation-Ready Runway\n\nStatus: ${validation.status}\n\nTarget: ${TARGET} citation-ready opportunities/surfaces in ${HORIZON_DAYS} days or less (declared in data/strategy/citation_strategy_profile.json).\nFanout opportunities generated (measured from shard index): ${generatedFanoutRecords}\nShortfall against target: ${Math.max(0, TARGET - generatedFanoutRecords)}\nShard count: ${shardIndex.shard_count}\nAggregate SHA256: ${shardIndex.aggregate_sha256}\nOwned surfaces: ${ownedSurfaceCount}\nSafe/free-win repair candidates: ${repairQueue.length}\nObserved external citation/win records: ${observedWins.length}\n\nThis report does not claim 100K external citations, rankings, indexing, traffic, or LLM surfacing.\n`);
  console.log(`citation runway: ${generatedFanoutRecords} sharded opportunities generated against a declared target of ${TARGET}; shards=${shardIndex.shard_count}; repairs=${repairQueue.length}; observed=${observedWins.length}`);
  if (generatedFanoutRecords < TARGET) {
    // Named, human-visible stop. The gates downstream will fail on the real
    // number; this makes sure nobody has to read a JSON file to find out why.
    console.error(`FANOUT SHORTFALL: generated ${generatedFanoutRecords} of a declared ${TARGET} citation-ready fanout opportunities.`);
  }
}

if (require.main === module) {
  try {
    run();
  } catch (err) {
    console.error(err.stack || err.message);
    process.exit(1);
  }
}

module.exports = { run };
