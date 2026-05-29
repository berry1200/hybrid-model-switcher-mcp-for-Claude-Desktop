# Changelog

All notable changes to this project are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
This project uses [Semantic Versioning](https://semver.org/).

---

## [0.4.0] — 2026-05

### Added
- GitHub Actions release pipeline (`.github/workflows/release.yml`) triggering on semver tags
- Multi-platform Tauri build matrix: `ubuntu-latest`, `macos-latest`, `windows-latest`
- macOS notarization hooks via `APPLE_*` environment secrets
- Windows `signtool` signing hooks via `WINDOWS_*` environment secrets
- Production esbuild bundle (`npm run bundle`) outputting `dist/production/hybrid-model-switcher-mcp.cjs`
- Bundle size analysis report alongside the `.cjs` artefact
- Type-aware ESLint release gate (`npm run lint`)
- Privacy-first telemetry via optional Sentry DSN (`HYBRID_TELEMETRY_DSN`)
  - Redacts API keys, bearer tokens, file paths, and prompt/tool payload fields before any event is sent
  - Disabled by default — no DSN, no events
- Internal APM metrics: route latency, model switch success/failure counts
- Latency degradation alerts via `HYBRID_METRICS_HEARTBEATS`
- `npm run test:e2e` Playwright Chromium fixture for the Tauri IPC bridge

### Changed
- `npm run start:prod` now starts the bundled `.cjs` rather than compiled `dist/index.js`

---

## [0.3.0] — 2026-05

### Added
- Payload sanitation layer: strips oversized or malformed fields before upstream dispatch
- Native secret-store wrappers for `LITELLM_API_KEY` and `OLLAMA_BASE_URL` on macOS Keychain and Windows Credential Manager
- Guarded stream cleanup: all streaming Ollama responses now close the underlying connection on timeout or client disconnect
- Token-bucket concurrency limiter: prevents thundering-herd on Ollama when multiple Claude tools call `hybrid_generate` simultaneously
- Lifecycle tests: boot sequence, upstream registry injection, config restore on shutdown
- Tauri IPC fixture tests covering `CMD_SWITCH_MODEL`, `CMD_GET_STATE`, and `EVT_HEALTH_UPDATE`
- Chaos recovery schemas: upstream-process crash, LiteLLM unreachable, config file corruption mid-write

### Fixed
- `hybrid_route_anthropic` no longer panics when LiteLLM returns a non-JSON error body under HTTP 5xx
- Config restore on shutdown now validates backup JSON before overwriting the live config

---

## [0.2.0] — 2026-05

### Added
- `src/mcp/server.ts` — full MCP proxy server on stdio with `tools/list` aggregation and `tools/call` routing
- `src/routing/litellm.ts` — Anthropic→LiteLLM payload translation, `classifyRouterError`, streaming result normalisation
- `src/tauri/config.ts` — `ClaudeConfigManager` (atomic config inject/restore), `ModelStateManager` with `AsyncMutex`
- `src/utils/errors.ts` — `HybridMcpError` hierarchy: `McpTimeoutError`, `RouterConnectionError`, `PayloadTranslationError`, and six additional typed errors
- `withTimeout<T>()` utility — races any promise against a deadline with guaranteed timer cleanup
- `buildFallbackToolResult()` — guaranteed-safe exit path when both primary and fallback inference fail
- Auto-fallback policy evaluation in `hybrid_infer` — switches to `preferredFallbackModelId` on error-rate or latency threshold breach
- Platform config path resolution for `claude_desktop_config.json` on macOS, Windows, and Linux
- Write-to-temp-then-rename atomic file writes for all config mutations
- `ModelStateManager.recordRequest()` — rolling latency average and error-rate tracking outside the mutex

### Changed
- Tool names prefixed `{upstreamId}__` to prevent collision across upstream MCP servers
- `initialize` response is now synthesised by the proxy rather than forwarded

---

## [0.1.0] — 2026-05

### Added
- `hybrid_status` — Ollama health, active model, host config status, runtime metadata
- `hybrid_list_models` — queries Ollama `/api/tags`, returns installed model names and recommended profiles
- `hybrid_set_model` — persists active provider (`ollama` / `litellm` / `client`) and model to `~/.hybrid-model-switcher/`
- `hybrid_generate` — single-prompt generation against Ollama or MCP client sampling
- `hybrid_chat` — message-array chat against Ollama or MCP client sampling
- `hybrid_route_anthropic` — Anthropic-format messages → LiteLLM chat completion dispatch
- `hybrid_recommend_model` — task-type to model-family recommendation map
- Environment variable configuration (`OLLAMA_BASE_URL`, `LITELLM_BASE_URL`, `HYBRID_DEFAULT_MODEL`, etc.)
- Basic state persistence at `~/.hybrid-model-switcher/state.json`
- Validated end-to-end: `hybrid_generate` → llama3:latest via Ollama on Windows with Claude Desktop Haiku 4.5
