# Automatic PR reviews: setup and validation

Status: repository guidance prepared; external activation and end-to-end validation are pending. Adding AGENTS.md does not enable a service. Do not treat this document as evidence that reviews are running.

## Audit (2026-11-05)

Audited master at `9da64b198dc67e13a4ec506f97ec9f1afdf241ca`.

- Node 22.x, ES modules, discord.js, Express. No tracked `.github` configuration, Actions workflows, CODEOWNERS, or AGENTS.md on master.
- Effective master rules require a PR and one approval, dismiss stale reviews on push, prevent branch deletion and force pushes. Code-owner review and thread resolution are not required. No required status check was returned by the effective branch rules. Bypass actors were not audited.
- The connected GitHub account reports admin/push access, but the connector rejects branch creation with `403 Resource not accessible by integration`. Account permission does not imply integration permission. Local `gh auth status` reports an invalid token. Authenticated Actions permission endpoints could not be audited; public requests returned 401. App installations, secrets, workflow token defaults, and billing remain unverified.
- Existing tests include atomic-write and save-queue tests. The save-queue test imports `getQueueLength`, absent from master's save-queue exports. No application tests were executed for this documentation-only configuration.

## Selected integration

Use the official Codex GitHub Code Review integration, configured in account settings, with root AGENTS.md for project rules. It avoids a custom reviewer and a privileged AI workflow inside this repository. No new workflow, PAT, API key, deployment credential, or production data access is needed in the repository for this approach.

Official sources:

- [Codex GitHub setup and automatic review](https://learn.chatgpt.com/docs/third-party/github)
- [Codex pricing and plan eligibility](https://learn.chatgpt.com/docs/pricing)
- [Claude hosted Code Review](https://code.claude.com/docs/en/code-review)
- [Claude GitHub Actions](https://code.claude.com/docs/en/github-actions)

Codex documents automatic reviews, configurable triggers, serious inline findings, and AGENTS.md guidance. It does not establish a guaranteed three-state status check, formal APPROVE/REQUEST_CHANGES submission, strict master-only filtering, or perfect deduplication. Verify actual behavior before relying on any of these. AGENTS.md requests behavior; it is not an enforcement boundary.

Claude hosted Code Review is an alternative requiring an organization on Team or Enterprise and owner activation. Its documentation describes static review without building/running code. The default Claude Actions review skill can skip PRs already commented on, so simply copying that workflow does not meet dependable re-review requirements. Actions also introduce credential and runner hardening work. Neither alternative is enabled here.

## Account owner activation

1. Restore GitHub write authorization for the connector, or run `gh auth login --hostname github.com` locally. Do not paste tokens into chat. Push only `codex/automatic-pr-review` and open a PR targeting master; review and merge it yourself. Do not push to master.
2. Sign in to [Codex review settings](https://chatgpt.com/settings/code-review). Connect/select only `coopscollectionbiz-debug/Poke-discord-bot`. If installation or renewed authorization is needed, inspect the actual GitHub consent screen before accepting. Review requires repository content/metadata read access and PR review/comment write access; the official app may request broader permissions for other features. Record that complete permission set before authorizing it. Do not give it a ruleset bypass or deployment credentials.
3. Enable repository Automatic review for **All PRs**, not just personal preferences. Select a Review trigger that covers every push as well as new/ready PRs. Confirm opened, synchronize, and ready-for-review behavior with the tests below; if the UI cannot provide that coverage, this implementation is incomplete. If a target-branch filter is available, select master. The root rules scope recommendations to master; they cannot enforce service event filtering.
4. Confirm account eligibility and usage before enabling. Current published Plus pricing is USD 20/month and includes automatic review; eligible higher plans also support cloud features. Reviews consume plan allowance/credits, vary with PR size, and may stop at usage limits. API-key-only access does not enable hosted GitHub review. Do not purchase a plan, credits, or enable paid overages without owner consent.
5. Keep auto-fix, auto-merge, deployment access, and ruleset bypass disabled. This change does not alter protections or deployment configuration. Optional Security Review has separate preview/eligibility settings; do not assume it is enabled.

## Safety boundary and approval

No workflow is added, so this configuration cannot execute PR code on an Actions runner with repository secrets. The review instructions explicitly forbid executing PR code and disclosing secrets. This does **not** independently prove the hosted service's sandbox, credential isolation, network policy, or resistance to prompt injection. Before unattended use, inspect its environment/setup settings and current vendor guarantees. Require a review environment with no production secrets, no install/setup hooks from PRs, no untrusted code execution with privileged credentials, and no deployment access. If those controls cannot be verified, mark security validation incomplete and do not call the setup production-ready. Secrets already committed in public source remain exposed regardless of reviewer settings.

PASS is an advisory recommendation for the exact reviewed head SHA, not a guarantee. No findings, a thumbs-up reaction, a completed task, and a green Actions run are not interchangeable. Missing/failed/limited/stale reviews mean NEEDS REVIEW. Merge only after the latest head has a complete review, no unresolved P0/P1 findings, adequate evidence for risky changes, and all existing GitHub requirements satisfied. You retain the final merge decision.

No synthetic passing check is installed. If Codex produces a native check, inspect its result semantics and test failures, limits, and stale heads before requesting any master ruleset change. A job that merely invokes a reviewer must not be a safety gate. Exact PASS/CHANGES REQUESTED/NEEDS REVIEW machine enforcement would require separately scoped implementation if the service does not support it.

A dedicated bot account could submit an APPROVE review through GitHub with appropriate review API authorization and repository write access, provided it is not the PR author. Whether that approval satisfies this ruleset must be tested. A comment-only Codex review does not satisfy the existing one-approval rule. A bot token/App able to approve is security-sensitive; do not create one or grant write access just to translate prose to approval. GitHub also disallows author self-approval and dismisses stale approvals here. See [GitHub required reviews](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews).

## Acceptance test (pending activation)

Use a disposable, unmerged PR targeting master after guidance is on the base branch. Never deploy it, run the bot, or use real trainer data/secrets.

| Step | Required evidence |
| --- | --- |
| Open a harmless documentation PR | Automatic reviewer starts without a mention; capture PR/review URL, head SHA, outcome and any native check |
| Push a second harmless commit | New review is attached to new head; old PASS cannot count |
| Open draft, then mark ready | No premature readiness claim; ready event starts a review |
| Add a small static fixture with a clear missing ownership check or double-reward bug | Inline finding has correct changed lines, severity, impact and fix; do not execute fixture |
| Fix fixture in another commit | New review verifies fix and avoids repeating resolved finding |
| Include significant behavior lacking validation | NEEDS REVIEW or equivalent explicit uncertainty, never an assumed PASS |
| Inspect checks and submitted review states | Record COMMENT vs APPROVE/REQUEST_CHANGES and native check semantics; do not infer from prose |
| Review environment/access settings | Record actual app permissions, no production secrets/setup execution, and no bypass/merge/deploy configuration |

Record observed results, URLs, head SHAs, timestamps, and limitations in this document before marking setup working. Test fork PRs and bot-authored PRs too if used; do not assume their authorization behavior matches same-repository human PRs. A manual `@codex review` can diagnose connectivity, but does not prove automatic triggers.

Rollback: disable repository Automatic review in Codex settings. Removing AGENTS.md only removes guidance; it does not disable the service. Revoke the app's repository access separately if no other Codex features need it. Keep master protections intact.
