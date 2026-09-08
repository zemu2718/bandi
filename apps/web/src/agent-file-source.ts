import { getAgentFileAssociation, type AgentProjectionContext } from './agent-config-projection'
import type { FullAgent } from './domain'
import { agentRootConfigPaths, serializeAgentConfig, snapshotAgentConfig, type AgentConfigPayload } from './agent-config-model'
import { getAgentPackageEditability } from './agent-package-schema'

export type AgentFileSource =
  | { status: 'available'; provenance: 'demo-projection'; language: 'yaml' | 'markdown' | 'json' | 'text'; content: string }
  | { status: 'unavailable'; reason: 'incompatible-package' | 'external-reference' | 'unsupported-file'; message: string }

const sourceKinds: Exclude<AgentConfigPayload['kind'], 'identity'>[] = [
  'instructions',
  'context',
  'skills',
  'rules',
  'mcp',
  'permissions',
  'sop',
  'hooks',
  'commands',
]

const configKindByPath = new Map<string, (typeof sourceKinds)[number]>(
  sourceKinds.map((kind) => [agentRootConfigPaths[kind], kind]),
)

export function agentFileSource(agent: FullAgent, _context: AgentProjectionContext, path: string): AgentFileSource {
  const association = getAgentFileAssociation(agent, path)
  if (!association) return { status: 'unavailable', reason: 'unsupported-file', message: '文件不在当前 Agent 配置记录中。' }
  if (agent.packageSource.kind === 'external-reference' || agent.packageSchema.compatibility === 'unverified') return { status: 'unavailable', reason: 'external-reference', message: '源码不可用：此 Agent 配置只是外部只读引用，浏览器演示未读取本机文件。' }
  const editability = getAgentPackageEditability(agent.packageSchema)
  if (!editability.editable) return { status: 'unavailable', reason: 'incompatible-package', message: `源码不可用：${editability.reason ?? '当前 Agent 配置与此版本不兼容。'}` }

  const normalized = association.file.path

  if (normalized === 'agent.yaml') {
    const payload = snapshotAgentConfig(agent, 'identity')
    const content = payload ? serializeAgentConfig(agent, payload) : undefined
    if (content !== undefined) return { status: 'available', provenance: 'demo-projection', language: 'yaml', content }
  }
  if (normalized === 'soul.md') return {
    status: 'available', provenance: 'demo-projection', language: 'markdown',
    content: `# ${agent.name} 行为原则\n\n## 主要职责\n\n${agent.responsibilities.map((item) => `- ${item}`).join('\n')}\n\n## 决策边界\n\n${agent.decisionBoundaries.map((item) => `- ${item}`).join('\n')}\n\n## 禁止事项\n\n${agent.prohibitions.map((item) => `- ${item}`).join('\n')}`,
  }
  const configKind = configKindByPath.get(normalized)
  if (configKind) {
    const payload = snapshotAgentConfig(agent, configKind)
    const content = payload ? serializeAgentConfig(agent, payload) : undefined
    if (content !== undefined) return { status: 'available', provenance: 'demo-projection', language: configKind === 'instructions' ? 'markdown' : 'yaml', content }
  }
  if (/^config\/mcp\.json$/.test(normalized)) return { status: 'available', provenance: 'demo-projection', language: 'json', content: JSON.stringify({ mcp: agent.mcpRefs }, null, 2) }
  if (normalized === 'memory/long-term.md') return { status: 'available', provenance: 'demo-projection', language: 'markdown', content: `# 长期记忆\n\nRevision: ${association.file.revision ?? '未设置'}\n\n长期记忆直接保存，每次变更生成不可变版本。` }

  return { status: 'unavailable', reason: 'unsupported-file', message: '已有文件记录，但浏览器演示暂不支持显示该格式的源码。' }
}
