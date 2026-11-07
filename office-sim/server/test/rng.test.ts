import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createRng, hashKey, stream } from '../rng';

const seq = (n: number, f: () => number) => Array.from({ length: n }, f);

describe('rng', () => {
  it('same key gives the same sequence', () => {
    const a = stream(42, 3, 'lena', 'action');
    const b = stream(42, 3, 'lena', 'action');
    assert.deepEqual(seq(20, a.next), seq(20, b.next));
  });

  it('any key part changes the sequence', () => {
    const base = seq(5, stream(42, 3, 'lena', 'action').next);
    assert.notDeepEqual(base, seq(5, stream(43, 3, 'lena', 'action').next));
    assert.notDeepEqual(base, seq(5, stream(42, 4, 'lena', 'action').next));
    assert.notDeepEqual(base, seq(5, stream(42, 3, 'tom', 'action').next));
    assert.notDeepEqual(base, seq(5, stream(42, 3, 'lena', 'target').next));
  });

  it('extra draws on one purpose never shift another', () => {
    const before = stream(7, 1, 'tom', 'action').next();
    const target = stream(7, 1, 'tom', 'target');
    for (let i = 0; i < 100; i++) target.next();
    assert.equal(stream(7, 1, 'tom', 'action').next(), before);
  });

  it('hashKey separates parts unambiguously', () => {
    assert.notEqual(hashKey('ab', 'c'), hashKey('a', 'bc'));
    assert.notEqual(hashKey(1, 23), hashKey(12, 3));
  });

  it('pick is deterministic, follows the given order and skips zeros', () => {
    const probs = { a: 0.2, b: 0, c: 0.8 };
    const r1 = createRng(1).pick(probs, ['a', 'b', 'c']);
    const r2 = createRng(1).pick(probs, ['a', 'b', 'c']);
    assert.deepEqual(r1, r2);
    assert.equal(r1.value, r1.draw < 0.2 ? 'a' : 'c');
    for (let s = 0; s < 200; s++) assert.notEqual(createRng(s).pick(probs, ['a', 'b', 'c']).value, 'b');
  });

  it('pick frequencies match probabilities', () => {
    const rng = createRng(99);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 20000; i++) counts[rng.pick({ a: 0.25, b: 0.75 }, ['a', 'b']).value]++;
    assert.ok(Math.abs(counts.a / 20000 - 0.25) < 0.015);
  });

  it('shuffle is a deterministic permutation', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'];
    const s1 = createRng(5).shuffle(items);
    assert.deepEqual(s1, createRng(5).shuffle(items));
    assert.deepEqual([...s1].sort(), items);
    assert.deepEqual(items, ['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('weighted never picks zero-weight items when others are positive', () => {
    const rng = createRng(3);
    for (let i = 0; i < 500; i++) assert.notEqual(rng.weighted(['x', 'y', 'z'], [1, 0, 2]), 'y');
  });
});
