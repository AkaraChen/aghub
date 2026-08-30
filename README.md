!['aghub banner'](/docs/assets/gh_banner.png)

!['aghub screenshot'](/docs/assets/app_screenshot.png)

**One hub for every AI coding agent.**

[![Version](https://img.shields.io/github/v/release/akarachen/aghub?include_prereleases&label=release)](https://github.com/akarachen/aghub/releases)
[![Downloads](https://img.shields.io/github/downloads/akarachen/aghub/total.svg)](https://github.com/akarachen/aghub/releases)
[![Homebrew](https://img.shields.io/badge/homebrew-tap-orange?logo=homebrew)](https://github.com/AkaraChen/homebrew-tap)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/akarachen/aghub/releases)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-orange.svg)](https://tauri.app/)
[![License](https://img.shields.io/github/license/akarachen/aghub)](https://github.com/akarachen/aghub/blob/main/LICENSE)

<a href="https://www.producthunt.com/products/aghub/reviews/new?utm_source=badge-product_review&utm_medium=badge&utm_source=badge-aghub" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/product_review.svg?product_id=1193657&theme=light" alt="aghub - The&#32;hub&#32;for&#32;every&#32;AI&#32;agent&#32;that&#32;isn&#39;t&#32;slop&#46; | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" /></a>

[中文版本](./README.CN.md)

## Installation

### macOS (Homebrew)

```bash
# Install Desktop App
brew install --cask akarachen/tap/aghub
```

### Download

| Platform               | Download                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| Windows (experimental) | [setup.exe](https://github.com/akarachen/aghub/releases/latest/download/aghub-windows-setup.exe) |
| macOS (Intel)          | [dmg](https://github.com/akarachen/aghub/releases/latest/download/aghub_mac_intel.dmg)           |
| macOS (Apple Silicon)  | [dmg](https://github.com/akarachen/aghub/releases/latest/download/aghub_mac_arm.dmg)             |
| Linux                  | [AppImage](https://github.com/akarachen/aghub/releases/latest/download/aghub-linux.AppImage)     |

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

- **Install plugins from anywhere** — the official registry, third-party Git URLs, or a local path
- **Marketplace built in** — discover, browse, and install Claude Code plugins (v2) without leaving aghub
- **Full lifecycle management** — install, update, enable/disable, and remove plugins with one command
- **Global or project scope** — apply plugins everywhere or pin them to a single project

**Claude Code Plugins**

- **Start from a preset** — spin up popular providers from built-in presets, or configure a custom endpoint from
  scratch
- **Bring your own model** — point Claude, Codex, and OpenCode at any custom inference endpoint
- **Every API format** — Anthropic Messages, OpenAI Chat Completions, and OpenAI Responses
- **Keys stay safe** — API keys are stored in your OS-native keychain, never in plaintext config
- **Per-agent model selection** — choose the right provider and model for each agent independently

**Claude Code Plugins**

- **Install plugins from anywhere** — the official registry, third-party Git URLs, or a local path
- **Marketplace built in** — discover, browse, and install Claude Code plugins (v2) without leaving aghub
- **Full lifecycle management** — install, update, enable/disable, and remove plugins with one command
- **Global or project scope** — apply plugins everywhere or pin them to a single project

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
