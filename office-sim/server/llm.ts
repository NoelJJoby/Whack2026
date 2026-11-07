import OpenAI from 'openai';
import { z } from 'zod';

import type { AgentProfile, AgentState, LlmTurn } from '../shared/types';

const TurnSchema = z.object({
  action: z.enum(['work', 'overwork', 'slack_off', 'complain', 'gossip', 'verify', 'interview', 'leak']),
  target: z.string().nullable().optional(),
  claim_id: z.string().nullable().optional(),
  public_line: z.string(),
  inner_monologue: z.string(),
});

export async function getAgentTurn(_agent: AgentProfile, _state: AgentState, _claimText: string): Promise<LlmTurn> {
  const fallback: LlmTurn = {
    action: 'work',
    target: null,
    claim_id: null,
    public_line: 'Work normally and keep the team steady.',
    inner_monologue: 'This is a placeholder turn.',
  };

  if (!process.env.OPENROUTER_API_KEY) {
    return fallback;
  }

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
    });

    const response = await client.chat.completions.create({
      model: process.env.MODEL ?? 'openai/gpt-4o-mini',
      temperature: Number(process.env.TEMPERATURE ?? '0.3'),
      messages: [{ role: 'user', content: 'Return a minimal JSON decision payload for an office agent.' }],
    });

    const raw = response.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw);
    const valid = TurnSchema.safeParse(parsed);
    if (!valid.success) {
      return fallback;
    }

    return {
      action: valid.data.action,
      target: valid.data.target ?? null,
      claim_id: valid.data.claim_id ?? null,
      public_line: valid.data.public_line,
      inner_monologue: valid.data.inner_monologue,
    };
  } catch {
    return fallback;
  }
}
