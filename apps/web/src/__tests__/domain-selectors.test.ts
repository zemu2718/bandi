import { describe, expect, it } from 'vitest'
import { getAgentConfigStatus, getAvailableAgents, getConfigurationStatusSummary, getLatestRevisionForAgent } from '../domain-selectors'
import { initialState } from '../state'

describe('配置事实 selectors', () => {
  it('启动候选只按生命周期与 Team 成员关系过滤', () => {
    const state = {
      ...initialState,
      agents: initialState.agents,
    }

    expect(getAvailableAgents(state, 'xinghe').map((agent) => agent.id)).toEqual(['zhiheng', 'zhouce', 'linxu'])
    expect(getAvailableAgents(state, 'studio')).toEqual([])
    expect(getAvailableAgents(state).map((agent) => agent.id)).toEqual(['zhiheng', 'zhouce', 'linxu'])
  })

  it('聚合全部待处理配置并让待处理优先于首次欢迎', () => {
    const warningAgent = {
      ...initialState.agents[0],
      files: initialState.agents[0].files.map((file, index) => index === 0 ? { ...file, status: '外部变化' } : file),
    }
    const errorAgent = {
      ...initialState.agents[1],
      ruleRefs: ['missing-rule'],
    }
    const summary = getConfigurationStatusSummary({
      ...initialState,
      onboarding: { status: 'active' },
      agents: [warningAgent, errorAgent],
      agentDiagnostics: [{ code: 'invalid-agent', severity: 'error', message: 'Agent 配置无效' }],
      agentRecoveryOperations: [{ id: 'recovery', agentId: errorAgent.id, operationKind: 'create', status: 'team_pending', createdAt: '2026-09-08T00:00:00Z' }],
    })

    expect(summary.phase).toBe('pending')
    expect(summary.items.map((item) => item.kind)).toEqual(['agent', 'agent', 'diagnostic', 'recovery'])
  })

  it('按读取、首次使用和正常状态确定阶段', () => {
    const healthyAgents = initialState.agents.filter((agent) => getAgentConfigStatus(initialState, agent).level === 'healthy')
    const healthy = { ...initialState, onboarding: { status: 'completed' as const }, agents: healthyAgents, agentDiagnostics: [], agentRecoveryOperations: [] }
    expect(getConfigurationStatusSummary(healthy).phase).toBe('healthy')
    expect(getConfigurationStatusSummary({ ...healthy, onboarding: { status: 'active' } }).phase).toBe('healthy')
    expect(getConfigurationStatusSummary({ ...healthy, agents: [], onboarding: { status: 'active' } }).phase).toBe('first-use')
    expect(getConfigurationStatusSummary({ ...healthy, agents: [] }).phase).toBe('healthy')
    expect(getConfigurationStatusSummary({ ...healthy, runtime: 'desktop', hydration: { ...healthy.hydration, managedAgents: 'loading' } }).phase).toBe('loading')
    expect(getConfigurationStatusSummary({ ...healthy, runtime: 'desktop', agentDiagnostics: [{ code: 'invalid-agent', severity: 'error', message: 'Agent 配置无效' }], hydration: { ...healthy.hydration, managedAgents: 'loading' } }).phase).toBe('pending')
    expect(getConfigurationStatusSummary({ ...healthy, runtime: 'desktop', hydration: { ...healthy.hydration, managedAgents: 'failed' } }).phase).toBe('failed')
  })

  it('最近保存只来自 ConfigRevision', () => {
    expect(getLatestRevisionForAgent(initialState, 'zhouce')?.id).toBe('cfg-zhouce-instructions-r8')
  })

  it('外部只读引用报告未验证包状态', () => {
    const source = initialState.agents.find((agent) => agent.id === 'zhouce')!
    const agent = {
      ...source,
      files: [],
      packageSource: { kind: 'external-reference' as const, externalPath: '/tmp/external', strategy: 'reference-only' as const },
      packageSchema: { compatibility: 'unverified' as const },
    }
    const state = { ...initialState, agents: initialState.agents.map((item) => item.id === agent.id ? agent : item) }
    const codes = getAgentConfigStatus(state, agent).issues.map((issue) => issue.code)

    expect(codes).toContain('package-unverified')
  })

  it('报告类型错误、Plugin 不可用和参数非法的组件引用', () => {
    const source = initialState.agents.find((agent) => agent.id === 'zhouce')!
    const agent = {
      ...source,
      hookRefs: [{ assetId: 'command-config-audit', parameterBindings: [] }],
      commandRefs: [{ assetId: 'command-config-audit', parameterBindings: [{ parameterId: 'scope', type: 'enum' as const, value: 'invalid' }] }],
    }
    const state = {
      ...initialState,
      agents: initialState.agents.map((item) => item.id === agent.id ? agent : item),
      pluginInstallations: initialState.pluginInstallations.map((item) => ({ ...item, status: 'available' as const, installedVersion: undefined })),
    }
    const codes = getAgentConfigStatus(state, agent).issues.map((issue) => issue.code)
    expect(codes).toEqual(expect.arrayContaining(['asset-kind-mismatch', 'plugin-unavailable', 'parameter-invalid']))
  })
})
