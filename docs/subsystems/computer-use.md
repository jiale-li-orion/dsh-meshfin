# Computer use

English | [中文](computer-use.zh.md)

Computer use lets a model observe and operate a desktop. `@deepseek-ai/dsh-computer-use` owns the capability definition — the `ctx.computerUse` service — and `@deepseek-ai/dsh-computer-use-cua-driver` is the provider this distribution mounts for a [Cua Driver](https://github.com/trycua/cua) desktop.

## One desktop per composition

The definition owns exactly one registration slot. `register(name)` reserves it until its disposer runs and returns that disposer; a second registration throws, including one repeating the current name, so a provider that restarted without releasing cannot silently take over. The name publishes through `providerName` for the registration's whole lifetime — including while the provider's resources are closing — so a released slot never overlaps a closing desktop session.

The seam defines no tool, no transport, and no approval policy: the provider owns its operations and their platform requirements, and a deployment whose approval policy does not match desktop input control should not mount one.

## How a desktop reaches the model

The driver is external. In this baseline the tools arrive through the row-based MCP client, so a composition mounts a companion row (`@deepseek-ai/dsh-mcp-client` with `command: cua-driver, args: [mcp]`) beside the provider; the driver's own tool descriptions and results are what the model sees. Screenshots are ordinary images: they arrive through the durable attachment store and are budgeted by the request pipeline like any other image, which is why the provider refuses to activate without an attachment service and a model route declaring `image` input.

```yaml
- id: mcp-cua-driver
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: cua-driver
    transport: stdio
    command: cua-driver
    args: [mcp]
- name: '@deepseek-ai/dsh-computer-use'
- name: '@deepseek-ai/dsh-computer-use-cua-driver'
```

The driver's installation and its platform grants stay with that program: on a Windows desktop driven from a WSL harness, it belongs on the Windows side, reachable from the parent shell.

## Where the design came from

Absorbed from the official harness's computer-use group and its experimental Cua Driver providers. Their exclusive-registration seam and screenshot prerequisites are kept; the official per-Session MCP mounting needs scope APIs newer than this baseline and is not ported, and the native (in-process SDK) provider is deliberately not ported because its crashes would terminate the harness process.

See also: [`@deepseek-ai/dsh-computer-use`](../../packages/computer-use/computer-use/README.md) and [`@deepseek-ai/dsh-computer-use-cua-driver`](../../packages/computer-use/computer-use-cua-driver/README.md).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcomputeruse--computeruseregistry"></a>

### `ctx.computerUse` — `ComputerUseRegistry`

Owns the single optional provider registration of the computer-use capability.

```ts cordis-catalog
/**
 * Reserve the sole provider slot until the contribution is disposed.
 * A second registration fails even when it repeats the current name.
 * Providers must stop their tools and await owned work before releasing this
 * registration, so a released slot never overlaps a closing desktop session.
 * @param name - provider-owned name used in registration diagnostics.
 * @returns the effect disposer for this exact registration.
 */
register(name: ComputerUseProviderName): () => Promise<void>
```

Source: [`packages/computer-use/computer-use/src/index.ts:22`](../../packages/computer-use/computer-use/src/index.ts)
<!-- END GENERATED cordis-surface -->
