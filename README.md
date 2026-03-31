# aghub

**One hub for every AI coding agent.**

[![Version](https://img.shields.io/github/v/release/akarachen/aghub?include_prereleases&label=release)](https://github.com/akarachen/aghub/releases)
[![Downloads](https://img.shields.io/github/downloads/akarachen/aghub/total.svg)](https://github.com/akarachen/aghub/releases)
[![Homebrew](https://img.shields.io/badge/homebrew-tap-orange?logo=homebrew)](https://github.com/Fldicoahkiin/homebrew-tap)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/akarachen/aghub/releases)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-orange.svg)](https://tauri.app/)
[![License](https://img.shields.io/github/license/akarachen/aghub)](https://github.com/akarachen/aghub/blob/main/LICENSE)

<a href="https://www.producthunt.com/products/aghub/reviews/new?utm_source=badge-product_review&utm_medium=badge&utm_source=badge-aghub" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/product_review.svg?product_id=1193657&theme=light" alt="AGHub - The&#32;hub&#32;for&#32;every&#32;AI&#32;agent&#32;that&#32;isn&#39;t&#32;slop&#46; | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" /></a>

[中文版本](./README.CN.md)

!['aghub banner'](/docs/assets/gh_banner.png)

!['aghub screenshot'](/docs/assets/app_screenshot.jpg)

---

## Installation

### macOS (Homebrew)

```bash
# Add the tap
brew tap fldicoahkiin/tap

# Install Desktop App
brew install --cask aghub

# Or install CLI Tool only
brew install aghub-cli
```

### Download

| Platform               | Download                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| Windows (experimental) | [setup.exe](https://github.com/akarachen/aghub/releases/latest/download/aghub_1.0.1_x64-setup.exe) |
| macOS (Intel)          | [dmg](https://github.com/akarachen/aghub/releases/latest/download/aghub_1.0.1_x64.dmg)             |
| macOS (Apple Silicon)  | [dmg](https://github.com/akarachen/aghub/releases/latest/download/aghub_1.0.1_aarch64.dmg)         |
| Linux                  | [AppImage](https://github.com/akarachen/aghub/releases/latest/download/aghub_1.0.1_amd64.AppImage) |

Or visit [Releases](https://github.com/akarachen/aghub/releases) for all available downloads.

### System Requirements

- Windows: Windows 10 and above
- macOS: macOS 12 (Monterey) and above
- Linux: Ubuntu 22.04+ / Debian 11+ / Fedora 34+ and other mainstream distributions

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

This project is licensed under the [MIT License](LICENSE).

## Star History

<a href="https://www.star-history.com/#AkaraChen/aghub&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=AkaraChen/aghub&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=AkaraChen/aghub&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=AkaraChen/aghub&type=date&legend=top-left" />
 </picture>
</a>
