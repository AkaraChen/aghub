# aghub - Code Agent Management Tool
# https://github.com/akarachen/aghub

set windows-shell := ["cmd.exe", "/c"]

# The ccusage sidecar is only needed for a real `tauri build` bundle. Workspace
# recipes (test/lint) build the desktop crate's build.rs too, which would
# otherwise fetch the sidecar from npm; skip it so the dev loop stays offline and
# needs no network. A real bundle runs `tauri build` directly, outside just.
export AGHUB_SKIP_SIDECAR := "1"

# aghub-v2 is a macOS-only GPUI app (its deps and code are gated on macOS), so
# workspace-wide checks skip it on other hosts to stay green on Linux/Windows.
aghub_v2_exclude := if os() == "macos" { "" } else { "--exclude aghub-v2" }

# Default recipe - build the CLI
default: build

# Build the CLI binary (aghub-cli)
build:
    cargo build --release -p aghub-cli

# Build for development
dev:
    cargo build -p aghub-cli

# Run all tests
test:
    cargo test --workspace {{aghub_v2_exclude}}

# Run integration tests only
integration-test:
    cargo test -p aghub-core --test integration_tests

# Run tests with agent validation (requires claude/opencode CLIs)
test-with-validation:
    cargo test --workspace --features agent-validation

# Format code
fmt:
	cargo fmt --all
	bun run format

# Run clippy linter
lint:
    cargo clippy --workspace {{aghub_v2_exclude}} -- -D warnings
    cd ./crates/desktop && nr lint

# Clean build artifacts
clean:
    cargo clean

# Install aghub-cli to ~/.cargo/bin
install: build
    cp target/release/aghub-cli ~/.cargo/bin/

# Run aghub-cli with --help
help: dev
    ./target/debug/aghub-cli --help

# Run with cargo (pass args: just start -- --arg)
start *args:
    cargo run -p aghub-cli -- {{args}}

desktop:
    cd ./crates/desktop && nr start

# Bump version across all manifests
bump version:
    sed -i '' 's/^version = .*/version = "{{version}}"/' Cargo.toml
    sed -i '' 's/"version": ".*"/"version": "{{version}}"/' crates/desktop/package.json
    sed -i '' 's/"version": ".*"/"version": "{{version}}"/' crates/desktop/src-tauri/tauri.conf.json || true
