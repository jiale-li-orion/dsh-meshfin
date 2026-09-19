# @deepseek-ai/dsh-browser-use

English | [中文](README.zh.md)

The browser-use capability definition (`ctx.browserUse`). A composition mounts **at most one** provider that lets a model inspect and operate web pages; the seam owns that single slot, and each provider owns its own operations, tools, and platform requirements.

## Service contract

- `register(name)` reserves the sole slot until its disposer runs and returns that disposer. A second registration throws — including one repeating the current name, so a provider that restarted without releasing cannot silently take over.
- `providerName` publishes the registered name, and keeps publishing it while the provider's resources are closing; a released registration clears it.
- Providers must stop their tools and await owned browser work **before** releasing the registration, so a released slot never overlaps a browser process that is still shutting down.

The seam defines no tool, no transport, and no page-content policy: `@deepseek-ai/dsh-browser-use-playwright-mcp` reserves the slot for Playwright's browser tools, and another provider may do the same for a different browser backend.

## Configuration

None. The service is mounted with a bare row and providers carry their own configuration.

## Dev Note

Absorbed from the official harness's browser-use group (`packages/browser-use/browser-use`): the exclusive-registration design and its diagnostics are theirs, restated against this fork's rc.7 seams. The official experimental group's per-Session browser mounting needs newer scope APIs and is not part of this port.

## Model Experience

None, as this package contributes no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **One browser backend per composition** — the exclusive slot is the contract, so two backends in one process would need a second composition rather than two providers.
- **No page-content policy of its own** — what a provider may read, navigate, or submit belongs to that provider and to the deployment's approval policy; this definition deliberately carries none.
- **No per-Session browser** — the mounted backend's tools serve every Session at once. One row per Session would need an MCP client that scopes its server namespace to the Session: this baseline's client reserves each `serverName` once per process root, so a second instance using the same namespace fails at load.
