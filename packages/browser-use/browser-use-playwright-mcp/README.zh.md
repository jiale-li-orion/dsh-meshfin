# @deepseek-ai/dsh-browser-use-playwright-mcp

[English](README.md) | 中文

为 Playwright 的浏览器工具占用组合的 browser-use 名额，在"启动浏览器"与"附着到已有浏览器"之间做出决定，并推导出浏览器服务端必须使用的参数。

服务端本身是外部的。在本基线上，一条伴生的 **MCP 客户端行**拥有进程并提供服务端自己的工具：

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

默认不启动任何浏览器；浏览器二进制的安装（`npx playwright install chromium` 及其系统库）属于部署方。

## 配置

`mode` 选择两种形态之一，其余键属于它们各自列在下面的那种形态。

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `mode: launch` | — | 启动一个由本 provider 为整个组合拥有的隔离 Chromium。 |
| `headless` | `true` | 让该浏览器在没有可见窗口的情况下运行。 |
| `executablePath` | — | 浏览器可执行文件；省略则使用服务端自身的安装发现。 |
| `mode: attach` | — | 驱动一个已由调试端点暴露的浏览器。 |
| `endpoint` | — | HTTP(S) 调试地址或 WS(S) 浏览器调试端点。 |
| `toolCallTimeoutMs` | MCP 客户端默认 | 对伴生行的单次调用超时覆盖。 |

## 使用本包

挂载 seam、伴生 MCP 行与本 provider。provider 在占用名额**之前**校验该选择，因此被拒绝的端点会让 browser use 保持空闲以供另一种配置使用，而不是半占用。

`browserServerArgs` 返回伴生行必须在服务端入口之后传入的参数，使**经过校验的选择与真正运行的服务端保持一致**：

- `launch`：`--browser chromium --isolated`，随后在 headless 时加 `--headless`，在设置了路径时加 `--executable-path <path>`。
- `attach`：`--browser chromium --cdp-endpoint <endpoint>`。

服务端会读取环境中的 `PLAYWRIGHT_MCP_*` 变量，因此通过本 provider 配置该行的组合，应在该行的 `env` 映射中把本来会被继承的那些置空（`PLAYWRIGHT_MCP_HEADLESS: ''` 等）。

## 开发注记

改写自官方实验性的 Playwright MCP provider。保留其启动/附着配置、端点校验，以及推导出的 `--browser`/`--isolated`/`--headless`/`--executable-path`/`--cdp-endpoint` 参数；**按 Session 挂载 MCP** 被替换为本基线按行生效的 MCP 客户端，上游的包版本钉子也从依赖变成伴生行自己的命令。

## 模型体验

间接经由伴生 MCP 客户端行：模型调用其中的浏览器工具（`mcp__playwright-mcp__*`），并原样读取其结果。

#### KV Cache 影响

没有直接影响；浏览器服务端的工具 schema 搭载在组合本来就会发送的工具块里。

## 已知限制与推迟项

- **工具来自 MCP 行而不是本 provider**——本基线的 MCP 客户端按行生效，所以一个浏览器服务组合内所有 Session。官方实验组为**每个 Session** 挂载浏览器并用 scope 掩码隔离；那需要一个服务端命名空间随 Session 限定的 MCP 客户端，而本基线按进程根保留 `serverName` 的机制表达不了这件事。
- **附着只在配置层面独占**——seam 只允许一个 provider，但没有任何东西阻止在本组合之外驱动第二个调试端点。
- **本 provider 不安装服务端与浏览器**——伴生行的命令与浏览器二进制属于部署方。
- **一个组合一个浏览器**——seam 的独占名额就是契约，因此并行 Session 会在同一个浏览器上串行。
