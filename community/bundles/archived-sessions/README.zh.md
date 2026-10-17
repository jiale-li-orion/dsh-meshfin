# dsh-archived-sessions

[English](README.md) | 中文

归档会话管理（Archived sessions manager）—— DeepSeek Harness Web 界面的设置页扩展，以单 bundle 包分发，一条命令即可安装。

在 Harness 的「设置 → 归档会话」页面中提供：

- 列出所有已归档会话（标题、工作目录、最近更新时间），数据来自 Workspace Remote 的归档集合与客户端会话目录。
- 释放会话（恢复到原工作区）：单个、批量或一键全部释放，走 workspace Remote 的 `unarchiveSession`。
- 点击会话标题预览最近 100 条用户/助手/工具消息。内容由宿主端有界读取会话日志尾部，浏览器侧不会接触会话文件路径。

有意不提供：应用内删除、单会话磁盘路径、文件缺失标记。`SessionPersistence` 已不再提供 `locate`、`inspect`、`remove`，没有任何受支持的 API 能推导出会话的落盘目录；删除已存储会话仍由 Harness 安装本身负责。

## 安装（推荐：套件安装器）

在套件根目录同时安装归档会话 bundle 与 anchored-presets bundle：

```sh
pnpm run community:install -- --dsh-home /path/to/.dsh
```

安装器通过 `dsh plugin --profile web add <dir>` 把两个 bundle 加入 `web` profile；`--update` 先移除再添加，因为运行中的 HMR 会话拒绝覆盖已安装的包。安装后重启 Harness，「归档会话」页面会出现在设置面板中（带归档图标）。

> 该包是纯 JS，没有 `prepare` 构建脚本，**不需要** pnpm `allowBuilds` 许可。

### 低层本地安装（仅开发）

```sh
dsh plugin --profile web add ./community/bundles/archived-sessions
```

仅在开发该 bundle 时从套件根目录执行。

## 目录结构

```
dsh-archived-sessions/
├── package.json          # dsh.bundle + dsh.client declarations (one package, two ends)
├── cordis.patch.yml      # inserts one archived-sessions row (Host + browser)
├── lib/
│   ├── index.js          # Host plugin: the /dsh-archived prefix route
│   └── client.js         # browser plugin: settings-page UI (__ModuleLoader__ bundle)
├── test/
│   ├── host.test.mjs             # archive-set guard, bounded tail, route wiring
│   ├── host-integration.test.mjs # real SessionPersistence service + real web server
│   └── client.test.mjs           # slot registration, row source, page render
├── README.md
└── LICENSE               # MIT
```

用 `npm test` 运行本包测试（纯 `node --test`；集成测试通过仓库的 `tsconfig.base.json` 加载工作区源码）。

宿主 API（`POST /dsh-archived/inspect`，同源；仅对 Workspace 注册表归档集合中的 id 作答）：

| 路由 | 请求体 | 响应 |
| --- | --- | --- |
| `/dsh-archived/inspect` | `{ sessionId }` | `{ id, createdAt, cwd, parentSession, eventCount, sizeBytes, windowStart, messageCount, truncated, messages }` |

## 兼容性

- 目标 Harness 版本：`0.2.1-rc.2`，通过 `engines.dsh`（`>=0.2.1-rc.2 <0.3.0`）声明。自 v0.2.1-alpha.3 起，包自带的 `engines.dsh` 范围单独决定插件兼容性。
- 浏览器端占用设置槽位 id `archived-sessions`，`@deepseek-ai/dsh-client-ui-settings-general` 已为其绘制归档图标。
- 宿主端插件无第三方运行时依赖（纯 ESM，不 import 任何 `@deepseek-ai/*`，需要的能力全部从 `ctx` 获取）；浏览器端仅依赖 `react`（由 Harness 前端运行时提供，属于 platform seed）。

## License

MIT
