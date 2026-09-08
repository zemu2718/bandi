---
name: bandi-config
description: 当用户要求查看 Bandi 配置状态、诊断本地配置或检查 AgentPackage 配置有效性时使用。只通过 bandi CLI 读取事实，不执行任务或直接写入配置。
allowed-tools: Bash(cargo run --manifest-path apps/desktop/src-tauri/Cargo.toml --bin bandi -- *)
---

# Bandi 配置事实

通过与 Desktop 共用 Rust Local Service 的 `bandi` CLI 获取事实：

```text
cargo run --quiet --manifest-path apps/desktop/src-tauri/Cargo.toml --bin bandi -- --json doctor
cargo run --quiet --manifest-path apps/desktop/src-tauri/Cargo.toml --bin bandi -- --json status
cargo run --quiet --manifest-path apps/desktop/src-tauri/Cargo.toml --bin bandi -- --json config check
```

## 配置范围

只解释以下长期配置事实：

- Team；
- Agent；
- 可选的 Team-scoped TaskBrief；
- Agent 长期 Memory。

## 边界

- 只读取配置事实、诊断与能力状态。
- 不直接访问 SQLite 或受管配置文件以绕过 Local Service。
- 不接受、登记、扫描或访问任意用户目录。
- 不创建或协作执行任务，不选择参与 Agent，不处理执行期批准，不推进或监控任务，不管理 Claude Code Session。
- 不把 RuntimeProjection 持久化为主事实。
- 持久化变更只能由 Desktop/Local Service 的受限流程处理；本 Skill 不执行写入。
- 凭据、Token、Cookie、私钥和钥匙串内容不得进入回复、命令参数或日志。

## 输出

按“状态 → 证据 → 影响 → 修复建议”说明结果。`degraded`、`not_initialized`、`not_checked` 必须原样表达，不得推断为可用。
