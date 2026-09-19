# @deepseek-ai/dsh-computer-use

English | [中文](README.zh.md)

The computer-use capability definition (`ctx.computerUse`). A composition mounts **at most one** provider that lets a model observe and operate a desktop; the seam owns that single slot, and each provider owns its own operations, tools, and platform requirements.

## Service contract

- `register(name)` reserves the sole slot until its disposer runs and returns that disposer. A second registration throws — including one repeating the current name, so a provider that restarted without releasing cannot silently take over.
- `providerName` publishes the registered name, and keeps publishing it while the provider's resources are closing; a released registration clears it.
- Providers must stop their tools and await owned work **before** releasing the registration, so a released slot never overlaps a closing desktop session.

The seam defines no tool and no transport: `@deepseek-ai/dsh-computer-use-cua-driver` reserves the slot for a Cua Driver desktop, and another provider may do the same for a different desktop.

## Configuration

None. The service is mounted with a bare row and providers carry their own configuration.


## Dev Note

Absorbed from the official harness's computer-use group (`packages/computer-use/computer-use`): the exclusive-registration design and its diagnostics are theirs, with this package restating them against this fork's rc.7 seams. The provider's per-Session mounting in the official experimental group needs newer scope APIs and is not part of this port.

## Model Experience

None, as this package contributes no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **One desktop per composition** — the exclusive slot is the contract, so two desktops in one process would need a second composition rather than two providers.
- **No approval seam of its own** — a provider decides whether desktop actions need `ctx.approval`; this definition deliberately carries no policy.
