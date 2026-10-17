# dsh-anchored-presets

[English](README.md) | 中文

DeepSeek Harness 的七个 anchored 智能体预设，以单个 bundle 包分发：`@deepseek-ai/dsh-agent-preset` 声明行 + 它们挂载的助手插件行。

| 预设 id | 名册名称 | 作用 |
| --- | --- | --- |
| `anchored-standard` | Anchored Standard (experimental) | 以 Minimal 工具对（`bash` + `str_replace_editor`）起步且不注入上下文，首次持久工具调用或回复后展开常驻目录。 |
| `zero-anchored-standard` | Zero-Anchored Standard (experimental) | 注入一次零工具锚定轮，从下一轮起展开完整 Standard 目录。 |
| `whoami-standard` | Whoami Standard (experimental) | 在空工具面上先播一次固定自我介绍轮，再放行真正的首条消息。 |
| `prefab-anchored-standard` | Prefab Anchored Standard | 新会话自动预填随包的 anchored 轨迹，等待首个真实任务提示。 |
| `eternal-minimal` | Eternal Minimal (experimental) | 可见目录永远是 Minimal 工具对，完整工具集在 `dshx` 网关后真实运行。 |
| `wire-think-standard` | Wire Think-Execute Standard (experimental) | 每轮先开一个 think 步骤，其兄弟路由禁止调用工具（`tool_choice=none`），随后展开常驻目录。 |
| `combo-anchored-standard` | Combo Anchored (experimental) | think/execute 拆分 + deliberation gate + deliberation drip，三条互相独立、可单独调参的行。 |

## 上游 0.2.1-rc.2 如何承载预设

预设不再是 `$DSH_HOME/.agent-presets/` 下的目录，而是 bundle patch 里的 `@deepseek-ai/dsh-agent-preset` 声明行，Loader 行 id 约定为 `preset-<id>`：

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

本包的 `cordis.patch.yml` 正是这七个组合的翻译，`package.json` 在 `dsh.bundle.patch` 中列出它，因此 `dsh plugin --profile web add <本目录>` 就装入了全部七个预设。

## 目录结构

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

改动某个组合请编辑 `presets/<id>/`，再运行 `node scripts/build-patch.mjs`；`cordis.patch.yml` 是生成物，漂移会让测试失败。

## 助手为什么走包内子路径

预设的插件行解析相对名时，基准是**启动配置目录**（profile），而不是声明预设的那个 bundle：`mountPreset` 用声明上下文的 `baseUrl` 挂载，Loader 按 `new URL(name, baseUrl)` 解析 `./x.mjs`。因此与 `cordis.patch.yml` 并列的助手文件从已安装的 bundle 里无法被访问，而裸包名会由 profile 的运行时解析表解析。

所以助手以 `@muwinds/dsh-anchored-presets/helpers/<file>.mjs` 分发，每一行都这样写。`test/mount.test.mjs` 记录了这个差异：同一条相对行在启动基准旁能挂载，在 bundle 旁则失败。

## 生成 patch 时应用的转换

- `name: ./<helper>.mjs` → `name: '@muwinds/dsh-anchored-presets/helpers/<helper>.mjs'`。
- `persona` 行：`text` → `prefix`。
- `@deepseek-ai/dsh-workflow-worker-thread` → `@deepseek-ai/dsh-workflow-ptc`。
- `tool-subagent` 行去掉 `backgroundMode` 与 `enableRunInBackground`（0.2.1 用 Agent Preset 组合取代了按子代理的 persona 与后台配置）。

## 安装

```sh
pnpm run community:install -- --dsh-home /path/to/.dsh   # both bundles
dsh plugin --profile web add ./community/bundles/anchored-presets   # this bundle only
```

安装后重启 Harness，预设出现在预设名册中。套件安装器的 `--update` 会先移除再添加。

## 测试

```sh
npm test
```

对 `test/` 运行 `node --test`。挂载与 patch 套件需要 import Harness 源码，因此命令把 `TSX_TSCONFIG_PATH` 指向仓库的 `tsconfig.base.json`；在已安装的包（没有 checkout）里，这两个套件会报告缺少 checkout，而不是静默通过。

## 兼容性

- 目标 Harness 版本：`0.2.1-rc.2`，通过 `engines.dsh`（`>=0.2.1-rc.2 <0.3.0`）声明。
- 已知缺口：`think-phase.mjs` 与 `wire-think.mjs` 读取持久事件 `steering/message`，而 0.2.1 不再发出该事件（steering 现在是收件箱排位）。这两个预设能挂载并运行，但「被 steer 的轮次」检测永远不会触发。

## License

MIT —— 见 `LICENSE` 与 `NOTICE`。
