'use strict';
/**
 * Exact repair of double-encoded UTF-8 ("mojibake") in text this repo did not write.
 *
 * 2026-09-30 trt: Twin Agent delivered data/report_fixes/agent_runs/2026-09-30/trt/
 * trt.csv with 427 sequences such as the em dash "—" (e2 80 94) stored as
 * c3 a2 c2 80 c2 94 - the UTF-8 bytes had been decoded as Latin-1 and encoded
 * again. The HTML and JSON artifacts of the same run were clean, and the CSV
 * itself also carried correctly encoded "—" and "→" elsewhere, so the file is
 * MIXED: a whole-file re-decode would have destroyed the good characters.
 * Intake copied the bytes unchanged into every derived ledger and into the
 * rendered trt/index.html ("TRT injections vs gel â how to decide"), where
 * validate_search_quality_basics refused `trt/index.html:mojibake` and blocked
 * every release from 30 Sep 14:23 until the source was repaired.
 *
 * Nothing between "the artifact is UTF-8 text" (agent_run_drop_integrity.textDefect)
 * and "render it on a public page" asked whether the text was ENCODED ONCE. This
 * module is that question, answered exactly:
 *
 *   - repairDoubleEncodedUtf8() rewrites only a run of characters that, read back
 *     as the single bytes they were mis-decoded from (Latin-1, or a cp1252 C1
 *     glyph), forms one complete, valid UTF-8 code point. Every other character is
 *     left byte-for-byte as delivered. The pass repeats (bounded) so a
 *     triple-encoded sequence - the 2026-09-25 medium-articles shape - also decodes.
 *   - MOJIBAKE_RE is the one definition of "still mojibake". It is the same pattern
 *     validate_search_quality_basics.js refuses on rendered pages, imported from
 *     here so intake and release can never disagree about what counts.
 *   - hasMojibake(text) after a repair is the refusal signal: a drop whose text
 *     cannot be decoded exactly is DEFECTIVE at intake (named), never a surprise at
 *     release.
 */

// Same shape scripts/validators/validate_search_quality_basics.js refuses on every
// rendered page: `â` + a C1 control / cp1252 punctuation glyph (UTF-8 three-byte
// punctuation read as Latin-1 or cp1252), `Ã¢` (the same, read twice), `Â` before a
// non-letter (a mis-read NBSP or C2-lead byte), and `Ã` + any Latin-1 continuation.
const MOJIBAKE_RE = /â(?:|€™|€œ|€|€˜|€")|Ã¢|Â(?=[^A-Za-z]|$)|Ã[\u0080-\u00BF]/;

// cp1252 maps bytes 0x80-0x9F to these glyphs; Latin-1 maps them to C1 controls.
// A mis-decoding pass may have used either, so both read back to the same byte.
const CP1252_GLYPH_TO_BYTE = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F
};
const CP1252_GLYPHS = Object.keys(CP1252_GLYPH_TO_BYTE).join('');
// One UTF-8 continuation byte (0x80-0xBF) as it looks after a Latin-1 or cp1252 mis-decode.
const CONTINUATION = `(?:[\\u0080-\\u00BF${CP1252_GLYPHS}])`;
// A complete UTF-8 sequence in mis-decoded form: lead byte 0xC2-0xDF + 1, 0xE0-0xEF + 2, 0xF0-0xF4 + 3.
const SEQUENCE_RE = new RegExp(`[\\u00C2-\\u00DF]${CONTINUATION}|[\\u00E0-\\u00EF]${CONTINUATION}{2}|[\\u00F0-\\u00F4]${CONTINUATION}{3}`, 'g');

function byteOf(ch) {
  const code = ch.codePointAt(0);
  if (code <= 0xFF) return code;
  const mapped = CP1252_GLYPH_TO_BYTE[ch];
  return mapped === undefined ? -1 : mapped;
}

/** Decode one mis-decoded run back to the code point it was, or return null when it is not one. */
function decodeSequence(segment) {
  const bytes = [];
  for (const ch of segment) { const b = byteOf(ch); if (b < 0) return null; bytes.push(b); }
  const buf = Buffer.from(bytes);
  const decoded = buf.toString('utf8');
  if (decoded.includes('�') || Buffer.byteLength(decoded, 'utf8') !== buf.length) return null;
  if ([...decoded].length !== 1) return null;
  return decoded;
}

// C1 controls are invisible in a terminal; show the mis-decoded run as \uXXXX so a log names the shape.
function escapeForLog(s) { return JSON.stringify(String(s).replace(/[\u0080-\u009F]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)); }

function repairOnce(text) {
  const samples = new Map();
  let count = 0;
  const out = String(text).replace(SEQUENCE_RE, (segment) => {
    const decoded = decodeSequence(segment);
    if (decoded === null) return segment;
    count += 1;
    const key = `${escapeForLog(segment)} -> ${escapeForLog(decoded)}`;
    samples.set(key, (samples.get(key) || 0) + 1);
    return decoded;
  });
  return { text: out, count, samples };
}

/**
 * Repair every exactly-decodable double-encoded sequence in `text`.
 *
 * Returns { text, repaired, passes, residual, residual_samples, samples }:
 *   repaired         - total sequences decoded across all passes (0 = text was already clean)
 *   passes           - sequences decoded per pass, e.g. [427] or [11, 11] for a triple-encoded file
 *   residual         - true when MOJIBAKE_RE still matches after repair: the file must be REFUSED
 *   residual_samples - up to 5 distinct surviving matches, for the named error
 *   samples          - { "\"â\\u0080\\u0094\" -> \"—\"": 134, ... } for the evidence ledger
 */
function repairDoubleEncodedUtf8(text, { maxPasses = 3 } = {}) {
  let current = String(text == null ? '' : text);
  const passes = [];
  const samples = {};
  for (let i = 0; i < maxPasses; i++) {
    const pass = repairOnce(current);
    if (!pass.count) break;
    passes.push(pass.count);
    for (const [key, n] of pass.samples) samples[key] = (samples[key] || 0) + n;
    current = pass.text;
  }
  const residualMatches = current.match(new RegExp(MOJIBAKE_RE.source, 'g')) || [];
  return {
    text: current,
    repaired: passes.reduce((a, b) => a + b, 0),
    passes,
    residual: residualMatches.length > 0,
    residual_count: residualMatches.length,
    residual_samples: [...new Set(residualMatches)].slice(0, 5).map((m) => JSON.stringify(m)),
    samples
  };
}

function hasMojibake(text) { return MOJIBAKE_RE.test(String(text == null ? '' : text)); }

module.exports = { MOJIBAKE_RE, repairDoubleEncodedUtf8, hasMojibake, decodeSequence };
