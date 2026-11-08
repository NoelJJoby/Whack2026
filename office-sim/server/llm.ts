import { buildCompanyTaskPrompt } from './llm/company-task-prompt';
import { buildManagementPrompt } from './llm/management-prompt';
import { buildMeetingPrompt } from './llm/meeting-prompt';
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
      request ??= createMessageClient(options);
      if (ctx.companyTurn) {
        const turn = ctx.companyTurn;
        const result = await request(buildCompanyTaskPrompt(agent, ctx, turn), {
          purpose: `company-${turn.kind}`, maxTokens: turn.kind === 'brief' ? 2200 : 120,
        });
        return result ? parseReply(result.message) : null;
      }
      if (ctx.meeting) {
        // Lines only: the outcome was decided by rules; server/accountability.ts validates and falls back.
        const result = await request(buildMeetingPrompt(ctx.meeting), { purpose: 'meeting', maxTokens: 300 });
        return result ? parseReply(result.message) : null;
      }
      const prompt = ctx.management ? buildManagementPrompt(ctx.management, ctx.companySchedule) : buildTurnPrompt(agent, ctx, options.personaFor?.(agent));
      const result = await request(prompt, { purpose: ctx.management?.kind ?? 'employee', ...(ctx.management ? { maxTokens: 2200 } : {}) });
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
