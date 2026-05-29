<div align="center">

<img src="https://img.shields.io/badge/MCP-Protocol-5DCAA5?style=flat-square&logo=anthropic&logoColor=white" alt="MCP"/>
<img src="https://img.shields.io/badge/Ollama-Local%20Models-EF9F27?style=flat-square" alt="Ollama"/>
<img src="https://img.shields.io/badge/LiteLLM-Router-7F77DD?style=flat-square" alt="LiteLLM"/>
<img src="https://img.shields.io/badge/TypeScript-Strict-378ADD?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"/>
<img src="https://img.shields.io/badge/Claude%20Desktop-Tested-D4537E?style=flat-square" alt="Claude Desktop"/>
<img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License"/>

# Hybrid Model Switcher MCP

**An open-source MCP routing proxy that gives Claude Desktop tools for discovering, activating, and generating with locally-hosted Ollama models — without leaving Claude's interface.**

*When Claude's usage limits slow your workflow, route to a local model and keep building.*

</div>

---

## What This Is

This project is a **Model Context Protocol (MCP) server** that acts as an intelligent routing proxy between Claude Desktop and locally-hosted open-source LLMs via [Ollama](https://ollama.com) and [LiteLLM](https://github.com/BerriAI/litellm).

Claude Desktop exposes the seven hybrid tools as first-class tools in every conversation. You can list installed models, set an active route, generate directly with a local LLM, translate Anthropic-format message payloads through LiteLLM, and persist your routing preference across sessions — all without leaving the Claude UI.

```
Claude Desktop (MCP Client)
        │  stdio / JSON-RPC 2.0
        ▼
Hybrid Model Switcher MCP  ◄──── this project
        │
   ┌────┴────┐
   ▼         ▼
Ollama    LiteLLM Gateway
(local)   (normalises to Ollama)
```

### Validated in production

The screenshots below are from a live Claude Desktop session running on Windows with llama3:latest served locally through Ollama.

<table>
<tr>
<td align="center" width="33%">
<b>MCP server: running</b><br/>
<sub>Claude Desktop → Developer → hybrid-model-switcher showing <code>running</code> status with env vars injected</sub>
</td>
<td align="center" width="33%">
<b>hybrid_generate in action</b><br/>
<sub>Claude orchestrating a migration plan request through <code>hybrid_generate</code> → llama3:latest</sub>
</td>
<td align="center" width="33%">
<b>Local model output</b><br/>
<sub>llama3:latest returns a 4-phase migration plan; Claude presents and structures the result</sub>
</td>
</tr>
</table>

---

## Key Capabilities

| Capability | Status | Notes |
|---|---|---|
| Ollama model discovery | ✅ Shipped | `hybrid_list_models` — auto-detects installed models |
| Active route persistence | ✅ Shipped | Survives restarts via `~/.hybrid-model-switcher/` |
| Local generation | ✅ Shipped | `hybrid_generate` — single prompt to Ollama |
| Local chat | ✅ Shipped | `hybrid_chat` — message array to Ollama |
| Anthropic→LiteLLM translation | ✅ Shipped | `hybrid_route_anthropic` — full payload normalisation |
| MCP client sampling | ✅ Shipped | Delegates to connected client when `provider=client` |
| Task-based model recommendations | ✅ Shipped | `hybrid_recommend_model` |
| Strict TypeScript + error boundaries | ✅ Shipped | `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` |
| Production bundle | ✅ Shipped | esbuild minified `.cjs` via `npm run bundle` |
| Observability / telemetry | ✅ Shipped | Opt-in Sentry, privacy-first redaction |
| GitHub Actions release pipeline | ✅ Shipped | Multi-platform Tauri build on semver tags |
| Native Tauri tray shell | 🔲 Planned | Phase 5 — `src-tauri` shell needed |
| Transparent chat interception | 🔲 Needs Claude Desktop API | Requires first-party extension point |

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org) 20 LTS or later
- [Claude Desktop](https://claude.ai/download)
- [Ollama](https://ollama.com) running locally

### 1 — Install and build

```bash
git clone https://github.com/berry1200/hybrid-model-switcher-mcp.git
cd hybrid-model-switcher-mcp
npm install
npm run build
```

For a minified single-file production executable:

```bash
npm run bundle
# outputs: dist/production/hybrid-model-switcher-mcp.cjs
```

### 2 — Pull at least one local model

```bash
ollama serve          # if not already running as a service
ollama pull llama3    # or deepseek-r1, qwen3, phi4, etc.
```

### 3 — Register with Claude Desktop

Edit `claude_desktop_config.json` (Settings → Developer → Edit Config) and add:

```json
{
  "mcpServers": {
    "hybrid-model-switcher": {
      "command": "node",
      "args": [
        "/absolute/path/to/hybrid-model-switcher-mcp/dist/index.js"
      ],
      "env": {
        "OLLAMA_BASE_URL": "http://127.0.0.1:11434",
        "LITELLM_BASE_URL": "http://127.0.0.1:4000",
        "HYBRID_DEFAULT_MODEL": "llama3:latest"
      }
    }
  }
}
```

For a production install, point `args` at the bundled file instead:

```
/absolute/path/to/hybrid-model-switcher-mcp/dist/production/hybrid-model-switcher-mcp.cjs
```

### 4 — Restart Claude Desktop

The seven `hybrid_*` tools appear in every conversation. Ask Claude:

```
Use hybrid_list_models, then set the active local model to llama3:latest.
```

Then:

```
Use hybrid_generate with the active local model to draft a migration plan for this codebase.
```

---

## MCP Tools

All seven tools are exposed as first-class MCP tools inside Claude Desktop.

### `hybrid_status`
Returns Ollama health, active model state, host config status, and runtime proxy metadata. Use this to verify the server is connected and routing correctly.

### `hybrid_list_models`
Queries the local Ollama instance and returns all installed model names alongside recommended model profiles. Called automatically on first use if no active model is set.

### `hybrid_set_model`
Persists the active provider and model to `~/.hybrid-model-switcher/active-model.json`. Provider can be `ollama`, `litellm`, or `client` (MCP sampling delegation).

```
Set the active model to deepseek-r1:latest with provider ollama.
```

### `hybrid_generate`
Runs a single prompt against the active local model, an explicitly named Ollama model, or the MCP client through sampling. Returns the generated text directly.

### `hybrid_chat`
Runs a full message array (conversation history) against Ollama chat or client sampling. Maintains role/content structure throughout.

### `hybrid_route_anthropic`
Translates an Anthropic-style `messages` request into a LiteLLM chat completion payload, appends active-route metadata, and dispatches it through the configured LiteLLM gateway. This is the bridge for workflows already written against the Anthropic SDK.

### `hybrid_recommend_model`
Maps task types (`reasoning`, `coding`, `chat`, `speed`, `general`) to recommended local model families with brief justification.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Claude Desktop (Electron)                                     │
│  MCP Client · Anthropic API · Conversation UI                  │
└──────────────────────────┬─────────────────────────────────────┘
                           │  stdio  JSON-RPC 2.0
                           ▼
┌────────────────────────────────────────────────────────────────┐
│  Hybrid Model Switcher MCP  (this project)                     │
│                                                                │
│  src/mcp/server.ts      — MCP protocol layer, tool registry   │
│  src/routing/litellm.ts — Anthropic→LiteLLM translation       │
│  src/tauri/config.ts    — Config manager, atomic model state   │
│  src/utils/errors.ts    — Typed error hierarchy, fallbacks     │
└────────────┬──────────────────────┬────────────────────────────┘
             │                      │
             ▼                      ▼
    ┌──────────────┐     ┌─────────────────────┐
    │  Ollama API  │     │  LiteLLM Gateway    │
    │  :11434      │     │  :4000              │
    │  Local LLMs  │     │  Format normaliser  │
    └──────────────┘     └─────────────────────┘
```

### Design principles

- **No Claude internals modified.** The server is a standard MCP tool provider. Claude Desktop is untouched.
- **Provider-agnostic routing.** The active route (`ollama` / `litellm` / `client`) is a persisted preference, switchable at runtime without a restart.
- **Fail-safe error boundaries.** Every tool handler returns a valid `CallToolResult` regardless of upstream state — Claude Desktop never sees an unhandled rejection.
- **Privacy by default.** Telemetry is opt-in and redacts API keys, file paths, and prompt content before any event leaves the machine.

---

## Configuration

All configuration is via environment variables in `claude_desktop_config.json`.

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama API endpoint |
| `LITELLM_BASE_URL` | `http://127.0.0.1:4000` | LiteLLM gateway endpoint |
| `LITELLM_API_KEY` | unset | Optional LiteLLM bearer token |
| `LITELLM_LOCAL_MODEL_PREFIX` | `ollama_chat` | Prefix when no explicit LiteLLM model name |
| `HYBRID_MODEL_STATE_PATH` | `~/.hybrid-model-switcher/state.json` | Persisted model state |
| `HYBRID_ACTIVE_MODEL_STATE_PATH` | `~/.hybrid-model-switcher/active-model.json` | Atomic active-route state |
| `HYBRID_DEFAULT_MODEL` | unset | Fallback Ollama model name on startup |
| `HYBRID_REQUEST_TIMEOUT_MS` | `120000` | Ollama and proxy request timeout |
| `HYBRID_TELEMETRY_DSN` / `SENTRY_DSN` | unset | Optional Sentry DSN — telemetry off without this |
| `HYBRID_TELEMETRY_DISABLED` | unset | Set to `1` to force-disable telemetry |
| `HYBRID_METRICS_HEARTBEATS` | unset | Set to `1` for periodic sanitised metric heartbeats |

---

## Development

```bash
npm run dev          # Run with tsx (live reload)
npm run build        # Compile TypeScript → dist/
npm run bundle       # Minified production .cjs + bundle analysis
npm run lint         # Type-aware ESLint release gate
npm run typecheck    # tsc --noEmit
npm test             # Unit, integration, observability, chaos tests
npm run test:e2e     # Playwright Tauri IPC bridge fixture
npm start            # Start dist/index.js
npm run start:prod   # Start dist/production/hybrid-model-switcher-mcp.cjs
```

For the E2E suite, install Playwright's Chromium driver first:

```bash
npx playwright install chromium
```

Full verification sequence before a release:

```bash
npm run lint && npm run typecheck && npm run build && npm test && npm run bundle && npm run test:e2e
npm audit --audit-level=moderate
```

---

## Recommended Local Models

| Task | Model | Reason |
|---|---|---|
| Heavy reasoning | `deepseek-r1:14b` | Strong chain-of-thought |
| Code generation | `deepseek-coder:latest` | Trained on code |
| Long conversations | `llama3.1:8b` | Good context window |
| Fast / lightweight | `phi4:latest` | Low resource use |
| Balanced general | `qwen3:latest` | Strong all-rounder |

Pull any of them with:

```bash
ollama pull deepseek-r1
ollama pull deepseek-coder
ollama pull llama3.1
ollama pull phi4
ollama pull qwen3
```

---

## Roadmap

### Shipped (Phases 1–4)
- MCP/Ollama bridge, model discovery, local generation and chat
- LiteLLM translation route with Anthropic-format normalisation
- Atomic active-model state with async mutex
- Strict error boundaries and typed fallback results
- Payload sanitation, native secret-store wrappers
- Token-bucket concurrency limiting, chaos recovery schemas
- GitHub Actions release pipeline (multi-platform Tauri)
- Type-aware lint gate, production esbuild bundle, telemetry

### Phase 5 — Native Tray Shell
- `src-tauri` desktop shell
- System tray icon with live model indicator
- One-click model switcher dropdown
- Native `.deb`, `.dmg`, `.msi` packaging

### Phase 6 — Transparent Routing *(requires Claude Desktop API support)*
- Automatic usage-limit detection
- Transparent continuation: every ordinary chat turn routes to the active local model
- Native model dropdown integrated into Claude Desktop's own UI

> **Important boundary:** MCP servers cannot currently replace Claude Desktop's built-in model selector or intercept every user message. Phases 5–6 require either first-party Claude Desktop extension support or a separate companion overlay. This project ships what is possible today and provides a clean foundation for when that support arrives.

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

Quick checklist:
- `npm run typecheck` passes with zero errors
- `npm test` passes
- `npm run lint` passes
- New tools include a corresponding tool definition, handler, and at minimum one unit test

---

## Research Context

This project originated as a structured engineering research exercise exploring the practical boundaries of MCP as a model-routing layer inside Claude Desktop. The four-phase implementation — from MCP/Ollama bridge through production hardening and release infrastructure — was designed to answer the question:

> *How far can an MCP server extend Claude Desktop's inference capabilities without modifying Claude itself?*

The answer is documented in code: substantial local inference routing, Anthropic-format payload translation, persisted provider state, and observable production metrics are all achievable today. The remaining gap — transparent interception of ordinary Claude chat turns — is a protocol-level boundary, not a technical one. It is documented here as a specific, scoped requirement for future first-party support rather than a limitation of the approach.

---

## License

[MIT](LICENSE) © 2026
