<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme-bandi-mark-light.png">
  <source media="(prefers-color-scheme: light)" srcset="assets/readme-bandi-mark-dark.png">
  <img src="assets/readme-bandi-mark-dark.png" alt="Bandi logo" width="200">
</picture>

# Bandi

**A local-first desktop workspace for managing distinct, persistent configurations for multiple AI coding agents.**

Organize multiple agents with different responsibilities by team. Each agent has its own AgentPackage, long-term Memory, and traceable revisions. Manage Bandi-owned configuration through safe writes, then use these agents in your selected AI coding tool. Nine built-in tools are currently supported.

[![Apache License 2.0](https://img.shields.io/github/license/zemu2718/bandi?style=flat-square)](LICENSE) ![Development](https://img.shields.io/badge/status-development-orange?style=flat-square) [![Desktop platforms](https://github.com/zemu2718/bandi/actions/workflows/desktop-platforms.yml/badge.svg?branch=main)](https://github.com/zemu2718/bandi/actions/workflows/desktop-platforms.yml?query=branch%3Amain)

[What you get](#what-you-get) · [How it works](#how-it-works) · [Run locally](#run-locally) · [Default boundaries](#default-boundaries)

🌐 [简体中文](README.md)

</div>

## What you get

- **See each agent's distinct, persistent configuration:** View multiple agents' responsibilities, team membership, and their own Instructions, Rules, Skills, MCP, permissions, SOP, and long-term Memory in one place. Bandi only displays Bandi-owned managed configuration and does not read existing host-tool configuration content.
- **Make changes with a history to return to:** Bandi checks for external changes before saving, creates a ConfigRevision or MemoryRevision after a verified write, and provides local backup and recovery.
- **Keep configuration separate from execution:** Bandi manages how agents work next time and beyond. Collaboration, authorization, execution, and acceptance for the current task stay in your chosen external AI coding tool.

## What Bandi manages

Bandi keeps its persistent relationships straightforward:

```text
Team → Agent → optional requirement
```

Each agent belongs to one team. For individual use, the built-in Personal Team provides that structure without requiring you to set up an organization. A requirement (internally modeled as TaskBrief) belongs to a team and prepares the goal, background, constraints, and expected outputs for a task before you continue in the selected external AI coding tool. It does not store participating agents, progress, todos, approvals, logs, or acceptance status, and Bandi does not execute or track the task.

| Scenario | Bandi Desktop | External AI coding tool |
| --- | --- | --- |
| **Persistent agents** | Create agents and maintain team membership and AgentPackages | Use configured agents to complete the current task |
| **Configuration and permissions** | Edit persistent configuration, default policies, and capability boundaries | Handle one-time permission requests for the current task |
| **Memory and history** | Save agent long-term Memory, revisions, and local backups | Keep the current session's chat, todos, logs, and execution feedback |
| **Requirement pool** | Optionally organize lightweight, team-scoped context | Choose participating agents and handle collaboration, reporting, and acceptance |

## How it works

1. **Choose a team and agent.** Start with the Personal Team, or use teams to organize multiple persistent agents with different responsibilities.
2. **View or edit persistent configuration.** Create an agent, then edit its Bandi-managed configuration in one interface.
3. **Save safely and retain history.** The Local Service validates the target and baseline, writes atomically, reads the result back, and creates a revision after success.
4. **Launch from AI Tools.** Choose one of the fixed tools on `/tools`, then temporarily select a team, agent, and optional requirement. Client Launch v3 reports launch or manual handoff through typed `outcome` and `contextDelivery` results; the external tool still performs the task.

### Fixed integration entry points

| Tool | Fixed entry point |
| --- | --- |
| Claude Code | plugin |
| Claude Desktop | MCPB through the official UI (degraded) |
| Codex | `~/.agents/skills` |
| Gemini | `~/.gemini/extensions` |
| Grok | `~/.grok/skills` |
| OpenCode | `~/.config/opencode/skills` |
| OpenClaw | `~/.openclaw/skills` |
| Hermes | `~/.hermes/skills` |
| Pi | `~/.pi/agent/skills` |

All nine tools have dedicated entries on the fixed `/tools` page. Local detection checks only fixed installation candidates; it does not run tools, scan `PATH`, or read configuration bodies. When a tool is not found, Bandi can open its fixed official installation page; when the fixed configuration location exists, the user can explicitly reveal it. Bandi never installs tools or integrations automatically, and opening an official page or revealing a location does not prove installation, loading, or runtime readiness.

### Persistent assets it manages

The two core objects are:

- **AgentPackage:** Stores an agent's identity and persistent configuration under a stable `agent-id`.
- **Memory and revisions:** Each agent maintains its own long-term Memory. Successful configuration and Memory writes leave traceable revisions.

<details>
<summary><strong>View other persistent configuration assets</strong></summary>

- **Instructions / Context:** Persistent instructions and background for the agent.
- **Rules:** Rules the agent must continue to follow.
- **Skills:** Referenced skill configuration and diagnostics.
- **MCP:** MCP server configuration and persistent boundaries.
- **Permissions:** Persistent capability boundaries and default policies; expansions require separate confirmation.
- **SOP:** Workflow definitions for agents to use in the selected AI coding tool; Bandi does not execute them.
- **Hooks / Commands:** Managed configuration, not a general-purpose command execution surface in Bandi.
- **Shared assets:** Explicitly referenced team assets and read-only reference diagnostics.

</details>

## Run locally

The repository is under development and currently targets source development and internal validation. It does not yet provide an official GitHub Release.

Install dependencies and start the Desktop app:

```bash
pnpm install
pnpm desktop:dev
```

To view the Web interface demo only:

```bash
pnpm web:dev
```

The Web app uses clearly labeled in-memory demonstrations. Real local storage, safe writes, and recovery are defined by Local Service receipts in the Tauri Desktop app. The Desktop loop is connected on macOS. Windows code and CI are in the repository, but installation, upgrades, uninstallation, SmartScreen behavior, and signing still require real-world validation.

## Default boundaries

By default, Bandi manages only its own persistent configuration assets:

- **It does not execute or schedule tasks,** and provides no task center, approval workflow, or runtime monitoring console.
- **Launching stays constrained.** Client Launch v3 uses only fixed tool, adapter, and terminal enums plus stable IDs to submit a launch request or return context for manual copying; it accepts no arbitrary command, argument, or path.
- **It does not manage sessions,** read terminal output, or mirror chats, todos, or logs.
- **The app only displays Bandi-owned managed configuration.** It accepts no arbitrary paths and does not enumerate, scan, or read host configuration content.
- **Host directories have one fixed-allowlist exception.** An explicit `/tools` action may only reveal an existing fixed configuration location. The installation action only opens a fixed official URL and never installs automatically; Bandi exposes no general opener, file API, or shell.
- **It does not back up credentials or execution history;** tokens, cookies, private keys, keychain data, and Claude Code session content are excluded.
- **Deletion and recovery affect Bandi-owned data only,** with separate confirmation and recovery boundaries for high-risk operations.

### More information

- **Understand the product:** [Product and page architecture](./docs/产品与页面架构.md) · [Low-fidelity page wireframes](./docs/页面低保真线框图.md)
- **Verify the implementation:** [Technical architecture](./docs/技术架构.md) · [Local service and frontend contract](./docs/本地服务与前端联调契约.md)
- **Report an issue:** [GitHub Issues](https://github.com/zemu2718/bandi/issues)

If Bandi helps you, consider giving the project a Star.

Bandi is open source under the [Apache License 2.0](LICENSE).
