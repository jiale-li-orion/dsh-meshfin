# Agent Note: 本部署改用 GitHub 托管 runner 的 CI

Status: implemented

[English](2026-09-19-hosted-runner-ci.md) | 中文

## Problem

本仓库是 harness 的公开部署，而不是上游开发树，而它的工作流是按上游组织写的。`ci.yml` 在 `master` 上触发，而这里的默认分支是 `main`，所以它一次都没跑过。每个企业作业选择的都是组织级 larger runner，或 `[self-hosted, linux, x64, vm-backup]` 自托管池，这些在本仓库都不存在——即便触发修好，也只会永远排队。夜间的真 API 泳道在 `DEEPSEEK_API_KEY_EXTERNAL` 为空时按设计硬失败，而仓库里从来没有配置过任何 secret。

可见结果就是：定时任务每晚固定一片红，而 CI 工作流从未产生过信号。

## Decision

所有泳道都跑在 GitHub 托管 runner 上。分支触发同时接受 `main` 与 `master`，企业作业在 push 与 pull request 上都会运行，worker 数量按托管的 4 核 runner 设定；原先的自有池机制——`DSH_CI_FAILOVER_*` 选择器、自托管备用演习、larger runner 基准矩阵——全部移除。`scripts/ci-workflow.spec.ts` 把这一集合钉住，其中还包括一项扫描：任何作业若选择了自托管或自定义池都会被拒绝。

E2E 工作流改为无 key 运行：定时与手动泳道通过 `pnpm run test:snapshot` 回放录制好的会话记录，真 API 套件只有在配置了 `DEEPSEEK_API_KEY_EXTERNAL` 时才运行。凡是需要本部署并不持有的凭据的泳道——`DEEPSEEK_API_KEY_EXTERNAL`、`AZURE_OPENAI_API_KEY_EXTERNAL` 与 `ANTHROPIC_API_KEY_EXTERNAL`、`E2B_API_KEY_EXTERNAL`、issue 应用的凭据对、`NPM_TOKEN`——都先在步骤里探测，缺失时打印 notice 并跳过，因为 GitHub 不允许在作业级 `if:` 里使用 `secrets`。issue 生命周期泳道还改为把 app token 指向当前仓库，而不是上游组织。

## Alternatives considered

**保留"只在 pull request 上运行"的门控，改为用 pull request 往 `main` 合并。** 这是上游保持推送廉价的做法，也能让工作流原样不动。之所以否决，是因为本部署的落地方式就是直接推 `main`：在 PR-only 门控下，完整套件依然不会在真正发布的那些提交上运行。

**用 mock 出来的 API provider 取代无 key 回放。** 专门写一个 mock 确实能让真 API 套件在没有 key 的情况下运行。之所以否决，是因为快照框架已经在真实组装的应用上回放录制好的模型与 API 交互，再加一套 mock 只会多出一个并行机制，而不会多出任何信号。

## Consequences

`ci.yml` 现在会在直接 push 到 `main` 时给出真实结论，而这正是本部署落地改动的方式；此前只在 pull request 上运行的门控让这条路径一直没有被验证。无 key 回放无法发现线上 API 的漂移，因此真 API 泳道是保持可用而未被启用，而不是被替换掉；日后配置 secret 不需要改动工作流。

有三项门禁输入只存在于"非干净检出"的环境中，现在都改成了显式写法。`scripts/prepare-ci-bubblewrap.sh` 改用 `apt-get download` 取包，因为一旦 Ubuntu 撤下某个修订版，钉死的 `archive.ubuntu.com` 文件名就会返回 404。静态作业在 push 事件下把推送前的提交作为归档基线，因为此时 pull request 的基线字段是空的。`zod` 被列入 `knip.json` 的 `ignoreDependencies`，因为生成出来的 `lib/typert.*` 产物会 import 它，而 `src/` 从不引用，于是没有构建产物的检出会把它当成未使用。`docs/module-graph.md` 由工作区生成，因此只要改了包而没有重新生成，模块图门禁就会失败。

此次移除的自有池故障切换机制记录在[已归档的故障切换手册](../../archived/process/2026-07-26-ci-failover-runbook.md)中。仍然适用的理由依据是[larger 托管运行器决策](2026-07-22-evidence-based-larger-hosted-runners.md)里的证据标准，以及[串行参考决策](2026-07-21-serial-cross-platform-ci-reference.md)里的跨平台参考形态；无 key 与真 API 的分工仍归[真 API e2e 决策](../testing/2026-06-19-real-api-e2e-ci.md)管辖。

## Verification

`npx vitest run scripts/ci-workflow.spec.ts` 13/13 通过，其中包含新增的检查：没有任何作业选择自托管或自定义池、无 key 泳道运行 `pnpm run test:snapshot`、两条依赖凭据的泳道都把步骤门控在探测输出上。所有工作流文件均能按 YAML 解析，`pnpm run verify-archived-agent-notes` 也接受封印后的故障切换三件套。
