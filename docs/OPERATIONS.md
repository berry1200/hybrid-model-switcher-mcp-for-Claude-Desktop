# Operations Runbook

## Release Distribution

1. Build the backend bundle with `npm.cmd run bundle`.
2. Build the Tauri shell on the native matrix runners through `.github/workflows/release.yml`.
3. Sign platform bundles with the release secrets configured in GitHub Actions.
4. Publish the signed native artifacts to the draft GitHub Release.
5. Generate updater signatures with the Tauri signer for the exact uploaded bundles.
6. Update `static/update-manifest.json` with the released version, artifact URLs, and signatures.
7. Serve the manifest over HTTPS from the production update endpoint configured in the desktop shell.

## Zero-Downtime Update Flow

1. `TauriUpdateMonitor` fetches the remote manifest on a timer.
2. The monitor validates the schema and checks semver against the installed version.
3. Active MCP tool-calling sessions defer update download.
4. When idle, the native Tauri bridge downloads and verifies the signed bundle silently.
5. The user is notified only after verification succeeds.
6. Install/restart runs only after the user accepts the ready-to-install prompt.

## Rollback Flow

1. Before editing `claude_desktop_config.json`, `LocalConfigRollbackEngine` writes a timestamped structural snapshot with a SHA-256 fingerprint.
2. Config writes use temp-file, fsync, and rename semantics.
3. On boot, `recordBootStartAndRollbackIfNeeded()` increments a persistent boot-failure counter.
4. A healthy startup must call `recordBootHealthy()` to reset the counter.
5. Three consecutive failed boots restore the latest snapshot or purge the injected proxy block if no snapshot exists.
6. A native tray notification explains that the config was recovered.

## Crash Triage

1. Unhandled exceptions pass through `classifyUnhandledException()`.
2. Fatal crashes include OOM, heap limit, stack overflow, permission errors, and explicit uncaught/unhandled markers.
3. Transient route failures are warnings and remain retryable.
4. Payload/config failures are errors but should not terminate the MCP host connection.
5. Telemetry redacts local paths, API keys, and prompt/tool payload fields before emission.

## Source Maps

1. CI sets `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, and `SENTRY_RELEASE`.
2. Run `sentry-cli sourcemaps inject dist/production`.
3. Run `sentry-cli sourcemaps upload dist/production --release $SENTRY_RELEASE --dist desktop`.
4. Runtime events send release/dist tags and sanitized stack frames.
5. Sentry un-minifies stack traces server-side using the uploaded maps, without collecting user prompts or raw local project paths.

## Compatibility Guard

1. Runtime config enters through `migrateRuntimeConfig()`.
2. Legacy active model state enters through `migrateActiveModelState()`.
3. Old `hybrid_route_anthropic` argument names such as `payload`, `maxTokens`, `stopSequences`, `model`, and `fallbackModel` are normalized before validation.
4. LiteLLM metadata receives a compatibility schema version marker.
5. Invalid legacy shapes fail with host-readable `PayloadTranslationError` or `ConfigurationError`, not process crashes.
