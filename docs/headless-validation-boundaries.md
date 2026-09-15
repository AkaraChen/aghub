# Headless validation boundaries

## Plan and acceptance

This checkpoint maps each issue-backed task in the active LoopX goal to
an observable result, a builder validation surface, and the evidence the
builder cannot provide. The integration baseline remains
`72f296f0317a405f96a163246eebdc77d74c668d`.

The plan is to preserve the running serial workspace queue, review source
and issue acceptance requirements, then validate this table against the
active task inventory. No application code or test selection changes are
needed for this checkpoint. The foundation validation task stays open
until its clean-clone workspace run passes.

The table covers **14 issue-backed tasks** in LoopX as read on
2026-09-15, plus PR #459 as a dependency. The public open-issue query
returned 10 issues; #436, #437, #441 and #444 were closed on GitHub but
still open in LoopX. GitHub lifecycle does not close these tasks or prove
that the required behavior is present on `origin/main`.

## Evidence classes

- **Rust fixture**: a test with controlled files, configuration, or a local
  server can prove parsing, persistence and failure behavior. A proposed
  fixture is not an existing or passing test.
- **Browser**: headless Chromium can prove interactions and request state.
  Record whether each route uses real Rust code or a mock. It cannot prove
  native WebView rendering, system menus, keychain integration or packaging.
- **Runtime**: a supported agent executable, sidecar or platform service
  must actually be exercised and its version recorded. A fixture cannot
  establish that a client loads the configuration.
- **Review / decision**: source inspection or an operator-approved design
  is needed. Neither is executable acceptance evidence.

**All issue-specific acceptance below is missing proof in this document.**
The table specifies how to obtain it; it does not report a passing run.
The [integration record](../INTEGRATION.md) owns actual commands and exits.

## Per-issue matrix

| Task | What builder evidence must demonstrate | Additional acceptance / missing proof |
| --- | --- | --- |
| [#436 — Codex Skill paths](https://github.com/AkaraChen/aghub/issues/436) | Rust fixtures for project, user, legacy, administrator and universal discovery; deduplication by physical location; explicit project writes and read-only provider/plugin/system sources. Start at `crates/agents/src/agents/codex/mod.rs`, `crates/core/tests/test_agent_paths.rs`, `crates/api/src/routes/agents.rs` and `crates/api/src/codex_skills.rs`. | Compare with the installed Codex app-server `skills/list` in an isolated fixture environment and record its version. Descriptor tests alone do not prove runtime discovery. Windows path behavior and native UI remain missing proof. |
| [#437 — remote MCP / enabled](https://github.com/AkaraChen/aghub/issues/437) | Rust round trips for stdio and HTTP entries, enable/disable, unknown TOML fields and unrelated configuration preservation. Exercise API capability output and distinguish disabled, failed connection and absent configuration in browser tests. Start at the Codex descriptor and `crates/core/tests/integration_tests.rs`. | Real client loading and transport compatibility need a versioned Codex run against a controlled local MCP server. OAuth UI is outside this issue. Native presentation remains missing proof. |
| [#441 — Agent Plugins 1.0](https://github.com/AkaraChen/aghub/issues/441) | Fixtures for manifest/version errors, fixed component locations, duplicate IDs, unknown extensions, partial success and symlink escape. Verify shared origin DTOs, read-only operations, no cache changes and no process/network execution. Review `crates/cc-plugins/` and `crates/api/src/routes/plugins.rs`; native Claude parsing is not portable-format proof. | #459 origin/schema availability must be checked on the chosen base. Cache discovery cannot establish installation, enabled state or client visibility; keep visibility unknown without runtime evidence. Native details view remains missing proof. |
| [#444 — Hook discovery](https://github.com/AkaraChen/aghub/issues/444) | Per-agent fixtures for Codex, Claude and Cursor sources, scope, original event names, ownership, unknown fields and partial failures. Verify that discovering hooks never executes or edits them. API/browser tests must retain source and event information. | Check each implemented format against current official agent documentation before implementation. Source parsing does not prove a hook is enabled. Hook execution is outside scope; native display remains missing proof. |
| [#335 — update existing Skills](https://github.com/AkaraChen/aghub/issues/335) | API/filesystem tests must compare installed bytes and real lock hashes for initial install, unchanged update, upstream update, local edits and failed hashing/replacement. Verify failures preserve destination contents. Start at `crates/api/src/routes/skills.rs` and `crates/skill/`. | Run the latest candidate's regression, including the destination snapshot-limit case. Old branch results do not cover later fixes. Browser update feedback and the native update flow remain missing proof. |
| [#336 — scan / credential prefill](https://github.com/AkaraChen/aghub/issues/336) | Split two checks: opening update-source automatically scans, while a fresh import waits for a request; separately, credential-ID lock migration and preselection handle missing/deleted IDs. Check branch changes and replacement scan-session identity. Use synthetic IDs and placeholder values. Start at `crates/skill/`, the Git import panel and desktop E2E. | Mocked requests do not prove a private repository can be cloned with the native credential store. Actual credential access requires a separately authorized fixture environment; native flow remains missing proof. Never put token contents in lock files or evidence. |
| [#56 — incomplete repository scan](https://github.com/AkaraChen/aghub/issues/56) | Create a local repository containing two distinct Skills and assert both scanned paths, selection IDs and install destinations. Cover nested directories and root-Skill handling; verify the API list and browser member selection independently. Start at `git_scan_skills` in `crates/api/src/routes/skills.rs`. | The reporter's repository/revision is not supplied in the active task. A local regression proves that fixture only; equivalence to the reported repository remains missing proof until a public or synthetic reproduction is identified. |
| [#264 — session export](https://github.com/AkaraChen/aghub/issues/264) | Stream synthetic JSONL fixtures through parsing and export. Cover malformed/truncated lines, Unicode, role/tool events, stable ordering, large files and cancellation. Compare exported bytes; measure memory on a stated input size. Review dependencies to ensure no third-party session package is introduced. | The primary result is exported content. Native save dialogs, file access, cancellation and preview rendering require desktop evidence. Never use private conversations as public fixtures. |
| [#285 — cc-switch import](https://github.com/AkaraChen/aghub/issues/285) | Use a synthetic SQLite database opened read-only; verify field mapping, selected-only import, duplicate handling, malformed rows and missing database behavior. Check source bytes remain unchanged and preview exposes no secret values. Start at `crates/inference/src/store.rs`, credentials and inference API routes. | The issue's schema is a starting fixture, not proof of current cc-switch compatibility. Native keyring storage, file picker and an identified cc-switch version require separate runtime evidence. SQL-file import, if selected, needs its own parser/selection tests. |
| [#288 — tray usage / provider status](https://github.com/AkaraChen/aghub/issues/288) | Test usage parsing and status transitions for success, stale data, timeout, malformed output and unavailable provider. Browser tests may exercise view state; existing fixture ccusage can validate the parser pipeline only. | Real ccusage output, tray icon changes, popover placement, focus and navigation require native runs on each supported desktop platform. The sidecar-skip build cannot validate usage collection or a release bundle. |
| [#38 — Git backup](https://github.com/AkaraChen/aghub/issues/38) | Review a written design for included files, source metadata, secret exclusion, local-edit conflicts, commit/tag/push policy, restore behavior and failure recovery. After operator scope approval, local temporary Git repositories can test the selected design. | Product decision required before implementation. Submit a concrete proposal and mark the task blocked for that decision. Existing prompt backup helpers do not prove full MCP/Skills backup. Remote push and native credentials remain missing proof. |
| [#41 — aghub cloud](https://github.com/AkaraChen/aghub/issues/41) | Review a written proposal for sync scope, identity, storage, conflict handling, encryption/key ownership, offline behavior and deletion. Name the smallest accepted milestone and its fixture contract before coding. | Product decision required; mark blocked after the concrete proposal is ready. Builder tests cannot select the product scope or prove a deployed service, multi-machine sync or production access. |
| [#236 — macOS ARM DMG](https://github.com/AkaraChen/aghub/issues/236) | Inspect packaging/build configuration and available CI diagnostics without modifying workflows. Record the exact artifact, commit, target and observed error before proposing a code change. | **macOS ARM hardware proof required**: download/mount/install/launch the identified DMG and capture the actual failure or success. Linux unit tests, cross compilation and a successful archive job cannot replace this. |
| [#319 — Windows model selection](https://github.com/AkaraChen/aghub/issues/319) | Review `crates/desktop/src/pages/inference-providers/claude-panel.tsx` and its select components. Browser checks can assert selected state and persistence for Primary/Haiku/Sonnet/Opus in both add and edit dialogs, including reopening the menu. | **Windows desktop proof required**: verify visible checkmark/highlight in the native WebView for all four fields in both dialogs. DOM state or Linux screenshots cannot establish the reported Windows rendering fix. |

### Shared dependency: PR #459

[#459](https://github.com/AkaraChen/aghub/pull/459) supplies the proposed
resource origin, source kind, write policy and runtime visibility model
used by #441. Its description and reported CI are external evidence claims;
they are not a judge validation receipt for the current main or task tip.
Verify the dependency exists on the integration base before using its DTOs.
Do not infer installation or runtime visibility from configuration presence.

## Commands and receipt requirements

Run all build/test commands with `AGHUB_SKIP_SIDECAR=1`. The full integration
gate remains:

```sh
AGHUB_SKIP_SIDECAR=1 cargo test --workspace
```

The [builder contract](builder-validation.md) records the PATH and
single-job/debug-information overrides used by the active queue. Those
overrides must appear in each receipt. Do not run a second Cargo process
against a worktree that the queue owns or check out another commit there.

The desktop declares separate checks in `crates/desktop/package.json`:

```sh
cd crates/desktop
AGHUB_SKIP_SIDECAR=1 bun run typecheck
AGHUB_SKIP_SIDECAR=1 bun run test:unit
AGHUB_SKIP_SIDECAR=1 bun run test:e2e
```

These are available commands, **not runs performed for this document**.
Playwright starts a Vite server and a Rust API server, uses Chromium and
supplies fixture ccusage. Some specs intercept API routes or mock Tauri.
Describe those substitutions per test; do not label the suite native
desktop acceptance or start it concurrently with the current Cargo queue.

For each acceptance receipt record: exact commit and clean source status,
command and environment, start/end time, exit code, passing/failing test
names, fixture versus runtime boundary, and remaining proof. For native
evidence also record OS, architecture, app/artifact and agent versions.
Keep raw local data private; publish only redacted reproducible evidence.

## Current decision

Continue the existing queue to a terminal result, then validate newly
fetched task tips before integration. The active queue pins older #436
and #335 revisions; it cannot authorize their updated tips. Preserve the
clean main clone for the separate baseline run. If resource termination
recurs, use its actual diagnostic to replan capacity before another
identical retry. Keep the baseline and platform acceptance open.
