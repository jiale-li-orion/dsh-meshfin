# Browser use

English | [中文](browser-use.zh.md)

Browser use lets a model inspect and operate web pages. `@deepseek-ai/dsh-browser-use` owns the capability definition — the `ctx.browserUse` service — and `@deepseek-ai/dsh-browser-use-playwright-mcp` is the provider this distribution mounts for Playwright's browser tools.

## One browser backend per composition

The definition owns exactly one registration slot. `register(name)` reserves it until its disposer runs and returns that disposer; a second registration throws, including one repeating the current name, so a provider that restarted without releasing cannot silently take over. The name publishes through `providerName` for the registration's whole lifetime — including while the provider's resources are closing — so a released slot never overlaps a browser process that is still shutting down.

The seam defines no tool, no transport, and no page-content policy. A provider owns its operations and their platform requirements, and a deployment that must not reach a live session or an authenticated profile should not mount one.

## How browser tools reach the model

The browser server is external. In this baseline the tools arrive through the row-based MCP client, so a composition mounts a companion row (`@deepseek-ai/dsh-mcp-client` starting `@playwright/mcp`) beside the provider; the server's own tool descriptions and results are what the model sees, and screenshots are ordinary images budgeted by the request pipeline.

The provider owns the launch-versus-attach decision and rejects an unusable one before it reserves the slot; `browserServerArgs` derives the arguments the companion row must pass so the validated choice and the running server agree. Launch owns a browser for the whole composition — `--isolated` keeps it out of the user's own profile — while attach exclusively drives a browser a debugging endpoint already exposes.

```yaml
- id: mcp-playwright
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: playwright-mcp
    transport: stdio
    command: npx
    args: ['-y', '@playwright/mcp@0.0.80', '--browser', 'chromium', '--isolated', '--headless']
- name: '@deepseek-ai/dsh-browser-use'
- name: '@deepseek-ai/dsh-browser-use-playwright-mcp'
  config:
    mode: launch
    headless: true
```

Attaching instead replaces the launch arguments with `--cdp-endpoint <endpoint>` and drops `--isolated`. Installing the browser binary (`npx playwright install chromium`, plus its system libraries) stays with the deployment, and the server inherits ambient `PLAYWRIGHT_MCP_*` variables, so a composition blanks the ones it sets in the row's `env` map to keep this provider's choice authoritative.

## Where the design came from

Absorbed from the official harness's browser-use group and its experimental providers. Their exclusive-registration seam, launch-versus-attach config, and endpoint validation are kept; the official per-Session MCP mounting needs scope APIs newer than this baseline and is not ported, so the companion row owns the process while the provider owns the contract. The Chrome DevTools and Stagehand backends are not ported: the first duplicates what the Chrome DevTools MCP server already offers as a plain row, and the second adds a hosted service this distribution does not depend on.

See also: [`@deepseek-ai/dsh-browser-use`](../../packages/browser-use/browser-use/README.md) and [`@deepseek-ai/dsh-browser-use-playwright-mcp`](../../packages/browser-use/browser-use-playwright-mcp/README.md).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbrowseruse--browseruseregistry"></a>

### `ctx.browserUse` — `BrowserUseRegistry`

Owns the single optional provider registration of the browser-use capability.

```ts cordis-catalog
/**
 * Reserve the sole provider slot until the contribution is disposed.
 * A second registration fails even when it repeats the current name.
 * Providers must stop their tools and await owned browser work before
 * releasing this registration, so a released slot never overlaps a browser
 * process that is still shutting down.
 * @param name - provider-owned name used in registration diagnostics.
 * @returns the effect disposer for this exact registration.
 */
register(name: BrowserUseProviderName): () => Promise<void>
```

Source: [`packages/browser-use/browser-use/src/index.ts:22`](../../packages/browser-use/browser-use/src/index.ts)
<!-- END GENERATED cordis-surface -->
