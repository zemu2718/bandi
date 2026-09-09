<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme-bandi-mark-light.png">
  <source media="(prefers-color-scheme: light)" srcset="assets/readme-bandi-mark-dark.png">
  <img src="assets/readme-bandi-mark-dark.png" alt="Bandi 标志" width="200">
</picture>

# Bandi · 班底

**可视化管理不同 AI Agent 各自的长期配置。**

按 Team 组织多个不同职责的长期 Agent；每个 Agent 都有独立的 AgentPackage、长期 Memory 和可追溯版本。通过安全写入维护 Bandi 受管配置，再回到你选择的 AI 编程工具使用这些 Agent。当前支持九个内置工具。

[![Apache License 2.0](https://img.shields.io/github/license/zemu2718/bandi?style=flat-square)](LICENSE) ![Development](https://img.shields.io/badge/status-development-orange?style=flat-square) [![Desktop platforms](https://github.com/zemu2718/bandi/actions/workflows/desktop-platforms.yml/badge.svg?branch=main)](https://github.com/zemu2718/bandi/actions/workflows/desktop-platforms.yml?query=branch%3Amain)

[你会得到什么](#你会得到什么) · [如何工作](#它怎样工作) · [本地运行](#本地运行) · [默认边界](#默认边界)

🌐 [English](README.en.md)

</div>

## 你会得到什么

- **看清不同 Agent 各自的长期配置：** 在一个界面中查看多个长期 Agent 的职责、Team 归属以及各自独立的 Instructions、Rules、Skills、MCP、权限、SOP 与长期 Memory；只展示 Bandi 自有受管配置，不读取宿主工具已有配置内容。
- **放心修改并随时回看：** 保存前检查外部变化，成功写入后保留 ConfigRevision 或 MemoryRevision，并提供本地备份与恢复能力。
- **把配置管理与任务执行分开：** Bandi 维护“下次及以后如何工作”；当前任务的协作、授权、执行与验收仍在你选择的外部 AI 编程工具中完成。

## Bandi 管理什么

Bandi 的长期关系保持简单：

```text
Team → Agent → 可选需求
```

每个 Agent 归属于一个 Team；个人使用时由内置 Personal Team 承载，无需先搭建组织。需求（内部模型名为 TaskBrief）归属于 Team，用来提前整理一次任务的目标、背景、约束和期望产出，方便在所选外部 AI 编程工具中继续沟通和执行。它不记录参与 Agent、进度、Todo、审批、日志或验收状态，也不会在 Bandi 中执行或跟踪任务。

| 场景 | Bandi Desktop | 外部 AI 编程工具 |
| --- | --- | --- |
| **长期 Agent** | 创建 Agent，维护 Team 归属与 AgentPackage | 使用已配置的 Agent 完成当前任务 |
| **配置与权限** | 编辑长期配置、默认策略与能力边界 | 处理当前任务的一次性权限请求 |
| **Memory 与历史** | 保存 Agent 长期 Memory、Revision 和本地备份 | 保留当前会话的聊天、Todo、日志与执行反馈 |
| **需求池** | 按需整理任务的目标、背景、约束和期望产出 | 决定参与 Agent，并完成协作、汇报与验收 |

## 它怎样工作

1. **选择 Team 和 Agent。** 从 Personal Team 开始，或按需用 Team 组织多个不同职责的长期 Agent。
2. **查看或修改长期配置。** 创建 Agent，在统一界面中编辑受管配置。
3. **安全保存并保留历史。** Local Service 校验目标和 baseline，原子写入并重读验证，成功后生成 Revision。
4. **回到你的工具工作。** Client Launch v3 只用稳定 ID 准备所选 Team、Agent 和可选需求的上下文；具体任务仍由外部工具完成。

### 九工具固定集成入口

| 工具 | 固定入口 |
| --- | --- |
| Claude Code | plugin |
| Claude Desktop | MCPB；在官方 UI 安装（降级） |
| Codex | `~/.agents/skills` |
| Gemini | `~/.gemini/extensions` |
| Grok | `~/.grok/skills` |
| OpenCode | `~/.config/opencode/skills` |
| OpenClaw | `~/.openclaw/skills` |
| Hermes | `~/.hermes/skills` |
| Pi | `~/.pi/agent/skills` |

工具方案只保存选择和配置，不自动安装。Host Integration 仅在用户显式点击时安装到固定入口或 reveal 固定目录；未经真实 smoke 的运行态显示“尚未验证”，部分链路显示“部分可用”。

### 它管理的长期资产

两个核心对象是：

- **AgentPackage：** 基于稳定 `agent-id` 保存 Agent 身份及其长期配置。
- **Memory 与 Revision：** 每个 Agent 维护自身长期 Memory；配置和 Memory 的成功写入均留下可追溯版本。

<details>
<summary><strong>查看其他长期配置资产</strong></summary>

- **Instructions / Context：** Agent 的长期指令与背景信息。
- **Rules：** Agent 需要持续遵守的规则。
- **Skills：** Agent 可引用的技能配置与诊断信息。
- **MCP：** MCP 服务配置及其长期边界。
- **Permissions：** 长期能力边界与默认策略；扩大边界时需要独立确认。
- **SOP：** 供外部 AI 编程工具中的 Agent 使用的工作流定义，Bandi 不负责执行。
- **Hooks / Commands：** 受管配置内容，不作为 Bandi 的通用命令执行入口。
- **共享资产：** Team 内显式引用的共享资产与只读引用诊断。

</details>

## 本地运行

仓库仍处于开发阶段，目前面向源码开发和内部验证，尚未提供正式 GitHub Release。

安装依赖并启动 Desktop：

```bash
pnpm install
pnpm desktop:dev
```

只查看 Web 界面演示：

```bash
pnpm web:dev
```

纯 Web 使用明确标识的页面内存演示；真实的本地存储、安全写入和恢复能力以 Tauri Desktop 的 Local Service 回执为准。macOS 已接入 Desktop 闭环；Windows 相关代码和 CI 已进入仓库，但真实安装、升级、卸载、SmartScreen 与签名仍待验证。

## 默认边界

Bandi 默认只管理自身受管的长期配置资产：

- **不执行或调度任务，** 不提供任务中心、审批流或运行监控台；
- **不启动终端或命令，** Client Launch v3 只准备类型化上下文；
- **不管理 Session，** 不读取终端输出，也不镜像聊天、Todo 或日志；
- **应用内只查看 Bandi 自有受管配置；** 不接受任意路径，不枚举、不扫描、不读取宿主配置内容；
- **宿主目录仅有固定 allowlist 例外；** 用户显式触发 Host Integration 后，才允许安装到九工具固定入口或 reveal 固定目录；不提供通用 opener、文件 API 或 Shell；
- **不备份凭据和执行过程，** Token、Cookie、私钥、钥匙串数据及 Claude Code 会话内容不进入备份；
- **删除与恢复只处理 Bandi 自有数据，** 高风险操作保留独立确认和恢复边界。

### 更多信息

- **了解产品：** [产品与页面架构](./docs/产品与页面架构.md) · [页面低保真线框图](./docs/页面低保真线框图.md)
- **核对实现：** [技术架构](./docs/技术架构.md) · [本地服务与前端联调契约](./docs/本地服务与前端联调契约.md) · [首版能力矩阵](./docs/首版能力矩阵.md)
- **查看验收：** [首版验收报告](./docs/首版验收报告.md) · [反馈问题](https://github.com/zemu2718/bandi/issues)

如果 Bandi 对你有帮助，欢迎给项目点个 Star。

本项目采用 [Apache License 2.0](LICENSE) 开源。
