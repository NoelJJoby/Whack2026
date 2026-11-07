import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emotionFor, type EmotionInput } from './voice/emotion';
import { EMOTION_VOICE, WHISPER, basePitch, voiceFor } from './voice/voices';
import { alignToText, babbleStep, BabbleScheduler, type TypingSnapshot } from './voice/schedule';
import { buildRound } from './dialogueQueue';
import { mockHistory } from './mocks';

const calm: EmotionInput = { quit: false, action: 'work', stress: 50, stressDelta: 0, burnout: 20, trust: 60, events: [] };
const feel = (change: Partial<EmotionInput>) => emotionFor({ ...calm, ...change });

test('emotion: angry, then sad, then happy, then normal', () => {
  assert.equal(feel({}), 'normal');
  assert.equal(feel({ action: 'complain' }), 'angry');
  assert.equal(feel({ action: 'leak', stress: 10 }), 'angry');
  assert.equal(feel({ stress: 70, stressDelta: 10 }), 'angry');
  assert.equal(feel({ stress: 60, stressDelta: 10 }), 'normal', 'jump must end above 60');
  assert.equal(feel({ quit: true, trust: 29 }), 'angry', 'rage quit');
  assert.equal(feel({ quit: true, trust: 30 }), 'sad');
  assert.equal(feel({ burnout: 70 }), 'sad');
  assert.equal(feel({ stress: 61, action: 'slack_off' }), 'sad');
  assert.equal(feel({ stress: 61, action: 'interview' }), 'sad');
  assert.equal(feel({ stress: 60, action: 'interview' }), 'normal');
  assert.equal(feel({ events: ['surprise_bonus'], stress: 59 }), 'happy');
  assert.equal(feel({ events: ['surprise_bonus'], stress: 60 }), 'normal');
  assert.equal(feel({ stress: 39, stressDelta: -5 }), 'happy');
  assert.equal(feel({ stress: 39, stressDelta: -4 }), 'normal');
  assert.equal(feel({ stress: 24 }), 'happy');
  assert.equal(feel({ stress: 24, action: 'complain' }), 'angry', 'angry wins over happy');
});

test('rounds carry each line\'s action and emotion', () => {
  const last = mockHistory.at(-1)!;
  const frame = { ...last, tick: last.tick + 1, events: [{ type: 'surprise_bonus' as const, is_true: true, text: 'Bonus!' }],
    records: last.records.map(r => ({ ...r, action: r.agent === 'tom' ? 'leak' as const : r.action, quit: r.agent === 'lena' })) };
  const round = buildRound(frame, last);
  assert.equal(round.find(l => l.agent === 'tom')?.emotion, 'angry');
  assert.equal(round.find(l => l.agent === 'lena')?.emotion, 'angry', 'mock Lena quits with trust 12');
  assert.ok(round.every(l => l.action));
});

test('each archetype has its own base pitch; emotions and whisper change the voice', () => {
  const pitches = ['CEO', 'Ops manager', 'Breadwinner', 'Gossip hub', 'Climber', 'Loyalist', 'Skeptic', 'Flight risk'].map(a => basePitch(a, 'x'));
  assert.equal(new Set(pitches).size, 8);
  assert.ok(pitches.every(p => p >= 1.15 && p <= 1.85));
  assert.equal(basePitch('Unknown', 'newhire'), basePitch(undefined, 'newhire'));
  assert.ok(basePitch(undefined, 'newhire') >= 1.15 && basePitch(undefined, 'newhire') <= 1.85);
  const speeds = Object.values(EMOTION_VOICE).map(v => v.speed);
  assert.equal(new Set(speeds).size, 4);
  assert.ok(EMOTION_VOICE.angry.speed > EMOTION_VOICE.normal.speed && EMOTION_VOICE.sad.speed < EMOTION_VOICE.normal.speed);
  assert.ok(EMOTION_VOICE.happy.pitch > 1 && EMOTION_VOICE.sad.pitch < EMOTION_VOICE.angry.pitch);
  const spoken = voiceFor(1.5, 'happy');
  const whisper = voiceFor(1.5, 'happy', true);
  assert.equal(spoken.pitch, 1.5 * 1.2);
  assert.equal(whisper.gain, EMOTION_VOICE.happy.gain * WHISPER.gain);
  assert.equal(whisper.lowpassHz, WHISPER.lowpassHz);
  assert.equal(spoken.lowpassHz, undefined);
});

test('synthesis output maps to text positions, skipping silence and grouped characters', () => {
  const out = (char: string, phoneme = char, length = 10) => ({ char, phoneme, buffer: { length } });
  const text = "Hi, I'll go 2day!";
  const outputs = [out('h'), out('i'), out(',', ',', 0), out(' ', ' ', 0), out('i'), out("'", "'", 0), out('l'), out('l'),
    out(' ', ' ', 0), out('g'), out('o'), out(' ', ' ', 0), out('d'), out('a'), out('y'), out('!', '!', 0), out('2', '', 0)];
  const map = alignToText(text, outputs);
  assert.deepEqual([...map.keys()], [0, 1, 4, 6, 7, 9, 10, 13, 14, 15]);
  assert.equal(map.get(13)?.char, 'd');
});

test('one voice: a syllable only starts after the previous one ends; stop clears it', () => {
  let now = 0;
  const started: string[] = [];
  const fades: number[] = [];
  const voice = new BabbleScheduler<string>(() => now, item => { started.push(item); return 0.08; }, fade => fades.push(fade));
  assert.equal(voice.blip(undefined), false);
  assert.equal(voice.blip('a'), true);
  now = 0.05;
  assert.equal(voice.blip('b'), false, 'still sounding');
  now = 0.08;
  assert.equal(voice.blip('c'), true);
  voice.stop(8);
  assert.equal(voice.blip('d'), true, 'free straight after a stop');
  assert.deepEqual(started, ['a', 'c', 'd']);
  assert.deepEqual(fades, [8]);
});

test('sync: typed letters blip, the last letter ends the sound, anything else cuts it', () => {
  const s = (phase: TypingSnapshot['phase'], shownPublic: number, shownInner = 0): TypingSnapshot => ({ phase, shownPublic, shownInner });
  assert.deepEqual(babbleStep(s('public', 3), s('public', 4)), { kind: 'blip', part: 'public', index: 3 });
  assert.deepEqual(babbleStep(s('inner', 10, 0), s('inner', 10, 1)), { kind: 'blip', part: 'inner', index: 0 });
  assert.deepEqual(babbleStep(s('public', 9), s('inner', 10)), { kind: 'stop', reason: 'finished' }, 'last public letter');
  assert.deepEqual(babbleStep(s('public', 9), s('reading', 10)), { kind: 'stop', reason: 'finished' }, 'no thoughts');
  assert.deepEqual(babbleStep(s('inner', 10, 4), s('reading', 10, 5)), { kind: 'stop', reason: 'finished' });
  assert.deepEqual(babbleStep(s('public', 3), s('reading', 10, 5)), { kind: 'stop', reason: 'cut' }, 'Next completes');
  assert.deepEqual(babbleStep(s('inner', 10, 2), s('reading', 10, 9)), { kind: 'stop', reason: 'cut' });
  assert.deepEqual(babbleStep(s('public', 3), s('idle', 0)), { kind: 'stop', reason: 'cut' }, 'skip round');
  assert.equal(babbleStep(s('public', 3), s('public', 0)), null, 'new line: the line change stops it');
  assert.equal(babbleStep(s('reading', 10, 5), s('reading', 10, 5)), null);
});
