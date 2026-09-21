# Skill repository updates

## Scope

This work addresses #335 and #336. Existing local files remain the source of
truth. Repository metadata supplements those files; it does not grant write
access to a repository or to an Agent-owned plugin.

- Discover existing sources from installation records, gh frontmatter, and
  tracked files in an existing Git checkout, including submodules and worktrees.
- Preserve gh and skills CLI lock extensions when aghub updates shared records.
- Keep the resolved Git revision/tree separate from the installed content digest.
- Compare the installed baseline, current local content, and reviewed upstream
  content before updating. Missing baselines do not mean unmodified content.
- Keep credential references in local aghub state, never tokens in shared locks.
- Reuse the existing scan sessions, content audit, diff, and staged replacement.
- Add gh search/install/update execution without silently replacing the native
  installer or changing branch selection into gh's release selection policy.

## Boundaries

No automatic Git initialization, remote creation, repository binding, publishing,
credential copying, or background overwrite. No marketplace/search redesign.
Plugin-owned Skills are updated through their owner, not as standalone copies.
Git-tracked source directories and pinned submodules are read-only update sources.

Global locks are shared by multiple installers and keyed by Skill name. They
cannot identify every physical installation. Per-location baselines belong in
aghub's local application data. Unknown fields and version pins in shared locks
must survive unrelated writes.

## Verification

- Lock round trips retain unknown root and entry fields, including `pinnedRef`.
- Source detection handles symlinks, nested repositories, detached HEAD, missing
  remotes, untracked Skills, and credentials embedded in remote URLs.
- Updates protect local edits, unknown baselines, pins, plugin ownership, stale
  reviews, and aliases of a shared physical directory.
- Failed writes do not advance the installed baseline or claim success.
- gh execution is bounded, noninteractive, scoped, and audited before activation;
  its global lock side effect must not bypass the review phase.
- The update entry preloads a valid credential reference and scans automatically;
  manual marketplace imports keep their existing behavior.

## Publication

Keep logical changes separately committed. Review the diff and PR description
before pushing. The PR description should include `Closes #335` and `Closes #336`
only when both issue acceptance paths are implemented and verified.

## Implementation status

- Implemented: shared lock extension preservation, gh metadata parsing, existing
  checkout/submodule/worktree source detection, and a scoped read-only source API.
- The v1.9.1 detail action uses an existing lock source to scan and replace the
  installed copies in place. It matches the stored Skill path exactly, keeps
  the recorded ref (a pin takes precedence), preserves links, and uses the
  existing audit and staged-write guards. It is an explicit replacement, not a
  background merge of local edits. Authentication errors can retry with a saved
  credential without reopening the import flow.
- This action does not advance shared lock hashes: those identify installation
  records, not per-location replacement baselines. Provider-owned locations are
  excluded. A missing or ambiguous upstream Skill fails without replacement.
- Pending: per-installation baselines, update execution and rollback metadata,
  credential-reference persistence, gh command execution, and automatic update
  checks. The two issues are not ready to close.
