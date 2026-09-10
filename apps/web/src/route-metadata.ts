import type { UsageGuideTopic } from './components/usage-guide'

export type NavigationSection =
  | 'home'
  | 'agents'
  | 'organization'
  | 'tasks'
  | 'assets'
  | 'tools'
  | 'settings'

export type RouteMetadata = {
  section: NavigationSection
  title: string
  guideTopic?: UsageGuideTopic
  agentId?: string
}

type NamedEntity = { id: string; name: string }

type RouteMetadataContext = {
  agents?: NamedEntity[]
  teams?: NamedEntity[]
  assets?: NamedEntity[]
}

const entityName = (
  pathname: string,
  prefix: string,
  entities: NamedEntity[] | undefined,
) => {
  const id = pathname.slice(prefix.length).split('/')[0]
  return entities?.find((item) => item.id === id)?.name
}

export function resolveRouteMetadata(
  location: string,
  context: RouteMetadataContext = {},
): RouteMetadata {
  const [pathname, search = ''] = location.split('?')
  if (pathname === '/') return { section: 'home', title: '配置状态', guideTopic: 'recovery' }
  if (pathname === '/guide') return { section: 'home', title: '使用指南', guideTopic: 'quick-start' }
  if (pathname === '/agents/new') {
    const mode = new URLSearchParams(search).get('mode')
    return {
      section: 'agents',
      title: mode === 'import' ? '导入 Agent' : '新建 Agent',
      guideTopic: 'quick-start',
    }
  }
  if (pathname.startsWith('/agents/')) {
    const agentId = pathname.slice('/agents/'.length).split('/')[0]
    const agent = context.agents?.find((item) => item.id === agentId)
    return { section: 'agents', title: agent?.name ?? 'Agent 配置', guideTopic: 'agent-config', agentId: agent?.id }
  }
  if (pathname === '/agents') return { section: 'agents', title: 'Agent', guideTopic: 'agent-config' }
  if (pathname.startsWith('/organization/teams/')) return { section: 'organization', title: entityName(pathname, '/organization/teams/', context.teams) ?? 'Team 详情', guideTopic: 'teams' }
  if (pathname === '/organization') return { section: 'organization', title: 'Team 管理', guideTopic: 'teams' }
  if (pathname === '/tasks') return { section: 'tasks', title: '需求池', guideTopic: 'handoff' }
  if (pathname === '/assets/skills') return { section: 'assets', title: '技能', guideTopic: 'assets' }
  if (pathname.startsWith('/assets/')) return { section: 'assets', title: entityName(pathname, '/assets/', context.assets) ?? '资产详情', guideTopic: 'assets' }
  if (pathname === '/assets') return { section: 'assets', title: '配置资产', guideTopic: 'assets' }
  if (pathname === '/tools') return { section: 'tools', title: 'AI 工具', guideTopic: 'handoff' }
  if (pathname.startsWith('/settings')) return { section: 'settings', title: '设置', guideTopic: 'recovery' }
  return { section: 'home', title: '配置管理', guideTopic: 'quick-start' }
}

export function formatWindowTitle(title: string): string {
  return `${title} · Bandi`
}
