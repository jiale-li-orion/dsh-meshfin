# @deepseek-ai/dsh-computer-use-cua-driver

[English](README.md) | 中文

为 [Cua Driver](https://github.com/trycua/cua) 桌面占用本组合的 computer-use 名额——让模型能看见并操作它——并在"什么都看不见"的配置上拒绝激活。

驱动本身是外部的。在本基线里，一个**伴生的 MCP 客户端行**持有进程并提供驱动自带的工具：

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

驱动的安装、它的平台授权与执行都归那个外部程序；默认不会激活任何桌面。`cua-driver` 必须装**拥有桌面的那台主机**上——在"Windows 桌面 + WSL harness"这套里就是装在 Windows 上、让 MCP 行能访问到它，而不是装在 WSL 里。

## 配置

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `requireScreenshots` | `true` | 除非已挂载持久化附件存储**且**至少有一条模型路由声明 `image` 输入，否则拒绝挂载。看不见截图的桌面 agent 是瞎的，所以默认拒绝挂载，而不是起一个没用的会话。 |

## 使用

挂载 seam、伴生 MCP 行与本 provider。当截图不可能时，激活会被拒绝，并点名缺哪个前提：

- 没有挂载 `attachments` 服务，或
- 没有任何模型路由的目录条目在 `inputModalities` 里声明 `image`（**省略模态是"负能力"，不是"未知"**）。

设 `requireScreenshots: false` 可以有意识地跑一个"盲"驱动：输入动作仍然可用，只是不提供截图。


## 开发注记

改编自官方的实验性 Cua Driver provider。保留了它们的 seam 形状、截图前提与"独占 provider 预约"纪律；按 Session 的 MCP 挂载换成本基线的行作用域 MCP 客户端；native（进程内 SDK）变体**刻意不移植**，因为它的崩溃会终止 harness 进程。

## 模型体验

间接地，经由伴生的 MCP 客户端行——模型调用的是驱动自己的工具（`mcp__cua-driver__*`），读到的也是它们原样的结果。

#### KV Cache 影响

无直接影响；驱动的工具 schema 搭乘组合本来就发送的 tool 块。

## 已知限制与推迟项

- **工具来自 MCP 行，而不是本 provider**——本基线的 MCP 客户端是行作用域的，所以一个驱动服务该组合里的所有 Session。官方实验组是**按 Session** 挂载浏览器/桌面服务器并做作用域工具屏蔽；那需要比 rc.7 更新的 scope API，未移植。
- **一个组合一个桌面**——seam 的独占名额就是契约。
- **不校验驱动自身的权限**——桌面授权属于 Cua Driver 的安装；本 provider 既不安装也不改动它们。
- **agent 可以在无人在场时动手**——挂载 provider 就等于把桌面的输入控制权交给模型；请只在审批策略匹配这种触达范围的部署里启用。
