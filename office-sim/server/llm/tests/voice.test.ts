import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { voiceParams as V } from '../../params';
import { createRng } from '../../rng';
import { fixtureCast } from '../../scripts/fixture';
import {
  HUMOURS, MANNERS, TELL_MANNER, addVoice, assignVoices, describeManner, describeVoice, mannerWeights,
  sampleStyle, signalsOf, stanceFor, validExamples, weigh, type Manner, type VoiceCard, type VoiceSubject,
} from '../voice';

const subjects = (seed: number): VoiceSubject[] =>
  fixtureCast(seed).map((c) => ({ id: c.profile.id, traits: c.profile.traits, state: c.start }));

const key = (c: VoiceCard) => `${c.register}/${c.humour}/${c.tell}`;

describe('voice cards', () => {
  it('the same seed gives the same cards; a different seed gives different ones', () => {
    assert.deepEqual(assignVoices(subjects(42), 42, V), assignVoices(subjects(42), 42, V));
    assert.notDeepEqual(assignVoices(subjects(42), 42, V), assignVoices(subjects(43), 43, V));
  });

  it('across 500 seeds: every agent has a card, no shared register+humour+tell, no shared habit', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const cast = subjects(seed);
      const cards = assignVoices(cast, seed, V);
      assert.equal(Object.keys(cards).length, cast.length);
      const keys = Object.values(cards).map(key);
      assert.equal(new Set(keys).size, keys.length, `seed ${seed}: ${keys.join(', ')}`);
      const habits = Object.values(cards).flatMap((c) => c.habits);
      assert.equal(new Set(habits).size, habits.length, `seed ${seed} shares a habit`);
      for (const c of Object.values(cards)) {
        assert.ok(c.habits.length >= 1 && c.habits.length <= 2);
        assert.ok(c.habits.filter((h) => V.card.habits.find((d) => d.id === h)!.opener).length <= 1);
        assert.equal(new Set(c.topics).size, 2);
      }
      const topics = Object.values(cards).flatMap((c) => c.topics);
      assert.equal(new Set(topics).size, topics.length, `seed ${seed} shares a topic`);
    }
  });

  it('a replacement gets a card that clashes with nobody', () => {
    const cards = assignVoices(subjects(42), 42, V);
    const newcomer: VoiceSubject = {
      id: 'newhire',
      traits: { ambition: 50, financial_need: 50, ethics: 50, sociability: 50, impulsivity: 50, recruiter_contact: false },
      state: { loyalty: 60, trust_mgmt: 60 },
    };
    const card = addVoice(cards, newcomer, 42, 9, V);
    assert.ok(!Object.values(cards).some((c) => key(c) === key(card)));
    assert.ok(!card.habits.some((h) => Object.values(cards).some((c) => c.habits.includes(h))));
    assert.deepEqual(addVoice(cards, newcomer, 42, 9, V), card);
  });

  it('traits shift the weights the way the brief says', () => {
    const loyal = signalsOf({ ambition: 40, financial_need: 40, ethics: 60, sociability: 40, impulsivity: 30, recruiter_contact: false }, { loyalty: 85, trust_mgmt: 75 });
    const humour = weigh(V.card.humour.base, V.card.humour.rules, loyal);
    assert.ok(humour.sarcastic < 0.1, `loyal sarcasm ${humour.sarcastic}`);
    assert.ok(humour.goofy > humour.dry && humour.self_deprecating > humour.dry);

    const cynic = signalsOf({ ambition: 40, financial_need: 35, ethics: 80, sociability: 20, impulsivity: 45, recruiter_contact: false }, { loyalty: 45, trust_mgmt: 25 });
    const reg = weigh(V.card.register.base, V.card.register.rules, cynic);
    assert.equal(Object.entries(reg).sort((a, b) => b[1] - a[1])[0][0], 'clipped');
    const tell = weigh(V.card.tell.base, V.card.tell.rules, cynic);
    assert.ok(tell.states_principle > 1 && tell.goes_quiet > 1 && tell.overly_cheerful < 0.5);
    assert.ok(weigh(V.card.humour.base, V.card.humour.rules, cynic).sarcastic > 1.5);
  });
});

describe('stance and manner', () => {
  const card = assignVoices(subjects(42), 42, V).loyalist;
  const s = signalsOf(fixtureCast(42)[4].profile.traits, { stress: 50, burnout: 30, loyalty: 80, trust_mgmt: 70 });

  it('stance comes from current trust', () => {
    assert.equal(stanceFor(80, V), 'believer');
    assert.equal(stanceFor(50, V), 'pragmatist');
    assert.equal(stanceFor(20, V), 'sceptic');
  });

  it('never repeats the last manner and respects the round cap', () => {
    const w = mannerWeights(card, s, 'pragmatist', { hasColleagues: true, last: 'minimal', round: { gallows: 2, practical_question: 1 } }, V);
    assert.equal(w.minimal, 0);
    assert.equal(w.gallows, 0);
    assert.ok(w.practical_question > 0);
    assert.ok(MANNERS.every((m) => w[m] >= 0));
  });

  it('boosts the tell manner and drops colleague manners with nobody around', () => {
    const base = mannerWeights({ ...card, tell: 'goes_quiet' }, s, 'pragmatist', { hasColleagues: false, last: null, round: {} }, V);
    const other = mannerWeights({ ...card, tell: 'opportunity' }, s, 'pragmatist', { hasColleagues: false, last: null, round: {} }, V);
    assert.ok(base[TELL_MANNER.goes_quiet] > other[TELL_MANNER.goes_quiet]);
    assert.equal(base.talk_to_colleague, 0);
    assert.equal(base.comment_on_other, 0);
  });

  it('falls back to an allowed manner when everything is weighted out', () => {
    const round = Object.fromEntries(MANNERS.map((m) => [m, 2])) as Record<Manner, number>;
    const w = mannerWeights(card, s, 'pragmatist', { hasColleagues: true, last: 'gallows', round }, V);
    assert.equal(w.gallows, 0);
    assert.ok(MANNERS.some((m) => w[m] > 0));
  });

  it('samples a style deterministically and fills in addressee and topic', () => {
    const colleagues = [{ id: 'skeptic', affinity: 70 }, { id: 'gossip', affinity: 40 }];
    const a = sampleStyle(createRng(7), card, s, 70, colleagues, { last: null, round: {} }, V);
    assert.deepEqual(sampleStyle(createRng(7), card, s, 70, colleagues, { last: null, round: {} }, V), a);
    for (let seed = 0; seed < 200; seed++) {
      const st = sampleStyle(createRng(seed), card, s, 70, colleagues, { last: null, round: {} }, V);
      assert.equal(st.addressee !== null, st.manner === 'talk_to_colleague' || st.manner === 'comment_on_other');
      assert.equal(st.topic !== null, st.manner === 'change_subject');
      if (st.topic) assert.ok(card.topics.includes(st.topic));
    }
  });

  it('a believer is never told to be sarcastic', () => {
    const sarcastic = { ...card, humour: 'sarcastic' as const };
    assert.doesNotMatch(describeVoice(sarcastic, 'believer', true, V), /sarcastic/);
    assert.match(describeVoice(sarcastic, 'sceptic', true, V), /sarcastic/);
    assert.ok(HUMOURS.includes(card.humour));
  });

  it('renders the brief without labels or numbers beyond word counts', () => {
    const text = describeVoice(card, 'believer', true, V);
    assert.doesNotMatch(text, /loyalist|skeptic|climber|tick/i);
    const style = { manner: 'talk_to_colleague' as const, stance: 'believer' as const, addressee: 'skeptic', topic: null, habits_shown: true };
    assert.equal(describeManner(style, () => 'Sam', V), 'say something directly to Sam, using their name.');
  });
});

describe('example small talk', () => {
  it('keeps valid lines only', () => {
    assert.deepEqual(validExamples({ lines: ['Rain again.', "I'm running on fumes.", 42] }, V), ['Rain again.']);
    assert.equal(validExamples({ nope: [] }, V), null);
    assert.equal(validExamples(null, V), null);
  });
});
