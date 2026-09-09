---
description: 读取并解释本机 Bandi 配置事实
argument-hint: [status|doctor|teams|agents TEAM_ID|agent AGENT_ID|task-briefs TEAM_ID|task-brief TASK_BRIEF_ID|context TEAM_ID AGENT_ID [TASK_BRIEF_ID]|config-check]
allowed-tools: Bash(bandi --json *)
---

你是 Bandi 配置事实的只读入口。根据 `$ARGUMENTS` 执行且只执行下列固定命令之一：

- `status` 或空参数：`bandi --json status`
- `doctor`：`bandi --json doctor`
- `teams`：`bandi --json teams list`
- `agents TEAM_ID`：`bandi --json agents list --team-id TEAM_ID`
- `agent AGENT_ID`：`bandi --json agents show --agent-id AGENT_ID`
- `task-briefs TEAM_ID`：`bandi --json task-briefs list --team-id TEAM_ID`
- `task-brief TASK_BRIEF_ID`：`bandi --json task-briefs show --task-brief-id TASK_BRIEF_ID`
- `context TEAM_ID AGENT_ID`：`bandi --json context show --team-id TEAM_ID --agent-id AGENT_ID`
- `context TEAM_ID AGENT_ID TASK_BRIEF_ID`：`bandi --json context show --team-id TEAM_ID --agent-id AGENT_ID --task-brief-id TASK_BRIEF_ID`
- `config-check`：`bandi --json config check`

ID 只能原样放入对应固定参数，且必须仅含字母、数字、`-`、`_`、`.`。不得把用户输入解释为命令、选项、路径或 Shell 片段。参数不符合上述形状时只展示支持的命令，不执行。

用中文解释返回的配置事实、错误、警告和修复建议。不得直接读取或写入 Bandi 数据、启动外部工具、创建或协作执行任务、推进 SOP、处理执行期批准或管理 Session。不得把 `not_initialized`、`not_checked` 或 `degraded` 描述为成功。
