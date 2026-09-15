# Builder validation contract

## Purpose and acceptance

Every integration candidate must pass the full Rust workspace test command
on its exact commit. Record the commit, command, environment, elapsed time,
exit status, and failing test names before deciding whether to merge.
A compile failure or interrupted run is incomplete proof, never a pass.

The first baseline uses `origin/main` at
`72f296f0317a405f96a163246eebdc77d74c668d`. The foundation checkpoint has no
GitHub issue number; its evidence branch is `task/foundation-codex-judge`.
LoopX Todo `todo_78e9885160c8` owns the checkpoint and continuation state.

## Reproduction

Use a clean clone on a disk-backed filesystem. The builder's `/tmp` is
tmpfs and consumes RAM; do not put a workspace build there.

```sh
export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$HOME/.local/share/fnm/node-versions/v24.20.0/installation/bin:$PATH"
git clone https://github.com/AkaraChen/aghub.git aghub-baseline
cd aghub-baseline
git checkout --detach 72f296f0317a405f96a163246eebdc77d74c668d
git status --porcelain
export CARGO_BUILD_JOBS=2
AGHUB_SKIP_SIDECAR=1 cargo test --workspace
```

`git status --porcelain` must be empty before building. The recorded run
used a local `git clone --no-hardlinks --no-checkout` of the fetched
repository, followed by the exact detached checkout above. No ignored
files, build artifacts, or local configuration were copied into the clone.
The machine's Cargo dependency and sccache caches remain available, so
this is a clean source baseline, not a measurement of cold network caches.

Limiting build jobs changes concurrency, not the test selection. Keep the
workspace member set, assertions, and test features unchanged. Do not use
package-only runs as evidence that the full integration gate passed.

For a memory-constrained retry, record these environment overrides with
the result:

```sh
CARGO_BUILD_JOBS=1 CARGO_PROFILE_DEV_DEBUG=0 \
  CARGO_PROFILE_TEST_DEBUG=0 AGHUB_SKIP_SIDECAR=1 cargo test --workspace
```

The debug profile settings disable debug information, not debug
assertions or tests. They change the build fingerprint, so expect
dependency recompilation. To investigate interference from the shared
compiler cache, prefix the same command with `RUSTC_WRAPPER=`. This
disables the wrapper for that invocation without stopping the shared
sccache server. Record each attempt separately, including interruption
and its reason; do not combine partial runs into a passing result.

The repository enables `sccache` in `.cargo/config.toml`. Linux workspace
builds include the Tauri crate and require the native development packages
listed in `.github/workflows/ci.yml`: `libgtk-3-dev`,
`libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, and
`patchelf`. Installing dependencies is separate from testing.

`AGHUB_SKIP_SIDECAR=1` prevents the build script from downloading ccusage
and permits an empty sidecar placeholder. A passing run with this setting
does not validate ccusage execution or a distributable desktop bundle.

## Observed environment — 2026-09-15

| Component | Observed value |
| --- | --- |
| OS / architecture | Ubuntu 26.04.1 LTS / Linux x86_64 |
| Rust | `rustc 1.97.1 (8bab26f4f 2026-07-14)` |
| Cargo | `cargo 1.97.1 (c980f4866 2026-06-30)` |
| Node / Bun | `v24.20.0` / `1.4.2` |
| GTK (`pkg-config`) | `3.24.52` |
| WebKitGTK / JavaScriptCoreGTK (`pkg-config`) | `2.52.6` / `2.52.6` |
| Machine RAM / swap | 15 GiB / no swap |

## Baseline evidence

**Baseline failed during compilation; no passing baseline is claimed.**

| Attempt | Command | Elapsed | Result |
| --- | --- | --- | --- |
| Initial tmpfs clone | `AGHUB_SKIP_SIDECAR=1 cargo test --workspace` | 123.93 s | Interrupted with SIGINT; subprocess return code `-2` |
| Disk-backed clone | `CARGO_BUILD_JOBS=2 AGHUB_SKIP_SIDECAR=1 cargo test --workspace` | 541.45 s | Cargo exit `101`; compiler killed by signal 9 |

The initial command was `AGHUB_SKIP_SIDECAR=1 cargo test --workspace`.
It was interrupted with SIGINT after **123.93 seconds** when the clone
was found to be on tmpfs and available machine memory was about 1.1 GiB.
The subprocess return code was `-2`; no test result was produced.
The clean source clone was then moved onto disk and the same workspace
command restarted with `CARGO_BUILD_JOBS=2`.

The second run produced these exact diagnostic lines:

```text
sccache: Compiler killed by signal 9
error: could not compile `cranelift-codegen` (lib)
```

Cargo also reported the compiler-wrapper exit status as `254` and printed:

```text
warning: build failed, waiting for other jobs to finish...
```

The failing dependency is `cranelift-codegen 0.130.2`. No test binaries ran,
so the failing-test set is **not measured**, rather than empty or passing.
The source worktree remained clean after the failed run. Memory pressure
is a plausible cause of signal 9 on this shared builder, but the compiler
diagnostic alone does not establish an OOM kill.

The checkpoint remains open. The next attempt should reuse the disk-backed
clone and cached artifacts, reduce `CARGO_BUILD_JOBS` to `1`, and run the
same full workspace command when adequate memory is available. If it still
fails, record the new failure before proposing changes to the build
profile or builder resources. No tests, assertions, or workflows were
changed for these attempts.

## Integration retry — 2026-09-15

The subsequent pass at foundation commit
`0b8cd70ff3c25bf4a301ffc5fcc5393d3033d598` did not start Cargo: LoopX
1.0.3 generated a `codex_cli` selection command but ignored its requested
Todo, leaving delivery prohibited. See the latest `INTEGRATION.md` entry
for the actual command, output and isolated argument-handling reproduction.
Repair and verify the CLI selection contract before resuming the command
below. The prior compilation attempts remain incomplete evidence.

The judge retried the full workspace on the foundation branch at
`3a6c70998472db3752b70a0401fac744dfcffd4c`, using a disk-backed worktree.
Rust source and tests matched the recorded main baseline; the branch
contained the validation document. Documentation corrections made during
the retry did not change Rust source, manifests, configuration, or tests.

The first retry used:

```sh
CARGO_BUILD_JOBS=1 CARGO_PROFILE_DEV_DEBUG=0 \
  CARGO_PROFILE_TEST_DEBUG=0 AGHUB_SKIP_SIDECAR=1 cargo test --workspace
```

After **334.00 seconds**, the judge interrupted this attempt with SIGINT
to investigate slow progress through the shared compiler cache. The
subprocess return code was **-2**. Its complete output was:

```text
    Blocking waiting for file lock on package cache
   Compiling unicode-ident v1.0.24
   Compiling quote v1.0.45
   Compiling proc-macro2 v1.0.106
   Compiling syn v2.0.117
   Compiling serde v1.0.228
   Compiling serde_derive v1.0.228
   Compiling equivalent v1.0.2
   Compiling serde_core v1.0.228
   Compiling cfg-if v1.0.4
   Compiling memchr v2.8.0
   Compiling libc v0.2.189
```

No test result was produced. The log does not establish a cache defect.
Only the Cargo process in the judge worktree was interrupted; the shared
cache server and other workers' builds were left running.

The second retry bypassed only the compiler wrapper:

```sh
RUSTC_WRAPPER= CARGO_BUILD_JOBS=1 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 AGHUB_SKIP_SIDECAR=1 cargo test --workspace
```

It ran for **1680.00 seconds (28 minutes)** before the judge
sent SIGINT to end this bounded attempt; the subprocess return code was
**-2**. The last output was:

```text
   Compiling kuchikiki v0.8.8-speedreader
   Compiling toml v1.1.2+spec-1.1.0
   Compiling plist v1.8.0
   Compiling serde_with v3.18.0
   Compiling tauri-utils v2.9.3
```

No test binary ran and no compiler error was emitted. This is **incomplete
validation**, not a failing-test verdict or a pass. At one observation,
`/proc/pressure/memory` reported `full avg60=35.24`; immediately before
interruption it reported `full avg60=24.49`. The machine had no swap and
about 1.1–2.5 GiB available memory during the attempt. This establishes
shared resource pressure, not the cause of the earlier SIGKILL or a
specific compiler-cache bug.

Both retries retained all tests and assertions. The warmed target directory
is preserved. Next: inspect memory headroom and pressure, then resume the
same direct, single-job command in the judge worktree without changing
profiles again. Obtain a complete exit result before integration, then
finish the clean-clone baseline checkpoint. No branch was merged in this
pass. See `INTEGRATION.md` for the candidate disposition and output excerpt.

## Integration decision

The initial `git fetch origin` succeeded and
`git branch -r --no-merged origin/main` returned no branches. A subsequent
inspection found that the configured fetch refspec tracked only `main`;
that empty local list did not prove that no remote task branches existed.
Fetch task heads explicitly before interpreting the integration queue:

```sh
git fetch origin '+refs/heads/main:refs/remotes/origin/main' \
  '+refs/heads/task/*:refs/remotes/origin/task/*'
git branch -r --no-merged origin/main | rg 'origin/task/'
```

The corrective full-head fetch on 2026-09-15 found one unmerged task
branch: `task/foundation-codex-judge` at
`3a6c70998472db3752b70a0401fac744dfcffd4c`. The main tip was still
`72f296f0317a405f96a163246eebdc77d74c668d`.

For subsequent candidates:

1. Fetch main and task heads explicitly, then record the remote task
   branch tip and current `origin/main`.
2. Check out the candidate in the judge's worktree and run
   `AGHUB_SKIP_SIDECAR=1 cargo test --workspace` to completion.
3. If red, leave the candidate unmerged. Record the first 40 lines of the
   failure in `INTEGRATION.md` and attach the failure to its LoopX Todo.
   Review public excerpts for credentials or private paths before pushing.
4. If green, perform the authorized integration. If current main has
   changed independently, validate the resulting combination before push.
5. For duplicate task branches for one issue, integrate only one and
   record the alternatives as superseded.

## Missing proof

Rust workspace tests do not establish desktop appearance, interaction
inside a real WebView, system tray behavior, Windows selection rendering,
macOS DMG installation, or real ccusage sidecar behavior. These require
their own evidence on the relevant platform. Headless Linux results must
retain `missing proof` for those acceptance conditions.
