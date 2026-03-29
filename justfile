# aghub - Code Agent Management Tool
# https://github.com/akarachen/aghub

# Default recipe - build the CLI
default: build

# Build the CLI binary (agentctl)
build:
    cargo build --release -p aghub-cli

# Build for development
dev:
    cargo build -p aghub-cli

# Run all tests
test:
    cargo test --workspace

# Run integration tests only
integration-test:
    cargo test -p aghub-core --test integration_tests

# Run tests with agent validation (requires claude/opencode CLIs)
test-with-validation:
    cargo test --workspace --features agent-validation

# Format code
fmt:
    fama

# Run clippy linter
lint:
    cargo clippy --workspace -- -D warnings
    cd ./crates/desktop && nr lint

# Clean build artifacts
clean:
    cargo clean

# Install agentctl to ~/.cargo/bin
install: build
    cp target/release/agentctl ~/.cargo/bin/

# Run agentctl with --help
help: dev
    ./target/debug/agentctl --help

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

