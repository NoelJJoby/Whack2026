import type Anthropic from '@anthropic-ai/sdk';

// Parsing is deliberately separate from the engine's validation/normalization.
export function parseReply(
  message: Pick<Anthropic.Message, 'content' | 'stop_reason'>,
): unknown | null {
  try {
    if (message.stop_reason !== 'end_turn' && message.stop_reason !== 'stop_sequence') {
      return null;
    }

    let text = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('').trim();
    const fence = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(text);
    if (fence) text = fence[1].trim();
    if (!text) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
