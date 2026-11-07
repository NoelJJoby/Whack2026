import { buildManagementPrompt } from './llm/management-prompt';
import type { EngineProfile, TurnProvider } from './engine-types';
import { createMessageClient } from './llm/client';
import { parseReply } from './llm/parse';
import { buildTurnPrompt } from './llm/prompt';

// The factory allows isolated transport checks without changing TurnProvider.
// Client initialization is lazy so missing credentials resolve to null at the
// provider boundary rather than throwing while the integration imports it.
export function createTurnProvider(
  options: Parameters<typeof createMessageClient>[0] & {
    personaFor?: (agent: EngineProfile) => string;
  } = {},
): TurnProvider {
  let request: ReturnType<typeof createMessageClient> | undefined;
  return async (agent, ctx) => {
    try {
      const prompt = ctx.management ? buildManagementPrompt(ctx.management) : buildTurnPrompt(agent, ctx, options.personaFor?.(agent));
      request ??= createMessageClient(options);
      const result = await request(prompt, { purpose: ctx.management?.kind ?? 'employee', maxTokens: ctx.management ? 2200 : 600 });
      // Engine validation, its one retry and rules fallback remain in tick.ts.
      return result ? parseReply(result.message) : null;
    } catch {
      return null;
    }
  };
}

export const getAgentTurn: TurnProvider = createTurnProvider();
