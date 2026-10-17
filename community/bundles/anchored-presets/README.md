# dsh-anchored-presets

English | [中文](README.zh.md)

Seven anchored agent presets for DeepSeek Harness, shipped as one bundle package: `@deepseek-ai/dsh-agent-preset` declaration rows plus the helper plugin rows they mount.

| Preset id | Roster name | What it does |
| --- | --- | --- |
| `anchored-standard` | Anchored Standard (experimental) | Bootstraps with the Minimal pair (`bash` + `str_replace_editor`) and no injected context, then exposes the resident catalog after the first durable tool call or reply. |
| `zero-anchored-standard` | Zero-Anchored Standard (experimental) | Injects one zero-tool anchor turn, then exposes the full Standard catalog from the next turn. |
| `whoami-standard` | Whoami Standard (experimental) | Seeds one fixed self-introduction turn on an empty tool surface before the real first message. |
| `prefab-anchored-standard` | Prefab Anchored Standard | Prefills a new session with a bundled anchored trajectory, ready for the first real prompt. |
| `eternal-minimal` | Eternal Minimal (experimental) | Keeps the visible catalog at the Minimal pair forever while the full toolset runs behind the `dshx` gateway. |
| `wire-think-standard` | Wire Think-Execute Standard (experimental) | Opens every turn with a think step whose sibling route forbids tool invocation, then opens the resident catalog. |
| `combo-anchored-standard` | Combo Anchored (experimental) | Think/execute split plus deliberation gate and deliberation drip as three independent rows. |

## How upstream 0.2.1-rc.2 carries a preset

A preset is no longer a directory under `$DSH_HOME/.agent-presets/`. It is a `@deepseek-ai/dsh-agent-preset` declaration row inside a bundle patch, and the Loader row id is `preset-<id>`:

```yaml
- insert:
    - id: preset-review
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: review
        name: Review
        order: 10
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: You review software changes.
```

`cordis.patch.yml` in this package is exactly that translation of the seven compositions, and `package.json` lists it under `dsh.bundle.patch`, so `dsh plugin --profile web add <this directory>` installs all seven presets.

## Layout

```
dsh-anchored-presets/
├── package.json               # dsh.bundle.patch + engines.dsh
├── cordis.patch.yml           # generated: seven preset-<id> declaration rows
├── presets/<id>/
│   ├── agent.cordis.yml       # the authored composition (single source of truth)
│   └── preset.yml             # display name, description, roster order
├── helpers/*.mjs              # the helper plugin rows every preset mounts
├── scripts/build-patch.mjs    # emits cordis.patch.yml from presets/
└── test/                      # helper behaviour, patch structure, mount
```

Edit a composition under `presets/<id>/`, then run `node scripts/build-patch.mjs`; `cordis.patch.yml` is generated and a test fails when it drifts.

## Why the helpers are package subpaths

A preset's plugin rows resolve relative names against the **boot configuration directory** (the profile), not the bundle that declared the preset: `mountPreset` mounts with the declaring context's `baseUrl`, and the Loader resolves `./x.mjs` as `new URL(name, baseUrl)`. A helper file shipped beside `cordis.patch.yml` is therefore unreachable from an installed bundle, while a bare package specifier resolves through the profile's runtime resolution.

So the helpers ship as `@muwinds/dsh-anchored-presets/helpers/<file>.mjs` and every row names them that way. `test/mount.test.mjs` records the difference: the same row mounts beside the boot base and fails beside the bundle.

## Conversions applied when emitting the patch

- `name: ./<helper>.mjs` → `name: '@muwinds/dsh-anchored-presets/helpers/<helper>.mjs'`.
- `persona` rows: `text` → `prefix`.
- `@deepseek-ai/dsh-workflow-worker-thread` → `@deepseek-ai/dsh-workflow-ptc`.
- `tool-subagent` rows drop `backgroundMode` and `enableRunInBackground` (0.2.1 replaced per-child background and persona configuration with Agent Preset composition).

## Install

```sh
pnpm run community:install -- --dsh-home /path/to/.dsh   # both bundles
dsh plugin --profile web add ./community/bundles/anchored-presets   # this bundle only
```

Restart Harness afterwards; the presets appear in the preset roster. `--update` on the suite installer removes a bundle before adding it again.

## Tests

```sh
npm test
```

Runs `node --test` over `test/`. The mount and patch suites import Harness sources, so the command sets `TSX_TSCONFIG_PATH` to the repository's `tsconfig.base.json`; from an installed package (no checkout) those two suites report the missing checkout instead of passing silently.

## Compatibility

- Target Harness version: `0.2.1-rc.2`, declared as `engines.dsh` (`>=0.2.1-rc.2 <0.3.0`).
- Known gap: `think-phase.mjs` and `wire-think.mjs` read the durable `steering/message` session event, which 0.2.1 no longer emits (steering is an inbox placement now). The two presets mount and run; their steered-turn detection never fires.

## License

MIT — see `LICENSE` and `NOTICE`.
