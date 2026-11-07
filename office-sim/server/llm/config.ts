// Model and request settings live here; credentials stay in the environment.
export const llmConfig = Object.freeze({
  model: 'claude-haiku-5-5',
  // Thinking counts towards this cap; the JSON itself is ~100 tokens. At 1024,
  // about 1 in 11 turns ran out before the JSON once the voice brief was added.
  maxOutputTokens: 2048,
  timeoutMs: 20_000,
  maxRetries: 0,
  // Simulation turns are short structured choices, not extended reasoning jobs.
  thinking: 'disabled' as const,
  effort: 'low' as const,
  // Current models do not accept temperature; omit it from Messages requests.
  temperature: undefined,
});
