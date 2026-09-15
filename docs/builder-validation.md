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

Validation is in progress. No passing baseline is claimed.

The initial command was `AGHUB_SKIP_SIDECAR=1 cargo test --workspace`.
It was interrupted with SIGINT after **123.93 seconds** when the clone
was found to be on tmpfs and available machine memory was about 1.1 GiB.
The subprocess return code was `-2`; no test result was produced.
The clean source clone was then moved onto disk and the same workspace
command restarted with `CARGO_BUILD_JOBS=2`.

## Integration decision

The initial `git fetch origin` succeeded. Running
`git branch -r --no-merged origin/main` returned no branches, so there
were no task candidates to test or merge in that pass.

For subsequent candidates:

1. Fetch and record the remote task branch tip and current `origin/main`.
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
