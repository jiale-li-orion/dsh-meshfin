# dsh-archived-sessions

English | [中文](README.zh.md)

An archived-session manager — a settings-page extension for the DeepSeek Harness Web UI, distributed as a single bundle package and installed with one command.

The Harness **Settings → Archived Sessions** page lets you:

- List every archived session with its title, working directory, and last update, read from the Workspace Remote's archive set and the client Session catalog.
- Restore sessions (unarchive them to their original workspace), individually, in bulk, or all at once, through the workspace Remote's `unarchiveSession`.
- Open a session title to preview its latest 100 user, assistant, and tool messages. The Host half reads a bounded tail of the stored log; the browser never sees an artifact path.

Deliberately absent: in-app deletion, per-session disk paths, and a missing-artifact badge. `SessionPersistence` no longer exposes `locate`, `inspect`, or `remove`, so no supported API derives a session's artifact directory; deleting stored sessions stays with the Harness installation itself.

## Install (recommended: suite installer)

From the suite root, install the archived-session bundle and the anchored-presets bundle together:

```sh
pnpm run community:install -- --dsh-home /path/to/.dsh
```

The installer adds both bundles to the `web` profile through `dsh plugin --profile web add <dir>`; `--update` removes a bundle before adding it again, because a running HMR session refuses an install over an installed package. Restart Harness after installation; the **Archived Sessions** page appears in the settings panel with the archive glyph.

> This pure-JS package has no `prepare` build script, so it **does not** need pnpm `allowBuilds` permission.

### Low-level local install (development only)

```sh
dsh plugin --profile web add ./community/bundles/archived-sessions
```

Run this from the suite root only when developing the bundle.

## Repository layout

```
dsh-archived-sessions/
├── package.json          # dsh.bundle + dsh.client declarations (one package, two ends)
├── cordis.patch.yml      # inserts one archived-sessions row (Host + browser)
├── lib/
│   ├── index.js          # Host plugin: the /dsh-archived prefix route
│   └── client.js         # browser plugin: settings-page UI (__ModuleLoader__ bundle)
├── test/
│   ├── host.test.mjs             # archive-set guard, bounded tail, route wiring
│   ├── host-integration.test.mjs # real SessionPersistence service + real web server
│   └── client.test.mjs           # slot registration, row source, page render
├── README.md
└── LICENSE               # MIT
```

Run this package's tests with `npm test` (plain `node --test`; the integration test loads workspace sources through the repository's `tsconfig.base.json`).

Host API (`POST /dsh-archived/inspect`, same-origin, answered only for ids in the Workspace registry's archive set):

| Route | Request body | Response |
| --- | --- | --- |
| `/dsh-archived/inspect` | `{ sessionId }` | `{ id, createdAt, cwd, parentSession, eventCount, sizeBytes, windowStart, messageCount, truncated, messages }` |

## Compatibility

- Target Harness version: `0.2.1-rc.2`, declared as `engines.dsh` (`>=0.2.1-rc.2 <0.3.0`). Since v0.2.1-alpha.3 an own `engines.dsh` range decides plugin compatibility alone.
- The browser half claims the settings slot id `archived-sessions`, which `@deepseek-ai/dsh-client-ui-settings-general` already draws with the archive glyph.
- The Host plugin has no third-party runtime dependencies (pure ESM, imports no `@deepseek-ai/*`, and obtains every needed capability from `ctx`); the browser plugin depends only on `react` (provided by the Harness frontend runtime as the platform seed).

## License

MIT
