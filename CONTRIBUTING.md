# Contributing to Hybrid Model Switcher MCP

Thank you for taking the time to contribute. This document covers the development workflow, code standards, and the process for submitting changes.

---

## Ways to contribute

- **Bug reports** — use the bug report issue template. Include your OS, Node.js version, Ollama version, and the full log from Claude Desktop's MCP log viewer.
- **Feature requests** — use the feature request template. Frame the request around a concrete user workflow, not just a technical capability.
- **Code** — fixes, new tool handlers, test coverage, documentation improvements.
- **Research** — if you are exploring the MCP routing boundary further (especially around transparent interception or Tauri overlay), open a Discussion thread first so work isn't duplicated.

---

## Development setup

```bash
git clone https://github.com/YOUR_USERNAME/hybrid-model-switcher-mcp.git
cd hybrid-model-switcher-mcp
npm install
```

You need Ollama running locally with at least one model pulled:

```bash
ollama serve
ollama pull llama3
```

Run the full verification sequence before pushing:

```bash
npm run typecheck    # must emit zero errors
npm run lint         # must pass the type-aware ESLint gate
npm test             # unit + integration + chaos tests
npm run build        # must compile cleanly
```

---

## Code standards

### TypeScript

The project compiles under the strictest TypeScript config available:

```json
"strict": true,
"noUncheckedIndexedAccess": true,
"exactOptionalPropertyTypes": true,
"noImplicitOverride": true,
"noPropertyAccessFromIndexSignature": true
```

Every pull request must pass `npm run typecheck` with zero errors. Do not use `any` casts or `@ts-ignore` without a comment explaining why the type system cannot express the constraint.

### Error handling

Every async operation must have an explicit `try/catch`. Caught values must be coerced through `toError()` before accessing `.message`. New error conditions should extend `HybridMcpError` from `src/utils/errors.ts` with a unique string literal `code`.

### Tool handlers

Each new MCP tool needs:

1. A `Tool` definition added to the `PROXY_INTRINSIC_TOOLS` array in `src/mcp/server.ts`
2. A case in `dispatchProxyTool()` routing to a private handler method
3. The handler wrapped in the existing error boundary (the `try/catch` in `dispatchProxyTool`)
4. At least one unit test covering the success path and one covering the failure path

### Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(tools): add hybrid_stream_generate for chunked Ollama output
fix(router): handle Ollama context-length exceeded as ModelNotAvailableError
docs(readme): add phi4 to recommended models table
test(chaos): add upstream-crash recovery fixture
```

Scope options: `tools`, `router`, `config`, `errors`, `tauri`, `tests`, `ci`, `docs`, `deps`.

---

## Pull request process

1. Fork the repository and create a branch from `main`: `feat/your-feature-name` or `fix/short-description`.
2. Make your changes. Keep each PR focused on a single concern.
3. Run the full verification sequence (see above). All checks must pass.
4. Open the PR against `main`. Fill in the pull request template — especially the "Testing" section.
5. A maintainer will review within a few days. Address feedback in additional commits; do not force-push during review.
6. Once approved, the maintainer will squash-merge.

---

## Project boundaries

This section exists to save you time before writing code.

**In scope:**
- New MCP tool handlers that route to local inference providers
- Improvements to the LiteLLM translation layer
- Additional Ollama model support or auto-discovery improvements
- Better error messages, structured logging, telemetry
- Test coverage for existing handlers
- The future `src-tauri` tray shell

**Out of scope (for now):**
- Anything that modifies Claude Desktop's binary, Electron runtime, or network traffic
- Reverse-engineering the Anthropic API or Claude's internal model routing
- Features that require Claude Desktop's built-in model selector to be replaced — this requires first-party support and is tracked as a known boundary in the README

If you are unsure whether something is in scope, open a Discussion before writing code.

---

## Reporting security issues

Do not open a public issue for security vulnerabilities. Email the maintainer directly (address in the GitHub profile). Include a description of the issue, steps to reproduce, and potential impact.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE) that covers this project.
