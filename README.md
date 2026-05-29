# Hybrid Model Switcher MCP

An open-source MCP routing proxy that lets Claude Desktop workflows call locally hosted Ollama models, route Anthropic-style payloads through LiteLLM, and keep model-routing state available for a future desktop companion UI.

This is the practical MVP foundation for the "Hybrid Model Switching for Claude Desktop" vision. It gives Claude Desktop tools for discovering local models, selecting an active route, routing prompts to Ollama, translating Anthropic message payloads through LiteLLM, and optionally delegating back to the MCP client through sampling when the client supports it.

## Current Status

Implemented:

- Phase 1: MCP/Ollama bridge, model discovery, local generation, chat, recommendations, and persisted provider/model state.
- Phase 2: Low-level MCP proxy server, explicit `tools/list` and `tools/call` handlers, LiteLLM translation route, host config reader, atomic active-model state, and strict error boundaries.
- Phase 3: Payload sanitation, native secret-store wrappers, guarded stream cleanup, token-bucket concurrency limiting, lifecycle tests, Tauri IPC fixture tests, and chaos recovery schemas.
- Phase 4: GitHub Actions release workflow, type-aware lint gate, production esbuild bundle, privacy-first telemetry, internal APM metrics, latency degradation alerts, and production bundle smoke verification.

Remaining:

- A real `src-tauri` desktop shell for native tray/menu packaging.
- A supported Claude Desktop extension point or companion overlay for a native one-click model dropdown.
- Transparent interception of ordinary Claude chat turns, which MCP alone cannot currently provide.

## Important Boundary

MCP servers cannot currently replace Claude Desktop's built-in model selector, intercept every user message, or transparently take over Claude's core inference. That requires explicit support from Claude Desktop or a separate companion client/overlay.

What this project can ship today:

- Expose local model inference as MCP tools inside Claude Desktop.
- Discover Ollama models automatically.
- Persist an active provider/model preference.
- Route explicit tool calls to Ollama.
- Route explicit Anthropic-style message payloads through LiteLLM.
- Record local-only metrics and optional redacted error telemetry.
- Use MCP sampling to ask the connected client model when supported.
- Provide a clean base for a future UI overlay or first-party client integration.

What future phases need client support for:

- A native Claude Desktop model dropdown.
- Automatic detection of Claude usage-limit screens.
- Transparent continuation where every normal chat turn routes locally.

## Quick Start

Install dependencies and build:

```powershell
npm.cmd install
npm.cmd run build
```

For a minified production MCP executable, run:

```powershell
npm.cmd run bundle
```

Start Ollama and pull at least one model:

```powershell
ollama serve
ollama pull deepseek-r1
```

Add the built server to Claude Desktop's MCP config. Use the absolute path to `dist/index.js` on your machine:

```json
{
  "mcpServers": {
    "hybrid-model-switcher": {
      "command": "node",
      "args": [
        "C:\\absolute\\path\\to\\Claude extension\\dist\\index.js"
      ],
      "env": {
        "OLLAMA_BASE_URL": "http://127.0.0.1:11434",
        "LITELLM_BASE_URL": "http://127.0.0.1:4000",
        "HYBRID_DEFAULT_MODEL": "deepseek-r1:latest"
      }
    }
  }
}
```

Restart Claude Desktop after editing the config.

For production installs, point Claude Desktop at:

```text
C:\absolute\path\to\Claude extension\dist\production\hybrid-model-switcher-mcp.cjs
```

## MCP Tools

`hybrid_status`

Returns Ollama health, active model state, host config status, and runtime proxy metadata.

`hybrid_list_models`

Lists installed Ollama models plus recommended model profiles.

`hybrid_set_model`

Persists the active provider and model. Provider can be `ollama`, `litellm`, or `client`.

`hybrid_generate`

Runs a single prompt against the active local model, an explicitly provided Ollama model, or the MCP client through sampling.

`hybrid_chat`

Runs a message array against Ollama chat or client sampling.

`hybrid_route_anthropic`

Translates an Anthropic-style messages request into a LiteLLM chat completion payload, appends active-route metadata, and dispatches it through the configured LiteLLM gateway.

`hybrid_recommend_model`

Maps common task types to recommended local model families.

## Verification

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
npm.cmd run bundle
npm.cmd run test:e2e
npm.cmd audit --audit-level=moderate
```

The E2E suite uses Playwright Chromium to exercise the Tauri IPC bridge fixture. If Chromium is not installed yet, run:

```powershell
npx.cmd playwright install chromium
```

The production bundle can be smoke-tested by starting `dist/production/hybrid-model-switcher-mcp.cjs` through an MCP stdio client and verifying the seven tools are listed.

## NPM Scripts

| Script | Purpose |
| --- | --- |
| `npm.cmd run dev` | Run the TypeScript server with `tsx` |
| `npm.cmd run build` | Compile TypeScript into `dist/` |
| `npm.cmd run bundle` | Create the minified production executable and bundle analysis |
| `npm.cmd run lint` | Run the type-aware ESLint release gate |
| `npm.cmd run typecheck` | Run `tsc --noEmit` |
| `npm.cmd test` | Run unit, integration, observability, and chaos tests |
| `npm.cmd run test:e2e` | Run the Playwright Tauri bridge fixture |
| `npm.cmd start` | Start `dist/index.js` |
| `npm.cmd run start:prod` | Start `dist/production/hybrid-model-switcher-mcp.cjs` |

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama API endpoint |
| `LITELLM_BASE_URL` | `http://127.0.0.1:4000` | LiteLLM gateway endpoint |
| `LITELLM_API_KEY` | unset | Optional LiteLLM gateway bearer token |
| `LITELLM_LOCAL_MODEL_PREFIX` | `ollama_chat` | Prefix used when an active local model has no explicit LiteLLM model name |
| `HYBRID_MODEL_STATE_PATH` | `~/.hybrid-model-switcher/state.json` | Persisted active model state |
| `HYBRID_ACTIVE_MODEL_STATE_PATH` | `~/.hybrid-model-switcher/active-model.json` | Atomic Phase 2 active-route state |
| `HYBRID_DEFAULT_MODEL` | unset | Fallback Ollama model name |
| `HYBRID_REQUEST_TIMEOUT_MS` | `120000` | Ollama and proxy request timeout |
| `HYBRID_TELEMETRY_DSN` / `SENTRY_DSN` | unset | Optional Sentry DSN; telemetry stays disabled without a DSN |
| `HYBRID_TELEMETRY_DISABLED` | unset | Set to `1` to force-disable telemetry |
| `HYBRID_TELEMETRY_ENVIRONMENT` / `SENTRY_ENVIRONMENT` | `NODE_ENV` | Telemetry environment name |
| `HYBRID_RELEASE` / `SENTRY_RELEASE` | unset | Release identifier attached to telemetry |
| `HYBRID_TELEMETRY_SAMPLE_RATE` | `1` | Error event sample rate |
| `HYBRID_TELEMETRY_TRACES_SAMPLE_RATE` | `0` | Trace sample rate; disabled by default |
| `HYBRID_METRICS_HEARTBEATS` | unset | Set to `1` to emit periodic sanitized metric heartbeats |

Telemetry is opt-in. Before any event leaves the machine, the logger redacts API keys, bearer tokens, local file paths, and prompt/tool payload fields. Metrics are limited to system diagnostics, route latency, model switch success/failure counts, stack traces, and internal error codes.

## Release Pipeline

The GitHub Actions workflow at `.github/workflows/release.yml` runs on semver tags such as `v0.2.1`.

Release gates:

- Install dependencies with npm cache.
- Run `lint`, `typecheck`, tests, E2E tests, and production bundling.
- Build native Tauri bundles on `ubuntu-latest`, `macos-latest`, and `windows-latest`.
- Sign macOS artifacts through Apple certificate/notarization environment hooks.
- Sign Windows artifacts through `signtool` when certificate secrets are present.
- Upload `.deb`, `.dmg`, `.msi`, and the production backend bundle to a draft GitHub Release.

Required signing secrets are intentionally environment-based and never stored in the repository:

- `APPLE_CERTIFICATE_BASE64`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_KEYCHAIN_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
- `WINDOWS_CERTIFICATE_BASE64`
- `WINDOWS_CERTIFICATE_PASSWORD`

The native package job expects a real Tauri app under `src-tauri`. Until that shell exists, the backend validation and production MCP bundle are complete, but native `.deb`, `.dmg`, and `.msi` packaging will be the next integration step.

## Example Prompts In Claude

Ask Claude:

```text
Use hybrid_list_models, then set the active local model to deepseek-r1:latest.
```

Then:

```text
Use hybrid_generate with the active local model to draft a migration plan for this codebase.
```

## Development Roadmap

Phase 1 through Phase 4 are implemented for the MCP backend, routing engine, hardening layer, tests, observability, and release infrastructure. A visual companion UI can build on the active-route state file or a small local HTTP control plane. Native, one-click replacement of Claude's own model picker depends on Claude Desktop exposing a supported extension point for that behavior.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full technical shape.


<img width="1915" height="1015" alt="Screenshot 2026-05-27 223925" src="https://github.com/user-attachments/assets/703d0ffa-7b2a-4af5-a514-2abe5acd996d" />
<img width="1562" height="1012" alt="Screenshot 2026-05-27 224040" src="https://github.com/user-attachments/assets/813a0c83-0336-498a-aaac-55bafd3be396" />
<img width="1566" height="994" alt="Screenshot 2026-05-27 224333" src="https://github.com/user-attachments/assets/017cdbf7-fb32-4bcd-891f-0b19474ff0e4" />
<img width="1060" height="716" alt="Screenshot 2026-05-29 215734" src="https://github.com/user-attachments/assets/4306f24e-78b8-42bc-b229-ef4631b5d216" />


