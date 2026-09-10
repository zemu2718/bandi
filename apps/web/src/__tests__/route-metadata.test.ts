import { describe, expect, it } from 'vitest'
import { formatWindowTitle, resolveRouteMetadata } from '../route-metadata'

describe('route metadata', () => {
  it('统一配置状态标题并排除新建页的最近 Agent 身份', () => {
    expect(resolveRouteMetadata('/')).toEqual({ section: 'home', title: '配置状态', guideTopic: 'recovery' })
    expect(formatWindowTitle('配置状态')).toBe('配置状态 · Bandi')
    expect(resolveRouteMetadata('/agents/new')).toEqual({ section: 'agents', title: '新建 Agent', guideTopic: 'quick-start' })
    expect(resolveRouteMetadata('/agents/new?mode=import')).toEqual({ section: 'agents', title: '导入 Agent', guideTopic: 'quick-start' })
    expect(resolveRouteMetadata('/agents/new?mode=reference')).toEqual({ section: 'agents', title: '新建 Agent', guideTopic: 'quick-start' })
  })

  it('解析实体名称和对应指南主题', () => {
    expect(resolveRouteMetadata('/agents/agent-a', {
      agents: [{ id: 'agent-a', name: '设计 Agent' }],
    })).toEqual({ section: 'agents', title: '设计 Agent', guideTopic: 'agent-config', agentId: 'agent-a' })
    expect(resolveRouteMetadata('/organization/teams/team-a', {
      teams: [{ id: 'team-a', name: '设计 Team' }],
    })).toEqual({ section: 'organization', title: '设计 Team', guideTopic: 'teams' })
    expect(resolveRouteMetadata('/assets/skills')).toEqual({ section: 'assets', title: '技能', guideTopic: 'assets' })
  })

  it('为需求、工具和设置匹配指南主题', () => {
    expect(resolveRouteMetadata('/tasks')).toEqual({ section: 'tasks', title: '需求池', guideTopic: 'handoff' })
    expect(resolveRouteMetadata('/tools')).toEqual({ section: 'tools', title: 'AI 工具', guideTopic: 'handoff' })
    expect(resolveRouteMetadata('/settings')).toEqual({ section: 'settings', title: '设置', guideTopic: 'recovery' })
  })

  it('为旧指南兼容地址和未知页面提供稳定元数据', () => {
    expect(resolveRouteMetadata('/guide')).toEqual({ section: 'home', title: '使用指南', guideTopic: 'quick-start' })
    expect(formatWindowTitle(resolveRouteMetadata('/guide').title)).toBe('使用指南 · Bandi')
    expect(resolveRouteMetadata('/unknown')).toEqual({ section: 'home', title: '配置管理', guideTopic: 'quick-start' })
  })
})
