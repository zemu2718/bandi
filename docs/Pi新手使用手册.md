# Pi Coding Agent 新手完整使用手册

> 面向主要使用过 Claude Code CLI、准备迁移或并行尝试 Pi 的开发者。
>
> 本手册依据本机安装的 **Pi 0.84.4** 官方文档整理，命令与配置对应 npm 包 `@earendil-works/pi-coding-agent`。Pi 更新较快，若未来版本行为变化，请以 `pi --help`、`/changelog` 和当前安装版本文档为准。

---

## 目录

1. [先说结论：Pi 是什么](#1-先说结论pi-是什么)
2. [Pi 与 Claude Code CLI 的主要差异](#2-pi-与-claude-code-cli-的主要差异)
3. [安装、升级与卸载](#3-安装升级与卸载)
4. [登录 Provider 与选择模型](#4-登录-provider-与选择模型)
5. [第一次启动：建议照着做](#5-第一次启动建议照着做)
6. [认识 Pi 的终端界面](#6-认识-pi-的终端界面)
7. [日常输入、文件引用与 Shell 命令](#7-日常输入文件引用与-shell-命令)
8. [模型与 Thinking / Effort 设置](#8-模型与-thinking--effort-设置)
9. [工具、权限与安全边界](#9-工具权限与安全边界)
10. [会话保存、恢复、分支与压缩](#10-会话保存恢复分支与压缩)
11. [项目指令：复用 CLAUDE.md 与 AGENTS.md](#11-项目指令复用-claudemd-与-agentsmd)
12. [Settings 配置](#12-settings-配置)
13. [Prompt Templates：可复用提示词](#13-prompt-templates可复用提示词)
14. [Skills：按需加载专业能力](#14-skills按需加载专业能力)
15. [Extensions：Pi 最重要的扩展机制](#15-extensionspi-最重要的扩展机制)
16. [Pi Packages：安装与分享能力包](#16-pi-packages安装与分享能力包)
17. [主题、快捷键与终端体验](#17-主题快捷键与终端体验)
18. [非交互模式与自动化](#18-非交互模式与自动化)
19. [从 Claude Code 迁移的推荐方式](#19-从-claude-code-迁移的推荐方式)
20. [推荐的实际开发工作流](#20-推荐的实际开发工作流)
21. [常见问题与排障](#21-常见问题与排障)
22. [命令与快捷键速查表](#22-命令与快捷键速查表)
23. [30 分钟上手清单](#23-30-分钟上手清单)

---

## 1. 先说结论：Pi 是什么

Pi 是一个**极简、可编程、运行在终端里的 Coding Agent Harness**。

它默认给模型提供文件读取、写入、精确编辑和 Shell 执行能力，让模型可以：

- 理解代码仓库；
- 搜索和读取文件；
- 修改代码；
- 运行测试、Lint、构建和 Git 命令；
- 在持续对话中完成较复杂的开发任务。

Pi 和 Claude Code 的共同点是：你进入项目目录，启动 CLI，然后直接让 Agent 阅读、修改和验证代码。

Pi 的核心特点不是“内置功能比所有工具都多”，而是：

> **核心保持精简，把工作流交给 Skills、Prompt Templates、Extensions 和 Packages 自由组合。**

因此 Pi 默认刻意不内置某些 Claude Code 用户熟悉的功能，例如：

- 不内置 Plan Mode；
- 不内置 Todo 系统；
- 不内置 Sub-agent；
- 不内置权限确认弹窗；
- 不内置 MCP；
- 不内置后台 Bash 任务。

这不代表它们做不到，而是 Pi 希望你：

- 用 Markdown 文件表达计划和 Todo；
- 用 tmux 管理后台进程和并行 Agent；
- 用 Skill 描述某类标准工作流；
- 用 TypeScript Extension 添加工具、权限门禁、UI、Sub-agent、MCP 或其他行为；
- 或安装一个已经实现这些能力的 Pi Package。

### 1.1 Pi 最适合谁

Pi 特别适合以下用户：

1. 经常切换 Claude、OpenAI、Gemini、OpenRouter 或本地模型；
2. 希望 Agent UI 和行为高度可定制；
3. 愿意用 TypeScript 或配置文件塑造自己的工作流；
4. 重视会话分支、模型切换和长期上下文管理；
5. 希望把 Coding Agent 嵌入脚本、服务或自己的应用；
6. 已经有 `CLAUDE.md`、Skills 或成熟 CLI 工作流，想逐步迁移而非推倒重来。

### 1.2 不要误解 Pi

Pi 不是：

- 一个天然更安全的沙箱；
- 一个默认拥有完整审批流程的 Agent；
- 一个开箱即用的多 Agent 管理系统；
- 一个默认集成所有第三方 SaaS 的工具；
- Claude Code 的一比一复刻。

Pi 更像一套精简的 Agent 运行内核和终端交互框架。它的价值在于**自由度、透明度、可组合性和可编程性**。

---

## 2. Pi 与 Claude Code CLI 的主要差异

下面是从 Claude Code 用户视角最值得关注的差异。

| 维度 | Claude Code CLI | Pi |
|---|---|---|
| 默认体验 | 较完整、产品化、预设较多 | 极简核心、按需扩展 |
| 模型生态 | 以 Claude 为中心 | 支持多个 Provider 和模型快速切换 |
| 项目指令 | 常用 `CLAUDE.md` | 支持 `AGENTS.md`，也兼容 `CLAUDE.md` |
| 会话分支 | 有会话管理能力 | 原生树形会话，`/tree` 可在单文件内分支 |
| Plan Mode | 内置或有明确工作流 | 默认不内置，可写计划文件或用扩展实现 |
| Todo | 常见内置体验 | 默认不内置，建议 `TODO.md` 或扩展 |
| Sub-agent | 有内置 Agent/Task 相关能力 | 默认不内置，可用 tmux、扩展或 Package |
| MCP | 有原生生态 | 默认不内置，可通过 CLI/Skill/Extension 接入 |
| 权限确认 | 通常有权限与确认机制 | 默认没有权限弹窗，需沙箱或权限扩展 |
| 自定义 | Hooks、Skills、MCP 等 | TypeScript Extensions 可深度改造工具、事件和 TUI |
| 自动化 | CLI/SDK 等 | Print、JSON、RPC、TypeScript SDK 四种运行方式 |
| UI | 产品预设为主 | 主题、快捷键、编辑器、状态栏、组件均可扩展 |

### 2.1 Pi 可能带来的优势

#### 优势一：模型切换非常直接

在同一会话里使用 `/model` 或 `Ctrl+L` 切换模型；用 `/thinking` 切换推理级别。还可以配置一组常用模型，然后用 `Ctrl+P` 快速轮换。

适合：

- 便宜模型做搜索和小改动；
- 强模型做架构设计或复杂调试；
- 不同模型交叉审查；
- 在 Provider 限流时切换备用模型。

#### 优势二：会话天然是树

Pi 会话不是只能线性前进。你可以用 `/tree` 回到旧节点，从那里创建另一条分支，同时保留原分支。

这很适合：

- 同一个 Bug 比较两种修复方案；
- 回到需求澄清前，重写提示词；
- 保留失败尝试，又不让其污染当前上下文；
- 给关键节点添加标签，作为书签。

#### 优势三：扩展能力深入运行时

Extension 不只是“加一段提示词”，还可以：

- 注册模型可调用的新工具；
- 拦截或修改工具调用；
- 对危险命令弹出确认；
- 保护指定路径；
- 修改系统提示词；
- 自定义压缩摘要；
- 添加命令和快捷键；
- 添加状态栏、组件、弹窗和自定义编辑器；
- 注册自定义 Provider；
- 实现 Git checkpoint、SSH、沙箱、MCP 或多 Agent。

#### 优势四：渐进式加载 Skills

Pi 启动时只将 Skill 的名称和描述放入上下文；当任务命中时，再读取完整 `SKILL.md`。这可以避免把所有专业流程一直塞在上下文中。

#### 优势五：适合嵌入和自动化

除了交互式 TUI，Pi 还支持：

- `pi -p`：一次性输出；
- `--mode json`：JSONL 事件流；
- `--mode rpc`：通过 stdin/stdout 控制；
- TypeScript SDK：嵌入自己的应用。

### 2.2 需要适应的地方

1. **没有默认权限弹窗。** 模型拥有的工具会按当前用户权限运行；重要项目必须结合 Git、容器、受限工具集或权限扩展。
2. **部分 Claude Code 内置体验需要自己组合。** 例如 Plan、Todo、Sub-agent、MCP。
3. **自由度意味着配置责任。** 第三方 Extension 和 Skill 可能执行任意代码或诱导模型执行危险动作。
4. **Provider 与计费要自己确认。** 尤其 Anthropic Claude Pro/Max 在第三方 harness 中的认证与计费政策可能和 Claude Code 不同。

最推荐的态度是：

> 前期把 Pi 当作“支持多模型、树形会话、可扩展的 Claude Code 同类 CLI”，先掌握核心功能，再逐步添加扩展。

---

## 3. 安装、升级与卸载

### 3.1 环境要求

最常见的安装方式需要 Node.js 与 npm。先检查：

```bash
node --version
npm --version
```

如果尚未安装 Node.js，建议使用官方安装包或 `mise`、`nvm`、`fnm` 等版本管理器。

### 3.2 npm 全局安装

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

`--ignore-scripts` 会禁用依赖生命周期脚本。Pi 的正常 npm 安装不需要运行 install scripts。

验证：

```bash
pi --version
pi --help
```

### 3.3 官方安装脚本

也可以使用：

```bash
curl -fsSL https://pi.dev/install.sh | sh
```

执行网络脚本前，安全敏感用户应先下载并审查脚本内容。

### 3.4 更新

```bash
pi update                 # 更新 Pi 本身
pi update --self          # 更新 Pi 本身
pi update --self --force  # 强制重新安装，部分托管安装方式不支持
pi update --models        # 只刷新模型目录
pi update --extensions    # 只更新 Package
pi update --all           # 更新 Pi 和 Package
```

查看版本变化：

```text
/changelog
```

### 3.5 卸载

如果使用 npm 或官方 curl 安装器：

```bash
npm uninstall -g @earendil-works/pi-coding-agent
```

其他包管理器：

```bash
pnpm remove -g @earendil-works/pi-coding-agent
yarn global remove @earendil-works/pi-coding-agent
bun uninstall -g @earendil-works/pi-coding-agent
```

卸载程序不会自动删除：

```text
~/.pi/agent/
```

其中可能包含设置、凭据、会话和已安装 Package。如果你要彻底清除，请先备份，再手动删除。

---

## 4. 登录 Provider 与选择模型

Pi 把模型服务来源称为 **Provider**，例如 Anthropic、OpenAI、Google、OpenRouter。

### 4.1 最简单方式：使用 `/login`

进入任意项目目录后启动：

```bash
cd /path/to/project
pi
```

在 Pi 中输入：

```text
/login
```

然后选择 Provider，并按界面完成订阅登录或 API Key 配置。

认证完成后：

```text
/model
```

选择模型。模型选择器中按 `Ctrl+S`，可以将当前高亮模型保存为启动默认值。

### 4.2 支持的常见订阅登录

当前官方文档列出的订阅类 Provider 包括：

- ChatGPT Plus/Pro（Codex）；
- Claude Pro/Max；
- GitHub Copilot；
- xAI Grok/X subscription；
- OpenRouter OAuth；
- Radius。

> **Anthropic 特别提示：** 官方文档说明，Claude Pro/Max 在第三方 harness 中的认证会使用 Anthropic 的 extra usage，并按 Token 计费，而不是消耗 Claude 套餐额度。使用前务必查看自己的 Anthropic 账户用量与最新政策。

### 4.3 使用环境变量提供 API Key

例如：

```bash
export ANTHROPIC_API_KEY='sk-ant-...'
export OPENAI_API_KEY='sk-...'
export GEMINI_API_KEY='...'
export OPENROUTER_API_KEY='...'
pi
```

常见变量：

| Provider | 环境变量 |
|---|---|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Google Gemini | `GEMINI_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| xAI | `XAI_API_KEY` |
| Groq | `GROQ_API_KEY` |
| Mistral | `MISTRAL_API_KEY` |
| Together AI | `TOGETHER_API_KEY` |
| Fireworks | `FIREWORKS_API_KEY` |
| Hugging Face | `HF_TOKEN` |
| Kimi For Coding | `KIMI_API_KEY` |
| MiniMax | `MINIMAX_API_KEY` |

更多 Provider 以 `/login`、`pi --list-models` 和官方 `docs/providers.md` 为准。

### 4.4 凭据保存在哪里

通过 `/login` 保存的凭据位于：

```text
~/.pi/agent/auth.json
```

该文件可能包含敏感信息，不要：

- 提交到 Git；
- 发到聊天群；
- 粘贴进 Issue；
- 让不可信 Extension 读取；
- 复制进项目目录。

凭据解析优先级为：

1. CLI `--api-key`；
2. `~/.pi/agent/auth.json`；
3. 环境变量；
4. `models.json` 中的自定义 Provider Key。

### 4.5 退出登录

在 Pi 中：

```text
/logout
```

### 4.6 查看可用模型

```bash
pi --list-models
pi --list-models gpt
pi --list-models claude
```

启动时指定：

```bash
pi --provider openai --model gpt-5
pi --model openai/gpt-5
pi --model sonnet:high
```

### 4.7 自定义 Provider 或代理

如果服务兼容 OpenAI、Anthropic 或 Google API，可在以下文件中配置：

```text
~/.pi/agent/models.json
```

最小的 OpenAI-compatible 本地模型示例：

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        {
          "id": "qwen2.5-coder:7b",
          "reasoning": false,
          "contextWindow": 128000,
          "maxTokens": 16384
        }
      ]
    }
  }
}
```

修改 `models.json` 后打开 `/model` 会重新加载。高级自定义 Provider 可通过 Extension 注册。

---

## 5. 第一次启动：建议照着做

### 第 1 步：进入一个有 Git 的练习仓库

不要第一次就在生产目录或包含重要未备份文件的目录中尝试。

```bash
cd /path/to/safe-test-repo
git status
pi
```

### 第 2 步：处理 Project Trust

若项目中包含 `.pi/settings.json`、`.pi/extensions/`、项目 Skills 等动态资源，Pi 会询问是否信任项目。

信任项目意味着允许 Pi：

- 加载项目设置；
- 加载并执行项目 Extension；
- 加载项目 Skill；
- 安装缺失的项目 Package。

只信任你了解来源的仓库。保存信任决策可使用：

```text
/trust
```

注意：`/trust` 写入决策后，需要重启 Pi 才会按新决策重新加载项目资源。

### 第 3 步：登录并选择模型

```text
/login
/model
/thinking
```

建议新手：

- 普通任务：`medium`；
- 复杂调试、架构、跨文件重构：`high`；
- 格式修改、小范围查询：`off`、`minimal` 或 `low`；
- `xhigh`、`max` 只在模型支持且任务确实复杂时使用。

在 `/model` 和 `/thinking` 选择器里按 `Ctrl+S` 保存默认值。

### 第 4 步：给一个只读任务

先让 Pi 熟悉仓库，不要马上修改：

```text
请只读分析这个仓库：说明技术栈、目录结构、启动方法、测试命令和主要风险。不要修改文件，也不要执行会产生持久变化的命令。
```

### 第 5 步：尝试一个小改动

```text
请修复 README 中的一个错别字。修改前说明要改哪里，修改后运行 git diff 并总结结果，不要提交。
```

### 第 6 步：查看改动

你可以自己运行：

```text
!git status --short
!git diff
```

`!` 命令的输出会进入模型上下文。若只想自己看、不希望污染上下文：

```text
!!git status --short
!!git diff
```

### 第 7 步：给会话命名

```text
/name Pi 上手练习
```

退出后恢复：

```bash
pi -c
```

或：

```bash
pi -r
```

---

## 6. 认识 Pi 的终端界面

Pi 的交互界面大致分为四部分。

### 6.1 Startup Header

启动区域会显示：

- 常用快捷键；
- 已加载的 `AGENTS.md` / `CLAUDE.md`；
- Prompt Templates；
- Skills；
- Extensions。

若你发现某个项目规则或 Skill 没生效，先检查这里是否显示已加载。

### 6.2 Messages

这里显示：

- 用户消息；
- 模型回答；
- Thinking 内容；
- Tool Call 与 Tool Result；
- 错误、通知；
- Extension 自定义 UI。

按 `Ctrl+O` 展开或折叠工具输出；按 `Ctrl+T` 展开或折叠 Thinking Block。

### 6.3 Editor

底部输入框用于编写提示词。边框颜色表示当前 Thinking Level。

常用操作：

- `Enter`：提交；
- `Shift+Enter`：换行；
- `Ctrl+G`：在外部编辑器中编辑长提示词；
- `@`：模糊搜索并引用项目文件；
- `Tab`：补全路径或候选项；
- `Ctrl+V`：粘贴文字或图片，Windows/WSL 常用 `Alt+V`。

### 6.4 Footer

底部状态信息通常包括：

- 当前工作目录；
- 会话名称；
- Token 使用；
- Cache Read / Cache Write；
- 最近 Cache Hit Rate；
- 费用；
- Context 占用；
- 当前模型。

常见符号：

- `↑`：输入 Token；
- `↓`：输出 Token；
- `R`：Cache Read；
- `W`：Cache Write；
- `CH`：最近缓存命中率。

费用与用量依赖 Provider 返回的数据，不能把显示值当作最终账单的唯一依据。

---

## 7. 日常输入、文件引用与 Shell 命令

### 7.1 普通任务

直接用自然语言描述：

```text
阅读认证模块，定位刷新令牌偶发失效的原因。先分析，不要修改。
```

建议把需求写成：

```text
目标：修复刷新令牌偶发失效。
范围：仅限 src/auth 和对应测试。
约束：不改变公共 API；不新增依赖；不要提交 Git。
验收：相关单测通过，并说明根因和改动。
```

清楚的范围和验收条件通常比盲目提高 Thinking Level 更有效。

### 7.2 引用文件

交互模式中输入 `@`，再模糊搜索文件。

命令行中：

```bash
pi @README.md "总结这个文件"
pi @src/app.ts @src/app.test.ts "一起审查实现与测试"
pi -p @screenshot.png "解释截图中的错误"
```

### 7.3 多行输入

- macOS/Linux 常用 `Shift+Enter`；
- Windows Terminal 可能需要配置，或使用 `Ctrl+Enter`；
- `Ctrl+G` 可打开外部编辑器，特别适合长需求和结构化提示词。

可在 `~/.pi/agent/settings.json` 配置 VS Code：

```json
{
  "externalEditor": "code --wait"
}
```

### 7.4 图片输入

支持时可以：

- `Ctrl+V` 粘贴图片；
- Windows/WSL 用 `Alt+V`；
- 将图片拖到终端；
- 通过 `@screenshot.png` 引用。

是否能在终端内直接预览，取决于 Kitty/iTerm2 等图片协议和终端能力。即使不能预览，也可能正常发送给支持视觉输入的模型。

### 7.5 `!command` 与 `!!command`

```text
!npm test
```

执行命令，并把输出加入模型上下文。适合让 Agent 根据结果继续分析。

```text
!!git diff
```

执行命令，但不把输出加入模型上下文。适合你自己查看状态，减少 Context 消耗。

注意，这两种是**用户主动执行的命令**。模型自己调用的 `bash` Tool 是另一条路径。

### 7.6 Shell Alias 为什么可能失效

Pi 默认使用非交互式 `bash -c`，Shell Alias 通常不会展开。

可以在设置中加入 `shellCommandPrefix`，但加载整个 Shell 配置可能引入副作用。官方示例：

```json
{
  "shellCommandPrefix": "shopt -s expand_aliases\neval \"$(grep '^alias ' ~/.zshrc)\""
}
```

更稳妥的做法通常是让 Agent 使用真实命令，而不是依赖交互式 Alias。

### 7.7 Agent 工作时追加消息

Pi 允许在 Agent 尚未结束时输入消息：

- `Enter`：排入 **steering message**，当前 Assistant Turn 的工具调用结束后送达；
- `Alt+Enter`：排入 **follow-up message**，整个 Agent 工作完成后送达；
- `Escape`：中止，并把排队消息恢复到编辑器；
- `Alt+Up`：取回队列中的消息。

例子：Agent 正在修改多个文件，你发现它不应碰数据库迁移，可以立刻输入：

```text
停止修改 migrations 目录，其余工作继续。
```

然后按 `Enter`，作为 Steering Message 尽快干预。

---

## 8. 模型与 Thinking / Effort 设置

### 8.1 切换模型

```text
/model
```

快捷键：

```text
Ctrl+L
```

在模型选择器中按 `Ctrl+S` 保存为启动默认模型。

### 8.2 设置 Thinking Level

```text
/thinking
```

可选级别：

```text
off
minimal
low
medium
high
xhigh
max
```

快捷切换：

```text
Shift+Tab
```

保存默认 Thinking：在 `/thinking` 选择器中按 `Ctrl+S`。

### 8.3 启动时指定

```bash
pi --thinking high
pi --model openai/gpt-5:high
```

### 8.4 如何选择级别

| 任务 | 建议级别 |
|---|---|
| 查文件、解释简单代码 | `off` / `minimal` / `low` |
| 普通功能、常规 Bug | `medium` |
| 多模块重构、复杂调试 | `high` |
| 高难度架构、复杂推导 | `xhigh` / `max`，若模型支持 |

更高级别通常意味着：

- 更慢；
- 可能消耗更多 Token；
- 成本可能更高；
- 不保证简单任务更准确。

### 8.5 为什么只能选 `off`

常见原因：

1. 当前模型元数据标记为不支持 Reasoning；
2. 自定义 Provider 配置中没有设置 `"reasoning": true`；
3. Provider 不支持对应参数；
4. `thinkingLevelMap` 把部分级别标记成不支持；
5. 当前模型只支持部分 Thinking Level，Pi 自动进行了 Clamp。

先尝试切换模型：

```text
/model
```

再打开：

```text
/thinking
```

### 8.6 查看真实生效状态

由 Agent 调用 Shell 时，Pi 注入这些变量：

```bash
printf '%s/%s\n' "$PI_PROVIDER" "$PI_MODEL"
printf 'reasoning=%s session=%s\n' "$PI_REASONING_LEVEL" "$PI_SESSION_ID"
```

对应含义：

- `PI_PROVIDER`：当前 Provider；
- `PI_MODEL`：当前模型 ID；
- `PI_REASONING_LEVEL`：当前实际生效级别；
- `PI_SESSION_ID`：当前会话 ID；
- `PI_SESSION_FILE`：当前会话文件。

注意：这些变量注入给模型可调用的 `bash` / `powershell` Tool，不一定注入你手动输入的 `!` 或 `!!` 命令。

### 8.7 配置常用模型循环

```text
/scoped-models
```

选择常用模型并保存后：

- `Ctrl+P`：下一个模型；
- `Shift+Ctrl+P`：上一个模型；
- Windows/WSL 上反向循环也可能使用 `Alt+P`。

也可在设置中配置：

```json
{
  "enabledModels": [
    "claude-*",
    "gpt-5*",
    "gemini-2*"
  ]
}
```

---

## 9. 工具、权限与安全边界

这是 Claude Code 用户迁移时最需要注意的章节。

### 9.1 默认工具

Pi 默认核心工具是：

- `read`：读取文本和图片文件；
- `write`：新建或完整覆写文件；
- `edit`：基于精确文本匹配修改文件；
- `bash`：运行 Shell 命令。

其他可用内置只读工具包括：

- `grep`；
- `find`；
- `ls`；
- Windows 下的 `powershell`。

Extension 可以注册更多工具，也可以覆盖内置工具。

### 9.2 Pi 默认没有权限确认弹窗

Pi 的设计哲学是：不内置一套固定权限 UI。模型调用已启用工具时，命令会以你启动 Pi 的当前系统用户权限执行。

因此必须主动建立安全边界。

### 9.3 新手安全原则

1. 在 Git 仓库中工作；
2. 开始前运行 `git status`；
3. 不要混入不相关的未提交改动；
4. 重要文件先备份；
5. 不在包含生产凭据的目录中随意测试；
6. 不把云端生产权限暴露给 Agent；
7. 对破坏性任务使用容器、VM、受限用户或沙箱；
8. 不安装未审查的 Extension、Skill、Package；
9. 明确提示“不提交、不推送、不部署”，但不要把提示词当作真正权限隔离；
10. 任务完成后自己审查 `git diff`。

### 9.4 启动只读模式

```bash
pi --tools read,grep,find,ls -p "审查这个仓库的安全问题"
```

交互模式也可：

```bash
pi --tools read,grep,find,ls
```

在只读模式下，Agent 没有 `write`、`edit`、`bash`，更适合代码审查。注意：Extension 的自定义工具也要纳入你的工具白名单评估。

### 9.5 禁用部分工具

```bash
pi --exclude-tools bash
pi --exclude-tools write
pi --exclude-tools ask_question
```

禁用全部工具：

```bash
pi --no-tools
```

禁用内置工具，但保留 Extension 工具：

```bash
pi --no-builtin-tools
```

### 9.6 设置默认工具

`~/.pi/agent/settings.json`：

```json
{
  "defaultTools": ["read", "grep", "find", "ls"]
}
```

项目 `.pi/settings.json` 中的 `defaultTools` 会替换全局数组，而不是简单追加。

### 9.7 Project Trust 不是命令审批

Project Trust 决定是否加载项目内动态配置和代码，例如：

- `.pi/settings.json`；
- `.pi/extensions/`；
- `.pi/skills/`；
- `.agents/skills/`；
- 项目 Package。

它并不等于“每个 Bash 命令都需要确认”。若需要逐条确认危险工具调用，要安装或开发权限门禁 Extension，或在系统层使用容器/沙箱。

### 9.8 推荐的防护组合

普通本地开发：

```text
Git + 清晰项目指令 + 任务前 git status + 任务后 git diff
```

陌生仓库：

```text
Project Trust 设为 No + 只读工具 + 不加载项目 Extension
```

高风险代码：

```text
容器/VM + 最小凭据 + 只挂载必要目录 + 权限门禁 Extension
```

生产环境：

```text
不要让通用 Coding Agent 直接持有生产部署、生产数据库和高权限云凭据
```

---

## 10. 会话保存、恢复、分支与压缩

Pi 的树形会话是最值得掌握的功能之一。

### 10.1 自动保存位置

默认保存到：

```text
~/.pi/agent/sessions/
```

按工作目录组织，每个会话是 JSONL 文件。

### 10.2 常用会话命令

```bash
pi -c                    # 继续当前项目最近一次会话
pi -r                    # 打开历史会话选择器
pi --name "修复登录问题" # 启动时命名
pi --no-session          # 临时会话，不保存
pi --session <path|id>   # 打开指定会话
pi --fork <path|id>      # 从指定会话创建分叉
```

Pi 内部：

```text
/session
/name 修复登录问题
/resume
/new
/tree
/fork
/clone
/compact
```

### 10.3 给会话命名

建议每次正式任务开始就执行：

```text
/name auth-refresh-token-fix
```

命名会话比事后依赖第一条消息搜索更可靠。

### 10.4 `/resume`

```text
/resume
```

会话选择器中可以：

- 输入文字搜索；
- `Ctrl+P` 切换路径显示；
- `Ctrl+S` 切换排序；
- `Ctrl+N` 只看已命名会话；
- `Ctrl+R` 重命名；
- `Ctrl+D` 删除并确认。

### 10.5 `/tree`：在同一会话里创建分支

```text
/tree
```

选择历史节点后：

- 若选中用户消息：Pi 回到该消息之前，并把原提示词放回编辑器；修改后重新提交，就创建新分支；
- 若选中 Assistant、Tool 或其他节点：Pi 将该节点作为当前叶子，从那里继续。

常用键：

| 按键 | 操作 |
|---|---|
| `↑` / `↓` | 选择节点 |
| `←` / `→` | 翻页 |
| `Ctrl+←` / `Ctrl+→` | 折叠、展开或跳转分支段 |
| `Shift+L` | 给节点加标签 |
| `Shift+T` | 切换标签时间显示 |
| `Ctrl+O` | 切换过滤模式 |
| `Enter` | 进入所选节点 |
| `Escape` | 取消 |

过滤模式包括：

- default；
- no-tools；
- user-only；
- labeled-only；
- all。

### 10.6 `/tree`、`/fork`、`/clone` 的区别

| 功能 | 结果 | 适用场景 |
|---|---|---|
| `/tree` | 仍在同一个会话 JSONL 中 | 同一问题尝试不同方案 |
| `/fork` | 从较早用户消息创建新会话文件 | 把一条旧路线独立成新任务 |
| `/clone` | 复制当前活动分支到新会话文件 | 当前状态做一份完整副本再继续 |

简单记忆：

- **Tree**：同一本笔记里的分支；
- **Fork**：从旧问题处分一本新笔记；
- **Clone**：把当前整条有效路线复制为新笔记。

### 10.7 双击 Escape

默认连续按两次 `Escape` 会打开 `/tree`。可在设置中改为：

```json
{
  "doubleEscapeAction": "tree"
}
```

可选值：`tree`、`fork`、`none`。

### 10.8 Compaction 是什么

长会话会接近模型 Context Window。Pi 会将较早内容摘要化，保留近期消息，以腾出上下文空间。

自动压缩默认启用。手动执行：

```text
/compact
```

指定摘要重点：

```text
/compact 重点保留接口契约、已修改文件、失败测试、关键决策和下一步
```

默认配置：

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

- `reserveTokens`：给下一次模型回答预留空间；
- `keepRecentTokens`：最近多少 Token 不摘要。

### 10.9 Compaction 会不会丢历史

对模型当前上下文来说，压缩是有损的；摘要可能遗漏细节。

但原始历史仍保存在会话 JSONL 中，可以用 `/tree` 查看。重要信息最好同时保存在：

- 源代码；
- 设计文档；
- `TODO.md`；
- 决策记录；
- 测试和 Git commit。

不要让聊天历史成为关键项目知识的唯一来源。

### 10.10 Branch Summary

使用 `/tree` 离开一条分支时，Pi 可以对被放弃的分支生成摘要，并把重要上下文带入新分支。

适用场景：

- 失败方案中仍发现了重要根因；
- 新路线仍需知道旧路线修改过哪些文件；
- 需要保留旧分支的测试结果和关键决定。

### 10.11 导出与分享

```text
/export
/export session.html
/share
```

- `/export`：导出 HTML 或 JSONL；
- `/share`：上传为私有 GitHub Gist，并生成可分享 HTML 链接。

分享前务必检查是否含有：

- 源代码机密；
- API Key；
- 用户数据；
- 内网地址；
- Tool 输出里的敏感信息。

“Private Gist”并不等于组织级机密存储。

---

## 11. 项目指令：复用 CLAUDE.md 与 AGENTS.md

### 11.1 Pi 会读取哪些文件

Pi 启动时会加载：

- 全局 `~/.pi/agent/AGENTS.md`；
- 从当前目录向上的父目录中的 `AGENTS.md` 或 `CLAUDE.md`；
- 当前目录中的 `AGENTS.md` 或 `CLAUDE.md`。

如果某一级存在 `AGENTS.override.md`，Pi 在该目录中优先加载它，而不是该目录的 `AGENTS.md` 或 `CLAUDE.md`。其他层级的 Context File 仍会继续合并。

这意味着 Claude Code 用户通常可以直接保留现有 `CLAUDE.md`，先不用迁移。

### 11.2 推荐写什么

```markdown
# Project Instructions

## Commands
- Install: `pnpm install`
- Test: `pnpm test`
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck`

## Architecture
- Web app is under `apps/web`.
- Shared contracts are under `packages/contracts`.

## Rules
- Do not modify generated files manually.
- Do not run production migrations.
- Never commit or push unless explicitly requested.
- Preserve existing API compatibility.
- Run relevant tests after changes.

## Style
- Prefer small focused modules.
- Avoid adding dependencies without approval.
```

### 11.3 全局指令和项目指令怎么分

全局 `~/.pi/agent/AGENTS.md` 放个人偏好：

- 默认语言；
- 回答风格；
- 是否允许自动提交；
- 通用安全规则；
- 你常用的审查要求。

项目 `AGENTS.md` / `CLAUDE.md` 放仓库事实：

- 架构；
- 目录；
- 命令；
- 编码规范；
- 业务边界；
- 禁止事项。

### 11.4 修改后如何生效

```text
/reload
```

或者退出并重新启动 Pi。

### 11.5 临时禁用 Context File

```bash
pi --no-context-files
pi -nc
```

适合诊断“是不是项目指令导致 Agent 行为异常”。

### 11.6 System Prompt 文件

完整替换默认 System Prompt：

```text
.pi/SYSTEM.md
~/.pi/agent/SYSTEM.md
```

在默认 System Prompt 后追加：

```text
.pi/APPEND_SYSTEM.md
~/.pi/agent/APPEND_SYSTEM.md
```

新手一般不建议直接替换默认 System Prompt。优先使用 `AGENTS.md`、Skill 或 Prompt Template；替换默认提示词可能削弱工具使用规范和安全约束。

---

## 12. Settings 配置

### 12.1 配置文件位置

| 文件 | 作用域 |
|---|---|
| `~/.pi/agent/settings.json` | 全局 |
| `.pi/settings.json` | 当前项目，覆盖全局 |

项目配置中的嵌套对象会和全局配置合并；同名值由项目配置覆盖。数组类设置通常应确认是替换还是过滤语义，不要假设全部自动合并。

### 12.2 图形化修改

Pi 内输入：

```text
/settings
```

适合新手修改主题、TUI、消息队列、Thinking 等常见选项。

### 12.3 推荐的新手全局配置

```json
{
  "theme": "dark",
  "defaultThinkingLevel": "medium",
  "defaultProjectTrust": "ask",
  "doubleEscapeAction": "tree",
  "hideThinkingBlock": false,
  "showCacheMissNotices": false,
  "externalEditor": "code --wait",
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  },
  "retry": {
    "enabled": true,
    "maxRetries": 3,
    "baseDelayMs": 2000
  },
  "steeringMode": "one-at-a-time",
  "followUpMode": "one-at-a-time"
}
```

如果不使用 VS Code，请删除 `externalEditor` 或改成自己的编辑器。

### 12.4 常见设置说明

#### 模型与推理

```json
{
  "defaultProvider": "openai",
  "defaultModel": "your-model-id",
  "defaultThinkingLevel": "medium",
  "modelThinkingLevels": {
    "openai/your-model-id": "high"
  },
  "hideThinkingBlock": false
}
```

建议通过 `/model` 和 `/thinking` 中的 `Ctrl+S` 保存，避免手写错模型 ID。

#### 项目信任

```json
{
  "defaultProjectTrust": "ask"
}
```

可选：

- `ask`：有 UI 时询问，新手推荐；
- `always`：默认信任，风险更高；
- `never`：默认不加载项目动态资源。

#### TUI 模式

```json
{
  "tuiMode": "regular",
  "fullscreenExitOutput": "transcript",
  "fullscreenScrollbar": "auto"
}
```

- `regular`：使用终端原生 Scrollback，稳定易用；
- `fullscreen`：Pi 自己管理视口，编辑器和状态区固定在底部，目前属于实验模式。

新手建议先使用 `regular`。

#### 重试

```json
{
  "retry": {
    "enabled": true,
    "maxRetries": 3,
    "baseDelayMs": 2000,
    "provider": {
      "maxRetries": 0,
      "maxRetryDelayMs": 60000
    }
  }
}
```

官方建议除非明确需要，保持 Provider 层 `maxRetries` 为 `0`，避免某些配额错误在底层长时间等待。

#### 网络代理

```json
{
  "httpProxy": "http://127.0.0.1:7890"
}
```

这是全局设置。也可以使用 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量。

#### 长缓存

支持的 Provider 可使用：

```bash
export PI_CACHE_RETENTION=long
pi
```

是否产生费用和缓存收益取决于 Provider。

### 12.5 离线与遥测

关闭版本检查：

```bash
export PI_SKIP_VERSION_CHECK=1
```

关闭安装/更新遥测与部分 Provider Attribution Header：

```bash
export PI_TELEMETRY=0
```

禁用全部启动阶段网络操作：

```bash
PI_OFFLINE=1 pi
# 或
pi --offline
```

`PI_OFFLINE` 会禁用更新检查、Package 更新检查和安装/更新遥测，但不会让模型 API 本身“离线可用”；远程模型仍需要网络。

---

## 13. Prompt Templates：可复用提示词

Prompt Template 是 Markdown 提示词片段，通过 `/名称` 展开。

### 13.1 存放位置

全局：

```text
~/.pi/agent/prompts/*.md
```

项目：

```text
.pi/prompts/*.md
```

项目资源需要先信任项目。

### 13.2 最小示例

创建 `~/.pi/agent/prompts/review.md`：

```markdown
---
description: 审查当前 Git 改动
---
请审查当前未提交改动。重点检查：
- 逻辑错误
- 安全问题
- 兼容性回归
- 错误处理
- 测试遗漏

先读取 `git status` 和 `git diff`，不要修改文件。
```

在 Pi 中输入：

```text
/review
```

### 13.3 参数

`~/.pi/agent/prompts/test-file.md`：

```markdown
---
description: 为指定文件补测试
argument-hint: "<file> [test-command]"
---
为 `$1` 补充必要测试。
约束：保持现有测试风格，不修改无关实现。
完成后运行：`${2:-相关的最小测试命令}`。
```

调用：

```text
/test-file src/auth/token.ts "pnpm test token"
```

支持：

- `$1`、`$2`：位置参数；
- `$@` 或 `$ARGUMENTS`：全部参数；
- `${1:-default}`：默认值；
- `${@:N}`：从第 N 个参数开始；
- `${@:N:L}`：从第 N 个开始取 L 个。

### 13.4 什么时候用 Template

适合：

- 每周重复的 Review 提示词；
- 固定格式的 Bug 排查；
- PR 审查；
- Release Check；
- 测试补全；
- 输出固定模板的报告。

如果流程需要脚本、参考资料、复杂步骤或专用工具，使用 Skill；如果要拦截运行时或增加工具，使用 Extension。

---

## 14. Skills：按需加载专业能力

### 14.1 Skill 是什么

Skill 是一个包含 `SKILL.md` 的能力目录，可以同时带：

- 专业工作流说明；
- 脚本；
- 参考文档；
- 模板和资产。

Pi 启动时只加载 Skill 名称和描述；匹配任务时读取完整说明，这叫 Progressive Disclosure。

### 14.2 存放位置

全局：

```text
~/.pi/agent/skills/
~/.agents/skills/
```

项目：

```text
.pi/skills/
.agents/skills/
```

`.agents/skills/` 会从当前目录向父目录发现，直到 Git 根或文件系统根。项目 Skill 需要 Project Trust。

### 14.3 Skill 目录结构

```text
my-skill/
├── SKILL.md
├── scripts/
│   └── process.sh
├── references/
│   └── api.md
└── assets/
    └── template.json
```

### 14.4 最小 Skill

`~/.pi/agent/skills/release-check/SKILL.md`：

```markdown
---
name: release-check
description: 审查发布准备状态，包括版本、变更日志、测试、构建和 Git 状态。用户要求发版检查或 release audit 时使用。
---

# Release Check

1. 读取项目发布说明和 package metadata。
2. 检查 Git 工作区状态，不自动提交。
3. 运行项目定义的最小测试、类型检查和构建。
4. 检查版本号、Changelog 和 Breaking Changes。
5. 输出：阻塞项、风险项、可发布项、建议下一步。
6. 未经用户明确授权，不发布、不推送、不创建 Tag。
```

### 14.5 强制调用 Skill

```text
/skill:release-check
```

带参数：

```text
/skill:release-check 检查 1.4.0 发布候选版本
```

模型也可能根据 Skill 描述自动加载。若任务重要，建议明确使用 `/skill:name`。

### 14.6 复用 Claude Code Skill

全局设置：

```json
{
  "skills": [
    "~/.claude/skills",
    "~/.codex/skills"
  ]
}
```

项目 `.pi/settings.json`：

```json
{
  "skills": ["../.claude/skills"]
}
```

复用前仍要检查：

- Skill 是否引用 Claude Code 专有工具；
- 路径是否正确；
- 命令是否存在；
- Frontmatter 是否有有效 `name` 和 `description`；
- 是否包含不适用于 Pi 的权限或 Hook 假设。

### 14.7 Skill 安全

Skill 可以指导模型执行命令，并可能携带可执行脚本。安装或复制第三方 Skill 前，应审查：

- `SKILL.md`；
- `scripts/`；
- 安装步骤；
- 网络请求；
- 凭据读取；
- 删除和覆盖行为；
- 是否会上传本地内容。

---

## 15. Extensions：Pi 最重要的扩展机制

### 15.1 Extension 能做什么

Extension 是 TypeScript 模块，可深入 Pi 生命周期：

- 添加模型可调用的 Tool；
- 添加 Slash Command；
- 添加快捷键；
- 监听 Session、Agent、Message、Tool、Model 事件；
- 阻止危险 Tool Call；
- 修改 Tool 参数或结果；
- 修改每轮 System Prompt；
- 添加确认框、选择框、状态栏、Widget、Overlay；
- 自定义 Session Compaction；
- 注册自定义 Provider；
- 覆盖内置 Tool；
- 实现 SSH、沙箱、Git checkpoint、MCP、Sub-agent 等。

这也是 Pi 相比固定工作流型 Agent 最明显的优势。

### 15.2 存放位置

全局：

```text
~/.pi/agent/extensions/*.ts
~/.pi/agent/extensions/*/index.ts
```

项目：

```text
.pi/extensions/*.ts
.pi/extensions/*/index.ts
```

项目 Extension 只在项目受信任后加载。

### 15.3 第一个 Extension：危险命令确认

创建：

```text
~/.pi/agent/extensions/safety-gate.ts
```

内容：

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;

    const command = String(event.input.command ?? "");
    const dangerous = [
      /rm\s+-rf\b/,
      /git\s+reset\s+--hard\b/,
      /git\s+clean\s+-[^\n]*f/,
      /git\s+push\s+[^\n]*--force/,
      /sudo\b/,
    ].some((pattern) => pattern.test(command));

    if (!dangerous) return;

    const allowed = await ctx.ui.confirm(
      "检测到高风险命令",
      `是否允许执行？\n\n${command}`,
    );

    if (!allowed) {
      return {
        block: true,
        reason: "用户拒绝执行高风险命令",
        terminate: true,
      };
    }
  });
}
```

然后在 Pi 中：

```text
/reload
```

或退出重启。

> 该示例只是入门演示，并非完整安全方案。命令可通过脚本、编码、子进程或其他工具间接执行；真正隔离仍应依靠容器、VM 和最小权限。

### 15.4 临时测试 Extension

```bash
pi -e ./my-extension.ts
```

`-e` 适合测试。希望 `/reload` 自动发现，应放进全局或项目 `extensions/` 目录。

### 15.5 Extension 的安全等级

Extension 以当前用户完整系统权限执行任意代码。风险高于普通配置文件，也不应因为它是 npm 包就默认可信。

安装前检查：

1. 源码；
2. npm install scripts；
3. 依赖树；
4. 网络请求；
5. 文件系统访问；
6. 凭据访问；
7. Tool 拦截与参数改写；
8. 是否把会话或代码上传到外部。

### 15.6 新手建议

不要第一天就安装十几个 Extension。建议顺序：

1. 先用纯 Pi 完成几个小任务；
2. 明确一个真实痛点；
3. 找到或开发一个对应 Extension；
4. 阅读源码；
5. 在测试仓库启用；
6. 验证后再全局安装。

---

## 16. Pi Packages：安装与分享能力包

Pi Package 可以组合：

- Extensions；
- Skills；
- Prompt Templates；
- Themes。

### 16.1 安装

```bash
pi install npm:@foo/pi-tools
pi install npm:@foo/pi-tools@1.2.3
pi install git:github.com/user/repo
pi install git:github.com/user/repo@v1
pi install https://github.com/user/repo
pi install ./local-package
```

默认安装到全局配置。项目本地安装：

```bash
pi install -l npm:@foo/pi-tools
```

项目安装会写入 `.pi/settings.json`，适合团队共享，但团队成员首次加载时仍应审查并信任项目。

### 16.2 管理

```bash
pi list
pi config
pi remove npm:@foo/pi-tools
pi uninstall npm:@foo/pi-tools
pi update --extensions
pi update --all
```

`pi config` 可以启用或禁用 Package 中的 Extension、Skill、Prompt、Theme。

### 16.3 临时试用

```bash
pi -e npm:@foo/pi-tools
pi -e git:github.com/user/repo
```

这只对当前运行生效，适合评估。

### 16.4 固定版本

生产型工作流建议固定版本：

```bash
pi install npm:@foo/pi-tools@1.2.3
pi install git:github.com/user/repo@具体tag或commit
```

固定版本不会自动移动到新版本。需要升级时显式修改版本或 Git Ref。

### 16.5 Package 安全

Pi 官方明确警告：Package 运行时拥有完整系统访问能力。Extension 可执行任意代码，Skill 可指示模型执行任意行为。

原则：

- 不安装来源不明的包；
- 优先固定版本；
- 阅读 Package Manifest 和源码；
- 查看依赖与安装脚本；
- 在隔离仓库试运行；
- 不让测试中的 Package 接触生产凭据。

---

## 17. 主题、快捷键与终端体验

### 17.1 主题

内置主题：

```text
dark
light
```

通过 `/settings` 选择，或临时启动：

```bash
pi --use-theme light
pi --use-theme light/dark
```

自定义主题放在：

```text
~/.pi/agent/themes/*.json
.pi/themes/*.json
```

正在使用的自定义主题支持热重载。

### 17.2 常用快捷键

| 快捷键 | 功能 |
|---|---|
| `Enter` | 提交；Agent 忙时排入 Steering Message |
| `Shift+Enter` | 换行 |
| `Ctrl+G` | 外部编辑器 |
| `Ctrl+C` | 清空编辑器；连续两次退出 |
| `Escape` | 中止当前工作或关闭选择器 |
| 连按两次 `Escape` | 默认打开 `/tree` |
| `Ctrl+L` | 模型选择器 |
| `Ctrl+P` | 下一个 Scoped Model |
| `Shift+Ctrl+P` | 上一个 Scoped Model |
| `Shift+Tab` | 循环 Thinking Level |
| `Ctrl+O` | 展开/折叠 Tool Output |
| `Ctrl+T` | 展开/折叠 Thinking Block |
| `Ctrl+X` | 复制上一条 Assistant 消息或当前选择 |
| `Alt+Enter` | 排入 Follow-up Message |
| `Alt+Up` | 取回排队消息 |
| `Ctrl+V` | 粘贴文字/图片，Windows/WSL 常用 `Alt+V` |

随时查看完整快捷键：

```text
/hotkeys
```

### 17.3 自定义快捷键

文件：

```text
~/.pi/agent/keybindings.json
```

示例：

```json
{
  "tui.editor.historyPrevious": "ctrl+p",
  "tui.editor.historyNext": "ctrl+n",
  "tui.editor.deleteWordBackward": ["ctrl+w", "alt+backspace"]
}
```

修改后：

```text
/reload
```

### 17.4 推荐终端

Pi 使用 Kitty Keyboard Protocol 改善组合键识别。体验较好的现代终端包括：

- Kitty；
- Ghostty；
- WezTerm；
- iTerm2；
- Alacritty；
- 新版 VS Code Integrated Terminal；
- Windows Terminal，部分按键需配置。

### 17.5 Shift+Enter 不工作

可能是终端无法区分 `Shift+Enter` 和普通 `Enter`。

可尝试：

1. `Ctrl+J`，Pi 默认也将它作为换行；
2. 使用 `Ctrl+G` 打开外部编辑器；
3. 更换支持 Kitty Keyboard Protocol 的终端；
4. 按官方 Terminal Setup 为 Windows Terminal、旧版 VS Code、WezTerm 或 Alacritty 增加按键映射。

### 17.6 中文输入法候选框位置异常

可尝试：

```bash
PI_HARDWARE_CURSOR=1 pi
```

或设置：

```json
{
  "showHardwareCursor": true
}
```

### 17.7 Fullscreen 模式

启动：

```bash
pi --tui-mode fullscreen
```

Fullscreen 会固定底部编辑器和状态区，由 Pi 管理消息滚动。它更像完整终端应用，但目前为实验模式；若滚动、图片或选择复制异常，回到：

```bash
pi --tui-mode regular
```

---

## 18. 非交互模式与自动化

### 18.1 Print 模式

执行一次任务，输出答案并退出：

```bash
pi -p "总结这个代码仓库"
pi --print "解释当前构建错误"
```

### 18.2 通过管道输入

```bash
cat README.md | pi -p "用中文总结，最多 10 条"
git diff | pi -p "审查这个 Diff，只输出高风险问题"
```

### 18.3 引用文件

```bash
pi -p @README.md "总结"
pi -p @src/app.ts @src/app.test.ts "检查测试覆盖"
```

### 18.4 Print 模式的安全建议

默认情况下 Agent 仍可能拥有工具，不要把 `-p` 理解为只读模式。

只读审查：

```bash
pi -p --tools read,grep,find,ls "审查当前代码，不修改"
```

无工具纯问答：

```bash
pi -p --no-tools "解释 OAuth PKCE 的工作原理"
```

### 18.5 JSON 模式

```bash
pi --mode json
```

用于消费流式 JSONL 事件。适合脚本、日志处理和自动化框架。不要用普通文本解析去猜事件边界。

### 18.6 RPC 模式

```bash
pi --mode rpc
```

通过 stdin/stdout 发送 LF 分隔 JSONL 命令，适合非 Node.js 应用集成。

### 18.7 SDK

TypeScript 示例：

```typescript
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

const modelRuntime = await ModelRuntime.create();
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  modelRuntime,
});

await session.prompt("这个目录里有哪些文件？");
```

若只是日常开发，新手暂时不需要 RPC 和 SDK。它们用于把 Pi 作为 Agent Runtime 嵌入其他程序。

### 18.8 常用 CLI 参数

```text
pi [options] [--] [@files...] [messages...]
```

| 参数 | 作用 |
|---|---|
| `-p`, `--print` | 单次输出并退出 |
| `--mode json` | JSONL 事件模式 |
| `--mode rpc` | RPC 模式 |
| `--provider <name>` | 指定 Provider |
| `--model <pattern>` | 指定模型 |
| `--thinking <level>` | 指定 Thinking Level |
| `--models <patterns>` | 限定可循环模型 |
| `--tools <list>` | 严格工具白名单 |
| `--exclude-tools <list>` | 排除工具 |
| `--no-tools` | 禁用全部工具 |
| `--no-builtin-tools` | 禁用内置工具 |
| `-c`, `--continue` | 恢复最近会话 |
| `-r`, `--resume` | 选择历史会话 |
| `--no-session` | 不保存会话 |
| `--name`, `-n` | 设置会话名称 |
| `-e`, `--extension` | 临时加载 Extension |
| `--skill <path>` | 加载指定 Skill |
| `--no-skills` | 禁用 Skill 自动发现 |
| `--no-context-files`, `-nc` | 不加载项目指令 |
| `-a`, `--approve` | 本次运行信任项目资源 |
| `-na`, `--no-approve` | 本次运行忽略项目资源 |
| `--offline` | 禁止启动阶段联网操作 |
| `--` | 停止解析参数，后面都视为输入 |

若提示词以 `-` 开头，要使用：

```bash
pi -p -- "- 请总结以下几点"
```

---

## 19. 从 Claude Code 迁移的推荐方式

不要一次性完全迁移。推荐并行使用一段时间。

### 19.1 第一阶段：复用现有项目指令

如果仓库已有：

```text
CLAUDE.md
```

Pi 会读取它。先验证启动 Header 是否显示已加载，不需要马上改名为 `AGENTS.md`。

### 19.2 第二阶段：复用 Skills

把 Claude 全局 Skill 路径添加到 Pi：

```json
{
  "skills": ["~/.claude/skills"]
}
```

逐个验证，不要默认所有 Skill 都兼容。

### 19.3 第三阶段：迁移高频命令为 Prompt Template

把你在 Claude Code 中经常手写的提示词改成：

```text
~/.pi/agent/prompts/*.md
```

例如：

- `/review`；
- `/fix-test`；
- `/release-check`；
- `/explain-diff`。

### 19.4 第四阶段：配置两三个常用模型

使用 `/scoped-models` 只保留你真正会切换的模型。模型太多会增加选择成本。

建议角色化：

- 一个日常编码模型；
- 一个复杂推理模型；
- 一个快速/低成本模型。

### 19.5 第五阶段：补齐权限保护

Claude Code 用户最容易忽略这一点。迁移到 Pi 后，应至少选择一种：

- 默认只读 Tool；
- 权限门禁 Extension；
- 容器；
- 受限系统用户；
- Git checkpoint 工作流。

### 19.6 第六阶段：只对真实痛点开发 Extension

可优先考虑：

1. 危险命令确认；
2. 路径保护；
3. Git checkpoint；
4. 项目专用命令；
5. 内部 API Tool；
6. 自定义 Provider；
7. 多 Agent / tmux 编排。

### 19.7 Claude Code 与 Pi 并行使用时

注意：

- 两个 Agent 不要同时修改同一工作区；
- 每个任务用独立 Git branch 或 worktree；
- 不要让两个会话同时运行格式化、依赖升级或代码生成；
- `CLAUDE.md` 写跨工具都能理解的规则；
- 专属于某个 Harness 的逻辑放到各自配置目录；
- 会话数据分别保存，不要假设能原生互相恢复。

---

## 20. 推荐的实际开发工作流

### 20.1 仓库理解

```bash
cd /path/to/repo
pi --tools read,grep,find,ls
```

提示词：

```text
只读分析仓库。输出：
1. 技术栈；
2. 目录职责；
3. 入口与数据流；
4. 开发、测试、构建命令；
5. 高风险区域；
6. 建议我下一步先读的 5 个文件。
不要修改文件。
```

### 20.2 小型 Bug 修复

```text
/name fix-token-refresh
```

```text
目标：修复刷新令牌偶发失效。
范围：src/auth 和直接相关测试。
约束：不改公共 API、不新增依赖、不提交。
步骤：
1. 复现或定位根因；
2. 给出简短修复方案；
3. 实施最小修改；
4. 运行相关测试；
5. 展示 git diff 摘要和剩余风险。
```

### 20.3 大型重构

先让 Agent 写计划文件，而不是依赖内置 Plan Mode：

```text
先只分析并创建 docs/refactor-plan.md，包含目标、非目标、影响面、迁移步骤、风险、测试策略和回滚方案。此阶段不要修改生产代码。
```

确认后：

```text
按 docs/refactor-plan.md 执行第一阶段。每完成一个可验证单元就运行相关测试，并更新计划中的进度。不要跨阶段扩张范围。
```

### 20.4 比较两个方案

1. 先完成方案 A；
2. 用 `/tree` 回到设计节点；
3. 修改原提示词为方案 B；
4. 在两个分支上分别验证；
5. 给关键节点用 `Shift+L` 添加标签；
6. 最后选择更好的分支继续。

### 20.5 Code Review

```bash
pi --tools read,grep,find,ls -p "读取 git diff，审查逻辑、安全、兼容性和测试遗漏。只报告有证据的问题，不修改。"
```

如果需要 Shell 读取 Git Diff，可启用 `bash`，但风险也随之增加：

```bash
pi --tools read,grep,find,ls,bash -p "审查当前 git diff，不修改任何文件。"
```

### 20.6 测试失败排查

```text
!pnpm test
```

然后：

```text
根据刚才测试输出定位根因。先区分：产品 Bug、测试 Bug、环境问题、Flaky Test。给出证据链后再修改；只运行最小相关测试验证。
```

### 20.7 长任务中的干预

如果 Agent 跑偏，输入 Steering Message 并按 Enter：

```text
不要继续全仓库重构，只保留 auth 模块的最小修复，并撤销刚才对公共类型的无关改动。
```

如果只是想让当前任务完成后再做一件事，用 `Alt+Enter`：

```text
完成后再运行一次类型检查，并总结未解决警告。
```

### 20.8 任务结束检查

建议固定执行：

```text
请做最终检查：
1. git status；
2. git diff；
3. 是否改了范围外文件；
4. 是否残留调试代码；
5. 是否新增依赖；
6. 已运行哪些验证；
7. 尚未验证什么；
8. 不要提交。
```

你自己再执行：

```text
!!git status --short
!!git diff
```

---

## 21. 常见问题与排障

### 21.1 `pi: command not found`

检查全局 npm bin：

```bash
npm prefix -g
npm bin -g 2>/dev/null || true
which pi
```

确保全局 bin 在 `PATH` 中。若使用 `nvm`、`mise`、`fnm`，确认当前 Node 版本就是安装 Pi 时的版本。

### 21.2 `/model` 中没有模型

排查：

1. 是否完成 `/login`；
2. API Key 是否有效；
3. Provider 是否需要其他环境变量；
4. 执行 `pi update --models`；
5. 检查自定义 `models.json`；
6. 用 `pi --list-models` 查看；
7. 网络或代理是否阻止请求。

### 21.3 Thinking 一直是 `off`

- 当前模型可能不支持；
- 切换一个 Reasoning 模型；
- 自定义模型需要 `"reasoning": true`；
- Provider 可能不支持 Reasoning 参数；
- 某些级别可能被 `thinkingLevelMap` 禁用。

### 21.4 项目 Skill / Extension 没加载

检查：

1. 项目是否受信任；
2. 文件位置是否是 `.pi/skills`、`.agents/skills` 或 `.pi/extensions`；
3. Skill 是否有有效 Frontmatter；
4. Extension 是否导出默认函数；
5. 启动 Header 是否列出资源；
6. 执行 `/reload`；
7. 用 `/trust` 保存后是否已重启。

### 21.5 修改设置后不生效

执行：

```text
/reload
```

仍无效时检查 JSON 格式、配置作用域和项目覆盖。项目 `.pi/settings.json` 可能覆盖全局值。

### 21.6 Agent 看不到最新文件

让它重新读取文件，或者明确提示：

```text
文件已被外部修改，请重新读取，不要依赖之前上下文中的旧内容。
```

若你修改了 `AGENTS.md`、Skill、Prompt 或 Extension，则执行 `/reload`。

### 21.7 上下文快满了

查看 Footer Context 使用，执行：

```text
/compact 重点保留当前目标、关键决策、修改文件、测试结果和下一步
```

也可以：

- 新开 `/new`；
- 用 `/clone` 复制有效分支；
- 把关键状态写入项目 Markdown；
- 避免把巨大日志通过 `!` 加入上下文；
- 用 `!!` 查看只给自己看的输出。

### 21.8 Shell 输出被截断

内置 Tool 通常会限制大输出，避免 Context 爆炸。完整输出可能保存到临时文件，消息中会给路径。

更好的方式：

- 使用 `rg` 精确搜索；
- 日志只取尾部；
- 分段读取文件；
- 只运行最小测试；
- 避免输出整个 `node_modules` 或巨大 JSON。

### 21.9 Escape 或 Alt 快捷键异常

可能是终端、tmux 或 SSH 对 Escape 序列的处理问题。可调整：

```bash
export PI_TUI_ESC_TIMEOUT=100
```

数值单位是毫秒。SSH 下默认等待通常更长。也可在终端中配置 Kitty Keyboard Protocol。

### 21.10 图片不显示

检查：

- 当前终端是否支持 Kitty 或 iTerm2 图片协议；
- `terminal.showImages` 是否为 `true`；
- 是否使用 Fullscreen，iTerm2 Fullscreen 下可能显示占位符；
- 模型是否支持图片输入；
- 是否设置了 `images.blockImages: true`。

可强制协议，但错误配置可能破坏终端显示：

```bash
PI_IMAGE_PROTOCOL=kitty pi
PI_IMAGE_PROTOCOL=iterm2 pi
```

### 21.11 费用异常

检查：

1. Provider 真实计费规则；
2. 是否启用了高 Thinking；
3. 是否频繁切换模型导致 Prompt Cache 失效；
4. 是否重复发送大文件或大日志；
5. 是否有 Tool 内嵌套模型调用；
6. Anthropic Subscription 是否走 Extra Usage；
7. `/session` 中的用量只作为参考，最终以 Provider 账单为准。

### 21.12 如何查看当前会话信息

```text
/session
```

或让 Agent 执行：

```bash
printf 'provider=%s\nmodel=%s\nreasoning=%s\nsession=%s\nfile=%s\n' \
  "$PI_PROVIDER" "$PI_MODEL" "$PI_REASONING_LEVEL" \
  "$PI_SESSION_ID" "$PI_SESSION_FILE"
```

### 21.13 Pi 修改错了，怎么恢复

优先用 Git：

```bash
git status
git diff
```

不要盲目执行 `git reset --hard`，它会丢弃所有未提交改动，包括你自己的改动。更安全的是：

- 手动还原特定 Hunk；
- 使用 IDE 的 Local History；
- 使用 `git restore <明确文件>`，前提是确认文件中没有要保留的改动；
- 在任务开始前使用独立 Branch/Worktree；
- 使用 Git checkpoint Extension，但安装前审查。

### 21.14 怎么彻底退出

```text
/quit
```

或连续按两次 `Ctrl+C`。编辑器为空时也可按 `Ctrl+D`。

---

## 22. 命令与快捷键速查表

### 22.1 最常用 Slash Commands

| 命令 | 功能 |
|---|---|
| `/login` | 登录或配置 Provider |
| `/logout` | 清除 Provider 凭据 |
| `/model` | 切换模型，`Ctrl+S` 保存默认 |
| `/thinking` | 切换推理级别，`Ctrl+S` 保存默认 |
| `/scoped-models` | 配置快速轮换模型 |
| `/settings` | 修改常用设置 |
| `/name <name>` | 命名会话 |
| `/session` | 查看会话、Token、费用等信息 |
| `/resume` | 恢复历史会话 |
| `/new` | 新会话 |
| `/tree` | 浏览和切换会话分支 |
| `/fork` | 从旧用户消息创建新会话 |
| `/clone` | 复制当前活动分支为新会话 |
| `/compact [说明]` | 压缩上下文 |
| `/copy` | 复制最后一条 Assistant 消息 |
| `/export [file]` | 导出会话 |
| `/import <file>` | 导入 JSONL 会话 |
| `/share` | 通过私有 GitHub Gist 分享 |
| `/trust` | 保存项目信任决策，重启生效 |
| `/reload` | 重载配置资源 |
| `/hotkeys` | 查看快捷键 |
| `/changelog` | 查看版本更新 |
| `/quit` | 退出 |

### 22.2 最常用 CLI

```bash
pi                                      # 当前目录启动交互会话
pi -c                                   # 继续最近会话
pi -r                                   # 选择历史会话
pi --name "任务名"                       # 启动并命名
pi --thinking high                      # 高推理级别启动
pi --model provider/model               # 指定模型
pi -p "问题"                            # 单次执行
pi -p @file "问题"                      # 带文件单次执行
pi --tools read,grep,find,ls             # 只读模式
pi --no-session                         # 不保存会话
pi --no-context-files                   # 不加载项目指令
pi --list-models                        # 列模型
pi update --models                      # 更新模型目录
pi update --all                         # 更新 Pi 与 Package
pi config                               # 配置 Package 资源
```

### 22.3 最常用快捷键

```text
Ctrl+L             模型选择
Shift+Tab          Thinking Level
Ctrl+P             下一个 Scoped Model
Ctrl+O             展开/折叠工具输出
Ctrl+T             展开/折叠 Thinking
Ctrl+G             外部编辑器
Shift+Enter        输入换行
Escape             中止
Escape, Escape     会话树
Ctrl+X             复制最后回答
Alt+Enter          Follow-up Queue
Alt+Up             取回排队消息
```

---

## 23. 30 分钟上手清单

按下面顺序完成，你就具备日常使用 Pi 的基本能力。

### 0～5 分钟：安装与认证

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi --version
cd /path/to/test-repo
pi
```

然后：

```text
/login
/model
/thinking
```

选择一个模型，将 Thinking 设置为 `medium`，在两个选择器中按 `Ctrl+S` 保存默认。

### 5～10 分钟：只读理解仓库

```text
请只读分析仓库结构、技术栈、启动方式和测试命令，不要修改。
```

尝试：

- 输入 `@` 引用文件；
- `Ctrl+O` 展开工具输出；
- `Ctrl+T` 切换 Thinking 显示；
- `/session` 查看当前状态。

### 10～15 分钟：完成小修改

```text
/name pi-first-change
```

让 Pi 修改一个低风险文件，要求它运行最小验证。然后：

```text
!!git status --short
!!git diff
```

### 15～20 分钟：体验会话树

1. 让 Pi 提出方案 A；
2. 连按两次 `Escape`；
3. 回到旧提示词；
4. 改成方案 B；
5. 观察 `/tree` 中两条分支。

### 20～25 分钟：创建 Prompt Template

创建：

```text
~/.pi/agent/prompts/review.md
```

写入自己的 Review 模板，执行 `/reload`，然后输入：

```text
/review
```

### 25～30 分钟：建立安全习惯

至少完成下面三项：

- 确认 `defaultProjectTrust` 为 `ask`；
- 学会用 `--tools read,grep,find,ls`；
- 创建独立 Git Branch 或 Worktree 再让 Agent 做大改动。

---

## 最后的建议

对于 Claude Code 老用户，Pi 最有效的上手方式不是先研究全部 API，而是先形成以下肌肉记忆：

```text
cd 项目
→ git status
→ pi
→ /name
→ /model 和 /thinking
→ 明确目标、范围、约束、验收
→ 用 Steering Message 及时纠偏
→ 用 /tree 比较路线
→ 必要时 /compact
→ 最后自己检查 git diff 和测试
```

先熟练这几个核心能力：

1. 多模型与 Thinking 切换；
2. `@file`、`!`、`!!`；
3. Steering / Follow-up Queue；
4. `/tree`、`/fork`、`/clone`；
5. `AGENTS.md` / `CLAUDE.md`；
6. Prompt Templates 和 Skills；
7. 最小工具集与安全隔离。

等你明确感受到某个重复痛点，再通过 Extension 或 Package 定制。这样既能获得 Pi 的自由度，也不会在真正开始开发之前陷入过度配置。

---

## 官方本机文档位置

当前安装对应文档位于：

```text
/Users/wuweixiang/.local/lib/node_modules/@earendil-works/pi-coding-agent/README.md
/Users/wuweixiang/.local/lib/node_modules/@earendil-works/pi-coding-agent/docs/
/Users/wuweixiang/.local/lib/node_modules/@earendil-works/pi-coding-agent/examples/
```

重点文档：

```text
docs/quickstart.md
docs/usage.md
docs/providers.md
docs/settings.md
docs/sessions.md
docs/compaction.md
docs/keybindings.md
docs/terminal-setup.md
docs/prompt-templates.md
docs/skills.md
docs/extensions.md
docs/packages.md
docs/models.md
docs/sdk.md
docs/rpc.md
```

在线入口：<https://pi.dev>
