/**
 * Who holds a citation slot, decided explicitly.
 *
 * The defect this replaces
 * -----------------------
 * classify() used to end with `return { kind: 'unbranded', name: h }` - a blind
 * fallthrough. "Unbranded" was documented as "a slot an independent microsite
 * can hold", but it actually meant "a host this file did not recognise". Every
 * incumbent local practice, every provider directory, every institutional site
 * the pattern list happened to miss landed there and was counted as OPEN GROUND.
 * england.nhs.uk, ico.org.uk, novascotia.ca and moh.gov.sa were counted open
 * until a later pass added public-sector patterns; the whole population of
 * dentist, law-firm and clinic websites never was. "dentist that accepts
 * medicaid near me" - the panel's KNOWN-CLOSED control, whose citation set is
 * seven competing dental practices - scored 1.00, maximally open.
 *
 * The rule now
 * ------------
 * "Unbranded" must mean NO ONE OWNS THE ANSWER. It must not mean we failed to
 * recognise the host. So there is no fallthrough into the open bucket. A host is
 * OPEN only if it is positively recognised as holding nothing durable. Anything
 * unrecognised is UNCLASSIFIABLE, counts as CLOSED, and is counted separately so
 * a large unrecognised share shows up as a finding instead of as winnability.
 *
 * Buckets, and whether the slot is open ground for one of this portfolio's pages:
 *
 *   owned           CLOSED  one of our own domains; we already hold it
 *   social          CLOSED  reddit/youtube/tiktok/... a surface, not a page slot
 *   incumbent       CLOSED  a competing service provider: an individual practice,
 *                           firm or clinic answering with its own services, a
 *                           provider directory or marketplace (Healthgrades,
 *                           Zocdoc, Psychology Today, LifeStance, BetterHelp,
 *                           Talkspace, GoodTherapy, Thumbtack, Yelp, Angi and the
 *                           equivalents in each vertical), or a lead-gen
 *                           aggregator monetising the same intent
 *   institutional   CLOSED  not a competitor, but still occupying the slot:
 *                           government, public health services, academic hosts,
 *                           regulators, journals and reference works. A slot held
 *                           by an authoritative institution is not a slot these
 *                           properties can take. Recorded under its own label so
 *                           the two kinds of closure stay legible.
 *   open_unheld     OPEN    nothing durable holds it: a content farm or free-blog
 *                           subdomain, a CDN/asset host serving a file rather
 *                           than a page, a parked or dead domain
 *   unclassifiable  CLOSED  we could not determine what it is. Counted and
 *                           reported separately. NEVER open.
 *
 * The service vocabulary is the repo's own governed topic_terms from
 * data/strategy/page_strategy_registry.json - the same authority
 * join_atlas_to_release_queue.mjs matches verticals on - not a parallel list
 * invented here. A hardcoded vertical list goes stale the moment the portfolio
 * adds a vertical, and this portfolio already spans dentistry, personal injury,
 * TRT, neuro and USCIS.
 */
'use strict';

const OPEN_KINDS = new Set(['open_unheld']);
const KINDS = ['owned', 'social', 'incumbent', 'institutional', 'open_unheld', 'unclassifiable'];
const isOpenKind = (kind) => OPEN_KINDS.has(kind);

const SOCIAL = {
  'reddit.com': 'reddit', 'youtube.com': 'youtube', 'm.youtube.com': 'youtube',
  'tiktok.com': 'tiktok', 'instagram.com': 'instagram', 'facebook.com': 'facebook',
  'x.com': 'x', 'twitter.com': 'x', 'linkedin.com': 'linkedin', 'medium.com': 'medium',
};

// ------------------------------------------------------------- institutional
// Public-sector and academic hosts in ANY country, plus named health services,
// regulators, journals and reference works.
const GOV_EDU = /(^|\.)((gov|edu|mil)|(gov|edu|ac|nhs|health)\.[a-z]{2})$|\.(nhs\.uk|police\.uk)$/i;
const US_STATE_LEGISLATURE = /(^|\.)(legis|legislature|mainelegislature|malegislature|wvlegislature|ncleg|oregonlegislature)\b|\.ls\.state\.[a-z]{2}\.us$|(^|\.)state\.[a-z]{2}\.us$/i;
const PUBLIC_BODY = /^(www\.)?(ico|cqc|rcseng|sdcep|nice|gmc-uk|hse)\.org\.uk$|\.(who|europa|oecd)\.int$/i;
// Canada publishes government at bare provincial/federal domains with no .gov.
const CA_GOV = /(^|\.)(canada|novascotia|ontario|alberta|quebec|manitoba|saskatchewan|newfoundland|princeedwardisland)\.ca$|\.gc\.ca$/i;
// Named health services, academic medical centres, professional bodies, peer
// review and reference. Not competitors; still occupying the slot.
const INSTITUTION_NAMES = /^(www\.|my\.)?(mayoclinic|clevelandclinic|hopkinsmedicine|pennmedicine|uclahealth|mcleanhospital|bidmc|childrensnational|advocatechildrenshospital|carilionclinic|dulyhealthandcare|texaschildrenshealthplan|nih|ncbi|pubmed|pmc|jamanetwork|sciencedirect|nejm|bmj|thelancet|cochrane|aafp|acog|aap|ada|jada|chadd|coachingfederation|icaew|rsdjournal|wikipedia|britannica|merckmanuals|medlineplus|physiciansweekly|medcentral|mheducation|lexisnexis|thomsonreuters|family-institute)\./i;
const INSTITUTION_SUFFIX = /(^|\.)(ncbi\.nlm\.nih\.gov|ada\.org|loc\.gov)$|(^|\.)(pmc|pubmed)\.ncbi\.nlm\.nih\.gov$|\.(ac|edu)\.[a-z]{2}$/i;
const HOSPITAL_MARKERS = /(hospital|childrenshospital|universityhealth|healthsystem|medschool|schoolofmedicine)/i;

// -------------------------------------------------------------- incumbent
// Provider directories, marketplaces, lead-gen aggregators and national
// service brands competing for the same intent.
const DIRECTORY_MARKETPLACE = new RegExp('^(www\\.)?(' + [
  // health / therapy
  'healthgrades', 'zocdoc', 'vitals', 'ratemds', 'wellness', 'psychologytoday', 'lifestance',
  'betterhelp', 'talkspace', 'goodtherapy', 'thriveworks', 'opencounseling', 'zencare',
  'whatclinic', 'sesamecare', 'solvhealth', 'healthline', 'webmd', 'verywellhealth',
  'medicalnewstoday', 'drugs', 'goodrx', 'healthinsurance', 'npidashboard', 'freedentalcare',
  'seniornavigator', 'smilehub', 'dentistrytoday', 'deardoctor', 'dentistry',
  // dental directories / guides that list practices
  'localdentalguide', 'localdentistguide', 'yourdentistryguide', 'dentalchoices',
  'thedentallist', 'smartdentalnetwork', 'mydental', 'dentlink', 'azdentist', 'dentisusa',
  'implantveneerguide', 'thepeptidecatalog', 'mymedicineadvisor',
  // legal
  'avvo', 'findlaw', 'justia', 'nolo', 'lawyers', 'superlawyers', 'martindale', 'lawinfo',
  'legalmatch', 'uslegalforms', 'rocketlawyer', 'legalzoom', 'citizenpath', 'forthepeople',
  // home / events / local services
  'thumbtack', 'angi', 'homeadvisor', 'houzz', 'porch', 'bark', 'theknot', 'weddingwire',
  'eventbrite', 'peartree', 'paperlesspost', 'graduationcapandgown', 'graduationattire',
  // work / commerce / software marketplaces
  'yelp', 'indeed', 'glassdoor', 'ziprecruiter', 'amazon', 'walmart', 'etsy', 'pinterest',
  'quora', 'g2', 'capterra', 'trustpilot', 'hubspot', 'salesforce', 'zoom', 'smartsheet',
  'esign', 'freeforms', 'raiseright',
  // finance / insurance carriers and lead-gen
  'nerdwallet', 'investopedia', 'bankrate', 'experian', 'equifax', 'transunion', 'sofi',
  'rocketmortgage', 'lexingtonlaw', 'lendingtree', 'creditkarma', 'usmortgage',
  'deltadental', 'unitedhealthcare', 'cigna', 'aetna', 'humana', 'aflac', 'bupa',
  // publishers that sell the same intent as a lead product
  'forbes', 'usnews', 'businesswire',
].join('|') + ')\\.', 'i');

// Generic provider / professional-services markers that appear in the domain
// label of an individual practice, firm or clinic site. Declared, not inferred:
// a host is called an incumbent because one of these positively matched, never
// because nothing else did.
const PROVIDER_STEMS = [
  'dds', 'dmd', 'denta', 'dentis', 'orthodont', 'periodont', 'perio', 'endodont', 'oralsurg',
  'implant', 'veneer', 'smiles', 'smile', 'toothdoc',
  'lawfirm', 'lawyer', 'attorney', 'law', 'legal', 'counsel', 'advocates', 'litigation',
  'clinic', 'hospital', 'medical', 'medicine', 'medspa', 'physician', 'doctor', 'surgery',
  'surgeons', 'urgentcare', 'primarycare', 'healthcare', 'health', 'wellness', 'therapy',
  'therapist', 'counseling', 'psychiatry', 'psychology', 'psychological', 'neuropsych',
  'neuro', 'chiropract', 'dermatolog', 'pediatric', 'obgyn', 'hrt', 'trt', 'hormone',
  'testosterone', 'peptide', 'mensheath', 'menshealth', 'weightloss', 'hairloss',
  'mortgage', 'lending', 'realty', 'insurance', 'financial',
];

// ------------------------------------------------------------- open_unheld
// Positively recognised as holding nothing durable. This is the ONLY route into
// the open bucket. Adding to it is a deliberate act; nothing arrives here by
// failing another test.
const FREE_BLOG_OR_CONTENT_FARM = /(^|\.)(look4blog|blogspot|wordpress|weebly|wixsite|jimdosite|strikingly|mystrikingly|over-blog|tumblr|hatenablog|hubpages|ezinearticles|site123|webnode|godaddysites|blogolize|bloggersdelight|ampblogs|tblogz|isblog|shotblogs|tribunablog|full-design|pointblog|thezenweb|affiliatblogger|diowebhost|fitnell|dbblog|blogdon|blogkoo|alltdesign|amoblog|blog5|onesmablog|blogthisbiz|blogocial|blogolize)\.(com|net|org|co\.uk|xyz|info)$/i;
const CDN_OR_ASSET_HOST = /(^|\.)(cloudinary|ctfassets|kc-usercontent|cloudfront|akamaized|amazonaws|blob\.core\.windows|googleusercontent|imgix|contentful|fastly|jsdelivr|unpkg)\.(net|com|io)$|^(static\d*|assets[\w-]*|res|cdn[\w-]*|media|files?)\..*\.(com|net|org|io)$|^static\d*\.squarespace\.com$/i;
const PARKED_OR_DEAD = /(^|\.)(sedoparking|parkingcrew|bodis|afternic|dan|hugedomains|undeveloped)\.(com|net)$/i;

function buildServiceVocabulary(strategyRegistry) {
  const terms = [...new Set(
    Object.values((strategyRegistry && strategyRegistry.allowed_verticals) || {})
      .flatMap((cfg) => (cfg && cfg.topic_terms) || [])
      .map((t) => String(t).toLowerCase().trim())
      .filter(Boolean)
  )];
  // A hostname carries no spaces, so a multi-word governed term is also matched
  // in its collapsed form ("oral surgeon" -> "oralsurgeon").
  const collapsed = terms.map((t) => t.replace(/[^a-z0-9]/g, ''));
  return [...new Set([...terms, ...collapsed])].filter((t) => t.length >= 4);
}

/**
 * @param {object} opts
 *   owned              array of owned domains (already lowercased, no www.)
 *   strategyRegistry   parsed data/strategy/page_strategy_registry.json
 */
function createClassifier({ owned = [], strategyRegistry = {} } = {}) {
  const OWNED = owned.map((d) => String(d).toLowerCase().replace(/^www\./, ''));
  const GOVERNED_SERVICE_TERMS = buildServiceVocabulary(strategyRegistry);
  if (!GOVERNED_SERVICE_TERMS.length) {
    // Refusing to guess, the same way blueOceanEligibility does. Without the
    // governed vocabulary an incumbent practice site cannot be told from an
    // unknown host - and the failure mode of guessing is exactly the one this
    // module exists to remove.
    return {
      governedServiceTerms: [],
      vocabularyAvailable: false,
      classify: (h) => ({ kind: 'unclassifiable', name: h, why: 'SERVICE_VOCABULARY_UNAVAILABLE', open: false }),
    };
  }

  const isOwned = (h) => OWNED.some((o) => h === o || h.endsWith(`.${o}`));
  const flat = (h) => h.replace(/[^a-z0-9]/g, '');

  function classify(host) {
    const h = String(host || '').toLowerCase().replace(/^www\./, '');
    if (!h) return { kind: 'unclassifiable', name: host, why: 'EMPTY_HOST', open: false };

    if (isOwned(h)) return { kind: 'owned', name: h, why: 'OWNED_DOMAIN', open: false };
    for (const k in SOCIAL) if (h === k || h.endsWith('.' + k)) return { kind: 'social', name: SOCIAL[k], why: 'SOCIAL_SURFACE', open: false };

    // OPEN is decided first and only by positive recognition, so nothing can
    // reach it by falling through the tests below.
    if (FREE_BLOG_OR_CONTENT_FARM.test(h)) return { kind: 'open_unheld', name: h, why: 'FREE_BLOG_OR_CONTENT_FARM', open: true };
    if (PARKED_OR_DEAD.test(h)) return { kind: 'open_unheld', name: h, why: 'PARKED_OR_DEAD_DOMAIN', open: true };
    if (CDN_OR_ASSET_HOST.test(h)) return { kind: 'open_unheld', name: h, why: 'CDN_OR_ASSET_HOST_NOT_A_PAGE', open: true };

    if (GOV_EDU.test(h)) return { kind: 'institutional', name: h, why: 'GOVERNMENT_OR_ACADEMIC', open: false };
    if (US_STATE_LEGISLATURE.test(h)) return { kind: 'institutional', name: h, why: 'LEGISLATURE', open: false };
    if (PUBLIC_BODY.test(h)) return { kind: 'institutional', name: h, why: 'REGULATOR_OR_PUBLIC_BODY', open: false };
    if (CA_GOV.test(h)) return { kind: 'institutional', name: h, why: 'GOVERNMENT_OR_ACADEMIC', open: false };
    if (INSTITUTION_SUFFIX.test(h) || INSTITUTION_NAMES.test(h)) return { kind: 'institutional', name: h, why: 'HEALTH_SERVICE_JOURNAL_OR_REFERENCE', open: false };
    if (HOSPITAL_MARKERS.test(h)) return { kind: 'institutional', name: h, why: 'HOSPITAL_OR_HEALTH_SYSTEM', open: false };

    if (DIRECTORY_MARKETPLACE.test(h)) return { kind: 'incumbent', name: h, why: 'DIRECTORY_MARKETPLACE_OR_AGGREGATOR', open: false };

    const f = flat(h);
    const governedHit = GOVERNED_SERVICE_TERMS.find((t) => f.includes(t.replace(/[^a-z0-9]/g, '')));
    if (governedHit) return { kind: 'incumbent', name: h, why: `SERVICE_PROVIDER_GOVERNED_TERM:${governedHit}`, open: false };
    const stemHit = PROVIDER_STEMS.find((t) => f.includes(t));
    if (stemHit) return { kind: 'incumbent', name: h, why: `SERVICE_PROVIDER_MARKER:${stemHit}`, open: false };

    // No fallthrough into "open". An unrecognised host is unrecognised, and an
    // unrecognised host is not open ground.
    return { kind: 'unclassifiable', name: h, why: 'NOT_RECOGNISED', open: false };
  }

  return { classify, governedServiceTerms: GOVERNED_SERVICE_TERMS, vocabularyAvailable: true };
}

module.exports = { createClassifier, isOpenKind, KINDS, OPEN_KINDS };
