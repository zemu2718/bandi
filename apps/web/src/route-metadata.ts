export type NavigationSection =
  | 'home'
  | 'agents'
  | 'organization'
  | 'tasks'
  | 'assets'
  | 'settings'

export type RouteMetadata = {
  section: NavigationSection
  title: string
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
  if (pathname === '/') return { section: 'home', title: '配置状态' }
  if (pathname === '/agents/new') {
    const mode = new URLSearchParams(search).get('mode')
    return {
      section: 'agents',
      title: mode === 'import' ? '导入 Agent' : '新建 Agent',
    }
  }
  if (pathname.startsWith('/agents/')) {
    const agentId = pathname.slice('/agents/'.length).split('/')[0]
    const agent = context.agents?.find((item) => item.id === agentId)
    return { section: 'agents', title: agent?.name ?? 'Agent 配置', agentId: agent?.id }
  }
  if (pathname === '/agents') return { section: 'agents', title: 'Agent' }
  if (pathname.startsWith('/organization/teams/')) return { section: 'organization', title: entityName(pathname, '/organization/teams/', context.teams) ?? 'Team 详情' }
  if (pathname === '/organization') return { section: 'organization', title: 'Team 管理' }
  if (pathname === '/tasks') return { section: 'tasks', title: '任务简报' }
  if (pathname === '/assets/skills') return { section: 'assets', title: '技能' }
  if (pathname.startsWith('/assets/')) return { section: 'assets', title: entityName(pathname, '/assets/', context.assets) ?? '资产详情' }
  if (pathname === '/assets') return { section: 'assets', title: '资产' }
  if (pathname.startsWith('/settings')) return { section: 'settings', title: '设置' }
  return { section: 'home', title: '配置管理' }
}

export function formatWindowTitle(title: string): string {
  return `${title} · Bandi`
}
