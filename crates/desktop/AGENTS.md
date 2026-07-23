# DESKTOP CRATE KNOWLEDGE BASE

**Crate**: `aghub-desktop` — Tauri v2 desktop application\
**Stack**: React 19 + TypeScript 5.8 + HeroUI v3 + Tailwind CSS v4\
**Package Manager**: bun (REQUIRED)

## STRUCTURE

```
crates/desktop/
├── src/                      # React frontend
│   ├── main.tsx             # Entry point
│   ├── App.tsx              # Root component
│   ├── pages/               # Route pages
│   ├── components/          # Reusable components
│   ├── lib/                 # Utilities
│   └── assets/              # Static assets
├── src-tauri/               # Tauri backend (Rust)
│   ├── src/
│   │   └── lib.rs          # Tauri commands
│   ├── Cargo.toml
│   ├── tauri.conf.json     # Tauri configuration
│   └── capabilities/        # Permission manifests
├── package.json
├── vite.config.ts          # Vite + Tauri integration
├── tsconfig.json           # TypeScript config
└── AGENTS.md               # This file
```

## CRITICAL: HEROUI V3

**STOP**: What you remember about HeroUI React v3 is WRONG for this project.

### v3 Differences (vs v2):

- **NO Provider needed** — was required in v2
- Compound components pattern (not flat props)
- Tailwind CSS v4 (not v3)
- Package: `@heroui/react@beta` (not `@heroui/system`)

### Before Any UI Task:

1. Search docs in `../../.heroui-docs/react/`
2. If docs missing, run: `heroui agents-md --react --output AGENTS.md`

## COMMANDS

```bash
# Frontend development
cd crates/desktop
bun run dev          # Vite dev server (port 1420)
bun run start        # Tauri dev mode

# Building
bun run build        # Production build

# Tauri-specific
bun run tauri dev    # Tauri dev with hot reload
bun run tauri build  # Build Tauri app
```

## CONVENTIONS

### Package Management

- **ALWAYS use `bun`** — never npm/yarn/pnpm
- Documented in CLAUDE.md: "Always use `bun` for package management"

### UI Development

- **ALWAYS use HeroUI v3** components
- **ALWAYS check HeroUI v3 docs** before implementing
- Tailwind v4 utility classes
- Strict TypeScript (`strict: true`, `noUnusedLocals: true`)

### Vite Configuration

- Port: 1420 (strict)
- HMR port: 1421 (when TAURI_DEV_HOST set)
- `src-tauri/**` excluded from file watching

## TAURI CONFIGURATION

From `tauri.conf.json`:

- Product name: `aghub-desktop`
- Window: 1280x800, native titlebar
- Permissions: window controls, opener, dialog, store

## ANTI-PATTERNS

### HeroUI

- NEVER use v2 patterns (Provider, framer-motion)
- NEVER assume v2 knowledge applies
- ALWAYS verify component API in v3 docs
- ALWAYS use secondary varient in Modal/Card for better contrast

### Frontend

- NEVER use npm/yarn/pnpm (bun only)
- NEVER remove the `// @ts-expect-error process is a nodejs global` comment in vite.config.ts
- NEVER use pure black (#000) or pure white (#fff) — always tint
- NEVER use string template for className concat, use `cn` util from `@/lib/utils`.

### Desktop Integration

- NEVER modify Tauri capabilities without security review
- NEVER expose system APIs without explicit permissions in `capabilities/`

### Async State Management

- NEVER use `useEffect` for data fetching or side effects, use `useQuery` from React Query or custom hooks instead.
- NEVER use `{error && <div>{error.message}</div>}` for error handling, just use HeroUI's toast system for consistent UX.

### You might not need effect

- NEVER use `useEffect` to sync state, use `useMemo` and `handleXXX` instead.

## RELEASE NOTES

- Product copy lives in `../../release-notes/v<version>.yml`; include English,
  Simplified Chinese, and Traditional Chinese in the same manifest.
- Run `bun run release-notes:generate` after editing a manifest and commit the
  generated `src/generated/release-notes.json`. Do not edit that JSON by hand.
- Run `bun run release-notes:check` before tagging. The release workflow also
  checks that Cargo, Tauri, and desktop package versions match the manifest.
- GitHub Release bodies use the manifest first and append the `git-cliff`
  output as a technical changes section.

## NOTES

- Tauri backend (`src-tauri/src/`) calls into `aghub-core` crate
- VS Code extensions recommended: `tauri-apps.tauri-vscode`, `rust-lang.rust-analyzer`
  </content>
