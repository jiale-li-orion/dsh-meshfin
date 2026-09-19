# @deepseek-ai/dsh-computer-use-cua-driver

English | [中文](README.zh.md)

Reserves the composition's computer-use slot for a [Cua Driver](https://github.com/trycua/cua) desktop the model can see and operate, and refuses to activate a setup that cannot show it anything.

The driver itself is external. In this baseline a companion **MCP client row** owns the process and supplies the driver's own tools:

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

The driver's installation, its platform grants, and its execution stay with that external program; nothing activates a desktop by default. `cua-driver` must be on the host that owns the desktop — on a Windows desktop with a WSL harness that means installing it on Windows and letting the MCP row reach it, not inside WSL.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `requireScreenshots` | `true` | Refuse the mount unless a durable attachment store is mounted **and** at least one model route declares `image` input. A desktop agent that cannot receive screenshots is blind, so the default refuses the mount instead of starting a useless session. |

## Use this package

Mount the seam, the companion MCP row, and this provider. Activation is refused — with a message naming the missing prerequisite — when screenshots are impossible:

- no `attachments` service is mounted, or
- no model route's catalog entry declares `image` in `inputModalities` (an entry that omits modalities is negative capability, not unknown).

Set `requireScreenshots: false` to run a blind driver deliberately: input actions still work and screenshots are simply not offered.


## Dev Note

Adapted from the official experimental Cua Driver providers. Their seam shape, the screenshot prerequisites, and the "exclusive provider reservation" discipline are kept; the per-Session MCP mounting is replaced by this baseline's row-scoped MCP client, and the native (in-process SDK) variant is deliberately not ported because its crashes would terminate the harness process.

## Model Experience

Indirectly, through the companion MCP client row, whose driver tools (`mcp__cua-driver__*`) the model calls and whose results it reads unchanged.

#### KV Cache effect

None directly; the driver's tool schemas ride the tool block the composition already sends.

## Known Limitations and Deferred Work

- **Tools come from the MCP row, not from this provider** — this baseline's MCP client is row-scoped, so one driver serves every Session in the composition. The official experimental group mounts a browser/desktop server **per Session** with scoped tool masks; that needs scope APIs newer than rc.7 and is not ported.
- **One desktop per composition** — the seam's exclusive slot is the contract.
- **No gate on the driver's own permissions** — desktop grants belong to Cua Driver's installation; this provider neither installs nor changes them.
- **The agent can act without a live human** — a mounted provider gives the model input control of the desktop; use a deployment whose approval policy matches that reach.
