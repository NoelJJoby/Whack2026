import { workdayTime } from '../shared/workday';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { World } from './engine-types';
import type { RunMetadata, BusinessReport } from '../shared/reports';

export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
interface Transaction { schemaVersion: 1; runId: string; sequence: number; tick: number; kind: 'start' | 'tick' | 'archive' | 'complete' | 'input' | 'settings'; revision: number; world: World; audit: unknown; hash: string; }
interface JournalHead { signature: string; end: number; sequence: number; tick: number; kind: Transaction['kind']; worldHash: string; }
/** A newline is the commit marker. A torn final line is truncated before appending. */
export class RunStore {
  // Cache only the committed tail's metadata, never mutable world snapshots.
  // Full reads/recovery still validate every transaction; external edits invalidate the tail.
  private heads = new Map<string, JournalHead>();
  constructor(readonly directory: string) { mkdirSync(directory, { recursive: true }); }
  private signature(path: string) {
    if (!existsSync(path)) return '';
    const s = statSync(path, { bigint: true });
    return `${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
  }
  private head(id: string): JournalHead | undefined {
    const path = this.path(id, 'journal.jsonl');
    const signature = this.signature(path);
    if (!signature) { this.heads.delete(id); return undefined; }
    const cached = this.heads.get(id);
    if (cached?.signature === signature) return cached;
    const tx = this.read(id).at(-1);
    if (!tx) return undefined;
    const head = { signature, end: readFileSync(path).lastIndexOf(10) + 1, sequence: tx.sequence, tick: tx.tick, kind: tx.kind, worldHash: digest(tx.world) };
    this.heads.set(id, head);
    return head;
  }
  private path(id: string, suffix: string) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Invalid run/report id');
    return join(this.directory, `${id}.${suffix}`);
  }
  private atomic(path: string, data: unknown) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(data)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path);
  }
  create(world: World): RunMetadata {
    const id = randomUUID();
    const meta: RunMetadata = { id, seed: world.seed, createdAt: new Date().toISOString(), tick: world.tick, sequence: 0, status: 'active', reports: [] };
    this.atomic(this.path(id, 'meta.json'), meta);
    this.commit(id, world, 'start', null);
    return this.metadata(id);
  }
  metadata(id: string): RunMetadata {
    const meta = JSON.parse(readFileSync(this.path(id, 'meta.json'), 'utf8')) as RunMetadata;
    const tx = this.head(id);
    return tx ? { ...meta, tick: tx.tick, sequence: tx.sequence, status: tx.kind === 'complete' ? 'complete' : tx.kind === 'archive' ? 'partial' : 'active' } : meta;
  }
  list(): RunMetadata[] { return readdirSync(this.directory).filter(f => f.endsWith('.meta.json')).map(f => this.metadata(f.slice(0, -10))).sort((a,b) => b.createdAt.localeCompare(a.createdAt)); }
  read(id: string): Transaction[] {
    const path = this.path(id, 'journal.jsonl');
    if (!existsSync(path)) return [];
    const contents = readFileSync(path, 'utf8');
    const lines = contents.split('\n'); lines.pop();
    return lines.map((line, i) => {
      let tx: Transaction;
      try { tx = JSON.parse(line); } catch { throw new Error(`Corrupted committed journal ${id}:${i + 1}`); }
      const { hash, ...payload } = tx;
      if (tx.runId !== id || tx.sequence !== i + 1 || hash !== digest(payload)) throw new Error(`Invalid journal transaction ${id}:${i + 1}`);
      return tx;
    });
  }
  commit(id: string, world: World, kind: Transaction['kind'], audit: unknown): Transaction {
    const last = this.head(id);
    const worldHash = digest(world);
    if (last?.tick === world.tick && last.kind === kind && last.worldHash === worldHash) return this.read(id).at(-1)!;
    if (kind === 'tick' && last && world.tick !== last.tick + 1) throw new Error('Nonconsecutive tick commit');
    const payload = { schemaVersion: 1 as const, runId: id, sequence: (last?.sequence ?? 0) + 1, tick: world.tick, kind, revision: world.tick, simulatedDate: workdayTime(world.tick), world, audit };
    const tx = { ...payload, hash: digest(payload) };
    const path = this.path(id, 'journal.jsonl');
    const end = last?.end ?? 0;
    if (existsSync(path) && statSync(path).size > end) truncateSync(path, end);
    const line = `${JSON.stringify(tx)}\n`;
    const fd = openSync(path, 'a', 0o600);
    try { appendFileSync(fd, line); fsyncSync(fd); } finally { closeSync(fd); }
    this.heads.set(id, { signature: this.signature(path), end: end + Buffer.byteLength(line), sequence: tx.sequence, tick: tx.tick, kind, worldHash });
    return tx;
  }
  recover(id: string): World { const tx = this.read(id).at(-1); if (!tx) throw new Error('Missing starting snapshot'); return structuredClone(tx.world); }
  saveReport(report: BusinessReport) {
    this.atomic(this.path(report.id, 'report.json'), report);
    const meta = this.metadata(report.runId);
    if (!meta.reports.includes(report.id)) meta.reports.push(report.id);
    this.atomic(this.path(report.runId, 'meta.json'), meta);
  }
  reports(id: string): BusinessReport[] { return readdirSync(this.directory).filter(f => f.endsWith('.report.json')).map(f => JSON.parse(readFileSync(join(this.directory, f), 'utf8')) as BusinessReport).filter(r => r.runId === id).sort((a,b) => a.version - b.version); }
}
