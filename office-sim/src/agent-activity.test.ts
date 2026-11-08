import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentActivity } from './three/AgentActivity';
import type { DialogueLine } from './dialogueQueue';

const line: DialogueLine = {
  kind: 'agent', key: '1-nia', tick: 1, agent: 'nia', publicLine: 'Good morning.',
  inner: 'I need coffee.', quit: false, action: 'work', emotion: 'normal',
  tier: 6, stress: 10, stressDelta: 0,
};
const props: ComponentProps<typeof AgentActivity> = {
  visible: false, name: 'Nia', line, showThoughts: true,
  convLine: 'Any news?', convDelay: 0, pinned: false, tag: 'psst', kind: 'gossip',
  emote: { emotion: 'happy', intensity: 1, key: '1:happy' },
};
const render = (overrides: Partial<typeof props> = {}) =>
  renderToStaticMarkup(createElement(AgentActivity, { ...props, ...overrides }));

test('arriving employees have no speech, thoughts, conversation, tags or emotion icons', () => {
  assert.equal(render(), '');
  assert.equal(render({ line: null }), '');
  assert.equal(render({ line: null, convLine: null }), '');
  assert.equal(render({ line: null, convLine: 'Office announcement', pinned: true }), '');
});

test('entering the office reveals current speech, thoughts and emotion', () => {
  const markup = render({ visible: true });
  assert.match(markup, /Nia says/);
  assert.match(markup, /Good morning\./);
  assert.match(markup, /Nia thinks/);
  assert.match(markup, /I need coffee\./);
  assert.match(markup, /aria-label="happy"/);
  assert.doesNotMatch(markup, /Any news\?|psst/);
  assert.doesNotMatch(render({ visible: true, showThoughts: false }), /I need coffee\.|Nia thinks/);
});

test('conversation bubbles, announcements and action tags remain available after entry', () => {
  assert.match(render({ visible: true, line: null }), /Any news\?/);
  assert.match(render({ visible: true, line: null, pinned: true }), /Nia announces/);
  assert.match(render({ visible: true, line: null, convLine: null }), /o3-tag gossip/);
});

test('hours advancing during entry reveal only the latest line, with no expired activity replay', () => {
  assert.equal(render(), '');
  const newer = { ...line, key: '2-nia', tick: 2, publicLine: 'The review is ready.', inner: '' };
  assert.equal(render({ line: newer }), '');
  const markup = render({ visible: true, line: newer, emote: undefined });
  assert.match(markup, /The review is ready\./);
  assert.doesNotMatch(markup, /Good morning\.|I need coffee\.|aria-label="happy"/);
  assert.equal(render({ visible: true, line: null, convLine: null, tag: null, emote: undefined }), '');
  assert.equal(render({ visible: false, line: newer }), '', 'departed employees hide all activity again');
});
