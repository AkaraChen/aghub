# aghub

**你的AI智能体配置中心**

[![Version](https://img.shields.io/github/v/release/akarachen/aghub?include_prereleases&label=release)](https://github.com/akarachen/aghub/releases)
[![Downloads](https://img.shields.io/github/downloads/akarachen/aghub/total.svg)](https://github.com/akarachen/aghub/releases)
[![Homebrew](https://img.shields.io/badge/homebrew-tap-orange?logo=homebrew)](https://github.com/Fldicoahkiin/homebrew-tap)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/akarachen/aghub/releases)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-orange.svg)](https://tauri.app/)
[![License](https://img.shields.io/github/license/akarachen/aghub)](https://github.com/akarachen/aghub/blob/main/LICENSE)

<a href="https://www.producthunt.com/products/aghub/reviews/new?utm_source=badge-product_review&utm_medium=badge&utm_source=badge-aghub" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/product_review.svg?product_id=1193657&theme=light" alt="AGHub - The&#32;hub&#32;for&#32;every&#32;AI&#32;agent&#32;that&#32;isn&#39;t&#32;slop&#46; | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" /></a>

[English Version](./README.md)

!['aghub banner'](/docs/assets/gh_baner_cn.png)

!['aghub screenshot'](/docs/assets/app_screenshot.jpg)

---

## 安装

### macOS (Homebrew)

```bash
# 添加官方 Tap
brew tap fldicoahkiin/tap

# 安装桌面端应用
brew install --cask aghub

# 或仅安装命令行工具 (CLI)
brew install aghub-cli
```

### 下载

| 平台                  | 下载                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| Windows (实验性)      | [setup.exe](https://github.com/akarachen/aghub/releases/latest/download/aghub_1.0.1_x64-setup.exe) |
| macOS (Intel)         | [dmg](https://github.com/akarachen/aghub/releases/latest/download/aghub_1.0.1_x64.dmg)             |
| macOS (Apple Silicon) | [dmg](https://github.com/akarachen/aghub/releases/latest/download/aghub_1.0.1_aarch64.dmg)         |
| Linux                 | [AppImage](https://github.com/akarachen/aghub/releases/latest/download/aghub_1.0.1_amd64.AppImage) |

或访问 [Releases](https://github.com/akarachen/aghub/releases) 查看所有可用下载。

### 系统要求

- Windows: Windows 10 及以上
- macOS: macOS 12 (Monterey) 及以上
- Linux: Ubuntu 22.04+ / Debian 11+ / Fedora 34+ 及其他主流发行版

---

## 功能

**统一 MCP 管理**

- 一次配置，部署到 22+ 支持的助手
- 支持本地 Stdio 和远程（SSE 和 StreamableHttp） 连线方式
- 无需删除即可启用或禁用服务器
- 单条命令查看和审计所有助手的服务器

**便携技能**

- 导入 `.skill` 包或使用 SKILL.md 前言编写技能
- 通过通用技能目录跨助手共享技能
- SHA-256 内容验证与来源追踪
- 浏览并安装 skills.sh 市场中的技能

**灵活的作用域**

- 按助手查看全局、项目或合并配置
- 按单个助手筛选或一次列出全部
- 每个配置资源的完整审计轨迹

---

## 贡献

欢迎贡献！开始方式：

```bash
git clone https://github.com/akarachen/aghub.git
cd aghub
just desktop    # 调试构建
just test       # 运行测试
just lint       # 运行 clippy
```

提交 Pull Request 前，请确保 `just test` 和 `just lint` 通过。

## 许可证

本项目基于 [MIT License](LICENSE) 协议进行开源。

## Star History

<a href="https://www.star-history.com/#AkaraChen/aghub&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=AkaraChen/aghub&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=AkaraChen/aghub&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=AkaraChen/aghub&type=date&legend=top-left" />
 </picture>
</a>
