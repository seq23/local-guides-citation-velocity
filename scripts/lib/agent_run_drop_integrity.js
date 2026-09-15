'use strict';
/**
 * Integrity of a landed Twin Agent drop, decided in ONE place.
 *
 * Twin Agent commits raw run folders straight to main under
 * data/report_fixes/agent_runs/<date>/<vertical>/. This repo does not own that
 * writer, and the writer has twice delivered bytes that were not the artifacts
 * its manifest names:
 *
 *   2026-07-20 personal-injury - the manifest arrived byte-corrupted
 *     ("som�_path", "personal-inqury") and every artifact was an unresolved
 *     {"_fetchBase64":"local:/agent/current/generated/..."} pointer. Repaired by
 *     hand three days later (75cfb63ee) into a QUARANTINED manifest.
 *   2026-09-15 dentistry - all four files were the SAME 15-byte non-UTF-8 blob,
 *     differing in one byte. agent_run_manifest.json did not parse. The
 *     normalizer died on JSON.parse, Velocity Content Release went red, and
 *     agent-artifact-continuity swallowed the parse error into `{}` and reported
 *     "vertical mismatch: undefined" - naming a symptom two steps removed from
 *     the defect.
 *
 * Both times the repo accepted the bytes because nothing between "a file named
 * agent_run_manifest.json exists" and "JSON.parse it" asked whether the file WAS a
 * manifest. Every reader answered that question differently: one crashed, one
 * `continue`d in silence, one treated garbage as an empty manifest.
 *
 * This module is the single answer. Readers classify a drop through
 * inspectRunDrop(); the intake normalizer converts a defective drop into a NAMED
 * QUARANTINED manifest through quarantineRunDrop(), preserving the rejected bytes
 * beside it; and every JSON this repo writes into data/report_fixes goes through
 * writeJsonVerified(), which refuses to leave a file on disk that does not
 * round-trip through JSON.parse.
 */
const fs = require('fs');
const path = require('path');

const RUNS_REL = 'data/report_fixes/agent_runs';
const MANIFEST_NAME = 'agent_run_manifest.json';
const REJECTED_SUFFIX = '.rejected';
const ARTIFACT_KEYS = ['csv_path', 'html_path', 'json_path'];
const QUARANTINE_REASON_PREFIX = 'defective_drop';
const LOCAL_FETCH_RE = /^\{\s*"_fetchBase64"\s*:\s*"local:\/\/?agent\/current\/generated\//;

function hexPreview(buf, max = 16) {
  return Array.from(buf.subarray(0, max)).map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

/** Bytes are text if they decode as UTF-8 without loss and carry no control bytes other than \t \r \n. */
function textDefect(buf) {
  if (!buf.length) return 'empty_file';
  const decoded = buf.toString('utf8');
  if (Buffer.byteLength(decoded, 'utf8') !== buf.length || decoded.includes('�')) return 'not_utf8_text';
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(decoded)) return 'control_bytes_in_text';
  return null;
}

/**
 * Read a JSON file and report exactly why it is not usable, or return the value.
 * Never returns a fallback: "unparseable" is a finding, not an absence.
 */
function readJsonStrict(abs, { requireObject = true } = {}) {
  if (!fs.existsSync(abs)) return { ok: false, defect: 'missing', detail: abs };
  const buf = fs.readFileSync(abs);
  const text = textDefect(buf);
  if (text) return { ok: false, defect: `unparseable:${text}`, detail: `bytes=${buf.length} head_hex=${hexPreview(buf)}`, bytes: buf.length };
  let value;
  try { value = JSON.parse(buf.toString('utf8').replace(/^﻿/, '')); } catch (err) {
    return { ok: false, defect: 'unparseable:invalid_json', detail: `${err.message} bytes=${buf.length} head_hex=${hexPreview(buf)}`, bytes: buf.length };
  }
  if (requireObject && (!value || typeof value !== 'object' || Array.isArray(value))) return { ok: false, defect: 'not_an_object', detail: `type=${Array.isArray(value) ? 'array' : typeof value}`, bytes: buf.length };
  return { ok: true, value, bytes: buf.length };
}

/**
 * Defects in the artifacts a PARSED, non-quarantined manifest points at.
 * A quarantined manifest is a named stop already; its artifacts are audit material.
 */
function artifactDefects(root, manifest) {
  const defects = [];
  for (const key of ARTIFACT_KEYS) {
    const rel = manifest[key];
    if (!rel) continue;
    const abs = path.resolve(root, rel);
    if (!fs.existsSync(abs)) { defects.push(`${key}:missing_file:${rel}`); continue; }
    const buf = fs.readFileSync(abs);
    const text = textDefect(buf);
    if (text) { defects.push(`${key}:${text}:${rel}:bytes=${buf.length}:head_hex=${hexPreview(buf)}`); continue; }
    const decoded = buf.toString('utf8').trim();
    if (LOCAL_FETCH_RE.test(decoded)) { defects.push(`${key}:unresolved_local_fetch_artifact:${rel}`); continue; }
    if (key === 'json_path') {
      const parsed = readJsonStrict(abs);
      if (!parsed.ok) defects.push(`${key}:${parsed.defect}:${rel}:${parsed.detail}`);
    }
  }
  return defects;
}

/**
 * Classify one landed run folder.
 *
 *   { state: 'PARSED',    manifest, manifestRel }              - usable; may still be QUARANTINED by its own word
 *   { state: 'DEFECTIVE', defects:[...], manifest|null, ... } - manifest unparseable, or artifacts are not artifacts
 *
 * `runDate` and `vertical` are derived from the directory, which is the only part of
 * a defective drop that can be trusted, so callers can age the drop against the
 * absorption window without reading the manifest.
 */
function inspectRunDrop(root, manifestRel) {
  const parts = manifestRel.replace(/\\/g, '/').split('/');
  const vertical = parts[parts.length - 2] || '';
  const runDate = parts[parts.length - 3] || '';
  const abs = path.resolve(root, manifestRel);
  const read = readJsonStrict(abs);
  if (!read.ok) {
    return { state: 'DEFECTIVE', manifestRel, runDate, vertical, manifest: null, manifest_defect: read.defect, defects: [`manifest:${read.defect}:${manifestRel}:${read.detail}`] };
  }
  const manifest = read.value;
  if (String(manifest.status || '').toUpperCase() === 'QUARANTINED') return { state: 'PARSED', manifestRel, runDate, vertical, manifest, defects: [] };
  const defects = artifactDefects(root, manifest);
  if (defects.length) return { state: 'DEFECTIVE', manifestRel, runDate, vertical, manifest, manifest_defect: null, defects };
  return { state: 'PARSED', manifestRel, runDate, vertical, manifest, defects: [] };
}

/**
 * Write JSON such that a file only ever exists at `abs` if it round-trips.
 *
 * Serialize, parse the serialization back, write to a sibling temp file, read THAT
 * back from disk and parse it, then rename over the target. A crash, a full disk, a
 * BigInt, an `undefined` top-level value, or a truncated write all throw with the
 * path in the message and leave the previous file untouched.
 */
function writeJsonVerified(abs, value) {
  let serialized;
  try { serialized = JSON.stringify(value, null, 2); } catch (err) { throw new Error(`writeJsonVerified:${abs}:value_does_not_serialize:${err.message}`); }
  if (typeof serialized !== 'string') throw new Error(`writeJsonVerified:${abs}:value_does_not_serialize (got ${serialized})`);
  JSON.parse(serialized);
  const body = `${serialized}\n`;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmp, body, 'utf8');
    const back = readJsonStrict(tmp, { requireObject: false });
    if (!back.ok) throw new Error(`writeJsonVerified:${abs}:readback_failed:${back.defect}:${back.detail}`);
    if (JSON.stringify(back.value) !== JSON.stringify(JSON.parse(serialized))) throw new Error(`writeJsonVerified:${abs}:readback_differs_from_value`);
    fs.renameSync(tmp, abs);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw err;
  }
}

/**
 * Turn a DEFECTIVE drop into a NAMED QUARANTINED manifest, in place.
 *
 * The bytes Twin Agent actually delivered are never destroyed: the original manifest
 * is moved to agent_run_manifest.json.rejected and its artifacts stay untouched, so
 * the folder remains the audit record of what arrived. The new manifest names the
 * defects, the writer that quarantined it, and what has to happen next. It is
 * written through writeJsonVerified, so a quarantine can never itself be the next
 * unparseable manifest.
 */
function quarantineRunDrop(root, inspection, { quarantinedBy, today }) {
  if (inspection.state !== 'DEFECTIVE') throw new Error(`quarantineRunDrop:${inspection.manifestRel}:not_defective`);
  const manifestAbs = path.resolve(root, inspection.manifestRel);
  const dirRel = path.posix.dirname(inspection.manifestRel);
  const rejectedRel = `${inspection.manifestRel}${REJECTED_SUFFIX}`;
  const rejectedAbs = path.resolve(root, rejectedRel);
  if (fs.existsSync(manifestAbs)) {
    if (fs.existsSync(rejectedAbs)) {
      // A second defective delivery on top of a quarantine: keep the first rejection too.
      fs.renameSync(rejectedAbs, `${rejectedAbs}.${Date.now()}`);
    }
    fs.renameSync(manifestAbs, rejectedAbs);
  }
  const original = inspection.manifest || {};
  const artifactPath = (ext) => {
    const fromManifest = original[`${ext}_path`];
    if (fromManifest && fs.existsSync(path.resolve(root, fromManifest))) return fromManifest;
    const guess = `${dirRel}/${inspection.vertical}.${ext}`;
    return fs.existsSync(path.resolve(root, guess)) ? guess : '';
  };
  const manifest = {
    source: original.source || 'twin_agent',
    run_date: original.run_date || inspection.runDate,
    vertical: inspection.vertical,
    csv_path: artifactPath('csv'),
    html_path: artifactPath('html'),
    json_path: artifactPath('json'),
    status: 'QUARANTINED',
    quarantine_reason: `${QUARANTINE_REASON_PREFIX}: ${inspection.defects.join('; ')}`,
    quarantine_action: `preserve the run folder for audit; the delivered manifest bytes are kept at ${rejectedRel}; exclude this run from absorption until Twin Agent re-delivers real CSV, HTML, and JSON artifacts with status READY_FOR_ABSORPTION`,
    quarantined_by: quarantinedBy,
    quarantined_at: today,
    rejected_manifest_path: rejectedRel,
    defects: inspection.defects
  };
  for (const key of ARTIFACT_KEYS) if (!manifest[key]) delete manifest[key];
  writeJsonVerified(manifestAbs, manifest);
  return { manifestRel: inspection.manifestRel, rejectedRel, manifest };
}

/** Walk every run folder and return the manifest paths it SHOULD contain, present or not. */
function walkRunFolders(root, runsRel = RUNS_REL) {
  const start = path.resolve(root, runsRel);
  const out = [];
  if (!fs.existsSync(start)) return out;
  for (const date of fs.readdirSync(start).sort()) {
    const dateAbs = path.join(start, date);
    if (!fs.statSync(dateAbs).isDirectory()) continue;
    for (const vertical of fs.readdirSync(dateAbs).sort()) {
      const runAbs = path.join(dateAbs, vertical);
      if (!fs.statSync(runAbs).isDirectory()) continue;
      out.push({ date, vertical, dirRel: `${runsRel}/${date}/${vertical}`, manifestRel: `${runsRel}/${date}/${vertical}/${MANIFEST_NAME}`, manifestExists: fs.existsSync(path.join(runAbs, MANIFEST_NAME)) });
    }
  }
  return out;
}

module.exports = { RUNS_REL, MANIFEST_NAME, REJECTED_SUFFIX, QUARANTINE_REASON_PREFIX, readJsonStrict, textDefect, artifactDefects, inspectRunDrop, writeJsonVerified, quarantineRunDrop, walkRunFolders };
