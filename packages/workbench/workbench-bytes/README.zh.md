# @deepseek-ai/dsh-workbench-bytes

[English](README.md) | 中文

工作台的字节路由：一条 `webServer` 前缀（`/workbench/file`）把工作区文件流式送给浏览器里的文件面板查看器。请求带会话 id 与路径；路由先过浏览器信任栅栏（`connection.isTrustedRequest`，即部署的 `trustedHosts` 策略），再过工作区栅栏（`dsh-workbench` 的 `fenceSessionPath`，与面板列目录用的是同一个），然后从解析出的目标的进程路径用 `createReadStream` 流式输出。`Range` 请求返回 `206` 加 `content-range`，不可满足的范围返回 `416`，`HEAD` 只回头部不带正文——所以视频可以拖动进度、大图可以边下边看，而不需要把整个文件读进内存。

## 上传与接入记录

`POST /workbench/upload` 接收文件正文，以及查询参数 `sessionId`、`name`、可选的 `device` 和 `ingestId`。请求经过同一浏览器信任检查与工作区围栏，文件落入 `uploads/<device>/`；未声明来源时使用 `unknown`。`maxUploadBytes` 控制大小上限，默认 64 MiB。上传返回路径和字节数，不创建用户消息。

带 `ingestId` 的成功上传在 `uploads/.dsh/ingest.json` 记录路径、字节数、SHA-256、来源类别、媒体类型和接收时间。已完成请求的重试返回原记录，附 `repeat: true`，不读取重试正文；**同一 id 尚在写入时到达的重试会等待那次尝试，并按它的结果作答**，不会把同一份字节存两次。ID 作为数据键处理，包括 `constructor` 与 `__proto__`。记录在索引的写入锁下提交、索引本身原子替换，因此同时被接收的两个上传两条记录都会保留，读者也看不到半截文件。字段校验不过、或路径不是本桶内的纯文件名的记录会被忽略，其它有效记录保留。同名上传各自占用不同文件：路径由**独占创建**取得，而不是先查是否空闲，所以并发的上传不会交错写进同一个文件。

## Model Experience

无：本包只服务浏览器字节；面向模型的工作台投影在 `dsh-tool-workbench`。

#### KV Cache effect

无；本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **一次请求只支持一个范围** — 多范围请求头会被忽略并返回整个表示；查看器只发单范围，而 multipart/byteranges 响应要额外写一个边界编码器，目前没有消费者。
- **接入恢复** — 上传的文件与它的索引记录不是一次事务：在两者之间崩溃会留下一个没有任何记录指名的文件，而同一份选择的下一次尝试会再写一份，而不是认领它。记录不会回头验证文件是否被移动或修改，记录的媒体类型来自文件名而不是内容嗅探，过期清理尚未实现。
- **栅栏就是会话记录的工作目录** — 没有记录工作目录的会话无法被服务，目录之外的路径以 `403` 拒绝。
