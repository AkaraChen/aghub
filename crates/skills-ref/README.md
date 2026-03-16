# skills-ref

A Rust reference library for Agent Skills - parsing and validating SKILL.md files.

## Overview

This crate is a Rust port/fork of the Python [skills-ref](https://github.com/agentskills/agentskills/tree/main/skills-ref) library from the [agentskills](https://github.com/agentskills/agentskills) specification.

It provides functionality to:

- Parse SKILL.md files with YAML frontmatter
- Validate skill properties against the Agent Skills specification
- Generate `<available_skills>` XML blocks for agent system prompts

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
skills-ref = { path = "../crates/skills-ref" }
```

## Usage

### Library

```rust
use skills_ref::{read_properties, validate, to_prompt};
use std::path::Path;

// Read skill properties from a directory
let props = read_properties(Path::new("/path/to/skill"))?;
println!("Skill name: {}", props.name);

// Validate a skill directory
let errors = validate(Path::new("/path/to/skill"));
if errors.is_empty() {
    println!("Skill is valid!");
}

// Generate XML prompt for multiple skills
let xml = to_prompt(&[Path::new("/path/to/skill1").to_path_buf()])?;
println!("{}", xml);
```

### CLI

The crate also provides a CLI tool:

```bash
# Validate a skill directory
cargo run -p skills-ref -- validate /path/to/skill

# Read skill properties as JSON
cargo run -p skills-ref -- read-properties /path/to/skill

# Generate XML prompt for one or more skills
cargo run -p skills-ref -- to-prompt /path/to/skill1 /path/to/skill2
```

## SKILL.md Format

A valid SKILL.md file has YAML frontmatter between `---` markers:

```yaml
---
name: my-skill
description: What this skill does and when to use it
license: MIT
compatibility: Requires Python 3.11+
allowed-tools: Bash(git:*) Bash(jq:*)
metadata:
  author: Your Name
  version: "1.0"
---

# Skill Documentation

Detailed instructions here...
```

### Validation Rules

- `name` (required): Must be lowercase, alphanumeric with hyphens only. Max 64 chars.
- `description` (required): Max 1024 characters.
- `license` (optional): License identifier.
- `compatibility` (optional): Max 500 characters.
- `allowed-tools` (optional): Tool patterns the skill requires.
- `metadata` (optional): Key-value pairs for custom properties.

Names support i18n (Unicode letters) and are NFKC normalized.

## License

MIT
