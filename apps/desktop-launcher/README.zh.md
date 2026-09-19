# Meshfin 桌面启动套件

[English](README.md) | 中文

把"某处有个服务"变成"双击一下"的那套管道：桌面快捷方式、**端口真的起来了才打开浏览器**的启动器、WSL 侧的寿命持有者，以及一个可选的桌面启动块。

两个便携包都会把这个目录作为它们的 `desktop/` 带在身上 —— 所以解压完就能直接建桌面入口，不用先 clone 任何东西。

## Windows

跑一次 `windows/setup.cmd`：它会在桌面创建 **Meshfin Web** 快捷方式（带本发行版的图标），指向启动器。加 `--tile` 还会编译并启动桌面启动块。

| 文件 | 作用 |
| --- | --- |
| `windows/setup.cmd` | 创建桌面快捷方式；`--tile` 额外编译并启动启动块。 |
| `windows/start-meshfin.cmd` | 启动 harness，并在端口开始接受连接后才打开浏览器。可传端口；`MESHFIN_NO_BROWSER=1` 则不打开浏览器。 |
| `windows/open-when-ready.ps1` | 轮询端口，通了才打开默认浏览器 —— 所以标签页永远不会落在死页面上。 |
| `windows/meshfin.ico` | 快捷方式与启动块的图标。 |
| `windows/tile/` | 桌面启动块：`MeshfinTile.cs`、`build-tile.cmd`、`start-tile.cmd`、`stop-tile.cmd`、`meshfin-tile.ini.example` 与 `skins/`。 |

### 寿命契约

**一个控制台窗口就是服务的寿命** —— 这正是"关掉浏览器还能继续干活"成立的原因：

- 关掉浏览器窗口 → 服务继续跑
- 关掉这个控制台窗口 → 服务停止
- 在这个窗口里按 `Ctrl+C` → 服务停止

## WSL 与 Linux

`wsl/meshfin-web.sh` 是 WSL／Linux 桌面上同一个寿命持有者。它按这个顺序解析 harness：`MESHFIN_CMD` → 上两级目录里的 `meshfin` 启动器 → `PATH` 上的 `dsh`。它会在自己解析出的端口上提供服务（`DSH_WEB_PORT`，默认 3080），并在该端口通了之后打开浏览器。

```sh
./desktop/wsl/meshfin-web.sh            # serve on 3080
DSH_WEB_PORT=8080 ./desktop/wsl/meshfin-web.sh
```

`linux/install-desktop-entry.sh` 会往应用目录写一个 `meshfin-web.desktop`，让启动器出现在桌面环境的应用菜单里。它生成的是**绝对路径** —— 这就是它要在解压之后运行、而不是直接随包发一个固定文件的原因。

## 桌面启动块

`windows/tile/MeshfinTile.cs` 是一个 Win32 分层窗口，行为上像壁纸的一部分：逐像素透明、没有任务栏按钮、不抢焦点，点一下就启动 harness。它由 `build-tile.cmd` 用**每台 Windows 自带的 `csc.exe`** 从源码编译 —— 不需要 SDK、不需要包管理器。

`skins/` 附带四张默认皮肤，是从原图降采样来的，让仓库保持轻量。右键启动块可以换皮肤／改尺寸／改位置，选择记在可执行文件旁的 `meshfin-tile.ini` 里。

启动块还能画一个 DeepSeek 余额小牌。那需要一个快照文件和一个抓取脚本，在 `meshfin-tile.ini` 里配置；没有它们时启动块就只画皮肤 —— 因为余额是**个人部署细节**，不属于这个项目。
