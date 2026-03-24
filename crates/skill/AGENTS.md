# SKILL CRATE KNOWLEDGE BASE

**Crate**: skill — Skill packaging library for `.skill` (zip) format

## OVERVIEW

Pack, unpack, parse, and validate AI agent skill packages. Extends skills-ref with zip-based packaging and lock file management for tracking skill dependencies with content hashes.

## STRUCTURE

```
src/
├── lib.rs           # Public exports (Skill, SkillError, pack, unpack, parse, validate)
├── error.rs         # SkillError enum with thiserror
├── model.rs         # Skill struct, SkillSource enum
├── package.rs       # pack(), unpack(), read_skill_md() — zip I/O
├── parser.rs        # parse() auto-detects format; parse_skill_md, parse_skill_dir, parse_skill_file
├── validator.rs     # validate() with path traversal protection
├── sanitize.rs      # sanitize_name() for safe directory names
└── lock/            # Lock file management
    ├── global.rs    # ~/.config/aghub/skills-lock.json
    ├── local.rs     # .claude/skills-lock.json (project-local)
    └── test_utils.rs # Mutex-based test isolation
```

## WHERE TO LOOK

| Task | File | Notes |
|------|------|-------|
| Pack skill to .skill | `src/package.rs:87` | Excludes __pycache__, node_modules, .git, tests/ at root |
| Parse any format | `src/parser.rs:276` | Auto-detects directory, .skill, .zip, .md |
| Validate skill | `src/validator.rs:71` | Checks for path traversal (`..`) in resources |
| Sanitize name | `src/sanitize.rs:21` | Converts "My Skill!" → "my-skill" |
| Global lock ops | `src/lock/global.rs` | Per-user skill registry |
| Local lock ops | `src/lock/local.rs` | Per-project skill registry |

## COMMANDS

```bash
# Build this crate only
cargo build -p skill

# Test with test isolation (uses mutex for lock file tests)
cargo test -p skill
```

## CONVENTIONS

- **Skill name rules**: lowercase, hyphens not spaces, no `..` in paths
- **Required field**: `name` and `description` in SKILL.md frontmatter (rejected if non-string)
- **Source path**: `~` prefix for home-relative paths
- **Lock entries**: Track `content_hash` (SHA-256) for integrity

## ANTI-PATTERNS

- **NEVER** use non-string frontmatter values for `name`/`description` (rejected by parser)
- **NEVER** allow `..` in resource paths (validated in `validate_skill_structure`)
- **NEVER** write lock tests without `with_test_lock()` mutex guard (prevents test flakiness)
- **NEVER** pack `tests/` or `evals/` at skill root (intentionally excluded)
