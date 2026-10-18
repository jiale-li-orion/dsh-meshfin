#!/bin/sh
# Install a desktop entry for this distribution, so a Linux or WSL desktop can
# start Meshfin from its application menu instead of a terminal.
#
# The entry needs absolute paths, which only exist after the archive is
# extracted, so it is generated here rather than shipped as a fixed file.
set -eu

SELF_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
# The distribution root: this script sits at <root>/launch/linux/.
DIST_ROOT="$(cd -- "$SELF_DIR/../.." && pwd)"
ENTRY_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ENTRY="$ENTRY_DIR/meshfin-web.desktop"

mkdir -p "$ENTRY_DIR"
cat > "$ENTRY" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Meshfin Web
Comment=Start the Meshfin harness and open its Web UI
Exec=$DIST_ROOT/launch/wsl/meshfin-web.sh
Icon=$DIST_ROOT/launch/windows/meshfin.ico
Terminal=true
Categories=Development;
Keywords=meshfin;dsh;agent;harness;
EOF
chmod 0644 "$ENTRY"

printf '[desktop] wrote %s\n' "$ENTRY"
printf '[desktop] it runs %s/launch/wsl/meshfin-web.sh\n' "$DIST_ROOT"
