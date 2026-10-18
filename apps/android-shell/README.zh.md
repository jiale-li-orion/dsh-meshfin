# DSH Android 薄壳

[English](README.md) | 中文

[Meshfin](../../README.zh.md) 的可选手机端 App。手机可以用普通浏览器标签页打开 Web UI；这个 App 只为**手机自带浏览器无法被配置成**的那一层浏览器能力而存在。

它是一个没有自己界面的 WebView 应用：显示的一切都是 host 的 Web UI。

## 它做什么

- **本地资源** —— host 以带 `rev` 查询参数的 URL 提供的插件 bundle、脚本与图片会缓存在设备上。那个 `rev` 由构建元数据推导而来，响应同时被标记为不可变，因此一个 URL 对应一段确定的字节，重新构建过的 bundle 会换成一个新的地址；缓存用完整 URL 作键，从不去重算 `rev`，它不是响应体的摘要。每条缓存都记下自己存下那串字节的摘要，于是只写了一半的响应会被重新拉取，而不是被当成完整的继续用。
- **launcher 图标** —— App 在桌面上有自己的身份。手机自带浏览器的"添加到桌面"只是网页快捷方式，不是一回事。
- **前台服务** —— App 切到后台时，会话流不会被回收。
- **回环代理** —— App 加载一个回环源，并以 host 自己的名字经 TLS 转发出去，于是 host 证书保持有效、手机自带的 DNS 解析层完全不被使用。回环源同时是安全上下文，因此剪贴板与 `crypto.randomUUID()` 都能用。

## 它不做什么

不承载 LLM 密钥、不复制会话存储、不改 Agent Loop。它**不实现任何设备能力**：agent 无法通过它访问这台手机的摄像头、文件或位置。设备能力协议是另一件事，目前还不存在。

## 下载

```text
https://github.com/jiale-li-orion/dsh-meshfin/releases/download/android-shell/dsh-shell.apk
```

在手机上下载并打开即可，App 不申请任何权限。该地址的文件会在本 App 更新时**原地替换**，所以这个链接始终指向当前构建。

### 由你自己的 host 分发

如果部署本身已经让手机经私有网络访问到 host，那 APK 也可以直接由 host 分发，省掉手机上跑一趟 GitHub。本仓库的部署就是从 Web host 的静态根提供它，因此发布一次重建只需一次拷贝：

```sh
cp apps/android-shell/app/build/outputs/apk/debug/app-debug.apk apps/web/dist/dsh-shell.apk
```

两份副本都被 git 忽略：APK 是构建产物，不是仓库内容。

## 构建

需要 Gradle 9.1.0 与带 platform 35 的 Android SDK。本项目**不含** Gradle wrapper，因此用的就是你 `PATH` 上的 `gradle`。

它指向的 host 是**编进包里**的，位于 [`MainActivity.java`](app/src/main/java/com/dsh/shell/MainActivity.java) 的 `UPSTREAM_HOST`、`UPSTREAM_ADDRESS`、`UPSTREAM_PORT` 三个常量。为别的 host 构建前先改这三处。

```sh
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android}"   # any SDK holding platform 35
export GRADLE_USER_HOME="$PWD/.gradle-home"            # keep the build cache off $HOME
gradle -p apps/android-shell assembleDebug
```

APK 产出在 `apps/android-shell/app/build/outputs/apk/debug/app-debug.apk`。它**故意**是 debug 签名：薄壳不提供 release keystore，因此安装它不需要任何人去信任一把自己无法核验的签名密钥。

## 文件

| 文件 | 内容 |
| --- | --- |
| `MainActivity.java` | WebView、与浏览器对齐的设置（缩放、文字缩放、文件选择器、下载），以及它服务的 host 地址。 |
| `LoopbackProxy.java` | 回环网关：进是明文 HTTP，出是 TLS，并用 host 自己的名字做 SNI 与证书校验。 |
| `GatewayCache.java` | 磁盘缓存：以带修订的 URL 为键，每条都用写入时记下的摘要校验。 |
