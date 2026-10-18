# Meshfin 启动块

[English](README.md) | 中文

把“某处有个服务器”变成一次双击的那层管线：Windows 快捷方式与桌面磁贴、WSL 侧持有服务器生命周期的脚本，以及 Linux 桌面条目。它们都启动 `dsh web`，并把该进程打印的已认证 URL 交给浏览器。它们都不是桌面应用：便携包把这个目录作为 `launch/` 携带，`apps/desktop/` 下的 Electron 包不属于该包。

## 启动器打开的 URL

harness 为每个浏览器进程单独认证，并在 `dsh web: <url>` 这一行打印携带该令牌的 URL。不带令牌直接请求源地址会被拒绝。由此两条结论决定了这些脚本的做法：

- 这里没有任何脚本先探测端口、等到端口通了再打开 `http://127.0.0.1:<port>/`：端口开始应答之后，那个 URL 仍然会被拒绝；
- WSL 脚本以 `dsh web --no-open` 运行，只把手交接那个进程自己打印的 URL；Windows 启动器则把开浏览器这件事留给 harness，由持有该认证 URL 的进程自己打开。

两条路径都不重置 profile。`dsh --from-default-profile <name>` 会用随包模板的副本替换既有 profile，用它启动会把该 profile 里已安装的插件全部删掉。

## Windows

先运行一次 `launch\windows\setup.cmd`。它在桌面创建 **Meshfin Web** 快捷方式，使用本发行版的图标，指向启动器。加 `--tile` 还会构建并启动桌面磁贴。

| 文件 | 作用 |
| --- | --- |
| `windows/setup.cmd` | 创建桌面快捷方式；加 `--tile` 时还构建并启动磁贴。 |
| `windows/start-meshfin.cmd` | 运行包根的 `meshfin.ps1 web`。可选端口；`MESHFIN_NO_BROWSER=1` 会传 `--no-open`。 |
| `windows/meshfin.ico` | 快捷方式与磁贴的图标。 |
| `windows/tile/` | 桌面磁贴：`MeshfinTile.cs`、`build-tile.cmd`、`start-tile.cmd`、`stop-tile.cmd`、`meshfin-tile.ini.example` 和 `skins/`。 |

`setup.cmd` 与 `start-meshfin.cmd` 位于 `<archive>\launch\windows\`，在包根之下两层，因此两者都用 `%~dp0..\..` 求出包根，并从那里读取 `meshfin.ps1`。

### 生命周期

一个控制台窗口就是服务器的生命周期，这才使“关掉浏览器还能继续用”成立：

- 关闭浏览器窗口，服务器继续运行；
- 关闭控制台窗口，服务器停止；
- 在控制台按 `Ctrl+C`，服务器停止。

## WSL 与 Linux

`launch/wsl/meshfin-web.sh` 是 WSL 或 Linux 桌面上持有生命周期的脚本。它按以下顺序解析 harness：`MESHFIN_CMD`，然后是上两级的 `meshfin` 启动器，最后是 `PATH` 上的 `dsh`。它使用解析出的端口（`DSH_WEB_PORT`，默认 3080），读取那行已认证 URL，并依次尝试用 `cmd.exe`、`wslview`、`xdg-open` 打开。设 `MESHFIN_OPEN=official` 可跳过交接，改由 harness 自己开浏览器——在 WSLg 或 Linux 侧就有浏览器的桌面上，这是正确的选择。

```sh
./launch/wsl/meshfin-web.sh            # serve on 3080
DSH_WEB_PORT=8080 ./launch/wsl/meshfin-web.sh
MESHFIN_OPEN=official ./launch/wsl/meshfin-web.sh
```

`launch/linux/install-desktop-entry.sh` 在 applications 目录写入 `meshfin-web.desktop`，使启动器出现在桌面的应用菜单里。它生成绝对路径，所以要在解包之后运行，而不是随包提供一个写死的文件。

## 桌面磁贴

`windows/tile/MeshfinTile.cs` 是一个 Win32 分层窗口，行为像壁纸的一部分：逐像素透明、不占任务栏按钮、不抢焦点，点击时通过上一级的 `start-meshfin.cmd` 启动 harness。它由 `build-tile.cmd` 用每台 Windows 都有的 `csc.exe` 从源码编译，不需要 SDK，也不需要包管理器。位置、尺寸和皮肤记在可执行文件旁的 `meshfin-tile.ini`。

`skins/` 带四张默认皮肤，由原图缩小而来，以免仓库变重。右键磁贴可改皮肤、尺寸和位置，选择记在 `meshfin-tile.ini`。

磁贴还能画 DeepSeek 余额小条，这需要在 `meshfin-tile.ini` 里用 `balancescript=` 指定一个抓取脚本。没有配置脚本时，磁贴启动后不画小条，也不运行抓取线程——余额属于个人部署细节，不是本项目的组成部分。
