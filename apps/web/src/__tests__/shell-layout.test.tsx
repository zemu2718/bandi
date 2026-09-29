// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { Shell } from '../shell'
import { EditorSessionProvider } from '../editor-session'
import { NotFoundPage } from '../pages/not-found-page'
import { GuidePage } from '../pages/guide-page'
import { PageHeader } from '../components/app/page'
import { Button } from '../components/ui/button'
import { AppProvider, initialState, type State } from '../state'

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
  theme: State['theme'] = 'light',
  initialEntry = '/',
  overrides: Partial<State> = {},
) {
  const state: State = {
    ...initialState,
    ...overrides,
    theme,
    onboarding: overrides.onboarding ?? { status: 'completed' },
    uiPreferences: { ...initialState.uiPreferences, ...overrides.uiPreferences },
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
              <Route path="tools" element={<div>AI 工具内容</div>} />
              <Route path="settings" element={<div>设置内容</div>} />
              <Route path="guide" element={<GuidePage />} />
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
    renderShell(theme)

    const switcher = screen.getByRole('button', { name: /切换 Team，当前为/ })
    expect(switcher).toHaveTextContent('星河')
    expect(switcher.querySelector('[data-brand-variant]')).not.toBeInTheDocument()
  })

  it('Team 切换器显示当前 Team 的一致标识', () => {
    createMatchMedia(1440)
    renderShell()

    const switcher = screen.getByRole('button', { name: /切换 Team，当前为/ })
    expect(switcher).toHaveTextContent('星河')
    expect(switcher).toHaveAttribute('aria-haspopup', 'menu')
  })

  it('一级菜单以需求池为首项，不显示概览和项目', () => {
    createMatchMedia(1440)
    renderShell()
    const rail = screen.getByLabelText('Bandi 配置管理')
    const navigation = within(rail).getByRole('navigation', { name: '一级导航' })

    for (const name of ['需求池', 'Agent', '配置资产', 'AI 工具']) {
      expect(within(navigation).getByRole('link', { name })).toBeInTheDocument()
    }
    expect(within(navigation).queryByRole('link', { name: '组织治理' })).not.toBeInTheDocument()
    expect(within(navigation).queryByRole('link', { name: /概览/ })).not.toBeInTheDocument()
    expect(within(navigation).queryByRole('link', { name: '项目' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /切换 Team，当前为/ })).toBeInTheDocument()
    expect(within(rail).queryByRole('button', { name: '切换到深色' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: '全局工具' })).getByRole('button', { name: '切换到深色' })).toBeInTheDocument()
  })

  it('首次使用首页不渲染空页面顶栏', () => {
    createMatchMedia(1440)
    renderShell('light', '/', { agents: [], onboarding: { status: 'active' } })

    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.getByText('配置状态内容')).toBeInTheDocument()
  })

  it('正常首页保留页面顶栏', () => {
    createMatchMedia(1440)
    renderShell('light', '/', { agents: [], onboarding: { status: 'completed' } })

    expect(screen.getByRole('banner')).toBeInTheDocument()
  })

  it('首次使用状态不影响非首页顶栏', () => {
    createMatchMedia(1440)
    renderShell('light', '/agents', { agents: [], onboarding: { status: 'active' } })

    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByText('Agents 内容')).toBeInTheDocument()
  })

  it('页面标题和主操作进入顶栏，正文不重复', () => {
    createMatchMedia(1440)
    renderShell('light', '/tasks')

    const header = screen.getByRole('banner')
    expect(within(header).getByRole('heading', { level: 1, name: '需求池' })).toBeInTheDocument()
    expect(within(header).getByText('任务说明')).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: '新建需求' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('历史导航固定在窗口顶栏并保留页面唯一标题', () => {
    createMatchMedia(1440)
    renderShell('light', '/tasks')

    const titlebar = screen.getByRole('navigation', { name: '全局工具' }).parentElement!
    const sidebarButton = within(titlebar).getByRole('button', { name: '收起侧栏' })
    const history = within(titlebar).getByRole('navigation', { name: '浏览历史' })
    const back = within(history).getByRole('button', { name: '后退' })
    const forward = within(history).getByRole('button', { name: '前进' })

    expect(back).toBeDisabled()
    expect(forward).toBeDisabled()
    expect(back).toHaveClass('size-11')
    expect(sidebarButton.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(history.compareDocumentPosition(titlebar.querySelector('[data-tauri-drag-region]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 1, name: '需求池' })).toHaveLength(1)
  })

  it('使用指南和设置固定在窗口顶栏，指南按当前页面显示相关主题', async () => {
    createMatchMedia(1440)
    renderShell('light', '/tasks')

    const pageHeader = screen.getByRole('banner')
    const rail = screen.getByLabelText('Bandi 配置管理')
    const globalTools = screen.getByRole('navigation', { name: '全局工具' })
    const titlebar = globalTools.parentElement
    const sidebarButton = within(titlebar!).getByRole('button', { name: '收起侧栏' })
    expect(titlebar?.querySelector('[data-tauri-drag-region]')).toBeEmptyDOMElement()
    expect(titlebar).not.toHaveTextContent('需求池 · Bandi')
    expect(within(rail).queryByRole('button', { name: /侧栏/ })).not.toBeInTheDocument()
    expect(sidebarButton.compareDocumentPosition(globalTools) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const guideButton = within(globalTools).getByRole('button', { name: '使用指南' })
    const themeButton = within(globalTools).getByRole('button', { name: '切换到深色' })
    const settingsLink = within(globalTools).getByRole('link', { name: '设置' })
    expect(guideButton.compareDocumentPosition(themeButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(themeButton.compareDocumentPosition(settingsLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(settingsLink).toHaveAttribute('href', '/settings')
    expect(within(screen.getByLabelText('Bandi 配置管理')).queryByRole('link', { name: '设置' })).not.toBeInTheDocument()
    expect(within(pageHeader).queryByRole('button', { name: '使用指南' })).not.toBeInTheDocument()
    expect(within(pageHeader).getByRole('button', { name: '新建需求' })).toBeInTheDocument()

    guideButton.focus()
    fireEvent.click(guideButton)
    expect(screen.getByRole('dialog')).toHaveTextContent('把长期上下文带到 AI 工具')
    expect(screen.getByRole('dialog')).toHaveTextContent('不关联 Agent，也不记录执行状态')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(guideButton).toHaveFocus()
  })

  it('可在指南弹窗中切换主题并进入相关页面', async () => {
    createMatchMedia(1440)
    renderShell('light', '/agents/zhouce')

    fireEvent.click(screen.getByRole('button', { name: '使用指南' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('完善 Agent 的长期配置')
    expect(within(within(dialog).getByRole('navigation', { name: '使用指南主题' })).getAllByRole('button')).toHaveLength(6)
    expect(within(dialog).getByRole('button', { name: '长期配置' })).toHaveAttribute('aria-current', 'page')

    fireEvent.click(within(dialog).getByRole('button', { name: '需求池与 AI 工具' }))
    expect(dialog).toHaveTextContent('把长期上下文带到 AI 工具')
    const selectedTopic = within(dialog).getByRole('button', { name: '需求池与 AI 工具' })
    expect(selectedTopic).toHaveAttribute('aria-current', 'page')
    expect(selectedTopic).toHaveClass('bg-primary', 'text-primary-foreground')
    expect(dialog.querySelector('[class~="h-[560px]"]')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '选择 AI 工具' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('AI 工具内容')).toBeInTheDocument()
  })

  it('按实际访问顺序后退和前进', async () => {
    createMatchMedia(1440)
    renderShell('light', '/agents')

    fireEvent.click(screen.getByRole('link', { name: '进入周策' }))
    const history = screen.getByRole('navigation', { name: '浏览历史' })
    const back = within(history).getByRole('button', { name: '后退' })
    const forward = within(history).getByRole('button', { name: '前进' })
    await waitFor(() => expect(back).toBeEnabled())
    expect(forward).toBeDisabled()

    fireEvent.click(back)
    await waitFor(() => expect(screen.getByText('Agents 内容')).toBeInTheDocument())
    expect(forward).toBeEnabled()

    fireEvent.click(forward)
    await waitFor(() => expect(screen.getByText('Agent 详情')).toBeInTheDocument())
    expect(back).toBeEnabled()
  })

  it('旧指南地址回到首页并打开默认指南弹窗', async () => {
    createMatchMedia(1440)
    renderShell('light', '/guide')

    await waitFor(() => expect(screen.getByText('配置状态内容')).toBeInTheDocument())
    expect(screen.getByRole('dialog')).toHaveTextContent('从一个 Agent 开始')
    expect(screen.queryByRole('heading', { level: 1, name: '使用指南' })).not.toBeInTheDocument()
  })

  it('待处理配置只从顶栏进入，不加入一级菜单', () => {
    createMatchMedia(1440)
    renderShell('light', '/agents')

    expect(screen.getByRole('link', { name: /配置状态 · \d+ 项/ })).toHaveAttribute('href', '/')
    const navigation = within(screen.getByLabelText('Bandi 配置管理')).getByRole('navigation', { name: '一级导航' })
    expect(within(navigation).queryByRole('link', { name: /配置状态/ })).not.toBeInTheDocument()
  })

  it('正常冷启动直接进入 Agent，主动返回配置状态后不再次跳转', async () => {
    createMatchMedia(1440)
    const agents = initialState.agents.map((agent) => ({ ...agent, files: agent.files.map((file) => ({ ...file, status: '已同步' })) }))
    renderShell('light', '/', {
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
    renderShell('light', '/projects')

    expect(screen.getByRole('heading', { level: 1, name: '页面不存在' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.queryByText('长期配置管理')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回配置状态' })).toHaveAttribute('href', '/')
  })

  it('宽屏默认展开一级菜单，并可独立收起和展开', () => {
    createMatchMedia(1440)
    const { container } = renderShell()
    const rail = screen.getByLabelText('Bandi 配置管理')
    const titlebar = screen.getByRole('navigation', { name: '全局工具' }).parentElement!

    expect(container.querySelector('[data-primary-menu-layout]')).toHaveAttribute('data-primary-menu-layout', 'expanded')
    const collapseButton = within(titlebar).getByRole('button', { name: '收起侧栏' })
    expect(collapseButton).toHaveAttribute('aria-expanded', 'true')
    expect(within(rail).queryByRole('button', { name: /侧栏/ })).not.toBeInTheDocument()
    expect(within(rail).queryByRole('link', { name: '设置' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /切换 Team，当前为/ })).toHaveTextContent('星河科技')
    expect(within(rail).getByText('需求池')).toBeInTheDocument()

    fireEvent.click(collapseButton)
    expect(container.querySelector('[data-primary-menu-layout]')).toHaveAttribute('data-primary-menu-layout', 'compact')
    expect(screen.getByRole('button', { name: /切换 Team，当前为/ })).toHaveTextContent('星河')
    expect(screen.getByRole('button', { name: /切换 Team，当前为/ })).not.toHaveTextContent('星河科技')

    fireEvent.click(within(titlebar).getByRole('button', { name: '展开侧栏' }))
    expect(container.querySelector('[data-primary-menu-layout]')).toHaveAttribute('data-primary-menu-layout', 'expanded')
  })

  it('窄屏默认收起一级菜单', () => {
    createMatchMedia(1024)
    const { container } = renderShell()

    expect(container.querySelector('[data-primary-menu-layout]')).toHaveAttribute('data-primary-menu-layout', 'compact')
    expect(screen.getByRole('button', { name: '展开侧栏' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('跟随系统暗色时首次点击立即切换到浅色', async () => {
    createMatchMedia(1440)
    renderShell('dark', '/', {
      uiPreferences: { ...initialState.uiPreferences, theme: 'system' },
    })

    const globalTools = screen.getByRole('navigation', { name: '全局工具' })
    fireEvent.click(within(globalTools).getByRole('button', { name: '切换到浅色' }))

    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'light'))
    expect(within(globalTools).getByRole('button', { name: '切换到深色' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('bandi-ui-preferences-v1') ?? '{}').theme).toBe('light')
  })

  it('窗口缩窄时收起一级菜单', async () => {
    const viewport = createMatchMedia(1440)
    const { container } = renderShell()
    expect(container.querySelector('[data-primary-menu-layout]')).toHaveAttribute('data-primary-menu-layout', 'expanded')

    act(() => viewport.resize(390))
    await waitFor(() => expect(container.querySelector('[data-primary-menu-layout]')).toHaveAttribute('data-primary-menu-layout', 'compact'))
  })

  it('AI 工具紧跟配置资产位于一级导航', () => {
    createMatchMedia(1440)
    renderShell('light', '/tasks')

    const navigation = within(screen.getByLabelText('Bandi 配置管理')).getByRole('navigation', { name: '一级导航' })
    const assetsLink = within(navigation).getByRole('link', { name: '配置资产' })
    const toolsLink = within(navigation).getByRole('link', { name: 'AI 工具' })
    expect(toolsLink).toHaveAttribute('href', '/tools')
    expect(assetsLink.compareDocumentPosition(toolsLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(screen.getByRole('banner')).queryByRole('link', { name: 'AI 工具' })).not.toBeInTheDocument()
  })

  it.each(['committed', 'restarting'] as const)('%s 时只显示重新打开终态', (status) => {
    createMatchMedia(1440)
    renderShell('light', '/tasks', {
      factoryReset: { status },
    })

    expect(screen.getByRole('status')).toHaveTextContent('Bandi 正在重新打开')
    expect(screen.queryByText('任务内容')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Bandi 配置管理')).not.toBeInTheDocument()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
  })

  it('自动重新打开失败时只显示手动兜底和技术详情', () => {
    createMatchMedia(1440)
    renderShell('light', '/tasks', {
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
    renderShell('light', '/', {
      factoryReset: {
        status: 'legacy-database-required',
        technicalDetails: 'LEGACY_DATABASE_RESET_REQUIRED: old database',
      },
    })

    await waitFor(() => expect(screen.getByText('设置内容')).toBeInTheDocument())
  })
})
