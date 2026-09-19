# Agent Note: Hosted-runner CI for this deployment

Status: implemented

English | [中文](2026-09-19-hosted-runner-ci.zh.md)

## Problem

This repository is a public deployment of the harness rather than the upstream development tree, and its workflows were written for the upstream organization. `ci.yml` triggered on `master` while the default branch here is `main`, so it had never run once. Each enterprise job selected an organization-level larger-runner pool or a `[self-hosted, linux, x64, vm-backup]` pool that does not exist here, so even a corrected trigger would only have queued forever. The nightly real-API lane hard-failed by design when `DEEPSEEK_API_KEY_EXTERNAL` was empty, and no repository secret ever filled it.

The visible result was a fixed red schedule run every night, and a CI workflow that had never produced a signal.

## Decision

Every lane runs on GitHub-hosted runners. Branch triggers accept `main` and `master`, the enterprise jobs run on push as well as on pull requests, worker counts are sized for the 4-core hosted runner, and the in-house-pool machinery — the `DSH_CI_FAILOVER_*` selectors, the self-hosted standby drills, and the larger-runner benchmark matrices — is gone. `scripts/ci-workflow.spec.ts` pins that set, including a scan that rejects any job selecting a self-hosted or custom pool.

The e2e workflow runs keyless: its scheduled and manual lanes replay recorded transcripts through `pnpm run test:snapshot`, and the real-API suite runs only when `DEEPSEEK_API_KEY_EXTERNAL` is configured. Wherever a lane needs a credential this deployment does not have — `DEEPSEEK_API_KEY_EXTERNAL`, `AZURE_OPENAI_API_KEY_EXTERNAL` and `ANTHROPIC_API_KEY_EXTERNAL`, `E2B_API_KEY_EXTERNAL`, the issue-app pair, `NPM_TOKEN` — the job probes for it in a step and skips with a notice, because GitHub forbids `secrets` in a job-level `if:`. The issue-lifecycle lane additionally points its app token at the current repository instead of the upstream organization.

## Alternatives considered

**Keep the pull-request-only gating and open pull requests into `main`.** This is how the upstream tree keeps pushes cheap, and it would have preserved the workflows unchanged. It was rejected because this deployment lands changes by pushing straight to `main`: under PR-only gating the full suite would still never have run on the commits that actually shipped.

**Replace the keyless replay with a mocked API provider.** A purpose-built mock would let the real-API suite run without a key. It was rejected because the snapshot harness already replays recorded model and API interactions through the assembled application, so a second mock would add a parallel mechanism without adding a signal.

## Consequences

`ci.yml` now produces its real verdict on direct pushes to `main`, which is how this deployment lands changes; the former pull-request-only gating left that path unverified. The keyless replay cannot detect drift in the live API, so the real-API lane stays available and unclaimed rather than being replaced, and configuring the secret later needs no workflow change.

Four gate inputs exist only outside a clean checkout, and each is now handled explicitly. `scripts/prepare-ci-bubblewrap.sh` fetches its payload through `apt-get download`, because a pinned `archive.ubuntu.com` filename answers 404 once Ubuntu supersedes that revision. The static job passes the pre-push commit as the archive baseline on push events, where the pull-request baseline field is empty. `zod` is declared by six packages whose generated `lib/typert.*` artifacts import it while no `src/` file does, so `knip` reads it as unused wherever those artifacts are absent; the gate therefore runs in the consumer lane, which owns the build, instead of the source-only static lane. `docs/module-graph.md` is regenerated from the workspace, so the module-graph gate fails whenever packages change without it.

The in-house failover mechanism this removed is recorded in the [archived failover runbook](../../archived/process/2026-07-26-ci-failover-runbook.md). The rationale that still applies is the evidence standard in the [larger-hosted-runner decision](2026-07-22-evidence-based-larger-hosted-runners.md) and the cross-platform reference shape in the [serial reference decision](2026-07-21-serial-cross-platform-ci-reference.md); the keyless/real-API split stays under the [real-API e2e decision](../testing/2026-06-19-real-api-e2e-ci.md).

## Verification

`npx vitest run scripts/ci-workflow.spec.ts` passes 13/13, including the new checks that no job selects a self-hosted or custom pool, that the keyless lane runs `pnpm run test:snapshot`, and that both credential-dependent lanes gate their steps on a probe output. Every workflow file parses as YAML, and `pnpm run verify-archived-agent-notes` accepts the sealed failover triplet.
