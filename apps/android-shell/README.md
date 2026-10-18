# DSH Android shell

English | [中文](README.zh.md)

The optional phone app of [Meshfin](../../README.md). A phone can use the Web UI as an ordinary browser tab; this app exists for the browser layer a stock phone browser cannot be configured to provide.

It is a WebView app with no UI of its own: everything it shows is the host's Web UI.

## What it does

- **Local assets** — plugin bundles, scripts, and images the host serves under a `rev` query are cached on the device. The host derives that `rev` from build metadata and serves the response as immutable, so one URL names one byte sequence and a rebuilt bundle addresses a new one; the cache keys on the full URL and never recomputes the `rev`, which is not a digest of the body. Each entry records a digest of the bytes it stored, so a partially written response is refetched instead of replayed.
- **Launcher icon** — the app has an identity on the home screen. The phone's stock browser turns "add to home screen" into a bookmark, which is not the same thing.
- **Foreground service** — the session stream is not reclaimed while the app sits in the background.
- **Loopback proxy** — the app loads a loopback origin and forwards to the host over TLS using the host's own name, so the host certificate stays valid and the phone's own DNS layer is never consulted. A loopback origin is also a secure context, so clipboard and `crypto.randomUUID()` work.

## What it does not do

It carries no LLM key, holds no second session store, and changes nothing in the agent loop. It implements **no device capabilities**: the agent cannot reach this phone's camera, files, or location through it. The device-capability protocol is a separate thing that does not exist yet.

## Download

```text
https://github.com/jiale-li-orion/dsh-meshfin/releases/download/android-shell/dsh-shell.apk
```

Download it on the phone and open it; the app requests no permissions. That asset is replaced in place whenever this app changes, so the URL always serves the current build.

### Serving it from your own host

A deployment that already reaches the phone over a private network can hand out the APK itself, which saves a trip to GitHub on the phone. This repository's deployment serves it from the web host's static root, so publishing a rebuild is one copy:

```sh
cp apps/android-shell/app/build/outputs/apk/debug/app-debug.apk apps/web/dist/dsh-shell.apk
```

Both copies are ignored by git, because an APK is a build artifact and not repository content.

## Build

Gradle 9.1.0 and an Android SDK with platform 35. The project ships **no** Gradle wrapper, so the `gradle` on your `PATH` is the one used.

The host it points at is compiled in, at `UPSTREAM_HOST`, `UPSTREAM_ADDRESS`, and `UPSTREAM_PORT` in [`MainActivity.java`](app/src/main/java/com/dsh/shell/MainActivity.java). Change those three constants before building for a different host.

```sh
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android}"   # any SDK holding platform 35
export GRADLE_USER_HOME="$PWD/.gradle-home"            # keep the build cache off $HOME
gradle -p apps/android-shell assembleDebug
```

The APK lands at `apps/android-shell/app/build/outputs/apk/debug/app-debug.apk`. It is debug-signed on purpose: the shell ships no release keystore, so installing it asks nobody to trust a signing key they cannot verify.

## Files

| File | What it holds |
| --- | --- |
| `MainActivity.java` | The WebView, the browser-parity settings (zoom, text zoom, file chooser, downloads), and the host address it serves. |
| `LoopbackProxy.java` | The loopback gateway: plain HTTP in, TLS out, with the host's own name for SNI and certificate validation. |
| `GatewayCache.java` | The on-disk cache: keyed on the revisioned URL, each entry verified against the digest it recorded when written. |
