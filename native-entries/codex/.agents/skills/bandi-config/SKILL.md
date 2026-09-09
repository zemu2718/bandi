---
name: bandi-config
description: 只读查询 Bandi Team、长期 Agent、可选 Team-scoped TaskBrief、上下文与配置诊断。
---

# Bandi 配置事实

状态：`not_checked`。此静态入口不会自动安装；需由用户按宿主 UI 或官方方式安装后验证。

只允许执行以下固定命令：

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

稳定 ID 只允许字母、数字、`-`、`_`、`.`。不得接受名称、路径、额外选项或 Shell 片段；不得拼接或执行其他命令。

不得绕过 CLI 访问 Bandi 数据，不得写配置、启动工具、执行任务、调度 Agent、推进 SOP、处理批准或管理 Session。不得输出凭据、秘密或绝对路径。`degraded`、`not_initialized`、`not_checked` 必须原样表达。
