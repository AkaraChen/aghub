# aghub

**One hub for every AI coding agent.**

[![Version](https://img.shields.io/github/v/release/akarachen/aghub?include_prereleases&label=release)](https://github.com/akarachen/aghub/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/akarachen/aghub/releases)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-orange.svg)](https://tauri.app/)

[中文版本](./README.CN.md)

!['aghub banner'](/docs/assets/gh_banner.png)

!['aghub screenshot'](/docs/assets/app_screenshot.jpg)

---

## Installation

### System Requirements

- Windows: Windows 10 and above
- macOS: macOS 12 (Monterey) and above
- Linux: Ubuntu 22.04+ / Debian 11+ / Fedora 34+ and other mainstream distributions

Download the latest release from [Releases](https://github.com/akarachen/aghub/releases). And you're good to go!

---

## Features

**Unified MCP Management**

- Configure once, deploy to any of 22+ supported agents
- Stdio, SSE, and StreamableHttp transports
- Enable or disable servers without removing them
- View and audit servers across all agents in one command

**Portable Skills**

- Import `.skill` packages or author skills with SKILL.md frontmatter
- Share skills across agents via the universal skills directory
- SHA-256 content verification and source provenance tracking
- Browse and install from the skills.sh marketplace

**Flexible Scoping**

- Global, project, or merged config views per agent
- Filter by agent or list everything at once
- Full audit trail of every configured resource

---

## Contributing

Contributions are welcome! To get started:

```bash
git clone https://github.com/akarachen/aghub.git
cd aghub
just desktop    # Debug build
just test       # Run tests
just lint       # Run clippy
```

Please ensure `just test` and `just lint` pass before submitting a pull request.

## License

MIT
