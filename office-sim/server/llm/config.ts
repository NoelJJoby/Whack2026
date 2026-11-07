// Model and request settings live here; credentials stay in the environment.
export const llmConfig = Object.freeze({
  model: 'claude-haiku-5-5',
  maxOutputTokens: 1024,
  timeoutMs: 20_000,
  maxRetries: 0,
  // Current models do not accept temperature; omit it from Messages requests.
  temperature: undefined,
});
