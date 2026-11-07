import { z } from 'zod';

import {
  CUSTOM_EVENT_KINDS,
  clampCustomEventEffects,
  createFallbackCustomEvent,
  inferCustomEventKind,
  normaliseHeadline,
  type CustomEventKind,
  type GeneratedCustomEvent,
} from '../../shared/customEvent';
import { createMessageClient, type MessageResult } from './client';

const customEventOutcomeSchema = z.object({
  headline: z.string().min(1),
  kind: z.enum(Object.keys(CUSTOM_EVENT_KINDS) as [CustomEventKind, ...CustomEventKind[]]).optional(),
  is_true: z.boolean(),
  severity: z.number().int().min(1).max(5),
  durationTicks: z.number().int().min(1).max(20),
  summary: z.string().min(1).max(200),
  effects: z.object({
    morale: z.number(),
    trust: z.number(),
    stress: z.number(),
    burnout: z.number(),
    productivity: z.number(),
    churnRisk: z.number(),
    rumorSpread: z.number(),
    priceImpact: z.number(),
  }),
}).strict();

export function buildCustomEventPrompt(headline: string): string {
  const inferredKind = inferCustomEventKind(headline);
  return [
    'You are generating a custom office event for a workplace management sim.',
    'Turn the user headline into a safe office event with realistic effect sizes.',
    'Rules:',
    '- Keep the event plausible in a modern office or company context.',
    '- Keep values small and bounded.',
    '- No violence, deaths, disasters, fantasy, politics, or real-world celebrity names.',
    '- Infer the closest office event family from the text itself; do not force a legacy category if the headline is broader or mixed.',
    '- Best-match family for this headline: ' + inferredKind,
    '- If the headline is about tariffs, layoffs, morale, rumours, stress, cuts, or policy changes, reflect that in the summary and effects.',
    '- The "kind" field is optional; if included, it must match the headline and the office setting.',
    '- Return JSON only, with the exact keys shown below.',
    '',
    'User headline:',
    `<headline>${headline}</headline>`,
    '',
    'JSON schema:',
    '{',
    '  "headline": "string",',
    '  "kind": "' + Object.keys(CUSTOM_EVENT_KINDS).join('" | "') + '" (optional),',
    '  "is_true": true,',
    '  "severity": 1,',
    '  "durationTicks": 4,',
    '  "summary": "short one-line summary",',
    '  "effects": {',
    '    "morale": 0,',
    '    "trust": 0,',
    '    "stress": 0,',
    '    "burnout": 0,',
    '    "productivity": 0,',
    '    "churnRisk": 0,',
    '    "rumorSpread": 0,',
    '    "priceImpact": 0',
    '  }',
    '}',
  ].join('\n');
}

export function parseGeneratedCustomEvent(result: MessageResult | null): GeneratedCustomEvent | null {
  if (!result) return null;
  const content = result.message.content.map((block) => block.type === 'text' ? block.text : '').join('');
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const json = JSON.parse(match[0]) as unknown;
    const parsed = customEventOutcomeSchema.safeParse(json);
    if (!parsed.success) return null;
    const data = parsed.data;
    const headline = normaliseHeadline(data.headline) || normaliseHeadline(data.summary);
    const effects = clampCustomEventEffects(data.effects);
    const kind = data.kind ?? inferCustomEventKind(headline);
    return {
      headline,
      kind,
      is_true: data.is_true,
      severity: data.severity,
      durationTicks: data.durationTicks,
      summary: data.summary,
      effects,
    };
  } catch {
    return null;
  }
}

export function createCustomEventGenerator(request?: (prompt: string) => Promise<MessageResult | null>) {
  const cache = new Map<string, GeneratedCustomEvent>();
  const caller = request ?? (async (prompt: string) => {
    try {
      return await createMessageClient({ timeoutMs: 8_000 })(prompt);
    } catch {
      return null;
    }
  });
  return async (headline: string, kind: CustomEventKind, isTrue: boolean): Promise<GeneratedCustomEvent> => {
    const text = normaliseHeadline(headline);
    const key = `${kind}\u001f${isTrue}\u001f${text.toLowerCase()}`;
    const cached = cache.get(key);
    if (cached) return cached;
    try {
      const result = await caller(buildCustomEventPrompt(text));
      const parsed = parseGeneratedCustomEvent(result);
      if (parsed) {
        cache.set(key, parsed);
        return parsed;
      }
    } catch {
      // Fall back to local tuning when the model fails or no key is available.
    }
    const fallback = createFallbackCustomEvent(kind, text, isTrue);
    cache.set(key, fallback);
    return fallback;
  };
}
