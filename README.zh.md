# Meshfin

[English](README.md) | 中文

**一个 agent，横跨多台设备。** Meshfin 是面向常驻 agent 的多设备能力运行时与个人工作台。

Meshfin 是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的社区维护发行版。本仓库以官方 `dsh-v0.1.0-rc.7` 为基础，将会话上下文增强、归档会话 Web bundle、7 个锚定 agent 预设和一套移动端个人工作台整理在同一个仓库中。

DeepSeek Harness（`dsh`）采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

本仓库不是 DeepSeek AI 官方发行版。上游的精确版本、许可证与适配补丁记录在[社区源码记录](COMMUNITY_SOURCES.md)中。

## 本仓库包含什么

两半，分别安装、分别更新：

| 半边 | 是什么 | 在哪 |
| --- | --- | --- |
| **本地 DSH** | 跑在你自己电脑上的 harness：Web UI、社区模块、共享工作台，以及同一个会话的移动端呈现。这是你要运行的那一半。 | [`packages/`](packages/README.md)、[`community/`](community/)、[`apps/cli`](apps/cli/README.md)、[`apps/web`](apps/web) |
| **Android App** | 可选的手机薄壳。它只承载**手机自带浏览器无法被配置成**的那一层浏览器能力，是 host Web UI 的查看端，而不是第二个客户端。 | [`apps/android-shell/`](apps/android-shell/README.md) |

本地那一半**不需要 App** 也能从手机浏览器使用；App 之所以存在，是因为本部署里这台手机的自带浏览器无法按 Web UI 需要的方式配置。

## 功能特色

- **一个会话，跨设备延续。** 同一个对话在电脑和手机上继续；手机操作的是**同一个会话**，模型也会被告知每条提示来自哪一类客户端。
- **手机能把东西交出去。** 手机上选中的文件经受围栏保护的 host 路由进入会话工作区，出现在按发送方分组的「上传」面板里，并能在工作台中就地预览。同一次选择重试时返回第一次的结果，不会存成两份。
- **两边共用的工作台。** 面板与文件查看器经声明的槽位注册，浏览器与 agent 修改**同一份** host 持有的视图，一条受围栏保护的字节路由以 `Range`／`206`／`416` 流式提供工作区文件 —— 视频能拖进度，长 PDF 能预览。
- **手机是一等的窄屏客户端**，而不是第二个产品：一条顶栏下三页、同一时刻只显示一页，为小屏准备界面缩放，流连接代际死亡时明确显示"连接中断"。
- **可选的 Android 薄壳**只承载手机自带浏览器给不了的那一层：本地资源缓存、launcher 身份、前台服务、回环代理 —— 不装 API 密钥、不复制会话存储、不改 Agent Loop。
- **会自己控节奏的 agent 预设。** 七个锚定组合：受控的首轮工具面、上下文门控、wire-think 路由、压缩感知的阶段提升。
- **长会话依然划算**：有界日志读取、上下文检查与区间压缩、历史召回、按模型容量规划摘要。
- **归档会话管理**，以及一个**插件目录**（搜索与安装共用同一份经校验的安装能力）。

导入的社区模块与其精确来源，审计在[社区优化](docs/community-optimizations.md)（[中文](docs/community-optimizations.zh.md)）；上游修订与许可证记录在[社区源码记录](COMMUNITY_SOURCES.md)。

## 使用说明

### 你需要什么

| | |
| --- | --- |
| 电脑 | Windows + PowerShell，或 WSL／Linux |
| 手机（可选） | Android；**只用浏览器也可以** —— [App](apps/android-shell/README.md) 只是补上浏览器无法被配置成的那一层 |
| API 密钥 | 一个 DeepSeek API key |
| 网络 | 把两者连起来的同一张私有网络；本部署用 [Tailscale](https://tailscale.com/) |

### 1. 电脑

下载即用 —— 不需要构建：

**WSL / Linux x64**

```sh
curl -L -o meshfin.tar.gz https://github.com/jiale-li-orion/dsh-meshfin/releases/download/pc-wsl/meshfin-linux-x64.tar.gz
tar xzf meshfin.tar.gz
cd meshfin-linux-x64
./meshfin web
```

**Windows x64（PowerShell）** —— 先下载并解压 [meshfin-windows-x64.zip](https://github.com/jiale-li-orion/dsh-meshfin/releases/download/pc-windows/meshfin-windows-x64.zip)，然后：

```powershell
cd meshfin-windows-x64
Set-ExecutionPolicy -Scope Process RemoteSigned
.\meshfin.ps1 web
```

两个包都自带 harness、依赖、一份 Node 运行时，以及**已装好**的社区模块 —— 所以 `DSH_HOME` 默认指向分发包自己的 `data/`，除非你自己设它，否则不会往解压目录之外写东西。WSL／Linux 那一版已经端到端冒烟实测；**Windows 那一版还没在 Windows 上跑过**，请把第一次启动当作验收。

**或者自己构建源码。** 安装 Node.js `^22.19.0` 或 `>=24.0.0`，安装 pnpm 11.22，克隆仓库、安装依赖、运行不使用真实 API 的社区检查，并构建 Harness：

```sh
npm install --global pnpm@11.22.0
git clone https://github.com/jiale-li-orion/dsh-meshfin.git
cd dsh-meshfin
pnpm install --frozen-lockfile
pnpm run community:check
pnpm run build
```

选择 DSH home，安装社区模块并启动 Web UI：

```sh
export DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
pnpm run community:install -- --dsh-home "$DSH_HOME"
pnpm dsh web
```

安装器只把归档会话 bundle 添加到 `web` profile，并在 `.agent-presets` 下安装以下 preset id：`anchored-standard`、`prefab-anchored-standard`、`combo-anchored-standard`、`eternal-minimal`、`whoami-standard`、`wire-think-standard` 与 `zero-anchored-standard`。安装器会拒绝覆盖不属于本套件的目标，在使用 `--update` 更新自有安装项前创建备份，并且不会访问会话目录。

Web UI 默认地址为 `http://127.0.0.1:3080`。使用 DSH 时请保持该终端运行。

### 2. API 密钥

给 harness 一个 DeepSeek API key：导出 `DEEPSEEK_API_KEY`、放进仓库根目录的 `.env`，或在 Web UI 的设置里填。没有密钥时 Web UI 仍能启动，只是无法发起模型轮次。

### 3. 手机

Web UI 绑定在 `127.0.0.1`，因此手机是**经私有网络**访问它，而不是经公网。[Tailscale](https://tailscale.com/) 就是本部署用的方式：把电脑和手机登进同一个 tailnet，然后在手机浏览器里打开电脑的 tailnet 地址。DSH 本身没有任何改动——tailnet 只是扩展了它的地址能被解析到的范围。

手机侧不需要 Google Play 账号：Tailscale 提供**官方直下**的 Android 安装包，地址是 <https://pkgs.tailscale.com/stable/#android>。

无论你用哪种私有网络，部署事实都一样：host 在一个固定的名字上应答，且只在该网络内部可达。我们自己的部署记录**不在本仓库里**，因为它指向一台具体的 host。

Android 薄壳 App 是可选的、独立的另一半；当手机浏览器不够用时，见 [App 自己的 README](apps/android-shell/README.md)。

在 Windows 上，从解压出来的目录跑一次 `desktop\windows\setup.cmd`，桌面就会出现 **Meshfin Web** 快捷方式（带图标、且会在端口就绪后才开浏览器）；加 `--tile` 还会编译桌面启动块。Linux／WSL 桌面则跑 `desktop/linux/install-desktop-entry.sh`，它会把入口写进应用菜单。启动套件的说明见[桌面启动套件 README](apps/desktop-launcher/README.md)。

### 后续启动与更新

使用同一个 DSH home 再次启动已经安装的 checkout：

```sh
cd dsh-meshfin
export DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
pnpm dsh web
```

拉取套件更新后，刷新依赖、重新构建，并且只更新属于本套件的安装项：

```sh
git pull --ff-only
pnpm install --frozen-lockfile
pnpm run community:check
pnpm run build
pnpm run community:install -- --dsh-home "$DSH_HOME" --update
```

profile 与界面说明详见 [Web UI 指南](docs/user/guide/index.md)（[中文](docs/user/guide/index.zh.md)）。

### 官方 npm 发行版

如需运行不包含本套件社区模块的官方 npm 发行版：

```sh
npx @deepseek-ai/dsh web
```

## 仓库布局

```text
community/
├── bundles/archived-sessions/
├── presets/anchored-standard/
├── patches/
└── install.mjs
packages/
apps/android-shell/
apps/cli/
apps/web/
docs/community-optimizations.md
COMMUNITY_SOURCES.md
```

## 社区与支持

- 本套件的整合问题请提交到当前仓库的 [issue tracker](https://github.com/jiale-li-orion/dsh-meshfin/issues)。
- Harness 上游问题请通过官方 [DeepSeek Harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)反馈。
- 为插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。开始开发前请阅读[开发指南](docs/development.md)（[中文](docs/development.zh.md)）、[架构文档](docs/architecture.md)（[中文](docs/architecture.zh.md)）与 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方源码版本与许可证记录在[社区源码记录](COMMUNITY_SOURCES.md)和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)中。每个导入的社区模块继续保留各自的许可证与声明。
