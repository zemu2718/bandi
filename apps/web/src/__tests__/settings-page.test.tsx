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
  it('默认展示三个用户可操作的设置分类', () => {
    renderSettings()

    expect(screen.getByText('管理终端偏好、本机数据恢复与外观。')).toBeInTheDocument()
    expect(screen.getAllByRole('navigation', { name: '设置分类' })[0].querySelectorAll('button')).toHaveLength(3)
    expect(screen.getByRole('button', { name: '终端偏好' })).toHaveClass('bg-foreground')
    expect(screen.getByRole('button', { name: '数据与恢复' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '外观' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '默认终端' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '首选编辑器' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '常规' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '客户端与工具' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '工作区默认' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '路径与编辑器' })).not.toBeInTheDocument()
  })

  it('未知设置分类回退到终端偏好', () => {
    renderSettings('/?section=workspace')

    expect(screen.getByRole('button', { name: '终端偏好' })).toHaveClass('bg-foreground')
    expect(screen.getByRole('combobox', { name: '默认终端' })).toBeInTheDocument()
  })

  it('在终端偏好分类中管理默认终端', () => {
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
    fireEvent.click(screen.getAllByRole('button', { name: '取消' })[0])
    expect(terminal).toHaveValue('terminal')

    fireEvent.change(terminal, { target: { value: 'ghostty' } })
    fireEvent.click(screen.getAllByRole('button', { name: '保存演示设置' })[0])
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

    expect(screen.getAllByRole('navigation', { name: '设置分类' })[0].querySelectorAll('button')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'AI 工具' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '网络与代理' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '终端偏好' })).toHaveClass('bg-foreground')

    unmount()
    const terminalView = renderSettings('/?section=terminal', {
      ...initialState,
      runtime: 'desktop',
      uiPreferences: { ...DEFAULT_UI_PREFERENCES, terminal: 'terminal' },
    })
    expect(screen.getByText(/这台设备上的 Bandi 偏好/)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '默认终端' }), { target: { value: 'ghostty' } })
    fireEvent.click(screen.getByRole('button', { name: '保存终端偏好' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? '{}').terminal).toBe('ghostty'))

    terminalView.unmount()
    renderSettings('/?section=recovery', {
      ...initialState,
      runtime: 'desktop',
      uiPreferences: { ...DEFAULT_UI_PREFERENCES, terminal: 'ghostty' },
    })
    expect(screen.getByRole('tab', { name: '本地数据' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '配置文件快照' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '重置 Bandi' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '配置方案' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '远程备份' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Agent 根目录' })).not.toBeInTheDocument()
  })

  it('数据与恢复保留存储、快照与远程备份三个 Tab', () => {
    renderSettings('/?section=recovery')

    expect(screen.getByRole('tab', { name: '存储位置' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('textbox', { name: 'Agent 根目录' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '快照与恢复' }))
    expect(screen.getByText('快照历史')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: '远程备份' }))
    expect(screen.getByText('Private Git 约束')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '配置方案' })).not.toBeInTheDocument()
  })

  it('网络代理保留在 Web 终端偏好页', () => {
    renderSettings('/?section=terminal')
    const mode = screen.getByRole('combobox', { name: '代理模式' })
    expect(mode).toHaveValue('system')
    fireEvent.change(mode, { target: { value: 'manual' } })
    const httpProxy = screen.getByRole('textbox', { name: 'HTTP 代理' })
    fireEvent.change(httpProxy, { target: { value: 'ftp://proxy.example.com' } })
    expect(screen.getByText(/协议必须是 http: 或 https:/)).toBeInTheDocument()
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
