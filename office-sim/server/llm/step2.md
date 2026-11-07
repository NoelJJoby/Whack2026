# Step 2 — Anthropic client and dependency handoff

Status: COMPLETE.

Live verification follow-up: after the developer configured the key, ran
`node --import tsx server/llm/tests/smoke.ts` from `office-sim/` with network
access. It passed: normal completion, expected JSON text, 31 input tokens,
9 output tokens, and 1435.27 ms request latency. SDK retries remain disabled.
The first sandboxed invocation returned a controlled request failure; the
network-enabled invocation was a separate manual check, not an SDK retry.
No credentials or response bodies were logged. Engine integration is not
established by this transport smoke check. Earlier blocked reports below
describe the state before dependencies and credentials were supplied.

Dependency follow-up: the developer authorized adding the SDK. Installed
`@anthropic-ai/sdk` 1.6.0 with pnpm and updated `package.json` and
`pnpm-lock.yaml`. The client tests pass against project-installed dependencies.
The full `pnpm exec tsc --noEmit` check reports TS6305 because the referenced
Vite config declaration has not been built; no configuration changes were
made. The missing API key is still the live-smoke dependency. The original
isolated verification and dependency handoff below are retained as history.

## Files

- `config.ts`: centralized model (`claude-sonnet-5-5`), 1024 maximum output
  tokens, 20-second timeout, zero SDK retries and omitted temperature.
- `client.ts`: official SDK Messages request, one user message, direct Anthropic
  base URL, mapped token usage and latency for each actual request. Request
  failures return `null`. Missing credentials fail at client creation with a
  safe configuration error. Raw SDK messages are retained for Step 3's text
  extraction and parsing. Metrics are internal, not engine payload fields.
- `tests/client.test.ts`: real SDK with injected fetch; checks request shape,
  endpoint, usage mapping, latency, missing key, HTTP 429/500, transport errors,
  timeout and no retries. Credentials are test-only and restored afterward.
- `tests/smoke.ts`: one live JSON-only request, requiring normal completion,
  text, expected JSON, token usage and latency. Loads local dotenv settings;
  does not print response bodies or keys. This is a transport smoke check,
  not the future engine output validator.

`server/llm.ts` is unchanged: provider migration belongs to Step 4. No engine
integration, production extraction/parser, retry loop or cache was added.

## Dependency handoff

The project has no installed dependencies and does not declare the Anthropic
SDK. Per the revised spec, package manifests and lockfiles were left unchanged.
The dependency owner should run from `office-sim/`:

```sh
pnpm add @anthropic-ai/sdk@1.6.0
```

This installs project dependencies and updates `package.json` and
`pnpm-lock.yaml`. The SDK version above was used for isolated local checks.
Configure `ANTHROPIC_API_KEY` securely in the environment or the project's local
dotenv file; never commit it. Then run from `office-sim/`:

```sh
node --import tsx server/llm/tests/client.test.ts
node --import tsx server/llm/tests/smoke.ts
```

## Verification performed

Dependencies were installed only in `/tmp/whack-llm-step2.NeIMmm`, with exact
copies of these source files. No project dependency files were changed.

- `node --import tsx llm/tests/client.test.ts`: passed with SDK 1.6.0 and stubbed
  transport, including timeout and single-attempt failure checks.
- `./node_modules/.bin/tsc --noEmit --strict --target ES2022 --module ESNext
  --moduleResolution Bundler --esModuleInterop --skipLibCheck --types node
  llm/config.ts llm/client.ts llm/tests/client.test.ts llm/tests/smoke.ts`:
  passed using TypeScript 5.7.2. This is an isolated check of the new files,
  not a full project compilation or engine-integration check.
- `node --import tsx llm/tests/smoke.ts`: exited 1 with the explicit missing-key
  message. No live API call occurred; live text/usage/latency remain unverified.
- `git diff --check`: passed. New files were also inspected manually.

The `tsx` CLI initially could not open its IPC pipe in the sandbox; using
Node's `--import tsx` entry point ran the scripts successfully.

## Documentation used

Checked 7 November 2026:

- [Official TypeScript SDK: retries and timeouts](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript)
- [Model IDs](https://platform.claude.com/docs/en/models/overview)
- [Messages API parameters](https://platform.claude.com/docs/en/api/typescript/messages/create)

Temperature is omitted because it is absent from the current Messages
parameters; model-specific options should be checked again if the model changes.

The dependency update and live smoke endpoint are now complete. Step 3 is not
started.
