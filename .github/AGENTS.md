# AGENTS.md — GitHub Actions

Run jobs on Windows runners (`windows-*` labels) under native `pwsh`. The `windows` job is the deliberate exception: it runs Windows Node under Wine on hosted Linux and blocks `all checks passed`; `windows-native` runs on `windows-2025` and reports independently.

Every lane in this repository runs on GitHub-hosted runners. The in-house pools, their `DSH_CI_FAILOVER_*` selectors, and the standby drills those pools required are gone, so worker counts are sized for the 4-core hosted runner.

The e2e workflow runs keyless: `pnpm run test:snapshot` replays recorded transcripts on demand and nightly, and the real-API lane runs only when the `DEEPSEEK_API_KEY_EXTERNAL` secret is configured — without it that lane reports a notice and skips rather than failing. A replay cannot detect drift in the live API, so never describe the keyless lane as covering it.
