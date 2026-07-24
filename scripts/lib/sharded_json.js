'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '../..');

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function ensureCleanDir(abs) {
  fs.rmSync(abs, { recursive: true, force: true });
  fs.mkdirSync(abs, { recursive: true });
}

function writeAtomic(abs, buffer) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, abs);
}

class ShardedJsonWriter {
  constructor(relDir, options = {}) {
    this.relDir = relDir.replace(/\\/g, '/').replace(/\/$/, '');
    this.absDir = path.join(ROOT, this.relDir);
    this.recordsPerShard = Number(options.recordsPerShard || 5000);
    this.maxBytesPerShard = Number(options.maxBytesPerShard || 8 * 1024 * 1024);
    this.metadata = options.metadata || {};
    this.compression = options.compression === 'none' ? 'none' : 'gzip';
    this.records = [];
    this.approxBytes = 0;
    this.totalRecords = 0;
    this.shards = [];
    ensureCleanDir(this.absDir);
  }

  add(record) {
    const serialized = JSON.stringify(record);
    const bytes = Buffer.byteLength(serialized, 'utf8') + 2;
    if (this.records.length && (this.records.length >= this.recordsPerShard || this.approxBytes + bytes > this.maxBytesPerShard)) {
      this.flush();
    }
    this.records.push(record);
    this.approxBytes += bytes;
  }

  flush() {
    if (!this.records.length) return;
    const partNumber = this.shards.length + 1;
    const filename = `part-${String(partNumber).padStart(5, '0')}.json${this.compression === 'gzip' ? '.gz' : ''}`;
    const rel = `${this.relDir}/${filename}`;
    const payload = {
      schema_version: '1.0',
      part: partNumber,
      count: this.records.length,
      first_id: this.records[0]?.opportunity_id || null,
      last_id: this.records[this.records.length - 1]?.opportunity_id || null,
      records: this.records
    };
    const rawBuffer = Buffer.from(JSON.stringify(payload, null, 2) + '\n', 'utf8');
    const buffer = this.compression === 'gzip' ? zlib.gzipSync(rawBuffer, { level: 9, mtime: 0 }) : rawBuffer;
    const sha256 = sha256Buffer(buffer);
    writeAtomic(path.join(ROOT, rel), buffer);
    this.shards.push({
      path: rel,
      part: partNumber,
      record_count: this.records.length,
      byte_count: buffer.length,
      uncompressed_byte_count: rawBuffer.length,
      compression: this.compression,
      sha256,
      first_id: payload.first_id,
      last_id: payload.last_id
    });
    this.totalRecords += this.records.length;
    this.records = [];
    this.approxBytes = 0;
  }

  finalize() {
    this.flush();
    const aggregateInput = this.shards.map((s) => `${s.part}:${s.record_count}:${s.sha256}:${s.first_id}:${s.last_id}`).join('\n');
    const index = {
      schema_version: '2.1',
      ...this.metadata,
      record_count: this.totalRecords,
      shard_count: this.shards.length,
      records_per_shard_target: this.recordsPerShard,
      max_bytes_per_shard: this.maxBytesPerShard,
      compression: this.compression,
      aggregate_sha256: sha256Buffer(Buffer.from(aggregateInput, 'utf8')),
      shards: this.shards
    };
    writeAtomic(path.join(this.absDir, 'index.json'), Buffer.from(JSON.stringify(index, null, 2) + '\n', 'utf8'));
    return index;
  }
}

function readShardIndex(relDir = 'data/queries/citation_fanout_opportunities_100k') {
  const abs = path.join(ROOT, relDir, 'index.json');
  return JSON.parse(fs.readFileSync(abs, 'utf8'));
}

function *iterateShardedRecords(relDir = 'data/queries/citation_fanout_opportunities_100k') {
  const index = readShardIndex(relDir);
  for (const shard of index.shards || []) {
    const buffer = fs.readFileSync(path.join(ROOT, shard.path));
    const raw = shard.compression === 'gzip' || shard.path.endsWith('.gz') ? zlib.gunzipSync(buffer) : buffer;
    const payload = JSON.parse(raw.toString('utf8'));
    for (const record of payload.records || []) yield record;
  }
}

function validateShardedDataset(relDir = 'data/queries/citation_fanout_opportunities_100k', expectedCount = null) {
  const errors = [];
  const index = readShardIndex(relDir);
  let count = 0;
  const ids = new Set();
  const aggregate = [];
  let priorLast = null;
  for (const shard of index.shards || []) {
    const abs = path.join(ROOT, shard.path);
    if (!fs.existsSync(abs)) { errors.push(`missing_shard:${shard.path}`); continue; }
    const buffer = fs.readFileSync(abs);
    const actualHash = sha256Buffer(buffer);
    if (actualHash !== shard.sha256) errors.push(`shard_hash_mismatch:${shard.path}`);
    if (buffer.length !== Number(shard.byte_count)) errors.push(`shard_size_mismatch:${shard.path}`);
    let payload;
    try {
      const raw = shard.compression === 'gzip' || shard.path.endsWith('.gz') ? zlib.gunzipSync(buffer) : buffer;
      payload = JSON.parse(raw.toString('utf8'));
      if (shard.uncompressed_byte_count && raw.length !== Number(shard.uncompressed_byte_count)) errors.push(`shard_uncompressed_size_mismatch:${shard.path}`);
    } catch (e) { errors.push(`invalid_shard_json:${shard.path}:${e.message}`); continue; }
    if ((payload.records || []).length !== Number(shard.record_count)) errors.push(`shard_count_mismatch:${shard.path}`);
    if ((payload.records || [])[0]?.opportunity_id !== shard.first_id) errors.push(`shard_first_id_mismatch:${shard.path}`);
    if ((payload.records || []).at(-1)?.opportunity_id !== shard.last_id) errors.push(`shard_last_id_mismatch:${shard.path}`);
    if (priorLast && shard.first_id && String(shard.first_id) <= String(priorLast)) errors.push(`shard_range_not_increasing:${shard.path}`);
    priorLast = shard.last_id;
    for (const record of payload.records || []) {
      count += 1;
      const id = record?.opportunity_id;
      if (!id) errors.push(`missing_opportunity_id:${shard.path}:${count}`);
      else if (ids.has(id)) errors.push(`duplicate_opportunity_id:${id}`);
      else ids.add(id);
    }
    aggregate.push(`${shard.part}:${shard.record_count}:${shard.sha256}:${shard.first_id}:${shard.last_id}`);
  }
  const aggregateSha = sha256Buffer(Buffer.from(aggregate.join('\n'), 'utf8'));
  if (aggregateSha !== index.aggregate_sha256) errors.push('aggregate_sha256_mismatch');
  if (count !== Number(index.record_count)) errors.push(`index_record_count_mismatch:${count}:${index.record_count}`);
  if (expectedCount !== null && count !== Number(expectedCount)) errors.push(`expected_record_count_mismatch:${count}:${expectedCount}`);
  if ((index.shards || []).length !== Number(index.shard_count)) errors.push('index_shard_count_mismatch');
  return { ok: errors.length === 0, errors, record_count: count, shard_count: (index.shards || []).length, aggregate_sha256: aggregateSha, index };
}

module.exports = {
  ROOT,
  ShardedJsonWriter,
  iterateShardedRecords,
  readShardIndex,
  validateShardedDataset,
  sha256Buffer
};
