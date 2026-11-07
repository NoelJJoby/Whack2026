import OpenAI from 'openai';
import { z } from 'zod';

import type { AgentProfile, AgentState, LlmOutput, Proposal } from '../shared/types';

const ProposalSchema = z.object({
  action: z.enum(['work', 'overwork', 'slack_off', 'complain', 'gossip', 'verify', 'interview', 'leak']),
  weight: z.number().min(0).finite(),
  target: z.string().nullable().optional(),
  claim: z.string().nullable().optional(),
});

const LlmOutputSchema = z.object({
  proposals: z.array(ProposalSchema).max(3),
  public_line: z.string().min(1).max(500),
  inner_monologue: z.string().min(1).max(500),
  beliefs: z.record(z.number().min(0).max(100)).default({}),
});

export type TurnProvider = (agent: AgentProfile, state: AgentState, prompt: string) => Promise<LlmOutput | null>;

export function buildAgentPrompt(agent: AgentProfile, state: AgentState, claimText: string): string {
  const topClaims = Object.entries(state.source_trust ?? {})
    .slice(0, 4)
    .map(([source, trust]) => `${source}:${trust}`)
    .join(', ');

  return `You are ${agent.name}, a ${agent.archetype}. Keep your response as strict JSON with no markdown. Current workload=${state.workload}, stress=${state.stress}, loyalty=${state.loyalty}, trust_mgmt=${state.trust_mgmt}, burnout=${state.burnout}. Source trust: ${topClaims || 'none'}. Current rumor context: ${claimText || 'No active claim.'}. Return up to 3 weighted proposals with action, weight, and optional target/claim, plus a brief public line and inner monologue. Beliefs should be between 0 and 100 for any claim the agent currently holds.`;
}

export async function getAgentTurn(agent: AgentProfile, state: AgentState, claimText: string): Promise<LlmOutput | null> {
  if (!process.env.OPENROUTER_API_KEY) {
    return null;
  }

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
    });

    const prompt = buildAgentPrompt(agent, state, claimText);
    const response = await client.chat.completions.create({
      model: process.env.MODEL ?? 'openai/gpt-4o-mini',
      temperature: Number(process.env.TEMPERATURE ?? '0.3'),
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw);
    const valid = LlmOutputSchema.safeParse(parsed);

    if (!valid.success) {
      return null;
    }

    const normalized = valid.data;
    const proposals: Proposal[] = normalized.proposals.length > 0
      ? normalized.proposals.map((proposal) => ({
          action: proposal.action,
          weight: Number(proposal.weight) || 1,
          target: proposal.target ?? null,
          claim: proposal.claim ?? null,
        }))
      : [{ action: 'work', weight: 1, target: null, claim: null }];

    return {
      proposals,
      public_line: normalized.public_line,
      inner_monologue: normalized.inner_monologue,
      beliefs: Object.fromEntries(Object.entries(normalized.beliefs ?? {}).map(([key, value]) => [key, Number(value)])),
    };
  } catch {
    return null;
  }
}
