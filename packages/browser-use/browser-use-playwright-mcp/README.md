# @deepseek-ai/dsh-browser-use-playwright-mcp

English | [中文](README.zh.md)

Reserves the composition's browser-use slot for Playwright's browser tools, decides between launching a browser and attaching to one, and derives the arguments the browser server must run with.

The server itself is external. In this baseline a companion **MCP client row** owns the process and supplies the server's own tools:

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

Nothing starts a browser by default, and installing the browser binary (`npx playwright install chromium`, plus its system libraries) stays with the deployment.

## Configuration

`mode` selects one of two shapes, and the other keys belong to the shape they are listed under.

| Key | Default | Meaning |
| --- | --- | --- |
| `mode: launch` | — | Launch an isolated Chromium this provider owns for the whole composition. |
| `headless` | `true` | Run that browser without a visible window. |
| `executablePath` | — | Browser executable; omission uses the server's own installation discovery. |
| `mode: attach` | — | Drive a browser a debugging endpoint already exposes. |
| `endpoint` | — | HTTP(S) debugging URL or WS(S) browser debugging endpoint. |
| `toolCallTimeoutMs` | MCP client default | Per-call timeout override for the companion row. |

## Use this package

Mount the seam, the companion MCP row, and this provider. The provider validates the choice before it reserves the slot, so a rejected endpoint leaves browser use free for another configuration instead of claiming it half-way.

`browserServerArgs` returns the arguments the companion row must pass after the server entry point, so the validated choice and the running server agree:

- `launch`: `--browser chromium --isolated`, then `--headless` when headless, then `--executable-path <path>` when set.
- `attach`: `--browser chromium --cdp-endpoint <endpoint>`.

The server reads ambient `PLAYWRIGHT_MCP_*` variables, so a composition that configures the row through this provider blanks the ones it would otherwise inherit (`PLAYWRIGHT_MCP_HEADLESS: ''` and so on) in that row's `env` map.

## Dev Note

Adapted from the official experimental Playwright MCP provider. Its launch-versus-attach config, endpoint validation, and derived `--browser`/`--isolated`/`--headless`/`--executable-path`/`--cdp-endpoint` arguments are kept; the per-Session MCP mounting is replaced by this baseline's row-scoped MCP client, and the upstream package pin moves from a dependency to the companion row's own command.

## Model Experience

Indirectly, through the companion MCP client row, whose browser tools (`mcp__playwright-mcp__*`) the model calls and whose results it reads unchanged.

#### KV Cache effect

None directly; the browser server's tool schemas ride the tool block the composition already sends.

## Known Limitations and Deferred Work

- **Tools come from the MCP row, not from this provider** — this baseline's MCP client is row-scoped, so one browser serves every Session in the composition. The official experimental group mounts a browser **per Session** with scoped tool masks; that needs scope APIs newer than rc.7 and is not ported.
- **Attachment is exclusive only by configuration** — the seam allows one provider, but nothing stops a second debugging endpoint from being driven outside this composition.
- **The provider does not install the server or the browser** — the companion row's command and the browser binary belong to the deployment.
- **One browser per composition** — the seam's exclusive slot is the contract, so parallel Sessions serialize on one browser.
