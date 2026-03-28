# aghub

!['Title'](/docs/assets/gh_baner_cn.png)

### 你所有 AI 编程助手的统管。

> 本项目正在积极开发中。

!['Title'](/docs/assets/app_screenshot.jpg)


[English Version](./README.md)

[![Version](https://img.shields.io/github/v/release/akarachen/aghub?include_prereleases&label=release)](https://github.com/akarachen/aghub/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/akarachen/aghub/releases)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-orange.svg)](https://tauri.app/)

---

## 安装

### 系统要求
* Windows: Windows 10 及以上
* macOS: macOS 12 (Monterey) 及以上
* Linux: Ubuntu 22.04+ / Debian 11+ / Fedora 34+ 及其他主流发行版

从 [Releases](https://github.com/akarachen/aghub/releases) 下载最新版本就可以开始使用！

---

## 功能

**统一 MCP 管理**

- 一次配置，部署到 22+ 支持的助手
- 支持 Stdio、SSE 和 StreamableHttp 传输方式
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

MIT
