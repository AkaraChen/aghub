---
name: init-deep
description: Generate hierarchical AGENTS.md and ensure paired CLAUDE.md files for codebases. Creates root AGENTS.md + CLAUDE.md plus complexity-scored subdirectory files. Use when user asks to "generate AGENTS.md files", "create codebase knowledge base", "run /init-deep", or wants comprehensive project documentation. Supports update mode (default) and --create-new flag to regenerate from scratch.
---

# /init-deep

Generate hierarchical AGENTS.md files. Ensure every AGENTS.md has a paired CLAUDE.md (and vice versa) via symlinks. Root + complexity-scored subdirectories + all monorepo packages.

## Usage

```
/init-deep                      # Update mode: modify existing + create new where warranted
/init-deep --create-new         # Read existing → remove all → regenerate from scratch
/init-deep --max-depth=2        # Limit directory depth (default: 3)
```

---

## Workflow (High-Level)

1. **Discovery + Analysis** (concurrent)
   - Fire background explore agents immediately
   - Main session: bash structure + LSP codemap + read existing AGENTS.md and CLAUDE.md
2. **Score & Decide** - Determine AGENTS.md/CLAUDE.md locations from merged findings
3. **Generate** - Root first, then subdirs in parallel
4. **Review** - Deduplicate, trim, validate, ensure pairs

<critical>
**TodoWrite ALL phases. Mark in_progress → completed in real-time.**
```
TodoWrite([
  { id: "discovery", content: "Fire explore agents + LSP codemap + read existing AGENTS.md and CLAUDE.md", status: "pending", priority: "high" },
  { id: "scoring", content: "Score directories, determine locations + monorepo packages", status: "pending", priority: "high" },
  { id: "generate", content: "Generate AGENTS.md + CLAUDE.md files (root + subdirs)", status: "pending", priority: "high" },
  { id: "review", content: "Deduplicate, validate, trim, ensure file pairs", status: "pending", priority: "medium" }
])
```
</critical>

---

## Phase 1: Discovery + Analysis (Concurrent)

**Mark "discovery" as in_progress.**

### Fire Background Explore Agents IMMEDIATELY

Don't wait—these run async while main session works.

```
// Fire all at once, collect results later
task(subagent_type="explore", load_skills=[], description="Explore project structure", run_in_background=true, prompt="Project structure: PREDICT standard patterns for detected language → REPORT deviations only")
task(subagent_type="explore", load_skills=[], description="Find entry points", run_in_background=true, prompt="Entry points: FIND main files → REPORT non-standard organization")
task(subagent_type="explore", load_skills=[], description="Find conventions", run_in_background=true, prompt="Conventions: FIND config files (.eslintrc, pyproject.toml, .editorconfig) → REPORT project-specific rules")
task(subagent_type="explore", load_skills=[], description="Find anti-patterns", run_in_background=true, prompt="Anti-patterns: FIND 'DO NOT', 'NEVER', 'ALWAYS', 'DEPRECATED' comments → LIST forbidden patterns")
task(subagent_type="explore", load_skills=[], description="Explore build/CI", run_in_background=true, prompt="Build/CI: FIND .github/workflows, Makefile → REPORT non-standard patterns")
task(subagent_type="explore", load_skills=[], description="Find test patterns", run_in_background=true, prompt="Test patterns: FIND test configs, test structure → REPORT unique conventions")
```

<dynamic-agents>
**DYNAMIC AGENT SPAWNING**: After bash analysis, spawn ADDITIONAL explore agents based on project scale:

| Factor                       | Threshold | Additional Agents          |
| ---------------------------- | --------- | -------------------------- |
| **Total files**              | >100      | +1 per 100 files           |
| **Total lines**              | >10k      | +1 per 10k lines           |
| **Directory depth**          | ≥4        | +2 for deep exploration    |
| **Large files (>500 lines)** | >10 files | +1 for complexity hotspots |
| **Monorepo**                 | detected  | +1 per package/workspace   |
| **Multiple languages**       | >1        | +1 per language            |

```bash
# Measure project scale first
total_files=$(find . -type f -not -path '*/node_modules/*' -not -path '*/.git/*' | wc -l)
total_lines=$(find . -type f \( -name "*.ts" -o -name "*.py" -o -name "*.go" \) -not -path '*/node_modules/*' -exec wc -l {} + 2>/dev/null | tail -1 | awk '{print $1}')
large_files=$(find . -type f \( -name "*.ts" -o -name "*.py" \) -not -path '*/node_modules/*' -exec wc -l {} + 2>/dev/null | awk '$1 > 500 {count++} END {print count+0}')
max_depth=$(find . -type d -not -path '*/node_modules/*' -not -path '*/.git/*' | awk -F/ '{print NF}' | sort -rn | head -1)
```

Example spawning:

```
// 500 files, 50k lines, depth 6, 15 large files → spawn 5+5+2+1 = 13 additional agents
task(subagent_type="explore", load_skills=[], description="Analyze large files", run_in_background=true, prompt="Large file analysis: FIND files >500 lines, REPORT complexity hotspots")
task(subagent_type="explore", load_skills=[], description="Explore deep modules", run_in_background=true, prompt="Deep modules at depth 4+: FIND hidden patterns, internal conventions")
task(subagent_type="explore", load_skills=[], description="Find shared utilities", run_in_background=true, prompt="Cross-cutting concerns: FIND shared utilities across directories")
// ... more based on calculation
```

</dynamic-agents>

### Main Session: Concurrent Analysis

**While background agents run**, main session does:

#### 1. Bash Structural Analysis

```bash
# Directory depth + file counts
find . -type d -not -path '*/\.*' -not -path '*/node_modules/*' -not -path '*/venv/*' -not -path '*/dist/*' -not -path '*/build/*' | awk -F/ '{print NF-1}' | sort -n | uniq -c

# Files per directory (top 30)
find . -type f -not -path '*/\.*' -not -path '*/node_modules/*' | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -30

# Code concentration by extension
find . -type f \( -name "*.py" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.go" -o -name "*.rs" \) -not -path '*/node_modules/*' | sed 's|/[^/]*$||' | sort | uniq -c | sort -rn | head -20

# Existing AGENTS.md / CLAUDE.md
find . -type f \( -name "AGENTS.md" -o -name "CLAUDE.md" \) -not -path '*/node_modules/*' 2>/dev/null

# Monorepo detection (package directories)
find . \( -name "package.json" -o -name "pyproject.toml" -o -name "Cargo.toml" -o -name "go.mod" \) -not -path '*/node_modules/*' -not -path '*/.git/*' | sed 's|/[^/]*$||' | sort | uniq
```

#### 2. Read Existing AGENTS.md and CLAUDE.md

For each directory where either AGENTS.md or CLAUDE.md exists:

```
agents_exists = file exists at {dir}/AGENTS.md
claude_exists = file exists at {dir}/CLAUDE.md

If agents_exists AND claude_exists:
  Read both files
  Merge their contents into EXISTING_AGENTS map for that directory
Else if agents_exists AND NOT claude_exists:
  Read AGENTS.md
  Create symlink: ln -s AGENTS.md CLAUDE.md (or ln -s CLAUDE.md AGENTS.md if you prefer; standard: ln -s AGENTS.md CLAUDE.md)
Else if claude_exists AND NOT agents_exists:
  Read CLAUDE.md
  Create symlink: ln -s CLAUDE.md AGENTS.md
```

<critical>
If `--create-new`: Read all existing first (preserve context) → delete all AGENTS.md and CLAUDE.md + their symlinks → regenerate.
</critical>

#### 3. LSP Codemap (if available)

```
LspServers()  # Check availability

# Entry points (parallel)
LspDocumentSymbols(filePath="src/index.ts")
LspDocumentSymbols(filePath="main.py")

# Key symbols (parallel)
LspWorkspaceSymbols(filePath=".", query="class")
LspWorkspaceSymbols(filePath=".", query="interface")
LspWorkspaceSymbols(filePath=".", query="function")

# Centrality for top exports
LspFindReferences(filePath="...", line=X, character=Y)
```

**LSP Fallback**: If unavailable, rely on explore agents + AST-grep.

### Collect Background Results

```
// After main session analysis done, collect all task results
for each task_id: background_output(task_id="...")
```

**Merge: bash + LSP + existing + explore findings. Mark "discovery" as completed.**

---

## Phase 2: Scoring & Location Decision

**Mark "scoring" as in_progress.**

### Scoring Matrix

| Factor               | Weight | High Threshold           | Source  |
| -------------------- | ------ | ------------------------ | ------- |
| File count           | 3x     | >20                      | bash    |
| Subdir count         | 2x     | >5                       | bash    |
| Code ratio           | 2x     | >70%                     | bash    |
| Unique patterns      | 1x     | Has own config           | explore |
| Module boundary      | 2x     | Has index.ts/**init**.py | bash    |
| Symbol density       | 2x     | >30 symbols              | LSP     |
| Export count         | 2x     | >10 exports              | LSP     |
| Reference centrality | 3x     | >20 refs                 | LSP     |

### Monorepo Rule

**Every monorepo package directory MUST have an AGENTS.md + CLAUDE.md pair, regardless of score.**

Detect packages via:

- `package.json` in subdirectories (Node/Yarn/npm workspaces, pnpm)
- `pyproject.toml` with `[tool.poetry]` or `[project]`
- `Cargo.toml` (Rust workspace member)
- `go.mod` (Go module)

Add all unique package directories to `AGENTS_LOCATIONS` with `type: "package"`.

### Decision Rules

| Score                | Action                       |
| -------------------- | ---------------------------- |
| **Root (.)**         | ALWAYS create                |
| **Monorepo package** | ALWAYS create                |
| **>15**              | Create AGENTS.md + CLAUDE.md |
| **8-15**             | Create if distinct domain    |
| **<8**               | Skip (parent covers)         |

### Output

```
AGENTS_LOCATIONS = [
  { path: ".", type: "root" },
  { path: "packages/core", type: "package", score: null, reason: "monorepo package" },
  { path: "src/hooks", score: 18, reason: "high complexity" },
  { path: "src/api", score: 12, reason: "distinct domain" }
]
```

**Mark "scoring" as completed.**

---

## Phase 3: Generate AGENTS.md & CLAUDE.md

**Mark "generate" as in_progress.**

<critical>
**File Writing Rule**:
- If AGENTS.md already exists at the target path → use `Edit` tool.
- If AGENTS.md does NOT exist → use `Write` tool.
- NEVER use Write to overwrite an existing file. ALWAYS check existence first via `Read` or discovery results.
- After writing AGENTS.md, ensure CLAUDE.md exists in the same directory. If missing, create it as a symlink to AGENTS.md.
- If both files already exist and both are regular files (not symlinks), merge their content mentally and then use `Edit` to update both to the merged content.
</critical>

### Pairing Rules Per Directory

For every location in `AGENTS_LOCATIONS`:

1. **Generate AGENTS.md** content using the templates below.
2. **Ensure CLAUDE.md exists** in the same directory:
   - If **neither exists**: Write AGENTS.md, then `ln -s AGENTS.md CLAUDE.md`
   - If **only AGENTS.md exists**: `ln -s AGENTS.md CLAUDE.md`
   - If **only CLAUDE.md exists**: `mv CLAUDE.md AGENTS.md`, then `ln -s AGENTS.md CLAUDE.md`
   - If **both exist as regular files**: Merge content from both, then use `Edit` to update both to the merged content.

**Preferred approach**: Write AGENTS.md as the canonical file, then `ln -s AGENTS.md CLAUDE.md` in all cases where no conflict exists.

### Root AGENTS.md (Full Treatment)

```markdown
# PROJECT KNOWLEDGE BASE

**Generated:** {TIMESTAMP}
**Commit:** {SHORT_SHA}
**Branch:** {BRANCH}

## OVERVIEW

{1-2 sentences: what + core stack}

## STRUCTURE
```

{root}/
├── {dir}/ # {non-obvious purpose only}
└── {entry}

```
## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|

## CODE MAP
{From LSP - skip if unavailable or project <10 files}

| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|

## CONVENTIONS
{ONLY deviations from standard}

## ANTI-PATTERNS (THIS PROJECT)
{Explicitly forbidden here}

## UNIQUE STYLES
{Project-specific}

## COMMANDS
```

{dev/test/build}

```
## NOTES
{Gotchas}
```

**Quality gates**: 50-150 lines, no generic advice, no obvious info.

### Monorepo Package AGENTS.md

Same structure as root but scoped to the package:

- Mention package name and its role in the monorepo
- Link to root AGENTS.md for global conventions
- 30-80 lines max

### Subdirectory AGENTS.md (Parallel)

Launch writing tasks for each location:

```
for loc in AGENTS_LOCATIONS (except root):
  task(category="writing", load_skills=[], run_in_background=false, description="Generate AGENTS.md", prompt=`
    Generate AGENTS.md for: ${loc.path}
    - Type: ${loc.type} (package | subdir)
    - Reason: ${loc.reason}
    - 30-80 lines max
    - NEVER repeat parent content
    - Sections: OVERVIEW (1 line), STRUCTURE (if >5 subdirs), WHERE TO LOOK, CONVENTIONS (if different), ANTI-PATTERNS
    If type is "package", include the package's role in the monorepo and link to root conventions.
  `)
```

After each AGENTS.md is written, run the pairing check to ensure CLAUDE.md exists (create symlink if missing).

**Wait for all. Mark "generate" as completed.**

---

## Phase 4: Review & Deduplicate

**Mark "review" as in_progress.**

For each generated file:

- Remove generic advice
- Remove parent duplicates
- Trim to size limits
- Verify telegraphic style
- **Verify every AGENTS.md has a paired CLAUDE.md in the same directory**
- Fix any missing symlinks

**Mark "review" as completed.**

---

## Final Report

```
=== init-deep Complete ===

Mode: {update | create-new}

Files:
  [OK] ./AGENTS.md (root, {N} lines)
  [OK] ./CLAUDE.md → symlinked to ./AGENTS.md
  [OK] ./packages/core/AGENTS.md ({N} lines)
  [OK] ./packages/core/CLAUDE.md → symlinked to ./AGENTS.md
  [OK] ./src/hooks/AGENTS.md ({N} lines)
  [OK] ./src/hooks/CLAUDE.md → symlinked to ./AGENTS.md

Dirs Analyzed: {N}
AGENTS.md Created: {N}
CLAUDE.md Created: {N}
Pairs Ensured: {N}

Hierarchy:
  ./AGENTS.md
  ├── packages/core/AGENTS.md
  └── src/hooks/AGENTS.md
```

---

## Anti-Patterns

- **Static agent count**: MUST vary agents based on project size/depth
- **Sequential execution**: MUST parallel (explore + LSP concurrent)
- **Ignoring existing**: ALWAYS read existing first, even with --create-new
- **Over-documenting**: Not every dir needs AGENTS.md (except monorepo packages)
- **Redundancy**: Child never repeats parent
- **Generic content**: Remove anything that applies to ALL projects
- **Verbose style**: Telegraphic or die
- **Orphan files**: NEVER leave AGENTS.md without CLAUDE.md in the same directory
