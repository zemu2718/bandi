import { getLatestAgentRevision, listConfigRevisions } from './config-revisions'
import { getAgentPackageEditability } from './agent-package-schema'
import { validateParameterBindings } from './component-parameters'
import type { ConfigRevision, FullAgent, FullAsset } from './domain'
import type { AgentRecoveryOperationSummaryDto, Diagnostic, TeamDto } from './contracts'
import type { PluginInstallation } from './plugin-installation'

export type ConfigIssue = {
  code:
    | 'external-change'
    | 'missing-reference'
    | 'skill-unavailable'
    | 'unverified'
    | 'package-legacy'
    | 'package-future'
    | 'package-unverified'
    | 'manifest-invalid'
    | 'asset-kind-mismatch'
    | 'plugin-unavailable'
    | 'parameter-invalid'
  label: string
}

export type ConfigStatus = {
  level: 'healthy' | 'warning' | 'error' | 'unknown'
  label: string
  issues: ConfigIssue[]
}

type SelectorState = {
  runtime: 'web' | 'desktop'
  hydration: Record<'managedAgents' | 'organization' | 'sharedAssets' | 'agentRecovery', 'idle' | 'loading' | 'succeeded' | 'failed'>
  onboarding: { status: 'active' | 'completed' }
  agents: FullAgent[]
  teams: TeamDto[]
  assets: FullAsset[]
  pluginInstallations: PluginInstallation[]
  configRevisions: ConfigRevision[]
  agentDiagnostics: Diagnostic[]
  agentRecoveryOperations: AgentRecoveryOperationSummaryDto[]
}

export type ConfigurationStatusItem =
  | { kind: 'agent'; agent: FullAgent; status: ConfigStatus }
  | { kind: 'diagnostic'; diagnostic: Diagnostic; index: number }
  | { kind: 'recovery'; operation: AgentRecoveryOperationSummaryDto }

export type ConfigurationStatusSummary = {
  phase: 'failed' | 'loading' | 'pending' | 'first-use' | 'healthy'
  items: ConfigurationStatusItem[]
}

export function getAvailableAgents(
  state: Pick<SelectorState, 'agents' | 'teams'>,
  teamId?: string,
): FullAgent[] {
  const active = state.agents.filter((agent) => agent.status === 'active')
  if (!teamId) return active
  if (!state.teams.some((item) => item.id === teamId)) return []
  return active.filter((agent) => agent.teamId === teamId)
}

function missingReferences(ids: string[], assets: FullAsset[]) {
  const available = new Set(assets.map((asset) => asset.id))
  return ids.filter((id) => !available.has(id))
}

function validateComponentReferences(
  references: FullAgent['hookRefs'] | FullAgent['commandRefs'],
  expectedKind: 'Hook' | 'Command',
  state: Pick<SelectorState, 'assets' | 'pluginInstallations'>,
  label: string,
): ConfigIssue[] {
  return references.flatMap((reference) => {
    const asset = state.assets.find((item) => item.id === reference.assetId)
    if (!asset) return [{ code: 'missing-reference' as const, label: `${label} ${reference.assetId} 不存在` }]
    if (asset.kind !== expectedKind) return [{ code: 'asset-kind-mismatch' as const, label: `${label} ${reference.assetId} 的资产类型应为 ${expectedKind}` }]
    const definition = expectedKind === 'Hook' ? asset.hook : asset.command
    if (!definition) return [{ code: 'asset-kind-mismatch' as const, label: `${label} ${reference.assetId} 缺少类型化定义` }]
    const issues: ConfigIssue[] = validateParameterBindings(definition.parameters, reference.parameterBindings)
      .map((issue) => ({ code: 'parameter-invalid', label: `${label} ${reference.assetId}.${issue.parameterId}：${issue.message}` }))
    const pluginAssetId = definition.pluginAssetId
    if (pluginAssetId) {
      const installation = state.pluginInstallations.find((item) => item.pluginId === pluginAssetId)
      if (!installation || installation.status === 'available' || installation.status === 'incompatible' || !installation.compatible || !installation.componentsComplete) {
        issues.push({ code: 'plugin-unavailable', label: `${label} ${reference.assetId} 的 Plugin ${pluginAssetId} 未安装、组件不完整或不兼容` })
      }
    }
    return issues
  })
}

export function getAgentConfigStatus(state: Pick<SelectorState, 'assets' | 'pluginInstallations'>, agent: FullAgent): ConfigStatus {
  const issues: ConfigIssue[] = []
  if (agent.files.some((file) => file.status.includes('外部变化'))) issues.push({ code: 'external-change', label: '存在预置的外部变化记录' })
  if (agent.packageSchema.compatibility === 'legacy') issues.push({ code: 'package-legacy', label: 'Agent 配置为旧版，升级前只能查看' })
  if (agent.packageSchema.compatibility === 'future') issues.push({ code: 'package-future', label: 'Agent 配置来自更高版本，当前版本不会降级保存' })
  if (agent.packageSchema.compatibility === 'unverified') issues.push({ code: 'package-unverified', label: '历史外部 Agent 引用未读取和验证，仅兼容查看' })
  if (!getAgentPackageEditability(agent.packageSchema).editable && agent.packageSchema.compatibility === 'current') issues.push({ code: 'manifest-invalid', label: 'Agent 配置的格式信息不一致' })
  const missingRootRefs = missingReferences([...agent.ruleRefs, ...agent.skillRefs, ...agent.mcpRefs, ...agent.sopRefs], state.assets)
  if (missingRootRefs.length) issues.push({ code: 'missing-reference', label: `存在失效引用：${missingRootRefs.join('、')}` })
  issues.push(...validateComponentReferences(agent.hookRefs, 'Hook', state, 'Hook'))
  issues.push(...validateComponentReferences(agent.commandRefs, 'Command', state, 'Command'))
  if (agent.outputProfileId) {
    const output = state.assets.find((item) => item.id === agent.outputProfileId)
    if (!output) issues.push({ code: 'missing-reference', label: `OutputProfile ${agent.outputProfileId} 不存在` })
    else if (output.kind !== 'OutputProfile' || !output.outputProfile) issues.push({ code: 'asset-kind-mismatch', label: `${agent.outputProfileId} 不是有效的 OutputProfile` })
    else issues.push(...validateParameterBindings(output.outputProfile.parameters, agent.outputParameterBindings).map((issue) => ({ code: 'parameter-invalid' as const, label: `OutputProfile ${issue.parameterId}：${issue.message}` })))
  }
  for (const skillId of agent.skillRefs) {
    const skill = state.assets.find((asset) => asset.id === skillId)?.skill
    if (!skill || skill.installation.status === 'available') issues.push({ code: 'skill-unavailable', label: `Skill ${skillId} 当前不可用` })
  }
  if (!issues.length) return { level: 'healthy', label: '配置完整', issues }
  if (issues.some((issue) => issue.code === 'external-change')) return { level: 'warning', label: '外部变化', issues }
  return { level: 'error', label: '配置缺口', issues }
}

export function getConfigurationStatusSummary(state: SelectorState): ConfigurationStatusSummary {
  const items: ConfigurationStatusItem[] = [
    ...state.agents.flatMap((agent) => {
      const status = getAgentConfigStatus(state, agent)
      return status.level === 'healthy' ? [] : [{ kind: 'agent' as const, agent, status }]
    }),
    ...state.agentDiagnostics.map((diagnostic, index) => ({ kind: 'diagnostic' as const, diagnostic, index })),
    ...state.agentRecoveryOperations
      .filter((operation) => operation.status !== 'completed')
      .map((operation) => ({ kind: 'recovery' as const, operation })),
  ]
  if (state.runtime === 'desktop' && Object.values(state.hydration).some((status) => status === 'failed')) return { phase: 'failed', items }
  if (items.length) return { phase: 'pending', items }
  if (state.runtime === 'desktop' && Object.values(state.hydration).some((status) => status === 'loading')) return { phase: 'loading', items }
  if (state.onboarding.status === 'active' && !state.agents.length) return { phase: 'first-use', items }
  return { phase: 'healthy', items }
}

export function getLatestRevisionForAgent(state: Pick<SelectorState, 'configRevisions'>, agentId: string) {
  return getLatestAgentRevision(state.configRevisions, agentId)
}

export function getConfigHistory(state: Pick<SelectorState, 'configRevisions'>, ownerType: ConfigRevision['ownerType'], ownerId: string, path: string) {
  return listConfigRevisions(state.configRevisions, { ownerType, ownerId, path })
}
