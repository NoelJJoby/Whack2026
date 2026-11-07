// Model and request settings live here; credentials stay in the environment.
export const llmConfig = Object.freeze({
  model: 'claude-haiku-5-5',
  maxOutputTokens: 1024,
  timeoutMs: 20_000,
  maxRetries: 0,
  // Simulation turns are short structured choices, not extended reasoning jobs.
  thinking: 'disabled' as const,
  effort: 'low' as const,
  // Current models do not accept temperature; omit it from Messages requests.
  temperature: undefined,
});
