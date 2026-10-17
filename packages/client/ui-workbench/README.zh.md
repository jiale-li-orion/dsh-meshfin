---
description: "把宿主拥有的共享工作台视图呈现为右侧栏的一个标签页：控制行通过工作台 Remote 提交面板选择，媒体预览经工作台字节路由读取一个工作区文件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workbench

[English](README.md) | 中文

## 概述

`dsh-client-ui-workbench` 把共享工作台视图——一个由宿主持有的打开标志与一个选中面板 id——呈现为右侧栏中的单一标签类型。标签页正文显示已提交的值，提供提交新值的操作，并经需要认证的字节路由预览一个工作区文件。视图存在于宿主上，因此这里的按下与 agent 的工具调用收敛到同一份状态；只有“这个浏览器在预览哪个文件”留在本包内部。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发者备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

经 web-app manifest 加载本插件，然后在右侧栏的添加控件中打开 `workbench` 标签页。本插件不贡献其他位置：没有头部按钮、没有输入框控件，也没有自己的列。

### 共享视图

控制行为本包定义的每个面板各放一个按钮——目前只有一个 `preview`——并通过 `ctx.remote.workbench.select` 提交选择。另外两个控件分别提交 `open`（以已提交的面板重新打开）与 `close`；`toggle` 翻转打开标志。状态行读取已提交的值：要么 `open` 加选中面板的名称，要么 `closed`。

任何其他来源的提交——agent 的工具调用、另一个浏览器窗口、一次 Remote 调用——都以 `workbench/changed` 推送到达，并同时移动三处：控制行、状态行与标签标题。加载时的一次 `state()` 读取覆盖提交之后才连上的页面，因此刷新会恢复视图而不是显示默认值。

### 文件预览

控制行下方的路径输入接受一个工作区路径并预览它。正文为标签页所属会话与该路径构造 `api/workbench/file?sessionId=<id>&path=<path>`，先用 `HEAD` 请求问路由该文件的媒体类型，再按该类型渲染：图片、音频、视频或 PDF 元素指向同一个 URL（由浏览器自行流式读取该文件），文本则读取一次并显示在预格式化块中。`403`（路径在会话工作区之外）、`404`（那里没有普通文件）、其他拒绝，以及服务不可达，各自渲染自己的一行文案。

预览哪个文件是标签存储自己的字段：它跨标签切换保留，且从不发往宿主，因为这是关于这台浏览器的事实，而不是关于共享视图的事实。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部——点击展开</summary>

注册走任何标签类型都用的两段路径。`workbenchDefinition()` 把一个页面类型——没有 `patterns`、按 kind `workbench` 打开、`builtin` 档——注册进 `ctx.sidebarRightTabs`；正文注册进按 key 分派的 `sidebar.right.pane.tab` 位置，标题注册进 `sidebar.right.pane.tab.title`，两者都使用定义的 `id`。两段都在插件自己的 `ctx.effect` 内，因此卸载插件会一并移除类型、正文、标题与字典。

唯一的投影在 apply 时建立，而不是每个标签页建立：`workbench/changed` 订阅、初始 `state()` 读取与四个提交调用都在 `SharedWorkbenchView` 里，它把结果发布到一个快照存储，两个位置经注入的 `hooks` 隔间读取它。失败的读取或提交不改变任何状态，因此保留最后一份已提交的视图，而不是合成一份。

| 文件 | 作用 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 注册、字典与共享视图投影 |
| [`src/client/shared-view.ts`](src/client/shared-view.ts) | Remote 面与已提交视图的快照 |
| [`src/client/definition.ts`](src/client/definition.ts) | `workbench` 标签类型 |
| [`src/client/panels.ts`](src/client/panels.ts) | 面板名册与 id 到面板的读取 |
| [`src/client/store.ts`](src/client/store.ts) | 预览路径，按会话留在浏览器本地 |
| [`src/client/bytes.ts`](src/client/bytes.ts) | 字节路由 URL、媒体类型族与拒绝映射 |
| [`src/client/preview.ts`](src/client/preview.ts) | 一次路由读取，以及字节最终是什么 |
| [`src/client/WorkbenchBody.tsx`](src/client/WorkbenchBody.tsx) | 控制行、状态行与预览 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`dsh-workbench`](../../workbench/workbench/README.zh.md) —— 拥有该视图的宿主服务、它的 Remote 命名空间与路由常量。
- [`dsh-workbench-bytes`](../../workbench/workbench-bytes/README.zh.md) —— 提供单个工作区文件字节的认证路由。
- [`dsh-client-ui-sidebar-right`](../ui-sidebar-right/README.zh.md) —— 标签类型注册表、本包填充的两个位置与地址规则。
- [`dsh-client-ui-sidebar-files`](../ui-sidebar-files/README.zh.md) —— 产品自带的文件树，本包刻意不重复它。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只在浏览器中渲染宿主拥有的工作台状态与一个字节路由文件预览，不涉及任何提示词、消息、schema、流或工具结果。agent 对同一视图的控制仍由工作台的工具承担，它们提交到控制行所调的同一个服务。

#### KV 缓存影响

无；本包从不组装或发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义当前包的约束，不是任务清单。

- **字节路由路径是重述而非导入。** 浏览器 bundle 无法把宿主的 `protocol.ts` 作为值导入，因此 `WORKBENCH_FILE_ROUTE` 以浏览器相对形式重复它。宿主常量变更时必须同步这里。
- **被预览的文件靠手输，而不是选取。** 本包不添加文件树：一个列出文件的同侪面板可以把路径交给本包，在那之前由人输入。
- **控制行没有渲染测试。** 它的面经注入工厂覆盖；它绘制的元素仅由预览自己的组件 spec 覆盖。

<a id="dev-note"></a>
### 开发者备注

<details>
<summary>维护者工作上下文——点击展开</summary>

标签不带 `keepMounted`：预览中途卸载的正文会放弃这次读取，标签回来时路径输入从存储重新读取。

</details>
