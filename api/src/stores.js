// Where attempts are kept. Azure Table Storage in production; a JSON file for local testing;
// memory for unit tests. Each store has create / get / update / list.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export class MemoryStore {
  constructor() { this.rows = new Map(); }
  async create(a) { this.rows.set(`${a.moduleId}|${a.id}`, structuredClone(a)); }
  async get(moduleId, id) { const r = this.rows.get(`${moduleId}|${id}`); return r ? structuredClone(r) : null; }
  async update(a) { await this.create(a); }
  async list({ moduleId } = {}) { return [...this.rows.values()].filter((r) => !moduleId || r.moduleId === moduleId).map((r) => structuredClone(r)); }
}

/** Keeps attempts in a JSON file (local testing only). */
export class FileStore extends MemoryStore {
  constructor(path) { super(); this.path = path; this.loaded = null; }
  async load() {
    this.loaded ??= readFile(this.path, 'utf8').then((t) => { for (const a of JSON.parse(t)) this.rows.set(`${a.moduleId}|${a.id}`, a); }).catch(() => {});
    return this.loaded;
  }
  async save() { await mkdir(dirname(this.path), { recursive: true }); await writeFile(this.path, JSON.stringify([...this.rows.values()], null, 2)); }
  async create(a) { await this.load(); await super.create(a); await this.save(); }
  async get(m, id) { await this.load(); return super.get(m, id); }
  async list(q) { await this.load(); return super.list(q); }
}

// Table Storage keys can't contain / \ # ? or control characters.
const key = (s) => encodeURIComponent(String(s)).replace(/[!'()*%]/g, (c) => `_${c.charCodeAt(0).toString(16)}`);

/** Azure Table Storage. Answers are stored as JSON text (a table property can't hold a list). */
export class TableStore {
  constructor(connectionString, tableName = 'attempts') { this.connectionString = connectionString; this.tableName = tableName; }
  async client() {
    if (!this.ready) {
      this.ready = (async () => {
        const { TableClient } = await import('@azure/data-tables');
        const c = TableClient.fromConnectionString(this.connectionString, this.tableName);
        await c.createTable().catch((e) => { if (e.statusCode !== 409) throw e; });
        return c;
      })();
    }
    return this.ready;
  }
  toEntity(a) { const { answers, ...rest } = a; return { partitionKey: key(a.moduleId), rowKey: a.id, ...rest, answers: JSON.stringify(answers || []) }; }
  fromEntity(e) {
    const { partitionKey, rowKey, etag, timestamp, 'odata.etag': _, ...rest } = e;
    let answers = [];
    try { answers = JSON.parse(rest.answers || '[]'); } catch {}
    return { ...rest, answers };
  }
  async create(a) { await (await this.client()).createEntity(this.toEntity(a)); }
  async get(moduleId, id) {
    try { return this.fromEntity(await (await this.client()).getEntity(key(moduleId), id)); } catch (e) { if (e.statusCode === 404) return null; throw e; }
  }
  async update(a) { await (await this.client()).upsertEntity(this.toEntity(a), 'Replace'); }
  async list({ moduleId } = {}) {
    const c = await this.client();
    const filter = moduleId ? { queryOptions: { filter: `PartitionKey eq '${key(moduleId).replace(/'/g, "''")}'` } } : undefined;
    const out = [];
    for await (const e of c.listEntities(filter)) out.push(this.fromEntity(e));
    return out;
  }
}

/** Store from settings: HQSCALE_STORAGE (connection string) → Table Storage, otherwise memory. */
export function storeFromEnv(env = process.env) {
  const conn = env.HQSCALE_STORAGE || env.AzureWebJobsStorage;
  return conn ? new TableStore(conn, env.HQSCALE_TABLE || 'attempts') : new MemoryStore();
}
