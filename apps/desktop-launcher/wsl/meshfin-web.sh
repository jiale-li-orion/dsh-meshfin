#!/usr/bin/env bash
# ============================================================================
#  meshfin web -- the WSL / Linux side of the "Meshfin Web" desktop entry.
#
#  This script owns the server's lifetime: it runs in the foreground of the
#  console window the shortcut opens, so that window IS the lifetime.
#
#    * closing the browser window    -> dsh keeps running (nothing else changes)
#    * closing that console window   -> SIGHUP  -> trap -> dsh stops
#    * Ctrl+C in that console window -> SIGINT  -> trap -> dsh stops
#
#  The harness authenticates each browser process and prints the tokenised URL
#  on its `dsh web: <url>` line. This script therefore runs `dsh web --no-open`,
#  reads that line, and hands exactly that URL to the desktop's browser. A URL
#  without the token is refused, so there is no bare-port URL to poll for: an
#  unauthenticated probe would answer even where the page then fails.
#
#  Set MESHFIN_OPEN=official to skip the handoff and let the harness open the
#  browser itself, which is the right choice under WSLg or a Linux desktop.
#
#  Environment / arguments:
#    --port N | --port=N      forwarded to `dsh web` (DSH_WEB_PORT sets the fallback)
#    DSH_WEB_PORT=8080        port to use when no --port argument is given
#    DSH_WEB_NO_BROWSER=1     do not open a browser; the URL is still printed
#    MESHFIN_OPEN=official    let the harness open the browser instead
#    MESHFIN_CMD="..."        command to start instead of this distribution's launcher
# ============================================================================

set -u

# A fresh GUI server must not inherit an agent session's identity, in case this
# script is ever invoked from inside a dsh tool shell instead of the shortcut.
unset DSH_SESSION_ID DSH_SESSION_JSONL DSH_SHELL DSH_WEB_URL

PORT="${DSH_WEB_PORT:-3080}"

# Honour an explicit --port / --port=N in the arguments we forward to dsh.
prev=''
for a in "$@"; do
  case "$a" in
    --port=*) PORT="${a#--port=}" ;;
    --port)   : ;;
    *)        [ "$prev" = '--port' ] && PORT="$a" ;;
  esac
  prev="$a"
done
case "$PORT" in '' | *[!0-9]*) PORT=3080 ;; esac

# True once something accepts TCP connections on the port (bash /dev/tcp).
# This is a diagnostic, not a readiness signal: see the note at the top.
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") >/dev/null 2>&1; }

# Which harness to run, in order: an explicit override, the launcher of the
# distribution this script was shipped inside (two directories up), then a `dsh`
# on PATH for a checkout install.
SELF_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
DIST_ROOT="$(cd -- "$SELF_DIR/../.." && pwd)"
if [ -n "${MESHFIN_CMD:-}" ]; then
  LAUNCH="$MESHFIN_CMD"
elif [ -x "$DIST_ROOT/meshfin" ]; then
  LAUNCH="$DIST_ROOT/meshfin"
elif [ -n "$(command -v dsh || true)" ]; then
  LAUNCH="$(command -v dsh)"
else
  LAUNCH=""
fi

# Hand one authenticated URL to whatever browser this desktop has.
handoff() {
  local url="$1"
  if [ -n "${DSH_WEB_NO_BROWSER:-}" ]; then
    printf '[launcher] 已关闭自动打开浏览器；请手动打开上面的 URL。\n' >&2
    return 0
  fi
  printf '[launcher] opening %s\n' "$url"
  if command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe /c start "" "$url" >/dev/null 2>&1 && return 0
  fi
  if command -v wslview >/dev/null 2>&1; then
    wslview "$url" >/dev/null 2>&1 && return 0
  fi
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 && return 0
  fi
  printf '[launcher] 无法自动打开浏览器，请手动打开上面的 URL。\n' >&2
  return 1
}

printf '\n[launcher] distro    : %s\n' "${WSL_DISTRO_NAME:-unknown}"
printf '[launcher] workspace : %s\n' "$PWD"
printf '[launcher] harness   : %s\n' "${LAUNCH:-NOT FOUND}"

if [ -z "$LAUNCH" ]; then
  printf '\n[launcher] 找不到 harness：既没有随包附带的 meshfin，PATH 里也没有 dsh。\n' >&2
  printf '[launcher] 请从发行包根目录运行，或设置 MESHFIN_CMD 指向一个启动器。\n' >&2
  exit 127
fi

# ---------------------------------------------------------------------------
# Already running? A second server would take another port and a second home.
# The URL of the running one is in the window that owns it.
# ---------------------------------------------------------------------------
if port_open; then
  printf '\n[launcher] 端口 %s 已经在监听：这里不会再启动第二个 dsh。\n' "$PORT"
  printf '[launcher] 请在已经运行的那个窗口里读取它的 URL，或换一个 --port。\n'
  printf '\n[launcher] 按任意键关闭本窗口。'
  if [ -t 0 ]; then read -r -n 1 -s; else sleep 10; fi
  printf '\n'
  exit 0
fi

# ---------------------------------------------------------------------------
# Normal start. The server's stdout goes through a FIFO so this script can read
# the authenticated URL line while the server keeps the terminal as its own.
# ---------------------------------------------------------------------------
FIFO_DIR="$(mktemp -d "${TMPDIR:-/tmp}/meshfin-web.XXXXXX")" || exit 1
FIFO="$FIFO_DIR/server.log"
if ! mkfifo "$FIFO"; then
  printf '[launcher] 无法创建命名管道（mkfifo）于 %s。\n' "$FIFO" >&2
  rm -rf "$FIFO_DIR"
  exit 1
fi

cleanup() {
  trap - HUP INT TERM EXIT
  if [ -n "${READER_PID:-}" ]; then kill "$READER_PID" 2>/dev/null; fi
  if [ -n "${DSH_PID:-}" ] && kill -0 "$DSH_PID" 2>/dev/null; then
    printf '\n[launcher] stopping the server (pid %s) ...\n' "$DSH_PID"
    kill -TERM "$DSH_PID" 2>/dev/null
    for _ in $(seq 1 30); do
      kill -0 "$DSH_PID" 2>/dev/null || break
      sleep 0.2
    done
    kill -KILL "$DSH_PID" 2>/dev/null
  fi
  rm -rf "$FIFO_DIR"
  printf '[launcher] stopped.\n'
}
trap cleanup HUP INT TERM EXIT

# The FIFO reader opens for reading first, so the server's open for writing pairs
# with a reader that already exists instead of blocking this shell. It clears the
# inherited traps: this subshell ends at EOF while the server may still be running,
# and running the parent's cleanup from here would stop a live server.
watch_url() {
  trap - HUP INT TERM EXIT
  local handed=''
  local line url
  while IFS= read -r line; do
    printf '%s\n' "$line"
    if [ -z "$handed" ]; then
      case "$line" in
        'dsh web: http'*)
          handed=1
          url="${line#dsh web: }"
          handoff "$url" || true
          ;;
      esac
    fi
  done
}

# The port this script resolves is the port the server must actually serve on:
# without this the harness falls back to its own composed default.
case " $* " in
  *' --port '*) ;;
  *' --port='*) ;;
  *) set -- --port "$PORT" "$@" ;;
esac

# With the handoff in charge, the harness must not open the browser itself.
if [ "${MESHFIN_OPEN:-handoff}" != 'official' ]; then
  set -- --no-open "$@"
fi

watch_url < "$FIFO" &
READER_PID=$!

printf '\n[launcher] starting : %s web %s\n' "$LAUNCH" "$*"
printf '[launcher] 关闭浏览器不影响它；关闭本窗口或按 Ctrl+C 才会停止。\n\n'

"$LAUNCH" web "$@" > "$FIFO" 2>&1 &
DSH_PID=$!

wait "$DSH_PID"
