import { describe, expect, it } from 'vitest'
import { initialState, reducer } from '../state'
import { buildBackupPreview, createDemoSnapshot } from '../backup-policy'

describe('演示状态', () => {
  it('只保留未完成的 Agent 恢复摘要并在完成后移除', () => {
    const pending = {
      id: 'operation-1',
      agentId: 'worker',
      operationKind: 'create' as const,
      status: 'team_pending' as const,
      createdAt: '2026-09-02T00:00:00Z',
    }
    const hydrated = reducer(initialState, {
      type: 'HYDRATE_AGENT_RECOVERY',
      operations: [pending, { ...pending, id: 'operation-2', status: 'completed' }],
    })
    expect(hydrated.agentRecoveryOperations).toEqual([pending])
    expect(reducer(hydrated, {
      type: 'SYNC_AGENT_RECOVERY',
      operation: { ...pending, status: 'completed' },
    }).agentRecoveryOperations).toEqual([])
  })

  it('包含九个唯一内置客户端和空的会话最近 Agent', () => {
    expect(initialState.aiClients.map((client) => client.id)).toEqual([
      'claude-code',
      'claude-desktop',
      'codex',
      'gemini-cli',
      'grok-build',
      'opencode',
      'openclaw',
      'hermes',
      'pi',
    ])
    expect(new Set(initialState.aiClients.map((client) => client.kind)).size).toBe(9)
    expect(initialState.aiClients.every((client) => client.detection === 'not-checked')).toBe(true)
    expect(initialState.recentAgentIds).toEqual([])
    expect(initialState.mainMenuLayoutPreference).toBe('follow-window')
  })

  it('使用官方 Claude Code 配置位置作为演示事实', () => {
    expect(initialState.assets.find((asset) => asset.id === 'mcp-bandi')?.path).toBe('.claude.json')
  })

  it('主菜单布局只更新顶层界面偏好', () => {
    const result = reducer(initialState, {
      type: 'SET_MAIN_MENU_LAYOUT',
      preference: 'compact',
    })

    expect(result.mainMenuLayoutPreference).toBe('compact')
    expect(result.settings).toBe(initialState.settings)
    expect(result.agents).toBe(initialState.agents)
    expect(result.assets).toBe(initialState.assets)
    expect(reducer(result, {
      type: 'SET_MAIN_MENU_LAYOUT',
      preference: 'compact',
    })).toBe(result)
  })

  it('只切换到已存在的 Team，并跳过重复选择', () => {
    const target = initialState.teams.find((team) => team.id !== initialState.currentTeamId)!
    const selected = reducer(initialState, { type: 'SELECT_TEAM', teamId: target.id })

    expect(selected.currentTeamId).toBe(target.id)
    expect(reducer(selected, { type: 'SELECT_TEAM', teamId: target.id })).toBe(selected)
    expect(reducer(selected, { type: 'SELECT_TEAM', teamId: 'missing-team' })).toBe(selected)
  })

  it('组织 hydration 保留合法选择，失效后优先回退个人 Team', () => {
    const personal = initialState.teams.find((team) => team.id === 'team-personal')!
    const selected = { ...initialState, currentTeamId: initialState.teams[0].id }
    const snapshot = {
      schemaVersion: 4 as const,
      teams: initialState.teams,
      taskBriefs: [],
    }

    expect(reducer(selected, {
      type: 'HYDRATE_ORGANIZATION',
      snapshot,
    }).currentTeamId).toBe(selected.currentTeamId)
    expect(reducer(selected, {
      type: 'HYDRATE_ORGANIZATION',
      snapshot: { ...snapshot, teams: [personal] },
    }).currentTeamId).toBe('team-personal')
  })

  it('只识别带稳定前缀的旧数据库错误生命周期', () => {
    const legacy = reducer(initialState, {
      type: 'FACTORY_RESET_LEGACY_REQUIRED',
      technicalDetails: 'LEGACY_DATABASE_RESET_REQUIRED: 检测到旧版开发数据库',
    })

    expect(legacy.factoryReset).toEqual({
      status: 'legacy-database-required',
      technicalDetails: 'LEGACY_DATABASE_RESET_REQUIRED: 检测到旧版开发数据库',
    })
    expect(initialState.factoryReset).toEqual({ status: 'idle' })
  })

  it('重置提交后只允许进入重新打开与手动兜底终态', () => {
    const committed = reducer(initialState, { type: 'FACTORY_RESET_COMMITTED' })
    const restarting = reducer(committed, { type: 'FACTORY_RESET_RESTARTING' })
    const manual = reducer(restarting, {
      type: 'FACTORY_RESET_MANUAL_RESTART_REQUIRED',
      technicalDetails: 'restart failed',
    })

    expect(committed.factoryReset).toEqual({ status: 'committed' })
    expect(restarting.factoryReset).toEqual({ status: 'restarting' })
    expect(manual.factoryReset).toEqual({
      status: 'manual-restart-required',
      technicalDetails: 'restart failed',
    })
    expect(reducer(manual, { type: 'FACTORY_RESET_COMMITTED' })).toBe(manual)
    expect(reducer(initialState, { type: 'FACTORY_RESET_RESTARTING' })).toBe(initialState)
    expect(reducer(initialState, {
      type: 'FACTORY_RESET_MANUAL_RESTART_REQUIRED',
    })).toBe(initialState)
  })

  it('重新读取期间保留已有 Agent 诊断', () => {
    const diagnostic = { code: 'invalid-agent', severity: 'error' as const, message: 'Agent 配置无效' }
    const state = { ...initialState, runtime: 'desktop' as const, agentDiagnostics: [diagnostic] }

    const refreshing = reducer(state, { type: 'START_DESKTOP_HYDRATION' })

    expect(refreshing.agentDiagnostics).toEqual([diagnostic])
    expect(refreshing.hydration.managedAgents).toBe('loading')
  })

  it('onboarding 初始启用，完成后只返回新内存状态', () => {
    expect(initialState.onboarding).toEqual({ status: 'active' })
    const completed = reducer(initialState, { type: 'COMPLETE_ONBOARDING' })
    expect(completed.onboarding).toEqual({ status: 'completed' })
    expect(completed.uiPreferences.firstUseTeamSetupDismissed).toBe(true)
    expect(completed).not.toBe(initialState)
    expect(initialState.onboarding).toEqual({ status: 'active' })
    expect(reducer(completed, { type: 'COMPLETE_ONBOARDING' })).toBe(completed)
  })

  it('保存指令生成新的不可变配置版本', () => {
    const result = reducer(initialState, { type: 'SAVE_INSTRUCTIONS', agentId: 'zhouce', text: '新的演示指令' })
    expect(result.notice?.description).toContain('仅在当前页面有效')
    expect(result.configRevisions).toHaveLength(initialState.configRevisions.length + 1)
    expect(result.configRevisions[0]).toMatchObject({ ownerType: 'agent', ownerId: 'zhouce', path: 'instructions.md', content: '新的演示指令' })
    expect(initialState.configRevisions[0].content).not.toBe('新的演示指令')
  })

  it('Desktop 拒绝通过演示 reducer 保存正式配置', () => {
    const desktopState = { ...initialState, runtime: 'desktop' as const }
    const result = reducer(desktopState, { type: 'SAVE_AGENT_CONFIG', input: { agentId: 'zhouce', kind: 'rules', value: ['rule-new'] } })

    expect(result.agents).toBe(desktopState.agents)
    expect(result.configRevisions).toBe(desktopState.configRevisions)
    expect(result.notice).toMatchObject({ tone: 'warning', title: '未保存配置' })
  })

  it('普通配置保存原子更新 Agent、文件和版本', () => {
    const result = reducer(initialState, { type: 'SAVE_AGENT_CONFIG', input: { agentId: 'zhouce', kind: 'rules', value: ['rule-common', 'rule-new'] } })
    const agent = result.agents.find((item) => item.id === 'zhouce')!
    expect(agent.ruleRefs).toEqual(['rule-common', 'rule-new'])
    expect(agent.files.find((file) => file.path === 'config/rules.yaml')).toMatchObject({ evidence: 'memory-only', revision: result.configRevisions[0].id })
    expect(result.configRevisions[0]).toMatchObject({ ownerId: 'zhouce', path: 'config/rules.yaml', evidence: 'memory-only' })
  })

  it('上下文保存原子更新策略、文件和版本', () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const result = reducer(initialState, {
      type: 'SAVE_AGENT_CONFIG',
      input: {
        agentId: source.id,
        kind: 'context',
        value: { policy: { ...source.contextPolicy, triggerRatio: 0.85 }, contextWindowTokens: 256_000 },
      },
    })
    const agent = result.agents.find((item) => item.id === source.id)!
    expect(agent.contextPolicy.triggerRatio).toBe(0.85)
    expect(agent.files.find((file) => file.path === 'config/context.yaml')).toMatchObject({ evidence: 'memory-only' })
    expect(result.configRevisions[0]).toMatchObject({ ownerType: 'agent', ownerId: source.id, path: 'config/context.yaml' })
  })

  it('未改变指令时不生成重复版本', () => {
    const agent = initialState.agents.find((item) => item.id === 'zhouce')!
    expect(reducer(initialState, { type: 'SAVE_INSTRUCTIONS', agentId: agent.id, text: agent.instructions })).toBe(initialState)
  })

  it('恢复历史配置生成新版本并保留来源', () => {
    const target = initialState.configRevisions.find((item) => item.id === 'cfg-zhouce-instructions-r7')!
    const result = reducer(initialState, { type: 'RESTORE_CONFIG_REVISION', revisionId: target.id })
    expect(result.configRevisions).toHaveLength(initialState.configRevisions.length + 1)
    expect(result.configRevisions[0].restoredFromRevisionId).toBe(target.id)
    expect(result.configRevisions[0].content).toBe(target.content)
    expect(result.agents.find((item) => item.id === 'zhouce')?.instructions).toBe(target.content)
    expect(initialState.configRevisions.find((item) => item.id === target.id)).toEqual(target)
  })

  it('拒绝恢复路径与结构化快照不匹配的版本', () => {
    const target = initialState.configRevisions.find((item) => item.id === 'cfg-zhouce-instructions-r7')!
    const invalid = { ...target, id: 'invalid-payload', payload: { kind: 'rules', value: ['rule-common'] } }
    const state = { ...initialState, configRevisions: [invalid, ...initialState.configRevisions] }
    const result = reducer(state, { type: 'RESTORE_CONFIG_REVISION', revisionId: invalid.id })
    expect(result.configRevisions).toBe(state.configRevisions)
    expect(result.notice?.tone).toBe('warning')
  })

  it('恢复与当前结构化配置相同时不误标记已有版本', () => {
    const current = initialState.agents.find((item) => item.id === 'zhouce')!
    const target = { ...initialState.configRevisions[0], id: 'same-current', content: current.instructions, payload: { kind: 'instructions', value: current.instructions } }
    const state = { ...initialState, configRevisions: [target, ...initialState.configRevisions] }
    const result = reducer(state, { type: 'RESTORE_CONFIG_REVISION', revisionId: target.id })
    expect(result.configRevisions).toBe(state.configRevisions)
    expect(result.configRevisions[0].restoredFromRevisionId).toBeUndefined()
  })

  it('按首次访问顺序记录 Agent、重复访问保持排序并限制为六项', () => {
    const extraAgents = Array.from({ length: 3 }, (_, index) => ({
      ...initialState.agents[0], id: `extra-${index}`, name: `额外 ${index}`,
    }))
    let state = { ...initialState, agents: [...initialState.agents, ...extraAgents] }
    for (const agent of state.agents) state = reducer(state, { type: 'RECORD_RECENT_AGENT', agentId: agent.id })
    expect(state.recentAgentIds).toHaveLength(6)
    expect(state.recentAgentIds[0]).toBe('extra-2')
    const unchanged = reducer(state, { type: 'RECORD_RECENT_AGENT', agentId: state.recentAgentIds.at(-1)! })
    expect(unchanged).toBe(state)
    expect(reducer(unchanged, { type: 'RECORD_RECENT_AGENT', agentId: 'missing' })).toBe(unchanged)
  })

  it('移除和清空最近 Agent 只影响会话导航历史', () => {
    const state = { ...initialState, recentAgentIds: ['zhouce', 'songyan', 'lumo'] }
    const removed = reducer(state, { type: 'REMOVE_RECENT_AGENT', agentId: 'songyan' })
    expect(removed.recentAgentIds).toEqual(['zhouce', 'lumo'])
    expect(removed.uiPreferences).toBe(state.uiPreferences)
    expect(removed.agents).toBe(state.agents)
    expect(reducer(removed, { type: 'REMOVE_RECENT_AGENT', agentId: 'missing' })).toBe(removed)

    const cleared = reducer(removed, { type: 'CLEAR_RECENT_AGENTS' })
    expect(cleared.recentAgentIds).toEqual([])
    expect(cleared.uiPreferences).toBe(state.uiPreferences)
    expect(reducer(cleared, { type: 'CLEAR_RECENT_AGENTS' })).toBe(cleared)
  })

  it('Desktop 拒绝技能与插件模拟操作', () => {
    const desktopState = { ...initialState, runtime: 'desktop' as const }
    const skill = reducer(desktopState, { type: 'APPLY_SKILL_ACTION', skillId: 'skill-docs', action: 'install' })
    const plugin = reducer(desktopState, { type: 'APPLY_PLUGIN_ACTION', pluginId: 'plugin-delivery', action: 'install' })

    expect(skill.assets).toBe(desktopState.assets)
    expect(plugin.pluginInstallations).toBe(desktopState.pluginInstallations)
    expect(skill.notice?.title).toBe('未执行技能操作')
    expect(plugin.notice?.title).toBe('未执行插件操作')
  })

  it('Skill 生命周期只修改安装事实，不修改 Agent 引用', () => {
    const originalRefs = initialState.agents.map((agent) => agent.skillRefs)
    const installed = reducer(initialState, { type: 'APPLY_SKILL_ACTION', skillId: 'skill-docs', action: 'install' })
    expect(installed.assets.find((asset) => asset.id === 'skill-docs')?.skill?.installation.status).toBe('installed')
    expect(installed.agents.map((agent) => agent.skillRefs)).toEqual(originalRefs)
    expect(installed.notice?.description).toContain('未自动分配给 Agent')

    const rolledBack = reducer(initialState, { type: 'APPLY_SKILL_ACTION', skillId: 'skill-release', action: 'rollback', version: '2.0.0' })
    expect(rolledBack.assets.find((asset) => asset.id === 'skill-release')?.skill?.installation.installedVersion).toBe('2.0.0')
  })

  it('备份设置只更新演示策略且 Private 固定', () => {
    const result = reducer(initialState, { type: 'UPDATE_BACKUP_SETTINGS', changes: { gitConnection: { status: 'connected-demo', visibility: 'private', repository: 'github.com/demo/private' }, formalMemoryRemote: 'confirmed' } })
    expect(result.backupSettings.gitConnection.visibility).toBe('private')
    expect(result.backupSettings.formalMemoryRemote).toBe('confirmed')
    expect(result.notice?.description).toContain('未连接 Git')
  })

  it('模拟恢复只新增恢复前快照，不修改业务集合', () => {
    const preview = buildBackupPreview(initialState, { kind: 'agent' as const, agentId: 'zhouce' })!
    const beforeSnapshot = createDemoSnapshot(preview, { id: 'before-test', createdAt: '刚刚', kind: '恢复前演示' })
    const result = reducer(initialState, { type: 'SIMULATE_RESTORE', snapshotId: 'snap-demo-001', beforeSnapshot })
    expect(result.backupSnapshots[0]).toEqual(beforeSnapshot)
    expect(result.agents).toBe(initialState.agents)
    expect(result.assets).toBe(initialState.assets)
    expect(result.teams).toBe(initialState.teams)
  })

  it('Web 直接保存 Agent 长期记忆并生成新版本', () => {
    const space = initialState.memorySpaces[0]
    const result = reducer(initialState, {
      type: 'SAVE_MEMORY',
      spaceId: space.id,
      content: '更新后的长期事实',
    })

    expect(result.memorySpaces[0]).toMatchObject({
      id: space.id,
      content: '更新后的长期事实',
      revision: 'r19',
    })
    expect(result.notice).toMatchObject({ tone: 'success', title: 'Agent 长期记忆已保存' })
  })

})
