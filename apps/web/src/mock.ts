export type AgentStatus = '启用' | '停用' | '归档'
export type ConfigStatus = '配置完整' | '外部变化' | '缺少 Rules'
export type Agent = { id: string; name: string; status: AgentStatus; config: ConfigStatus; updated: string }
export type Asset = { id: string; name: string; kind: string; owner: string; scope: string; refs: number; path: string; status: string }
import type { BuiltInClientId } from './client-adapters'

export type AiClientKind = BuiltInClientId
export type AiClient = {
  id: BuiltInClientId
  kind: AiClientKind
  name: string
  shortName: string
  description: string
  detection: 'not-checked'
  persistence: 'initial-demo' | 'memory-only'
}

export const aiClients: AiClient[] = [
  { id:'claude-code', kind:'claude-code', name:'Claude Code', shortName:'CC', description:'Anthropic 的命令行 AI 编程工具', detection:'not-checked', persistence:'initial-demo' },
  { id:'claude-desktop', kind:'claude-desktop', name:'Claude Desktop', shortName:'CD', description:'Anthropic 的桌面 AI 助手', detection:'not-checked', persistence:'memory-only' },
  { id:'codex', kind:'codex', name:'ChatGPT', shortName:'CG', description:'包含 Codex 编程能力的 OpenAI 桌面应用', detection:'not-checked', persistence:'memory-only' },
  { id:'gemini-cli', kind:'gemini-cli', name:'Gemini CLI', shortName:'GE', description:'Google 的命令行 AI 编程工具', detection:'not-checked', persistence:'memory-only' },
  { id:'grok-build', kind:'grok-build', name:'Grok Build', shortName:'GB', description:'xAI 的 AI 编程工具', detection:'not-checked', persistence:'memory-only' },
  { id:'opencode', kind:'opencode', name:'OpenCode', shortName:'OC', description:'开源 AI 编程工具', detection:'not-checked', persistence:'memory-only' },
  { id:'openclaw', kind:'openclaw', name:'OpenClaw', shortName:'CL', description:'开源 AI 助手', detection:'not-checked', persistence:'memory-only' },
  { id:'hermes', kind:'hermes', name:'Hermes', shortName:'HE', description:'Nous Research 的 AI Agent', detection:'not-checked', persistence:'memory-only' },
  { id:'pi', kind:'pi', name:'Pi', shortName:'PI', description:'命令行 AI 编程 Agent', detection:'not-checked', persistence:'memory-only' },
]

export const assets: Asset[] = [
  { id:'sop-delivery', name:'软件功能交付', kind:'SOP', owner:'星河科技', scope:'Team 共享', refs:7, path:'.claude/sops/software-delivery.md', status:'已保存' },
  { id:'rule-common', name:'公共安全边界', kind:'Rules', owner:'星河科技', scope:'公司共享', refs:6, path:'~/.bandi/shared/rules/common.md', status:'已保存' },
  { id:'skill-review', name:'代码审查', kind:'Skill', owner:'星河科技', scope:'公司共享', refs:4, path:'~/.bandi/shared/skills/code-review', status:'已保存' },
  { id:'mcp-bandi', name:'Bandi MCP', kind:'MCP', owner:'系统', scope:'用户级', refs:13, path:'.claude.json', status:'已配置' },
]
