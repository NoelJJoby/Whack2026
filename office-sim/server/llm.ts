import type { EngineProfile, TurnProvider } from './engine-types';
import { createMessageClient } from './llm/client';
import { parseReply } from './llm/parse';
import { buildTurnPrompt, restoreIds } from './llm/prompt';
import { examplesPrompt, validExamples } from './llm/voice';
import { voiceParams } from './params';

// The factory allows isolated transport checks without changing TurnProvider.
// Client initialization is lazy so missing credentials resolve to null at the
// provider boundary rather than throwing while the integration imports it.
export function createTurnProvider(
  options: Parameters<typeof createMessageClient>[0] & {
    personaFor?: (agent: EngineProfile) => string;
  } = {},
): TurnProvider {
  let request: ReturnType<typeof createMessageClient> | undefined;
  const provider: TurnProvider = async (agent, ctx) => {
    try {
      const prompt = buildTurnPrompt(agent, ctx, options.personaFor?.(agent));
      request ??= createMessageClient(options);
      const result = await request(prompt);
      // The prompt shows names and claim keys; the engine needs ids.
      // Engine validation, its one retry and rules fallback remain in tick.ts.
      return result ? restoreIds(parseReply(result.message), ctx) : null;
    } catch {
      return null;
    }
  };
  // Example small talk for a voice card: one request, null on any failure.
  provider.styleExamples = async (agent, voice) => {
    try {
      request ??= createMessageClient(options);
      const result = await request(examplesPrompt(agent.name, voice, voiceParams));
      return result ? validExamples(parseReply(result.message), voiceParams) : null;
    } catch {
      return null;
    }
  };
  return provider;
}

export const getAgentTurn: TurnProvider = createTurnProvider();
