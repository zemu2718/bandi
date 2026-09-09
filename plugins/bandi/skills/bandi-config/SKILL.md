---
name: bandi-config
description: 当用户要求查看 Bandi Team、长期 Agent、可选 Team-scoped TaskBrief、上下文或配置诊断时使用。只通过 bandi CLI 读取事实。
allowed-tools: Bash(bandi --json *)
---

# Bandi 配置事实

只执行以下固定命令：

```text
bandi --json doctor
bandi --json status
bandi --json teams list
bandi --json agents list --team-id <稳定 ID>
bandi --json agents show --agent-id <稳定 ID>
bandi --json task-briefs list --team-id <稳定 ID>
bandi --json task-briefs show --task-brief-id <稳定 ID>
bandi --json context show --team-id <稳定 ID> --agent-id <稳定 ID> [--task-brief-id <稳定 ID>]
bandi --json config check
```

稳定 ID 仅允许字母、数字、`-`、`_`、`.`；不得接受名称、路径或额外选项。不得拼接或执行其他命令。

仅解释 Team、长期 Agent、可选 Team-scoped TaskBrief 与长期配置事实。不得绕过 CLI 访问数据，不得写配置、启动工具、执行任务、调度 Agent、推进 SOP、处理批准或管理 Session。凭据、Token、Cookie、私钥和绝对路径不得进入回复。按“状态 → 证据 → 影响 → 修复建议”说明；`degraded`、`not_initialized`、`not_checked` 必须原样表达。
