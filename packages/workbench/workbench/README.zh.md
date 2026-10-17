# @deepseek-ai/dsh-workbench

[English](README.md) | 中文

共享工作台状态服务。唯一的值——工作台栏是否打开、选中了哪个面板——是两个平面共同的唯一权威：浏览器手势以 Remote 调用到达，`dsh-tool-workbench` 的工具写入同一个值，每次提交都发出 `workbench/changed`，因此选中该事件的客户端收到每一份已提交视图，而不必自行推导。Remote 命名空间 `workbench` 暴露 `state`、`open`、`close`、`select` 与 `toggle`；视图不携带会话身份，因此每次调用只触及内置的 `global` 资源。该包还导出工作区围栏 `fenceSessionPath`、扩展名到媒体类型的映射 `contentTypeForPath`，以及 `/api/workbench/file` 与 `/api/workbench/upload` 两条路由路径，使这里的 Remote 命名空间与 `dsh-workbench-bytes` 提供的路由读同一套词表。Typert 生成阶段从这些带装饰器的方法产出 `lib/typert.host.js` 与 `lib/typert.remote-client.js`。

## 模型体验

无，因为该包持有浏览器查看状态与字节路由共用的围栏；面向模型的投影位于 `dsh-tool-workbench`。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **视图是进程全局的**：每个已连接的浏览器与 agent 看到同一份打开/选中状态；按客户端隔离的视图暂缓到有消费方需要时。
- **围栏是会话记录的工作目录**：没有它的会话无法寻址文件，因此在该会话成为当前会话前字节路由没有可提供的内容。
- **媒体类型按扩展名判断**：内容与扩展名不符的文件按名字定型；这正是浏览器需要的 `Content-Type` 与查看器路由依据。
