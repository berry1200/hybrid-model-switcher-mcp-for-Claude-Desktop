# Architecture

## Current MVP

```text
Claude Desktop
  |
  | MCP tool call
  v
Hybrid Model Switcher MCP Server
  |                 |
  |                 +--> Model state manager
  |                 |
  |                 +--> Atomic active-model state
  |
  +--> Ollama API
  |
  +--> LiteLLM Gateway
  |
  +--> MCP client sampling, when supported
```

The server is intentionally local-first and does not modify Claude Desktop internals.

## Components

### MCP Server

Registers explicit low-level `tools/list` and `tools/call` handlers with the official MCP SDK `Server`. The proxy handler forwards listing to the tool pipeline and intercepts calls for health checks, model discovery, model selection, prompt generation, chat generation, Anthropic-to-LiteLLM routing, and model recommendations.

### LiteLLM Router

Translates Anthropic-style messages into OpenAI-compatible LiteLLM chat completions. It appends active route metadata, dispatches through `/v1/chat/completions`, parses standard local-model failures, and returns host-readable error boundaries for timeouts, gateway failures, and context-window problems.

### Ollama Connector

Talks to the local Ollama REST API:

- `GET /api/tags` for model discovery.
- `POST /api/generate` for prompt completion.
- `POST /api/chat` for conversation-style completion.

The connector has an internal streaming generator, but MCP tool responses are returned as completed text in this MVP because normal Claude Desktop tool calls do not provide token-by-token replacement for assistant output.

### Model State Manager

Persists:

- selected provider
- selected model
- auto fallback preference
- update timestamp

The default path is `~/.hybrid-model-switcher/state.json`.

### Atomic Active-Model State

Persists Phase 2 local route state at `~/.hybrid-model-switcher/active-model.json` by default. Reads and writes are serialized inside the process, and writes use a temporary file plus rename so a model switch creates a new immutable snapshot without mutating a request already in flight.

### Router

Resolves each request to one of two providers:

- `ollama`: local model inference.
- `client`: MCP sampling request to the connected client model, if supported.

When the active provider is `client` and sampling fails, `autoFallback` can retry with Ollama if a local model is available.

### Security And Resilience

The Phase 3 hardening layer adds:

- Native secret-store wrappers for Tauri IPC or Node keytar, with no localStorage token persistence.
- Strict `tools/call` sanitation with per-tool schemas, prototype-pollution key rejection, shell-execution key rejection, depth limits, and bounded string/array sizes.
- A token-bucket concurrency limiter on local inference tools.
- Guarded stream collection that cancels readers, releases locks, bounds buffers, and drops references on close or abort.
- Degradation schemas and UI fallback signals for local stream crashes, offline cloud routes, and unreadable host configuration.

## Product Boundary

This MCP server cannot:

- detect Claude usage-limit banners by itself
- inject a global model dropdown into Claude Desktop
- transparently reroute ordinary chat turns without a tool call
- bypass Anthropic product limits or policies

It can:

- keep local-model generation available from Claude Desktop via MCP
- preserve MCP tool workflows around local inference
- serve as the backend for a future supported switcher UI

## Phase Mapping

| Phase | Status | Notes |
| --- | --- | --- |
| Core Bridge | Implemented | MCP server, Ollama connector, discovery, generation |
| Model Switching | Implemented MVP | Low-level MCP proxy handlers, LiteLLM route, host config manager, atomic state; native UI still requires companion/client support |
| Hardening, Security, Testing | Implemented MVP | MSW unit tests, MCP lifecycle integration tests, Playwright Tauri bridge E2E, chaos recovery tests, sanitizer, secrets, stream guard, limiter |
| Hybrid Workflows | Partial | Client sampling and Ollama routing exist; advanced delegation is future work |
| Agent Enhancement | Future | Local agent pool and orchestration should build on this routing layer |
