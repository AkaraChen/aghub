# aghub - Code Agent Management Tool
# https://github.com/akarachen/aghub

set windows-shell := ["cmd.exe", "/c"]

# Default recipe - build the CLI
default: build

# Build the CLI binary (aghub-cli)
build:
    cargo build --release -p aghub-cli

# Build for development
dev:
    cargo build -p aghub-cli

# Fetch the ccusage sidecar binary for the current target triple (idempotent;
# skips if already present). Required before compiling the desktop crate:
# tauri-build validates the externalBin path at build time and the binary is
# gitignored, so CI / fresh clones must fetch it first.
_fetch-ccusage:
    node scripts/fetch-ccusage.mjs

# Run all tests
test: _fetch-ccusage
    cargo test --workspace

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
lint: _fetch-ccusage
    cargo clippy --workspace -- -D warnings
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
