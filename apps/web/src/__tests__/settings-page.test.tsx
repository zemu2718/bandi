// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '../pages/settings/settings-pages'
import { EditorSessionProvider } from '../editor-session'
import { AppProvider, initialState, type State } from '../state'
import { DEFAULT_UI_PREFERENCES, UI_PREFERENCES_STORAGE_KEY } from '../ui-preferences'

const desktopBridge = vi.hoisted(() => ({
  desktop: false,
  deleteUiAsset: vi.fn<(slot: 'logo' | 'background') => Promise<void>>(),
  importUiAsset: vi.fn<() => Promise<void>>(),
  readUiAsset: vi.fn<() => Promise<string | undefined>>(),
}))

vi.mock('../desktop-bridge', () => ({
  deleteUiAsset: desktopBridge.deleteUiAsset,
  importUiAsset: desktopBridge.importUiAsset,
  isDesktopRuntime: () => desktopBridge.desktop,
  readUiAsset: desktopBridge.readUiAsset,
}))

function renderSettings(initialEntry = '/', state?: State) {
  const router = createMemoryRouter([{
    path: '/',
    element: <AppProvider initialState={state}><EditorSessionProvider><SettingsPage /></EditorSessionProvider></AppProvider>,
  }], { initialEntries: [initialEntry] })
  return render(<RouterProvider router={router} />)
}

const storage = new Map<string, string>()
const NativeRequest = globalThis.Request
beforeEach(() => {
  storage.clear()
  vi.stubGlobal('Request', class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, { ...init, signal: undefined })
    }
  })
  desktopBridge.desktop = false
  desktopBridge.deleteUiAsset.mockReset().mockResolvedValue(undefined)
  desktopBridge.importUiAsset.mockReset().mockResolvedValue(undefined)
  desktopBridge.readUiAsset.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('设置页', () => {
  it('默认展示四个用户可操作的设置分类', () => {
    renderSettings()

    expect(screen.getByText('管理工具交接、终端偏好、本机数据恢复与外观。')).toBeInTheDocument()
    expect(screen.getAllByRole('navigation', { name: '设置分类' })[0].querySelectorAll('button')).toHaveLength(4)
    expect(screen.getByRole('button', { name: '工具与交接' })).toHaveClass('bg-foreground')
    expect(screen.getByRole('button', { name: '终端' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '数据与恢复' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '外观' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '默认终端' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '首选编辑器' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '常规' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '客户端与工具' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '工作区默认' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '路径与编辑器' })).not.toBeInTheDocument()
  })

  it('兼容旧链接并让已删除分类回退到工具与交接', () => {
    const { unmount } = renderSettings('/?section=ai-clients')
    expect(screen.getByRole('button', { name: '工具与交接' })).toHaveClass('bg-foreground')
    unmount()

    renderSettings('/?section=workspace')
    expect(screen.getByRole('button', { name: '工具与交接' })).toHaveClass('bg-foreground')
    expect(screen.getByText('要管理的 AI 编程工具')).toBeInTheDocument()
  })

  it('在终端分类中管理默认终端', () => {
    renderSettings('/?section=terminal')

    const terminal = screen.getByRole('combobox', { name: '默认终端' })
    expect(terminal).toHaveValue('terminal')
    expect(screen.getByRole('option', { name: 'Terminal.app' })).toHaveValue('terminal')
    expect(screen.queryByRole('option', { name: '系统默认终端' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Warp' })).toHaveValue('warp')
    expect(screen.getByRole('option', { name: 'Ghostty' })).toHaveValue('ghostty')
    expect(screen.getByText(/当前选择只保存在页面内存，刷新后恢复默认值/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '首选编辑器' })).not.toBeInTheDocument()

    fireEvent.change(terminal, { target: { value: 'iterm2' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(terminal).toHaveValue('terminal')

    fireEvent.change(terminal, { target: { value: 'ghostty' } })
    fireEvent.click(screen.getByRole('button', { name: '保存演示设置' }))
    expect(terminal).toHaveValue('ghostty')
  })

  it('将旧版 system 终端偏好显示为 Terminal.app', () => {
    renderSettings('/?section=terminal', {
      ...initialState,
      settings: { ...initialState.settings, terminal: 'system' },
    })

    expect(screen.getByRole('combobox', { name: '默认终端' })).toHaveValue('terminal')
    expect(screen.queryByRole('option', { name: '系统默认终端' })).not.toBeInTheDocument()
  })

  it('Desktop 只展示真实设置并保存白名单终端偏好', async () => {
    desktopBridge.desktop = true
    const { unmount } = renderSettings('/?section=network', {
      ...initialState,
      runtime: 'desktop',
      uiPreferences: { ...DEFAULT_UI_PREFERENCES, terminal: 'terminal' },
    })

    expect(screen.getAllByRole('navigation', { name: '设置分类' })[0].querySelectorAll('button')).toHaveLength(4)
    expect(screen.getByRole('button', { name: '工具与交接' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '网络与代理' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '工具与交接' })).toHaveClass('bg-foreground')

    unmount()
    const terminalView = renderSettings('/?section=terminal', {
      ...initialState,
      runtime: 'desktop',
      uiPreferences: { ...DEFAULT_UI_PREFERENCES, terminal: 'terminal' },
    })
    expect(screen.getByText(/白名单界面偏好/)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '默认终端' }), { target: { value: 'ghostty' } })
    fireEvent.click(screen.getByRole('button', { name: '保存终端偏好' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? '{}').terminal).toBe('ghostty'))

    terminalView.unmount()
    renderSettings('/?section=data', {
      ...initialState,
      runtime: 'desktop',
      uiPreferences: { ...DEFAULT_UI_PREFERENCES, terminal: 'ghostty' },
    })
    expect(screen.getByRole('tab', { name: '本地数据' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '配置文件快照' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '重新开始' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '配置方案' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '远程备份' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Agent 根目录' })).not.toBeInTheDocument()
  })

  it('将配置与备份拆为四个互斥 Tab 并保留内容归属', () => {
    renderSettings('/?section=data')

    const profiles = screen.getByRole('tab', { name: '配置方案' })
    const content = screen.getByTestId('configuration-backup-scroll-area')
    expect(content).toHaveClass('flex-1', 'lg:overflow-y-auto', 'lg:overscroll-contain')
    expect(profiles).toHaveAttribute('aria-selected', 'true')
    expect(profiles).toHaveAttribute('aria-controls', 'configuration-backup-panel-profiles')
    expect(screen.getByRole('tabpanel', { name: '配置方案' })).toHaveAttribute('aria-labelledby', 'configuration-backup-tab-profiles')
    expect(screen.getByText('个人配置')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新建配置方案' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Agent 根目录' })).not.toBeInTheDocument()
    expect(screen.queryByText('快照历史')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '存储位置' }))
    expect(screen.getByRole('textbox', { name: 'Agent 根目录' })).toHaveValue('~/.bandi/agents')
    expect(screen.getByText('外部变化保护')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '演示检查频率' })).toHaveValue('5 分钟')
    expect(screen.queryByText('自动快照')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '快照与恢复' }))
    expect(screen.getByText('快照历史')).toBeInTheDocument()
    expect(screen.getByText('自动快照')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '启用自动快照' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getAllByRole('button', { name: '预览恢复' }).length).toBeGreaterThan(0)
    expect(screen.queryByText('Private Git 约束')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '远程备份' }))
    expect(screen.getByText('Private Git 约束')).toBeInTheDocument()
    expect(screen.getByText('远程备份包含正式记忆')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '远程备份包含正式记忆' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/凭据、Token、钥匙串/)).toBeInTheDocument()
    expect(screen.queryByText('快照历史')).not.toBeInTheDocument()
  })

  it('在存储位置展示已登记的本地访问边界', () => {
    const managed = {
      ...initialState.agents[0],
      id: 'managed-access',
      packagePath: '~/.bandi/agents/agt_managed-access/',
      packageSource: { kind: 'bandi-managed' as const, packageId: 'agt_managed-access', strategy: 'managed' as const },
    }
    const imported = {
      ...initialState.agents[0],
      id: 'imported-access',
      packagePath: '~/.bandi/agents/agt_imported-access/',
      packageSource: { kind: 'claude-agent-import' as const, packageId: 'agt_imported-access', strategy: 'managed-copy' as const, sourcePath: '/Users/demo/.claude/agents/reviewer.md', sourceBaselineHash: 'sha256:source', importedAt: '2026-09-02T00:00:00Z' },
    }
    const reference = {
      ...initialState.agents[0],
      id: 'external-access',
      packagePath: '/Volumes/shared/agent/',
      packageSource: { kind: 'external-reference' as const, externalPath: '/Volumes/shared/agent', strategy: 'reference-only' as const },
    }
    renderSettings('/?section=data', {
      ...initialState,
      runtime: 'desktop',
      agents: [managed, imported, reference],
    })

    fireEvent.click(screen.getByRole('tab', { name: '存储位置' }))
    expect(screen.getByText('本地访问边界')).toBeInTheDocument()
    expect(screen.getByText('Bandi 受管 Agent 配置')).toBeInTheDocument()
    expect(screen.getByText('Agent 导入来源')).toBeInTheDocument()
    expect(screen.getByText('历史外部 Agent 引用')).toBeInTheDocument()
    expect(screen.getByText('/Users/demo/.claude/agents/reviewer.md')).toBeInTheDocument()
    expect(screen.getByText('/Volumes/shared/agent')).toBeInTheDocument()
    expect(screen.getByText(/不是整盘权限/)).toBeInTheDocument()
    expect(screen.queryByText(/OS 已授权/)).not.toBeInTheDocument()
  })

  it('配置与备份 Tab 支持循环键盘切换、切换回顶并保留未保存草稿', async () => {
    renderSettings('/?section=data')
    const content = screen.getByTestId('configuration-backup-scroll-area')
    const scrollTo = vi.fn()
    content.scrollTo = scrollTo
    const profiles = screen.getByRole('tab', { name: '配置方案' })
    const storageTab = screen.getByRole('tab', { name: '存储位置' })
    const remote = screen.getByRole('tab', { name: '远程备份' })

    fireEvent.keyDown(profiles, { key: 'ArrowLeft' })
    await waitFor(() => expect(remote).toHaveFocus())
    expect(remote).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(remote, { key: 'Home' })
    await waitFor(() => expect(profiles).toHaveFocus())
    fireEvent.keyDown(profiles, { key: 'End' })
    await waitFor(() => expect(remote).toHaveFocus())
    fireEvent.keyDown(remote, { key: 'ArrowRight' })
    await waitFor(() => expect(profiles).toHaveFocus())

    fireEvent.click(storageTab)
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0 })
    const agentRoot = screen.getByRole('textbox', { name: 'Agent 根目录' })
    fireEvent.change(agentRoot, { target: { value: '~/.bandi/custom-agents' } })
    fireEvent.click(remote)
    fireEvent.change(screen.getByRole('textbox', { name: '仓库地址' }), { target: { value: 'github.com/org/demo' } })
    fireEvent.click(profiles)
    fireEvent.click(storageTab)
    expect(screen.getByRole('textbox', { name: 'Agent 根目录' })).toHaveValue('~/.bandi/custom-agents')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole('textbox', { name: 'Agent 根目录' })).toHaveValue('~/.bandi/agents')
    fireEvent.click(remote)
    expect(screen.getByRole('textbox', { name: '仓库地址' })).toHaveValue('github.com/org/demo')
  })

  it('保存存储位置并在关闭创建快照对话框后恢复焦点', async () => {
    renderSettings('/?section=data')

    fireEvent.click(screen.getByRole('tab', { name: '存储位置' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Agent 根目录' }), { target: { value: '~/.bandi/custom-agents' } })
    fireEvent.click(screen.getByRole('button', { name: '保存演示设置' }))
    expect(screen.getByRole('textbox', { name: 'Agent 根目录' })).toHaveValue('~/.bandi/custom-agents')

    fireEvent.click(screen.getByRole('tab', { name: '快照与恢复' }))
    const trigger = screen.getByRole('button', { name: '创建快照' })
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: '创建快照' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('所有工具共享当前配置方案并独立加入', () => {
    renderSettings('/?section=ai-clients')

    expect(screen.getByRole('combobox', { name: '当前配置方案' })).toHaveValue('personal')
    expect(screen.getByText(/这里只记录当前配置方案管理哪些工具/)).toBeInTheDocument()
    expect(screen.getAllByText('可选择 Agent 与上下文 · 尚未检查是否已安装')).toHaveLength(2)
    expect(screen.getAllByText('仅管理配置 · 暂不支持直接打开').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: '从方案移除' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '加入配置方案' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: '新建配置方案' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Gateway/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Profile/)).not.toBeInTheDocument()
  })

  it('以中文展示插件安装范围和状态', () => {
    const scopes = ['user', 'project', 'local', 'managed'] as const
    renderSettings('/?section=ai-clients', {
      ...initialState,
      pluginInstallations: scopes.map((scope, index) => ({
        ...initialState.pluginInstallations[0],
        pluginId: `plugin-${scope}`,
        scope,
        installedVersion: `1.0.${index}`,
      })),
    })

    expect(screen.getByText('1.0.0 · 用户级')).toBeInTheDocument()
    expect(screen.getByText('1.0.1 · 项目级')).toBeInTheDocument()
    expect(screen.getByText('1.0.2 · 本地级')).toBeInTheDocument()
    expect(screen.getByText('1.0.3 · 受管级')).toBeInTheDocument()
    expect(screen.getAllByText('已安装')).toHaveLength(4)
  })

  it('在配置与备份中新建空白方案并统一切换', async () => {
    renderSettings('/?section=data')
    fireEvent.click(screen.getByRole('button', { name: '新建配置方案' }))
    fireEvent.change(screen.getByLabelText('方案名称'), { target: { value: 'Team B' } })
    fireEvent.click(screen.getByRole('button', { name: '创建演示方案' }))
    await waitFor(() => expect(screen.getByText('Team B')).toBeInTheDocument())
    expect(screen.getAllByText('当前').length).toBeGreaterThan(0)
    expect(screen.getByText('已加入 0 个工具 · 1 个演示版本')).toBeInTheDocument()
  })

  it('网络代理默认跟随系统且仅手动模式展开字段', () => {
    renderSettings('/?section=network')
    const mode = screen.getByRole('combobox', { name: '代理模式' })
    expect(mode).toHaveValue('system')
    expect(screen.queryByRole('textbox', { name: 'HTTP 代理' })).not.toBeInTheDocument()
    fireEvent.change(mode, { target: { value: 'manual' } })
    const httpProxy = screen.getByRole('textbox', { name: 'HTTP 代理' })
    fireEvent.change(httpProxy, { target: { value: 'ftp://proxy.example.com' } })
    expect(screen.getByText(/协议必须是 http: 或 https:/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存演示设置' })).toBeDisabled()
  })

  it('个性化草稿立即作用当前工作台，保存前不持久化', async () => {
    renderSettings('/?section=appearance')

    const savedBeforeDraft = localStorage.getItem(UI_PREFERENCES_STORAGE_KEY)
    expect(screen.queryByTestId('personalization-actions')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '布局' }))
    fireEvent.click(screen.getByRole('button', { name: /紧凑显示/ }))
    fireEvent.click(screen.getByRole('tab', { name: '主题与颜色' }))
    fireEvent.click(screen.getByRole('button', { name: /暗色/ }))
    expect(document.documentElement).toHaveClass('dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY)).toBe(savedBeforeDraft)
    expect(screen.getByTestId('personalization-actions')).toHaveTextContent('有未保存的更改 · 仅当前设备')
    expect(screen.queryByText(/项更改尚未保存/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? '{}').mainMenuLayout).toBe('compact'))
    expect(JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? '{}').theme).toBe('dark')
    expect(screen.queryByTestId('personalization-actions')).not.toBeInTheDocument()
    expect(localStorage.getItem('bandi-settings')).toBeNull()
  })

  it('取消个性化草稿后恢复已保存工作台', async () => {
    renderSettings('/?section=appearance')

    fireEvent.click(screen.getByRole('tab', { name: '主题与颜色' }))
    fireEvent.click(screen.getByRole('button', { name: /暗色/ }))
    expect(document.documentElement).toHaveClass('dark')

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'))
    expect(screen.getByRole('button', { name: /跟随系统/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('可隐藏 Agent 上下文栏并保存偏好', async () => {
    renderSettings('/?section=appearance')

    fireEvent.click(screen.getByRole('tab', { name: '布局' }))
    fireEvent.click(screen.getByRole('button', { name: /隐藏/ }))
    expect(screen.getByText(/可随时在此恢复/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? '{}').mainMenuLayout).toBe('hidden'))
  })

  it('外观页签独立展示内容并保留跨页签草稿', () => {
    renderSettings('/?section=appearance')

    fireEvent.change(screen.getByRole('textbox', { name: /^工作台名称/ }), { target: { value: '我的工作台' } })
    fireEvent.click(screen.getByRole('tab', { name: '主题与颜色' }))
    expect(screen.queryByRole('textbox', { name: '工作台名称' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: '外观模式' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '品牌与标识' }))
    expect(screen.getByRole('textbox', { name: /^工作台名称/ })).toHaveValue('我的工作台')
  })

  it('个性化分类使用分段页签并提供字段校验', () => {
    renderSettings('/?section=appearance')

    const navigation = screen.getByRole('tablist', { name: '外观设置章节' })
    const content = screen.getByTestId('personalization-scroll-area')
    expect(navigation).toHaveClass('rounded-xl', 'bg-muted/50')
    expect(content).toHaveClass('flex-1', 'lg:overflow-y-auto', 'lg:overscroll-contain')
    expect(screen.getByRole('tab', { name: '品牌与标识' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: '品牌与标识' })).toBeInTheDocument()
    expect(screen.getByText('工作台标识').closest('div')).toHaveTextContent('图片选择和预览仅在 Bandi Desktop 中可用。')
    expect(screen.getAllByText('图片选择和预览仅在 Bandi Desktop 中可用。')).toHaveLength(1)
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1)

    fireEvent.click(screen.getByRole('tab', { name: '工作台背景' }))
    const backgroundGrid = screen.getByRole('group', { name: '背景效果' }).querySelector('.grid')
    expect(backgroundGrid).toHaveClass('grid-cols-1', 'sm:grid-cols-2')
    expect(screen.queryByRole('heading', { name: '品牌与标识' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '主题与颜色' }))
    const appearanceGrid = screen.getByRole('group', { name: '外观模式' }).querySelector('.grid')
    expect(appearanceGrid).toHaveClass('grid-cols-1', 'sm:grid-cols-3')
    expect(appearanceGrid).not.toHaveAttribute('style')
    const custom = screen.getByRole('button', { name: '自定义颜色' })
    fireEvent.click(custom)
    fireEvent.change(screen.getByRole('textbox', { name: '颜色值' }), { target: { value: '#xyz' } })
    expect(screen.getByRole('button', { name: '保存更改' })).toBeDisabled()
    expect(screen.getByTestId('personalization-actions')).toHaveClass('max-[959px]:flex-col')
  })

  it('恢复默认只修改草稿，保存后才写入默认偏好', async () => {
    renderSettings('/?section=appearance', {
      ...initialState,
      uiPreferences: { ...DEFAULT_UI_PREFERENCES, theme: 'dark', density: 'comfortable' },
      theme: 'dark',
    })

    const savedBeforeRestore = localStorage.getItem(UI_PREFERENCES_STORAGE_KEY)
    fireEvent.click(screen.getByRole('button', { name: '恢复默认…' }))
    expect(screen.getByRole('dialog', { name: '恢复默认外观？' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }))
    fireEvent.click(screen.getByRole('tab', { name: '主题与颜色' }))
    expect(screen.getByRole('button', { name: /跟随系统/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('tab', { name: '字体与显示' }))
    expect(screen.getAllByRole('button', { name: /标准/ })).toHaveLength(2)
    expect(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY)).toBe(savedBeforeRestore)

    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? '{}').theme).toBe(DEFAULT_UI_PREFERENCES.theme))
    expect(JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? '{}').density).toBe(DEFAULT_UI_PREFERENCES.density)
  })

  it('Desktop 展示完整图片选择器并读取固定槽位', async () => {
    desktopBridge.desktop = true
    renderSettings('/?section=appearance', { ...initialState, runtime: 'desktop' })

    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(1)
    expect(screen.getByText('选择图片')).toBeInTheDocument()
    expect(screen.queryByText('图片选择和预览仅在 Bandi Desktop 中可用。')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '工作台背景' }))
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(1)
    expect(screen.getByText('选择图片')).toBeInTheDocument()
    await waitFor(() => expect(desktopBridge.readUiAsset).toHaveBeenCalledWith('logo'))
    expect(desktopBridge.readUiAsset).toHaveBeenCalledWith('background')
  })

  it('图片清理部分失败时先移除偏好引用并允许幂等重试', async () => {
    desktopBridge.desktop = true
    desktopBridge.deleteUiAsset.mockImplementation((slot) =>
      slot === 'background' ? Promise.reject(new Error('背景清理失败')) : Promise.resolve(),
    )
    renderSettings('/?section=appearance', {
      ...initialState,
      uiPreferences: {
        ...DEFAULT_UI_PREFERENCES,
        logoAsset: { kind: 'local_asset', assetId: 'logo' },
        backgroundAsset: { kind: 'local_asset', assetId: 'background' },
      },
    })

    fireEvent.click(screen.getByRole('button', { name: '恢复默认…' }))
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }))
    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
    fireEvent.click(screen.getByRole('tab', { name: '工作台背景' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('偏好已保存，但旧图片未能清理。再次保存可重试。'))
    const saved = JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? '{}')
    expect(saved.logoAsset).toBeUndefined()
    expect(saved.backgroundAsset).toBeUndefined()
    expect(desktopBridge.deleteUiAsset).toHaveBeenCalledWith('logo')
    expect(desktopBridge.deleteUiAsset).toHaveBeenCalledWith('background')

    desktopBridge.deleteUiAsset.mockClear().mockResolvedValue(undefined)
    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
    await waitFor(() => expect(desktopBridge.deleteUiAsset).toHaveBeenCalledTimes(1))
    expect(desktopBridge.deleteUiAsset).toHaveBeenCalledWith('background')
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})
