// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { Shell } from '../shell'
import { EditorSessionProvider } from '../editor-session'
import { NotFoundPage } from '../pages/not-found-page'
import { PageHeader } from '../components/app/page'
import { Button } from '../components/ui/button'
import { AppProvider, initialState, type State } from '../state'
import type { MainMenuLayoutPreference } from '../navigation-layout'

type MediaListener = (event: MediaQueryListEvent) => void

function createMatchMedia(initialWidth: number) {
  let width = initialWidth
  const queries = new Map<string, { listeners: Set<MediaListener>; query: MediaQueryList }>()
  const matches = (media: string) => width >= Number(media.match(/\d+/)?.[0] ?? 0)

  vi.stubGlobal('matchMedia', vi.fn((media: string) => {
    const existing = queries.get(media)
    if (existing) return existing.query
    const listeners = new Set<MediaListener>()
    const query = {
      get matches() { return matches(media) },
      media,
      onchange: null,
      addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => listeners.add(listener as MediaListener),
      removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => listeners.delete(listener as MediaListener),
      addListener: (listener: MediaListener) => listeners.add(listener),
      removeListener: (listener: MediaListener) => listeners.delete(listener),
      dispatchEvent: () => true,
    } as MediaQueryList
    queries.set(media, { listeners, query })
    return query
  }))

  return {
    resize(nextWidth: number) {
      width = nextWidth
      queries.forEach(({ listeners }, media) => {
        const event = { matches: matches(media), media } as MediaQueryListEvent
        listeners.forEach((listener) => listener(event))
      })
    },
  }
}

function renderShell(
  preference: MainMenuLayoutPreference,
  theme: State['theme'] = 'light',
  initialEntry = '/',
  recentAgentIds: string[] = [],
  overrides: Partial<State> = {},
) {
  const state: State = {
    ...initialState,
    ...overrides,
    theme,
    onboarding: { status: 'completed' },
    mainMenuLayoutPreference: preference,
    uiPreferences: { ...initialState.uiPreferences, ...overrides.uiPreferences, mainMenuLayout: preference },
    recentAgentIds,
  }
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AppProvider initialState={state}>
        <EditorSessionProvider>
          <Routes>
            <Route path="/" element={<Shell />}>
              <Route index element={<div>配置状态内容</div>} />
              <Route path="agents" element={<div>Agents 内容<Link to="/agents/zhouce">进入周策</Link><Link to="/">查看配置状态</Link></div>} />
              <Route path="agents/:id" element={<div>Agent 详情</div>} />
              <Route path="organization" element={<div>组织内容</div>} />
              <Route path="tasks" element={<><PageHeader title="需求池" description="任务说明" action={<Button>新建需求</Button>} /><div>任务内容</div></>} />
              <Route path="assets" element={<div>资产内容</div>} />
              <Route path="settings" element={<div>设置内容</div>} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </EditorSessionProvider>
      </AppProvider>
    </MemoryRouter>,
  )
}

const storage = new Map<string, string>()

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('应用壳导航布局', () => {
  it.each(['light', 'dark'] as const)('%s 主题显示当前 Team 标识', (theme) => {
    createMatchMedia(1440)
    renderShell('expanded', theme)

    const switcher = screen.getByRole('button', { name: /切换 Team，当前为/ })
    expect(switcher).toHaveTextContent('星河')
    expect(switcher.querySelector('[data-brand-variant]')).not.toBeInTheDocument()
  })

  it('Team 切换器显示当前 Team 的一致标识', () => {
    createMatchMedia(1440)
    renderShell('expanded')

    const switcher = screen.getByRole('button', { name: /切换 Team，当前为/ })
    expect(switcher).toHaveTextContent('星河')
    expect(switcher).toHaveAttribute('aria-haspopup', 'menu')
  })

  it('一级菜单以需求池为首项，不显示概览和项目', () => {
    createMatchMedia(1440)
    renderShell('expanded')
    const rail = screen.getByLabelText('Bandi 配置管理')
    const navigation = within(rail).getByRole('navigation', { name: '一级导航' })

    for (const name of ['需求池', 'Agent', '配置资产']) {
      expect(within(navigation).getByRole('link', { name })).toBeInTheDocument()
    }
    expect(within(navigation).queryByRole('link', { name: '组织治理' })).not.toBeInTheDocument()
    expect(within(navigation).queryByRole('link', { name: /概览/ })).not.toBeInTheDocument()
    expect(within(navigation).queryByRole('link', { name: '项目' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /切换 Team，当前为/ })).toBeInTheDocument()
    expect(within(rail).getByRole('button', { name: '切换到深色' })).toBeInTheDocument()
  })

  it('页面标题和主操作进入顶栏，正文不重复', () => {
    createMatchMedia(1440)
    renderShell('expanded', 'light', '/tasks')

    const header = screen.getByRole('banner')
    expect(within(header).getByRole('heading', { level: 1, name: '需求池' })).toBeInTheDocument()
    expect(within(header).getByText('任务说明')).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: '新建需求' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('待处理配置只从顶栏进入，不加入一级菜单', () => {
    createMatchMedia(1440)
    renderShell('expanded', 'light', '/agents')

    expect(screen.getByRole('link', { name: /配置状态 · \d+ 项/ })).toHaveAttribute('href', '/')
    const navigation = within(screen.getByLabelText('Bandi 配置管理')).getByRole('navigation', { name: '一级导航' })
    expect(within(navigation).queryByRole('link', { name: /配置状态/ })).not.toBeInTheDocument()
  })

  it('正常冷启动直接进入 Agent，主动返回配置状态后不再次跳转', async () => {
    createMatchMedia(1440)
    const agents = initialState.agents.map((agent) => ({ ...agent, files: agent.files.map((file) => ({ ...file, status: '已同步' })) }))
    renderShell('expanded', 'light', '/', [], {
      agents,
      agentDiagnostics: [],
      agentRecoveryOperations: [],
    })

    await waitFor(() => expect(screen.getByText('Agents 内容')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('link', { name: '查看配置状态' }))
    expect(screen.getByText('配置状态内容')).toBeInTheDocument()
  })

  it('/projects 路由显示 NotFound', () => {
    createMatchMedia(1440)
    renderShell('expanded', 'light', '/projects')

    expect(screen.getByRole('heading', { level: 1, name: '页面不存在' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.queryByText('长期配置管理')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回配置状态' })).toHaveAttribute('href', '/')
  })

  it('宽屏默认展开一级菜单，并可独立收起和展开', () => {
    createMatchMedia(1440)
    const { container } = renderShell('expanded')
    const rail = screen.getByLabelText('Bandi 配置管理')

    expect(container.querySelector('[data-primary-menu-layout]')).toHaveAttribute('data-primary-menu-layout', 'expanded')
    const collapseButton = within(rail).getByRole('button', { name: '收起侧栏' })
    const settingsLink = within(rail).getByRole('link', { name: '设置' })
    expect(collapseButton).toHaveAttribute('aria-expanded', 'true')
    expect(collapseButton.compareDocumentPosition(settingsLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('button', { name: /切换 Team，当前为/ })).toHaveTextContent('星河科技')
    expect(within(rail).getByText('需求池')).toBeInTheDocument()

    fireEvent.click(within(rail).getByRole('button', { name: '收起侧栏' }))
    expect(container.querySelector('[data-primary-menu-layout]')).toHaveAttribute('data-primary-menu-layout', 'compact')
    expect(screen.getByRole('button', { name: /切换 Team，当前为/ })).toHaveTextContent('星河')
    expect(screen.getByRole('button', { name: /切换 Team，当前为/ })).not.toHaveTextContent('星河科技')
    expect(container.querySelector('[data-main-menu-layout]')).toHaveAttribute('data-main-menu-layout', 'expanded')

    fireEvent.click(within(rail).getByRole('button', { name: '展开侧栏' }))
    expect(container.querySelector('[data-primary-menu-layout]')).toHaveAttribute('data-primary-menu-layout', 'expanded')
  })

  it('窄屏默认收起一级菜单', () => {
    createMatchMedia(1024)
    const { container } = renderShell('expanded')

    expect(container.querySelector('[data-primary-menu-layout]')).toHaveAttribute('data-primary-menu-layout', 'compact')
    expect(screen.getByRole('button', { name: '展开侧栏' })).toHaveAttribute('aria-expanded', 'false')
  })

  it.each([
    ['follow-window', 1280, 'expanded'],
    ['follow-window', 1279, 'compact'],
    ['expanded', 960, 'expanded'],
    ['expanded', 959, 'compact'],
    ['compact', 1440, 'compact'],
  ] as const)('%s 在 %spx 使用 %s Agent 栏', (preference, width, expected) => {
    createMatchMedia(width)
    const { container } = renderShell(preference, 'light', '/', ['zhouce'])

    expect(container.querySelector('[data-main-menu-layout]')).toHaveAttribute('data-main-menu-layout', expected)
    expect(screen.getByRole('complementary', { name: '当前 Team Agent' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '查看全部 Agent' })).not.toBeInTheDocument()
    if (expected === 'expanded') {
      expect(screen.getByText('当前 Team Agent')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '收起 Agent 栏' })).toBeInTheDocument()
      expect(within(screen.getByRole('complementary', { name: '当前 Team Agent' })).getByText('周策')).toBeInTheDocument()
    } else {
      expect(screen.queryByText('当前 Team Agent')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: '展开 Agent 栏' })).toBeInTheDocument()
    }
  })

  it('直接进入 Agent 详情时首屏显示当前 Agent', async () => {
    createMatchMedia(1440)
    const { container } = renderShell('expanded', 'light', '/agents/zhouce')

    expect(container.querySelector('[data-main-menu-layout]')).toHaveAttribute('data-main-menu-layout', 'expanded')
    const recent = screen.getByRole('complementary', { name: '当前 Team Agent' })
    expect(within(recent).getByRole('link', { name: /周策/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Agent 详情')).toBeInTheDocument()
    expect(screen.queryByText(/在线|运行中|Session/)).not.toBeInTheDocument()
    await waitFor(() => expect(within(recent).getByRole('link', { name: /周策/ })).toBeInTheDocument())
  })

  it('Agent 二级栏在自身内部独立展开和收起', () => {
    createMatchMedia(1440)
    const view = renderShell('expanded', 'light', '/', ['zhouce'])
    const rail = screen.getByLabelText('Bandi 配置管理')
    const agentMenu = screen.getByRole('complementary', { name: '当前 Team Agent' })

    expect(within(rail).queryByRole('button', { name: /Agent 栏/ })).not.toBeInTheDocument()
    fireEvent.click(within(agentMenu).getByRole('button', { name: '收起 Agent 栏' }))
    expect(view.container.querySelector('[data-main-menu-layout]')).toHaveAttribute('data-main-menu-layout', 'compact')
    expect(view.container.querySelector('[data-primary-menu-layout]')).toHaveAttribute('data-primary-menu-layout', 'expanded')
    fireEvent.click(within(agentMenu).getByRole('button', { name: '展开 Agent 栏' }))
    expect(view.container.querySelector('[data-main-menu-layout]')).toHaveAttribute('data-main-menu-layout', 'expanded')
  })

  it('显式隐藏 Agent 二级栏时由设置恢复', () => {
    createMatchMedia(1440)
    const { container } = renderShell('hidden', 'light', '/', ['zhouce'])
    const rail = screen.getByLabelText('Bandi 配置管理')

    expect(screen.queryByLabelText('当前 Team Agent')).not.toBeInTheDocument()
    expect(within(rail).queryByRole('button', { name: /Agent 栏/ })).not.toBeInTheDocument()
    expect(container.querySelector('[data-main-menu-layout]')).toHaveAttribute('data-main-menu-layout', 'hidden')
  })

  it('跟随系统暗色时首次点击立即切换到浅色', async () => {
    createMatchMedia(1440)
    renderShell('expanded', 'dark', '/', ['zhouce'], {
      uiPreferences: { ...initialState.uiPreferences, theme: 'system' },
    })

    const rail = screen.getByLabelText('Bandi 配置管理')
    fireEvent.click(within(rail).getByRole('button', { name: '切换到浅色' }))

    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'light'))
    expect(within(rail).getByRole('button', { name: '切换到深色' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('bandi-ui-preferences-v1') ?? '{}').theme).toBe('light')
  })

  it('可显式隐藏上下文栏且 Agent 深链不会重新显示', async () => {
    createMatchMedia(1440)
    const { container } = renderShell('hidden', 'light', '/agents/zhouce', ['songyan'])

    expect(container.querySelector('[data-main-menu-layout]')).toHaveAttribute('data-main-menu-layout', 'hidden')
    expect(screen.queryByLabelText('当前 Team Agent')).not.toBeInTheDocument()
    await waitFor(() => expect(JSON.parse(localStorage.getItem('bandi-ui-preferences-v1') ?? '{}').mainMenuLayout).toBe('hidden'))
  })

  it('切换已有 Agent 只更新选中态，不改变列表排序', () => {
    createMatchMedia(1440)
    renderShell('expanded', 'light', '/agents/zhouce', ['songyan', 'zhouce'])

    const links = within(screen.getByRole('navigation', { name: '当前 Team Agent' })).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(/^周策/),
      expect.stringMatching(/^知衡/),
      expect.stringMatching(/^林序/),
    ])
    expect(links[0]).toHaveAttribute('aria-current', 'page')
  })

  it('当前 Team Agent 栏隔离其他 Team，最近访问只影响排序', () => {
    createMatchMedia(1440)
    const currentTeamId = initialState.currentTeamId
    const otherTeamId = 'team-other'
    const otherAgent = { ...initialState.agents[0], id: 'other-agent', name: '其他 Team Agent', teamId: otherTeamId }
    renderShell('expanded', 'light', '/', [otherAgent.id, 'zhiheng', 'zhouce'], {
      currentTeamId,
      teams: [...initialState.teams, { ...initialState.teams[0], id: otherTeamId, name: '其他 Team' }],
      agents: [...initialState.agents, otherAgent],
    })

    const links = within(screen.getByRole('navigation', { name: '当前 Team Agent' })).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
      expect.stringMatching(/^知衡/),
      expect.stringMatching(/^周策/),
      expect.stringMatching(/^林序/),
    ])
    expect(screen.queryByRole('link', { name: /^其他 Team Agent/ })).not.toBeInTheDocument()
  })

  it('窗口缩窄时收起一级菜单', async () => {
    const viewport = createMatchMedia(1440)
    const { container } = renderShell('expanded')
    expect(container.querySelector('[data-primary-menu-layout]')).toHaveAttribute('data-primary-menu-layout', 'expanded')

    act(() => viewport.resize(390))
    await waitFor(() => expect(container.querySelector('[data-primary-menu-layout]')).toHaveAttribute('data-primary-menu-layout', 'compact'))
  })

  it('跟随窗口调整当前 Team Agent栏宽度', async () => {
    const viewport = createMatchMedia(1279)
    const { container } = renderShell('follow-window', 'light', '/', ['zhouce'])
    expect(container.querySelector('[data-main-menu-layout]')).toHaveAttribute('data-main-menu-layout', 'compact')

    act(() => viewport.resize(1280))
    await waitFor(() => expect(container.querySelector('[data-main-menu-layout]')).toHaveAttribute('data-main-menu-layout', 'expanded'))
  })

  it('AI 工具入口位于全局侧栏而非页面顶栏', () => {
    createMatchMedia(1440)
    renderShell('expanded', 'light', '/tasks', ['zhouce'])

    const rail = screen.getByLabelText('Bandi 配置管理')
    expect(within(rail).getByRole('button', { name: 'Claude Code' })).toBeInTheDocument()
    expect(within(screen.getByRole('banner')).queryByRole('button', { name: /Claude Code|AI 工具/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/浏览器演示|本机配置管理/)).not.toBeInTheDocument()
  })

  it.each(['committed', 'restarting'] as const)('%s 时只显示重新打开终态', (status) => {
    createMatchMedia(1440)
    renderShell('expanded', 'light', '/tasks', ['zhouce'], {
      factoryReset: { status },
    })

    expect(screen.getByRole('status')).toHaveTextContent('Bandi 正在重新打开')
    expect(screen.queryByText('任务内容')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Bandi 配置管理')).not.toBeInTheDocument()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
  })

  it('自动重新打开失败时只显示手动兜底和技术详情', () => {
    createMatchMedia(1440)
    renderShell('expanded', 'light', '/tasks', ['zhouce'], {
      factoryReset: {
        status: 'manual-restart-required',
        technicalDetails: 'restart failed',
      },
    })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Bandi 已重置')
    expect(alert).toHaveTextContent('请重新打开 Bandi')
    expect(alert).toHaveTextContent('restart failed')
    expect(screen.queryByText('任务内容')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Bandi 配置管理')).not.toBeInTheDocument()
  })

  it('旧开发数据库状态直达重置 Bandi 页签', async () => {
    createMatchMedia(1440)
    renderShell('expanded', 'light', '/', [], {
      factoryReset: {
        status: 'legacy-database-required',
        technicalDetails: 'LEGACY_DATABASE_RESET_REQUIRED: old database',
      },
    })

    await waitFor(() => expect(screen.getByText('设置内容')).toBeInTheDocument())
  })
})
