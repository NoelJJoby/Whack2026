export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Named purposes for random streams. Each draw site gets its own stream so
 * adding a new draw elsewhere never shifts existing results.
 */
export type Purpose =
  | 'action'
  | 'target'
  | 'claim'
  | 'order'
  | 'distort'
  | 'notice'
  | 'verify'
  | 'stub'
  | 'traits'
  | 'event'
  | 'text';

/** FNV-1a over the joined key parts, finished with the murmur3 fmix32 avalanche. */
export function hashKey(...parts: Array<string | number>): number {
  const s = parts.join('\u001f');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Integer in [0, n). */
  int(n: number): number;
  chance(p: number): boolean;
  /**
   * Sample a key from (unnormalised) probabilities, walking keys in `order`
   * so the result never depends on object key order. Returns the draw too,
   * for logging.
   */
  pick<K extends string>(probs: Partial<Record<K, number>>, order: readonly K[]): { value: K; draw: number };
  /** Sample an item with the given non-negative weights. */
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  shuffle<T>(items: readonly T[]): T[];
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  const rng: Rng = {
    next,
    int: (n) => Math.floor(next() * n),
    chance: (p) => next() < p,
    pick(probs, order) {
      const keys = order.filter((k) => (probs[k] ?? 0) > 0);
      if (keys.length === 0) throw new Error('pick: no positive probabilities');
      const total = keys.reduce((s, k) => s + (probs[k] ?? 0), 0);
      const draw = next();
      let acc = 0;
      for (const k of keys) {
        acc += (probs[k] ?? 0) / total;
        if (draw < acc) return { value: k, draw };
      }
      return { value: keys[keys.length - 1], draw };
    },
    weighted(items, weights) {
      if (items.length === 0) throw new Error('weighted: no items');
      const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
      if (total <= 0) return items[Math.floor(next() * items.length)];
      const draw = next() * total;
      let acc = 0;
      for (let i = 0; i < items.length; i++) {
        acc += Math.max(0, weights[i]);
        if (draw < acc) return items[i];
      }
      return items[items.length - 1];
    },
    shuffle(items) {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
  return rng;
}

/** A stream seeded from (run seed, tick, agent id, purpose). */
export function stream(runSeed: number, tick: number, agentId: string, purpose: Purpose): Rng {
  return createRng(hashKey(runSeed, tick, agentId, purpose));
}

/** Streams bound to one (run seed, tick, agent). */
export type RngFactory = (purpose: Purpose) => Rng;

export function rngFactory(runSeed: number, tick: number, agentId: string): RngFactory {
  return (purpose) => stream(runSeed, tick, agentId, purpose);
}
