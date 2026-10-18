# Meshfin launch block

English | [中文](README.zh.md)

The plumbing that turns "there is a server somewhere" into a double-click: a Windows shortcut and desktop tile, a WSL-side owner of the server's lifetime, and a Linux desktop entry. All of them start `dsh web` and hand its authenticated URL to the browser. None of them is a desktop application: a portable archive carries this directory as `launch/`, and the Electron packages under `apps/desktop/` are not part of that archive.

## The URL a launcher opens

The harness authenticates each browser process and prints the URL carrying that token on its `dsh web: <url>` line. A request to the bare origin without the token is refused. Two consequences decide what these scripts do:

- nothing here polls a port to decide "the server is ready" and then opens `http://127.0.0.1:<port>/` — that URL is refused even after the port answers;
- the WSL script runs `dsh web --no-open` and hands over exactly the URL the process printed, while the Windows launcher leaves the browser handoff to the harness, which opens the same authenticated URL from inside the process that owns it.

Neither path resets a profile. `dsh --from-default-profile <name>` replaces an existing profile with a copy of a shipped template, so a launcher that used it would delete every plugin installed into that profile.

## Windows

Run `launch\windows\setup.cmd` once. It creates a **Meshfin Web** shortcut on the desktop, with this distribution's icon, pointing at the launcher. Add `--tile` to also build and start the desktop tile.

| File | What it does |
| --- | --- |
| `windows/setup.cmd` | Creates the desktop shortcut; `--tile` also builds and starts the tile. |
| `windows/start-meshfin.cmd` | Runs the archive's `meshfin.ps1 web`. Takes an optional port; `MESHFIN_NO_BROWSER=1` passes `--no-open`. |
| `windows/meshfin.ico` | The shortcut and tile icon. |
| `windows/tile/` | The desktop tile: `MeshfinTile.cs`, `build-tile.cmd`, `start-tile.cmd`, `stop-tile.cmd`, `meshfin-tile.ini.example`, and `skins/`. |

`setup.cmd` and `start-meshfin.cmd` live in `<archive>\launch\windows\`, two levels below the archive root, so both resolve the root as `%~dp0..\..` and read `meshfin.ps1` from there.

### Lifetime

One console window is the server's lifetime, which is what makes "close the browser, keep working" true:

- closing the browser window leaves the server running;
- closing the console window stops it;
- `Ctrl+C` in the console stops it.

## WSL and Linux

`launch/wsl/meshfin-web.sh` is the lifetime owner for a WSL or Linux desktop. It resolves the harness in this order: `MESHFIN_CMD`, then the `meshfin` launcher two directories up, then a `dsh` on `PATH`. It serves the port it resolved (`DSH_WEB_PORT`, default 3080), reads the authenticated URL line, and hands that to `cmd.exe`, `wslview`, or `xdg-open`, in that order. Set `MESHFIN_OPEN=official` to skip the handoff and let the harness open the browser itself — the right choice under WSLg or a Linux desktop with a browser on the Linux side.

```sh
./launch/wsl/meshfin-web.sh            # serve on 3080
DSH_WEB_PORT=8080 ./launch/wsl/meshfin-web.sh
MESHFIN_OPEN=official ./launch/wsl/meshfin-web.sh
```

`launch/linux/install-desktop-entry.sh` writes a `meshfin-web.desktop` entry into the applications directory so the launcher appears in the desktop's application menu. It generates absolute paths, which is why it runs after extraction instead of shipping a fixed file.

## The desktop tile

`windows/tile/MeshfinTile.cs` is a Win32 layered window that behaves like part of the wallpaper: per-pixel transparency, no taskbar button, no focus stealing, and a click that starts the harness through `start-meshfin.cmd` one level up. It is compiled from source by `build-tile.cmd` with the `csc.exe` every Windows install already has — no SDK and no package manager. Geometry and skin are remembered in `meshfin-tile.ini` beside the executable.

`skins/` ships four default skins, downscaled from their originals so the repository stays light. Right-click the tile to change skin, size, or position; the choice is remembered in `meshfin-tile.ini`.

The tile can also draw a DeepSeek balance chip, which needs a fetcher script named in `meshfin-tile.ini` (`balancescript=`). With no script configured the tile starts with no chip and runs no fetch thread, because the balance is a personal deployment detail and not part of this project.
