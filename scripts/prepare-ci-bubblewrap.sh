#!/usr/bin/env bash
set -euo pipefail

# Ubuntu's package transaction scans the hosted image's full dpkg database and
# runs post-install hooks. CI needs only the signed-archive payload, so
# `apt-get download` fetches it — verified against apt's signed Release metadata,
# without touching the dpkg database — and it is extracted into the ephemeral
# runner directory.
#
# The payload is deliberately NOT pinned to one filename. A pin to
# bubblewrap_0.9.0-1ubuntu0.1_amd64.deb turned every security update into a red
# CI job, because Ubuntu removes a superseded revision from the pool and the
# pinned URL then answers 404. apt resolves the revision the runner's own
# sources actually serve.

: "${RUNNER_TEMP:?prepare-ci-bubblewrap requires RUNNER_TEMP}"
: "${GITHUB_PATH:?prepare-ci-bubblewrap requires GITHUB_PATH}"

if [[ "$(uname -s)" != 'Linux' || "$(uname -m)" != 'x86_64' ]]; then
  echo 'prepare-ci-bubblewrap supports only Linux x86_64 hosted runners' >&2
  exit 1
fi

download_dir="${RUNNER_TEMP}/dsh-bubblewrap-download"
root="${RUNNER_TEMP}/dsh-bubblewrap"

rm -rf "$download_dir"
mkdir -p "$download_dir" "$root"

download() {
  (cd "$download_dir" && apt-get download bubblewrap)
}

if ! download; then
  # A stale image package list can name a revision the pool has already
  # superseded; refresh once and retry before failing the job.
  echo 'apt-get download failed; refreshing package lists and retrying' >&2
  sudo apt-get update -q
  download
fi

archives=("$download_dir"/bubblewrap_*.deb)
if [[ "${#archives[@]}" -ne 1 || ! -f "${archives[0]}" ]]; then
  echo "expected exactly one downloaded bubblewrap package, found ${#archives[@]}" >&2
  exit 1
fi

dpkg-deb --extract "${archives[0]}" "$root"
printf '%s\n' "$root/usr/bin" >> "$GITHUB_PATH"

sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0 \
  || echo 'apparmor userns knob absent — the functional probe decides'
"$root/usr/bin/bwrap" --version
"$root/usr/bin/bwrap" --ro-bind / / --dev /dev --proc /proc --die-with-parent -- true
echo 'bubblewrap functional probe passed'
