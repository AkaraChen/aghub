# Integration record

## 2026-09-15 — terminal #436 compilation failure

**Not merged.** The carried-over full workspace run on
`d1894b1b5dd36b8e972823dc8e0b38f90cac7e75` finished at
`2026-09-15T09:44:20.135340+00:00` with Cargo exit **101**, after
**7979.0 seconds** (2 h 12 min 59 s). The failing crate is
`yara-x 1.17.0`; its compiler process received signal 9 (`SIGKILL`).
No test result was reached, so the failing-test set is **not measured**.
The compiler diagnostic does not by itself establish an OOM kill.

Actual command, started in the judge worktree at `2026-09-15T07:31:21Z`:

```sh
RUSTC_WRAPPER= CARGO_BUILD_JOBS=1 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 AGHUB_SKIP_SIDECAR=1 cargo test --workspace
```

### First 40 failure lines

The log contains only four lines from the first `error:` to EOF; all four
are reproduced below. The home-directory prefix is replaced with `$HOME`.
The long compiler invocation is retained so its terminating signal remains
part of the original diagnostic.

```text
error: could not compile `yara-x` (lib)

Caused by:
  process didn't exit successfully: `$HOME/.rustup/toolchains/1.97.1-x86_64-unknown-linux-gnu/bin/rustc --crate-name yara_x --edition=2024 $HOME/.cargo/git/checkouts/yara-x-74b3dd3e6ee1849a/e0096cd/lib/src/lib.rs --error-format=json --json=diagnostic-rendered-ansi,artifacts,future-incompat --crate-type lib --emit=dep-info,metadata,link -C opt-level=1 -C embed-bitcode=no -C debug-assertions=on --cfg 'feature="constant-folding"' --cfg 'feature="exact-atoms"' --cfg 'feature="fast-regexp"' --check-cfg 'cfg(docsrs,test)' --check-cfg 'cfg(feature, values("console-module", "constant-folding", "crx-module", "crypto", "cuckoo-module", "default", "default-modules", "dex-module", "dotnet-module", "elf-module", "exact-atoms", "fast-regexp", "generate-module-docs", "generate-proto-code", "hash-module", "lnk-module", "logging", "macho-module", "magic-module", "math-module", "native-code-serialization", "parallel-compilation", "pe-module", "protoc", "pulley", "rules-profiling", "string-module", "test_proto2-module", "test_proto3-module", "time-module", "vt-module"))' -C metadata=88fefc4a5371bbbd -C extra-filename=-f8a5bf8808a9bab4 --out-dir $HOME/Developer/aghub-judge/target/debug/deps -C strip=debuginfo -L dependency=$HOME/Developer/aghub-judge/target/debug/deps --extern annotate_snippets=$HOME/Developer/aghub-judge/target/debug/deps/libannotate_snippets-811ecab956cfe225.rmeta --extern anyhow=$HOME/Developer/aghub-judge/target/debug/deps/libanyhow-77969aec8d196c0b.rmeta --extern base64=$HOME/Developer/aghub-judge/target/debug/deps/libbase64-ffba77cd2f5b1674.rmeta --extern bincode=$HOME/Developer/aghub-judge/target/debug/deps/libbincode-969cfc50fe3e7330.rmeta --extern bitflags=$HOME/Developer/aghub-judge/target/debug/deps/libbitflags-e27bf87314d2819b.rmeta --extern bitvec=$HOME/Developer/aghub-judge/target/debug/deps/libbitvec-0a314643e0b3d305.rmeta --extern bstr=$HOME/Developer/aghub-judge/target/debug/deps/libbstr-e1dc184b4505f104.rmeta --extern daachorse=$HOME/Developer/aghub-judge/target/debug/deps/libdaachorse-2dc2ea44dac7d5b1.rmeta --extern hex=$HOME/Developer/aghub-judge/target/debug/deps/libhex-b9abb339c41f142c.rmeta --extern indexmap=$HOME/Developer/aghub-judge/target/debug/deps/libindexmap-78e3813c4cfa4449.rmeta --extern intaglio=$HOME/Developer/aghub-judge/target/debug/deps/libintaglio-ae12bbad19ff33d2.rmeta --extern inventory=$HOME/Developer/aghub-judge/target/debug/deps/libinventory-05bd0565c627b11c.rmeta --extern itertools=$HOME/Developer/aghub-judge/target/debug/deps/libitertools-99c4a582f9dc09b9.rmeta --extern memchr=$HOME/Developer/aghub-judge/target/debug/deps/libmemchr-6181c21c21fda231.rmeta --extern memmap2=$HOME/Developer/aghub-judge/target/debug/deps/libmemmap2-b95d0c9facafb2dd.rmeta --extern num_derive=$HOME/Developer/aghub-judge/target/debug/deps/libnum_derive-33b37663e5fe9cee.so --extern num_traits=$HOME/Developer/aghub-judge/target/debug/deps/libnum_traits-eb145d0c04f92820.rmeta --extern protobuf=$HOME/Developer/aghub-judge/target/debug/deps/libprotobuf-671bc9ffa7d74423.rmeta --extern regex=$HOME/Developer/aghub-judge/target/debug/deps/libregex-18728fc814e9e37d.rmeta --extern regex_automata=$HOME/Developer/aghub-judge/target/debug/deps/libregex_automata-ad6eac5865818452.rmeta --extern regex_syntax=$HOME/Developer/aghub-judge/target/debug/deps/libregex_syntax-3d4f5e63214601e0.rmeta --extern rustc_hash=$HOME/Developer/aghub-judge/target/debug/deps/librustc_hash-8c76cc366150d7e8.rmeta --extern serde=$HOME/Developer/aghub-judge/target/debug/deps/libserde-dc00d36d053e7811.rmeta --extern serde_json=$HOME/Developer/aghub-judge/target/debug/deps/libserde_json-b8117fc31197a4c0.rmeta --extern smallvec=$HOME/Developer/aghub-judge/target/debug/deps/libsmallvec-d8c4ca6c2738a5d4.rmeta --extern strum_macros=$HOME/Developer/aghub-judge/target/debug/deps/libstrum_macros-6d9d2539495a2eb2.so --extern thiserror=$HOME/Developer/aghub-judge/target/debug/deps/libthiserror-4956b21161e0307f.rmeta --extern walrus=$HOME/Developer/aghub-judge/target/debug/deps/libwalrus-e04c1cb4d7d03d5b.rmeta --extern wasmtime=$HOME/Developer/aghub-judge/target/debug/deps/libwasmtime-7033456e0433914b.rmeta --extern yara_x_macros=$HOME/Developer/aghub-judge/target/debug/deps/libyara_x_macros-d49383028bf86382.so --extern yara_x_parser=$HOME/Developer/aghub-judge/target/debug/deps/libyara_x_parser-bc21561033105d59.rmeta --cap-lints allow -L native=$HOME/Developer/aghub-judge/target/debug/build/wasmtime-3044dfac06b76f96/out` (signal: 9, SIGKILL: kill)
```

### Queue and current revisions

The serial supervisor observed the predecessor exit and started #436
`2fa9578658d9a50b533393f6ccd6c13ff7918249` at
`2026-09-15T09:44:21.464637+00:00`. By the 09:46Z observation it had reached
`Compiling yara-x v1.17.0`; there was no final result. This demonstrates
predecessor-to-candidate execution on agHub, not a successful validation.
No concurrent judge Cargo invocation was launched and the running plan
was not edited.

An explicit task-head fetch found these remote revisions:

| Branch | Remote revision | Integration status |
| --- | --- | --- |
| `task/436-grok-worker-1` | `e14d3272` | Current tip untested; pinned queue tests older `2fa95786` |
| `task/335-grok-worker-2` | `49deb6c6` | Waiting behind #436; hash-error review finding remains open |
| `task/foundation-codex-judge` | `18c3c7b6` before this evidence update | Waiting behind #335; this documentation update needs final-tip validation |

Main remains `72f296f0317a405f96a163246eebdc77d74c668d`.
There are no duplicate issue branches. The queue will also validate the
clean clone of that main commit, sharing only the warmed disk-backed target.
A result for either old #436 revision cannot authorize merging `e14d3272`.
Fetch again after the queue ends and validate the then-current task tips.

### Resource observation and continuation

At `2026-09-15T09:44Z`, `free -h` reported 15 GiB RAM, 2.5 GiB available
and no swap. `df -h /tmp` reported a 10 GiB tmpfs with 5.8 GiB used;
the judge target is on the disk-backed root filesystem. These observations
support investigating shared memory pressure, but are not kernel OOM
attribution. Preserve other workloads and the current compilation cache.

The attempt to add this failure note to the #436 Todo, using the judge
identity and the explicit integration authority reason, returned:

```text
agent_id='codex-judge' cannot update todo_id='todo_9e9c2483edde'; it is claimed_by='grok-worker-1'
```

The peer claim was preserved. This report and the judge-owned foundation
Todo retain the failure handoff; the peer Todo was **not** updated.

The foundation checkpoint remains **open**. Retrieve each queue result,
record its revision, exit code, duration and failure excerpt, then decide
integration against freshly fetched tips. Do not infer a pass from a
running process or the queue's eventual `finished` status. If the resource
failure repeats, record the distinct failure and replan validation capacity
before another identical queue. Full workspace, clean-clone, desktop,
sidecar, Windows and macOS acceptance remain missing proof.

## 2026-09-15 — pinned queue after candidate revision changed

Main is still `72f296f0317a405f96a163246eebdc77d74c668d`.
The explicit task-head fetch advanced #436 from `d1894b1b` to
`2fa9578658d9a50b533393f6ccd6c13ff7918249`. #335 remains
`49deb6c6a82b8a54fb486f915c96fef492f75bd2`. Foundation was
`a8bbd2c139c61667e606f29e7aa767a01591ba4d` before this evidence change.
There are three task branches and no duplicate issue branches.

**No branch is merged.** The full workspace command on old #436 remained
live after 1 hour 52 minutes 57 seconds. Its last observed output included:

```text
   Compiling gix-pathspec v0.20.0
   Compiling aghub-agents v1.9.0-beta.1
   Compiling getopts v0.2.24
   Compiling gix-negotiate v0.35.1
```

The local path on the `aghub-agents` line is omitted. These are compilation
lines, not failures or passing tests. The final result was absent.
Even a later pass on `d1894b1b` cannot validate the new #436 tip.
The delta updates API tests for the new Codex project write path and adds
create/delete persistence coverage. Full-suite validation is still needed.

### Bounded continuation plan

Repeated observation-only turns have not obtained a terminal test result.
This change adds a finite serial runner so the next validation can begin
when its predecessor actually exits, without another heartbeat launch.
It first waits for the existing #436 process and matching final result;
then validates pinned #436 `2fa95786`, #335 `49deb6c6`, the final pushed
foundation commit containing this runner, and main `72f296f0` in the
preserved clean clone. All runs use the same single-job, no-debug-info
profile and full workspace command with `AGHUB_SKIP_SIDECAR=1`.
The clean clone shares only the warmed build target, not source changes.

The runner never merges or pushes. It checks clean detached revisions
before checkout and again after testing. It records nonzero test exits
and continues with the next independent candidate. A missing predecessor
result, source change, or dirty workspace stops the queue. The local plan,
PID, output directory and actual launch status are recorded in the LoopX
foundation Todo after launch. No queued candidate is yet accepted.

The runner was tested with a temporary real Cargo/Git repository:

```text
PASS real Cargo queue: exit codes [0, 101, 0], pinned revisions and sidecar flag verified
PASS dirty workspace: blocked before checkout; source preserved
PASS used output: rejected; prior results unchanged
PASS predecessor: waits for process exit and matching result, then runs Cargo
PASS duplicate runner: rejected while first runner retains ownership
PASS missing predecessor result: blocked without starting Cargo
```

These checks validate evidence collection, not agHub. The #335 hash-error
review finding below remains open. The foundation Todo stays open until
its clean-clone full command exits successfully. Per-platform and sidecar
proof remains missing. See [runner instructions](docs/validation/README.md).

## 2026-09-15 — queue readback and issue #335 review

Main remains `72f296f0317a405f96a163246eebdc77d74c668d`.
The default fetch refspec still tracks only main. This pass ran both
`git fetch origin` and the explicit task-head fetch:

```sh
git fetch origin '+refs/heads/task/*:refs/remotes/origin/task/*'
git branch -r --no-merged origin/main | rg 'origin/task/'
```

Actual queue output:

```text
  origin/task/335-grok-worker-2
  origin/task/436-grok-worker-1
  origin/task/foundation-codex-judge
```

| Candidate at queue capture | Revision | Disposition |
| --- | --- | --- |
| `task/335-grok-worker-2` | `49deb6c6a82b8a54fb486f915c96fef492f75bd2` | Workspace run pending; review finding below |
| `task/436-grok-worker-1` | `d1894b1b5dd36b8e972823dc8e0b38f90cac7e75` | Existing workspace run still compiling |
| `task/foundation-codex-judge` | `b0dee587a92ced622af1d6a22af6107f239bc70a` | Workspace run pending; evidence changes require final-tip validation |

No duplicate issue branches were found. No branch was merged.
The judge worktree remains clean and detached at the tested #436 commit.
At `2026-09-15T08:33:13Z`, the existing supervisor and Cargo process
were both alive, with Cargo elapsed time `01:01:53`. Its only direct
compiler child was compiling `cranelift_codegen`; the final result file
was absent. No second judge build was started and the existing run was
not interrupted. The original command is:

```sh
RUSTC_WRAPPER= CARGO_BUILD_JOBS=1 CARGO_PROFILE_DEV_DEBUG=0 \
  CARGO_PROFILE_TEST_DEBUG=0 AGHUB_SKIP_SIDECAR=1 cargo test --workspace
```

Last eight log lines at this observation (compilation, not test results):

```text
   Compiling miniz_oxide v0.8.9
   Compiling gix-sec v0.14.2
   Compiling gtk v0.18.2
   Compiling async-trait v0.1.89
   Compiling base64 v0.23.1
   Compiling object v0.38.1
   Compiling leb128fmt v0.1.0
   Compiling wasm-encoder v0.245.1
```

### Issue #335: failed destination hashing can bypass edit protection

This is a **code-review finding**, not an executed reproduction or a
workspace failure. At the captured revision,
`crates/api/src/routes/skills.rs:659` converts a destination hash error
to `None` with `.ok()`. The local-edit guard uses `is_some_and`, so it
does not fire for that error. Execution then reaches
`replace_skill_dir_staged` at line 677, even with a tracked lock hash.

A concrete case to reproduce is a previously installed skill to which
the user adds a file larger than the snapshot's 128 MiB byte limit.
`crates/skill/src/snapshot.rs` enforces that limit; inability to hash
the destination must preserve its contents and return a visible error.
The worker should propagate the hash error before replacement and add
a regression that verifies the local file survives. Existing happy-path
update/skip tests do not cover this error path. The judge has not edited
the worker's source or changed any tests.

The attempted note write to the #335 Todo was rejected because it is
claimed by `grok-worker-2`. No claim or peer identity was changed. This
report and the judge-owned foundation Todo retain the review handoff.

### Continuation

Read the existing #436 final result and verify the actual process before
any checkout or new build. A live process is not a green test result.
When it exits, record the final code, duration and first 40 failure lines
if red. Then validate #335 and the final foundation tip sequentially in
the judge worktree. The clean-clone main baseline remains a separate
required run. Keep the foundation Todo open; full workspace, clean-clone,
desktop, sidecar, Windows and macOS proof remain missing.

## 2026-09-15 — issue #436 validation in progress

- Main: `72f296f0317a405f96a163246eebdc77d74c668d`.
- Explicit main/task fetch found two unmerged task branches:
  `task/436-grok-worker-1` at
  `d1894b1b5dd36b8e972823dc8e0b38f90cac7e75` and
  `task/foundation-codex-judge` at
  `01e59776692499ddba02e1e04187f546996819c8` (short revision `01e59776`).
- There are no duplicate issue branches in this queue snapshot.
- **Neither branch is merged.** Issue #436 is undergoing the full
  workspace command in the judge worktree, fixed at the commit above.
  The foundation candidate and clean-clone main baseline still require
  successful full runs afterward.

The prior foundation run has no final result file. Both PIDs recorded
in its continuation are absent; the surviving log ends with
`Compiling reqwest v0.13.4`. Its termination cause, final exit status,
and duration are unknown. Earlier statements that it was running were
observations at the time, not proof it survived into this pass.

The new issue #436 command started at `2026-09-15T07:31:21Z`:

```sh
RUSTC_WRAPPER= CARGO_BUILD_JOBS=1 CARGO_PROFILE_DEV_DEBUG=0 \
  CARGO_PROFILE_TEST_DEBUG=0 AGHUB_SKIP_SIDECAR=1 cargo test --workspace
```

The supervisor records the tested commit before starting Cargo and
captures its final return code and monotonic duration after exit. It is
running in a detached session, with on-disk start metadata and log files.
Its process and compilation output were observed after the launching
shell exited. The exact local continuation paths are in the LoopX Todo;
they are not public acceptance evidence.

Static inspection found three changed Rust files, no workflow changes,
and no removed failure assertions. The unsupported native-target test
now uses Openclaw because Codex gains a project skill write path. This
inspection does not establish a passing suite or real Codex app-server
compatibility.

Observed at `2026-09-15T07:41:34Z` after 613 seconds: Cargo
was running, and the final result file did not yet exist. Last ten log
lines (compilation only; local workspace path abbreviated):

```text
   Compiling termcolor v1.4.1
   Compiling pulley-interpreter v43.0.2
   Compiling skill v1.9.0-beta.1 (.../crates/skill)
   Compiling gix-lock v24.0.0
   Compiling jsonc-parser v0.33.1
   Compiling which v8.0.6
   Compiling hex v0.4.3
   Compiling cranelift-codegen-shared v0.130.2
   Compiling target-lexicon v0.13.5
   Compiling cranelift-codegen-meta v0.130.2
```

No failing-test set has been measured. Do not treat a
compile snapshot as a failure excerpt or a pass. If Cargo exits red,
record the first 40 failure lines and keep the branch unmerged. If green,
verify the remote tip and current main before integration. Desktop,
Windows/macOS and real sidecar proof remain missing.

## 2026-09-15 — admitted retry still compiling

- Main: `72f296f0317a405f96a163246eebdc77d74c668d`.
- Tested candidate: `task/foundation-codex-judge` at
  `1159d581cae68f5feb3301757c308de0ddce5e4a`.
- Explicit fetch of main and task heads found only this task branch;
  there were no duplicate issue branches to supersede.
- Disposition at `2026-09-15T07:04:03Z`: **not merged — missing proof**.
  Cargo was still running after 20 minutes 18 seconds. No test binary
  had reported results and no compiler error had been emitted.
- The process was left running to preserve compilation progress. There
  is no final exit status or total duration yet. This is not a failure
  verdict or a pass. Read the existing process result before starting
  another build or changing the candidate's Rust source.

Command actually running:

```sh
RUSTC_WRAPPER= CARGO_BUILD_JOBS=1 CARGO_PROFILE_DEV_DEBUG=0   CARGO_PROFILE_TEST_DEBUG=0 AGHUB_SKIP_SIDECAR=1 cargo test --workspace
```

Complete output at the observation (27 lines; no failure excerpt exists):

```text
   Compiling tauri-utils v2.9.3
   Compiling gio-sys v0.18.1
   Compiling faster-hex v0.10.0
   Compiling aws-lc-sys v0.39.1
   Compiling sha1 v0.10.6
   Compiling http-body v1.0.1
   Compiling aws-lc-rs v1.16.2
   Compiling ring v0.17.14
   Compiling gix-quote v0.8.0
   Compiling encoding_rs v0.8.35
   Compiling toml_datetime v1.1.1+spec-1.1.0
   Compiling foreign-types-shared v0.1.1
   Compiling rustls v0.23.37
   Compiling openssl v0.10.76
   Compiling openssl-probe v0.2.1
   Compiling toml_writer v1.1.1+spec-1.1.0
   Compiling foreign-types v0.3.2
   Compiling rustls-webpki v0.103.9
   Compiling sha1-checked v0.10.0
   Compiling openssl-sys v0.9.112
   Compiling h2 v0.4.13
   Compiling memmap2 v0.9.11
   Compiling openssl-macros v0.1.1
   Compiling pin-utils v0.1.0
   Compiling native-tls v0.2.18
   Compiling hyper v1.8.1
   Compiling gix-hash v0.26.2
   Compiling gdk-sys v0.18.2
   Compiling hashbrown v0.16.1
   Compiling bumpalo v3.20.2
   Compiling shell-words v1.1.1
   Compiling jiff v0.2.28
```

At that observation, `/proc/pressure/memory` reported
`some avg60=55.34` and `full avg60=36.63`. This measures builder memory
pressure, not a proven cause of any particular compiler delay. The
existing single-job profile and compiler cache directories were retained.
Only documentation was edited during the run; Rust sources, manifests,
configuration and tests still match the tested candidate.

### Admission and continuation

The previous selection blocker did not reproduce after the same Turn's
selection command supplied the real `--runtime-profile codex_cli`.
The result was `delivery_allowed=true`, matching settlement identity,
and `execution_context.valid=true`; no LoopX installation or stored
receipt was edited. The initial profile-less command had returned
`selection_required=true` with a missing execution context.

Todo `todo_78e9885160c8` remains open. First retrieve the running test's
result using the local continuation recorded in its note. If it passes,
validate the final documentation tip before integrating. Then run the
full command in the preserved clean baseline clone and record its exact
commit, final duration and result. If it fails, quote the first 40 failure
lines and leave the branch unmerged. Workspace, clean-clone, desktop,
sidecar, Windows and macOS acceptance remain unproven.

## 2026-09-15 — CLI selection blocks the next validation pass

- Main: `72f296f0317a405f96a163246eebdc77d74c668d`.
- Candidate: `task/foundation-codex-judge` at
  `0b8cd70ff3c25bf4a301ffc5fcc5393d3033d598`.
- Explicit main/task fetch succeeded; this remained the only unmerged
  task branch. There were no duplicate issue branches to supersede.
- Disposition: **not merged — missing proof**. No Cargo invocation ran
  in this pass. The current LoopX CLI rejected delivery through its
  selection contract; this is not a Rust build or test failure.
- Existing compile cache and runtime installation were left intact.

The initial guard and its exact selection follow-up both returned:

```text
ok=true
interaction_contract.agent_channel.must_attempt=true
interaction_contract.agent_channel.delivery_allowed=false
interaction_contract.cli_channel.selection_required=true
```

Executed selection command (same Turn identity as the initial guard):

```sh
loopx --format json quota should-run --goal-id aghub-goal \
  --todo-id todo_78e9885160c8 --agent-id codex-judge \
  --runtime-profile codex_cli --turn-instance-id 2026-09-15T06:32:56Z
```

`loopx doctor` reported `ok=True`, distribution version `1.0.3`, and
TypeScript runtime `ready`. Inspecting the installed Python command found
that `_requested_quota_action_todo_id` admits only the profiles in
`GUIDED_START_TURN_RUNTIME_PROFILES` (App heartbeat and App SSH). The
generated `codex_cli` selection command therefore discards `--todo-id`.
A read-only direct call of that function produced:

```text
codex_cli: requested_todo_id=None
codex_app_ssh_goal: requested_todo_id='todo_78e9885160c8'
codex_app_heartbeat: requested_todo_id='todo_78e9885160c8'
```

This diagnoses argument handling; it does not prove a runtime repair.
Do not impersonate another host profile or alter a persisted guard receipt.
Repair the CLI selection path for caller-owned Turn identities, with a
regression covering the real generated command and receipt binding. Then
verify `selection_required=false` and `delivery_allowed=true` before
resuming the preserved single-job workspace command below. Do not broaden
the separate `--begin-turn` profile set as a side effect.

The foundation Todo remains open with this continuation. This pass records
only diagnostic evidence and spends no delivery quota. The clean-clone,
full workspace, desktop and platform acceptance proofs remain missing.

## 2026-09-15 — foundation validation

- Main: `72f296f0317a405f96a163246eebdc77d74c668d`.
- Candidate: `task/foundation-codex-judge` at `3a6c70998472db3752b70a0401fac744dfcffd4c`.
- LoopX owner: `codex-judge`; Todo: `todo_78e9885160c8`.
- Disposition: **not merged — missing proof**. Both attempts were
  interrupted by the judge during compilation. No test failures or
  successful tests were measured; neither interruption is a compiler failure.
- Queue: a full-head fetch found this one unmerged task branch. Default
  fetch had a main-only refspec, so future passes must explicitly fetch
  main and task heads. No duplicate task branch was present in that snapshot.

## Executed commands and results

```sh
CARGO_BUILD_JOBS=1 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 AGHUB_SKIP_SIDECAR=1 cargo test --workspace
# Elapsed: 334.00 s; subprocess return code: -2 (judge SIGINT).

RUSTC_WRAPPER= CARGO_BUILD_JOBS=1 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 AGHUB_SKIP_SIDECAR=1 cargo test --workspace
# Elapsed: 1680.00 s; subprocess return code: -2 (judge SIGINT).
```

The first attempt was interrupted to probe slow progress through shared
sccache. The second was interrupted after 28 minutes in dependency
compilation under shared memory pressure. These are evidence limits;
there is no failing-test set to report. Source/tests/manifests were
unchanged; only validation documentation was edited while it ran.

There are no error lines to quote. The first 40 output lines from the
second attempt are preserved below, rather than labeled as a failure:

```text
   Compiling serde_core v1.0.228
   Compiling itoa v1.0.17
   Compiling pkg-config v0.3.32
   Compiling once_cell v1.21.4
   Compiling syn v3.0.2
   Compiling allocator-api2 v0.2.21
   Compiling thiserror v2.0.20
   Compiling thiserror-impl v2.0.20
   Compiling bitflags v2.13.1
   Compiling serde v1.0.228
   Compiling version_check v0.9.5
   Compiling foldhash v0.2.0
   Compiling stable_deref_trait v1.2.1
   Compiling regex-syntax v0.8.10
   Compiling smallvec v1.15.1
   Compiling bytes v1.11.1
   Compiling hashbrown v0.17.1
   Compiling aho-corasick v1.1.4
   Compiling heck v0.5.0
   Compiling jobserver v0.1.34
   Compiling find-msvc-tools v0.1.9
   Compiling shlex v1.3.0
   Compiling cc v1.2.57
   Compiling indexmap v2.14.0
   Compiling scopeguard v1.2.0
   Compiling lock_api v0.4.14
   Compiling parking_lot_core v0.9.12
   Compiling zmij v1.0.21
   Compiling fnv v1.0.7
   Compiling autocfg v1.5.0
   Compiling pin-project-lite v0.2.17
   Compiling crc32fast v1.5.0
   Compiling futures-core v0.3.32
   Compiling same-file v1.0.6
   Compiling walkdir v2.5.0
   Compiling typenum v1.20.0
   Compiling log v0.4.33
   Compiling synstructure v0.13.2
   Compiling getrandom v0.4.2
   Compiling zerofrom-derive v0.1.6
```

The final five output lines were:

```text
   Compiling kuchikiki v0.8.8-speedreader
   Compiling toml v1.1.2+spec-1.1.0
   Compiling plist v1.8.0
   Compiling serde_with v3.18.0
   Compiling tauri-utils v2.9.3
```

## Continuation

Keep the Todo open. Preserve the warmed judge target directory and rerun
the same direct single-job command after checking builder memory pressure.
Do not clear the merge gate until the complete workspace command exits
successfully. The clean-clone baseline remains unproven. Real desktop,
Windows/macOS, and sidecar execution proof also remain missing.

Environment, pressure observations, and the initial baseline failures are
recorded in [the validation contract](docs/builder-validation.md).
