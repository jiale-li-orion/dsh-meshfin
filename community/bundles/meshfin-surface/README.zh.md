# @muwinds/dsh-meshfin-surface

[English](README.md) | 中文

本发行自有能力包。选中它会给一个原版 DeepSeek Harness profile 增加三样东西：与 Chat 并列的 Context 视图（展示下一次模型请求由哪些单元构成、允许对一个可编辑单元做持久改写、并在提交前审阅已准备的压缩）；驱动同一批操作的模型侧工具；以及浏览器与智能体共同改写、预览经认证 Range 路由读取工作区文件的工作台视图。

## 使用本包

装进一个 profile 后重启：

```sh
dsh plugin --profile web add ./community/bundles/meshfin-surface
```

本包插入七行：`session-context` 与 `tool-session-context` 搭配 `ui-context` 视图；`workbench`、`workbench-bytes` 与 `tool-workbench` 搭配 `ui-workbench` 标签页。每一行都可以在 profile patch 里按 id 覆盖或禁用，包本身不装任何别的东西。

## 各表面的含义

- **Context 视图。** 人能看到一次请求由哪些单元构成，并对一个可编辑单元做改写；改写是持久的，下一次请求就用它。模型获得 `context_inspect`、`context_read`、`context_prepare`、`context_edit_preparation`、`context_commit`、`context_discard_preparation`、`history_read`、`history_search`，它们检查同一批单元、准备并提交审阅过的压缩、以及在需要时召回检查点遮蔽的原文。
- **工作台视图。** 一个提交值——是否打开与选中的面板——住在宿主上。浏览器手势与智能体的 `workbench_open` 调用移动同一个值，每次提交都发出 `workbench/changed`，两侧因此收敛。预览经 `/api/workbench/file` 流式读取工作区文件，该路由由 connection 载体认证，并被限定在会话工作区内。

## 已知限制与延期工作

- 工作台只渲染一个文件预览与其面板列表；文件树、上传、主题与市场面板仍归官方侧栏与设置面。
- 被改写的单元报告为 `user` 角色：官方没有用于合成改写的 catch-all 消息来源种类，身份改由持久的 `context/rewrite` 记录承载。
- 召回读取每次调用对会话日志做一次快照重放，尚无存储侧异步读取器。

## 开发备注

无。
