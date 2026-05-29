# Research Notes

## Hybrid Model Switching via MCP: Practical Boundaries of Local LLM Routing in Claude Desktop

### Abstract

This project investigates how far an MCP (Model Context Protocol) server can extend Claude Desktop's inference capabilities without modifying Claude itself. Through four structured implementation phases, we built a production-grade routing proxy that exposes local Ollama models as first-class tools inside Claude Desktop, translates Anthropic-format message payloads through LiteLLM, and persists provider preference across sessions. We document both what is achievable today and the specific protocol boundary that prevents fully transparent routing.

---

### Motivation

Claude Desktop's usage limits create friction in long agentic workflows. When limits are hit, users must either wait, switch to a different interface, or pay for higher tiers — all of which interrupt the session context and disrupt any active MCP tool connections. The research question was:

> Can an MCP server provide meaningful local model routing inside Claude Desktop, using only the published MCP protocol, without modifying Claude's internals?

---

### Methodology

Four implementation phases, each building on the previous:

**Phase 1 — Core Bridge**  
Established the MCP/Ollama bridge: model discovery via Ollama's `/api/tags` endpoint, single-prompt generation, chat message arrays, and persisted provider/model state. Validated that Claude Desktop correctly invokes MCP tools and surfaces their results.

**Phase 2 — Proxy Architecture**  
Implemented the low-level MCP proxy server with explicit `tools/list` aggregation across upstream servers and `tools/call` routing. Added the LiteLLM translation layer (Anthropic format → LiteLLM → Ollama), atomic active-model state with async mutex, and a typed error hierarchy with guaranteed-safe fallback tool results.

**Phase 3 — Production Hardening**  
Added payload sanitation, native secret-store wrappers, guarded stream cleanup, token-bucket concurrency limiting, chaos recovery schemas, and comprehensive test coverage including lifecycle tests and Tauri IPC fixture tests.

**Phase 4 — Observability and Release**  
Added GitHub Actions multi-platform release pipeline, production esbuild bundle, type-aware ESLint gate, privacy-first telemetry (opt-in Sentry with field-level redaction), internal APM metrics, and latency degradation alerts.

---

### Results

**What works today via MCP:**

- Ollama model discovery and selection exposed as Claude Desktop tools
- Single-prompt and multi-turn generation routed to local models
- Anthropic-format payload translation through LiteLLM
- Provider state persistence across Claude Desktop restarts
- Observable metrics: route latency, model switch counts, error rates
- Production bundle deployable on Windows, macOS, and Linux

**Demonstrated end-to-end:** Claude Desktop (Haiku 4.5) successfully invoked `hybrid_generate` → llama3:latest via Ollama on Windows, producing a complete 4-phase migration plan. The local model response was presented directly in the Claude Desktop conversation.

**The protocol boundary:**

MCP servers are tool providers. Claude Desktop invokes them when it decides to use a tool. Claude Desktop cannot currently be instructed via MCP to route its *own* inference — ordinary chat turns, where the user types a message and Claude responds — through a different model. The gap between "a tool Claude can call" and "the model Claude uses for its own responses" is a protocol-level distinction, not a technical limitation of the proxy implementation.

Transparent routing — where every chat turn silently routes to a local model — requires one of:

1. A first-party Claude Desktop extension point that intercepts the inference call
2. A separate companion client (Tauri overlay or browser extension) that wraps the UI
3. Running the conversation inside a different client that natively supports model switching

This boundary is documented explicitly in the project rather than worked around, both for honesty and because any future first-party support would make the remaining phases straightforward to implement on top of the existing infrastructure.

---

### Architecture Decisions Worth Noting

**Proxy injection over parallel server registration**  
The proxy rewrites `claude_desktop_config.json` to register itself as the sole MCP server, then spawns original upstream servers internally and aggregates their tools. This was chosen over running in parallel because it gives the proxy full control over tool namespace (preventing name collisions via `{upstreamId}__` prefixing) and a single stdio transport path to Claude Desktop.

**LiteLLM as the only Anthropic↔Ollama translation boundary**  
The proxy speaks Anthropic format to LiteLLM and nothing else. Zero Ollama-specific wire format code exists in the proxy. This means adding new local providers (Mistral, Gemini, llama.cpp) requires only a `config.yaml` update.

**AsyncMutex without external dependencies**  
The model state manager uses a hand-rolled promise-queue mutex rather than a library like `async-mutex`. The implementation is 30 lines, fully tested, and avoids a transitive dependency for a simple critical section.

**`buildFallbackToolResult()` as an invariant**  
Every tool handler's error catch calls `buildFallbackToolResult()`, which always returns a valid `CallToolResult` with `isError: true`. Claude Desktop never receives an unhandled rejection — the connection remains alive even when a local model is unreachable.

---

### Future Work

- Native Tauri tray shell (`src-tauri`) for one-click model switching without Claude prompting
- Streaming token output through MCP (currently blocked on MCP protocol support for streaming tool results)
- Usage-limit detection heuristics (screen text, API error codes) as a trigger for automatic provider switch
- Evaluation framework: measure response quality delta between Claude and each local model on standard benchmarks

---

### Citation

If you reference this work, please cite the GitHub repository:

```
Hybrid Model Switcher MCP — MCP routing proxy for Claude Desktop / Ollama / LiteLLM
https://github.com/YOUR_USERNAME/hybrid-model-switcher-mcp
2026
```
