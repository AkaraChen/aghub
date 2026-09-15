# Serial workspace validation

`run_queue.py` runs a finite, locally authored JSON plan on Linux. It
captures full workspace results across shell/heartbeat lifetimes without
starting concurrent judge builds. It never fetches, merges, pushes,
changes assertions, or updates LoopX. A judge still reviews every result.

## Plan before launch

1. Fetch main and task heads and pin their full commit IDs.
2. Reserve detached, clean workspaces for the duration of the queue.
   Do not use a peer's workspace. Keep this script in a separate worktree.
3. Use a disk-backed target directory. Sharing the judge's warmed target
   directory serially preserves dependency compilation across candidates.
4. If an existing run owns the judge workspace, supply its `started` and
   `result` JSON paths as `predecessor`. The runner waits for both recorded
   processes to exit and requires a matching final result before checkout.
   A missing result stops the queue; a failed predecessor permits the next
   candidate but remains failed evidence.
5. Give each run a new output directory; reuse is rejected. The advisory
   lock prevents duplicate runners using that output directory. It is not
   a global workspace lock: the operator must not launch a second queue
   with a different output directory against the same workspace or target.

Example local plan (replace placeholders with actual paths and commits):

```json
{
  "max_seconds": 21600,
  "target_dir": "/disk/judge/target",
  "initial_commits": {
    "/disk/judge": "<40-character current commit>",
    "/disk/clean-clone": "<40-character main commit>"
  },
  "predecessor": {
    "started": "/disk/evidence/prior.started.json",
    "result": "/disk/evidence/prior.result.json"
  },
  "entries": [
    {
      "id": "candidate",
      "workspace": "/disk/judge",
      "commit": "<40-character task commit>"
    },
    {
      "id": "baseline",
      "workspace": "/disk/clean-clone",
      "commit": "<40-character main commit>"
    }
  ]
}
```

Omit `predecessor` when no existing build owns the workspaces. Launch from
a shell with the documented Cargo/Node/LoopX `PATH`. A detached invocation
can use `nohup`; verify its PID and `queue.json` after the shell exits.

```sh
python3 docs/validation/run_queue.py --plan /disk/plan.json \
  --output /disk/evidence/new-queue
```

The runner always executes:

```sh
RUSTC_WRAPPER= CARGO_BUILD_JOBS=1 CARGO_PROFILE_DEV_DEBUG=0 \
  CARGO_PROFILE_TEST_DEBUG=0 AGHUB_SKIP_SIDECAR=1 \
  CARGO_TARGET_DIR=/disk/judge/target cargo test --workspace
```

Debug assertions and all workspace tests remain enabled. This measures
clean source with a warmed build cache, not cold compilation performance.
The deadline stops new queue entries and predecessor waiting; an active
Cargo invocation is allowed to finish. It is not a hard process timeout.

## Readback and integration

- `queue.json` records the pinned plan, runner PID, phase and results.
- Each entry has a full local `.log`, `.started.json`, and `.result.json`.
- `finished` means all entries exited, **not that all tests passed**.
  Only an entry with `status=passed` and `exit_code=0` is passing evidence.
- A changed source revision or dirty worktree invalidates the result and
  stops subsequent checkouts. An unexpected runner death may leave a
  `running` record; verify the real PID and final file before continuing.
- A red entry does not prevent testing later independent candidates.
  Quote the first 40 failure lines in `INTEGRATION.md` and update the
  corresponding authorized Todo. Keep full logs and local paths private.
- Fetch again before merging. A result for an older task tip does not
  validate its successor. If main changed, test the proposed combination.
- Desktop, sidecar and Windows/macOS proof remains separate.

## Validation of the runner

On 2026-09-15 a temporary real Git/Cargo workspace exercised three pinned
commits in sequence (pass, deliberate assertion failure, pass). Recorded
exit codes were `[0, 101, 0]`; commit identities and the sidecar environment
flag were checked. A dirty source was rejected before checkout and left
unchanged. Reusing an output directory was rejected with prior results
unchanged. These are runner checks, not agHub workspace acceptance.
Additional real-process checks verified that the runner waits for its
predecessor to exit, rejects a concurrent duplicate, and blocks before
Cargo when the predecessor exits without a final result. All six checks
passed.
