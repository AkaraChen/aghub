# Integration record

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
