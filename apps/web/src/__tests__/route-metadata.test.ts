import { describe, expect, it } from 'vitest'
import { formatWindowTitle, resolveRouteMetadata } from '../route-metadata'

describe('route metadata', () => {
  it('统一配置状态标题并排除新建页的最近 Agent 身份', () => {
    expect(resolveRouteMetadata('/')).toEqual({ section: 'home', title: '配置状态' })
    expect(formatWindowTitle('配置状态')).toBe('配置状态 · Bandi')
    expect(resolveRouteMetadata('/agents/new')).toEqual({ section: 'agents', title: '新建 Agent' })
    expect(resolveRouteMetadata('/agents/new?mode=import')).toEqual({ section: 'agents', title: '导入 Agent' })
    expect(resolveRouteMetadata('/agents/new?mode=reference')).toEqual({ section: 'agents', title: '新建 Agent' })
  })

  it('解析实体名称和主导航归属', () => {
    expect(resolveRouteMetadata('/agents/agent-a', {
      agents: [{ id: 'agent-a', name: '设计 Agent' }],
    })).toEqual({ section: 'agents', title: '设计 Agent', agentId: 'agent-a' })
  })

  it('保留需求池窗口标题', () => {
    expect(resolveRouteMetadata('/tasks')).toEqual({ section: 'tasks', title: '需求池' })
  })

  it('将旧备份兼容路径归入设置', () => {
    expect(resolveRouteMetadata('/settings/backup')).toEqual({
      section: 'settings',
      title: '设置',
    })
    expect(formatWindowTitle('设置')).toBe('设置 · Bandi')
  })
})
