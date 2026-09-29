// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from '../pages/settings/settings-pages'
import { EditorSessionProvider } from '../editor-session'
import { AppProvider, initialState, useApp, type State } from '../state'
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

function ExternalPreferenceControls() {
  const { state, dispatch } = useApp()
  return <>
    <button onClick={() => dispatch({ type: 'THEME' })}>外部切换主题</button>
    <button onClick={() => dispatch({ type: 'UPDATE_UI_PREFERENCES', preferences: { ...state.uiPreferences, terminal: 'ghostty' } })}>外部切换终端</button>
  </>
}

function renderSettings(initialEntry = '/', state?: State, controls = false) {
  const router = createMemoryRouter([{
    path: '/',
    element: <AppProvider initialState={state}><EditorSessionProvider>{controls && <ExternalPreferenceControls />}<SettingsPage /></EditorSessionProvider></AppProvider>,
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
    expect(screen.getByRole('button', { name: '终端偏好' })).toHaveAttribute('aria-current', 'page')
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

    expect(screen.getByRole('button', { name: '终端偏好' })).toHaveAttribute('aria-current', 'page')
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
    expect(screen.getByText(/当前 Web 演示只保存在页面内存/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '首选编辑器' })).not.toBeInTheDocument()

    expect(screen.queryByTestId('terminal-actions')).not.toBeInTheDocument()
    fireEvent.change(terminal, { target: { value: 'iterm2' } })
    expect(screen.getByTestId('terminal-actions')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(terminal).toHaveValue('terminal')

    fireEvent.change(terminal, { target: { value: 'ghostty' } })
    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
    expect(terminal).toHaveValue('ghostty')
    expect(screen.queryByTestId('terminal-actions')).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: '终端偏好' })).toHaveAttribute('aria-current', 'page')

    unmount()
    const terminalView = renderSettings('/?section=terminal', {
      ...initialState,
      runtime: 'desktop',
      uiPreferences: { ...DEFAULT_UI_PREFERENCES, terminal: 'terminal' },
    })
    expect(screen.getByText(/仅保存在这台设备/)).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: '默认终端' }), { target: { value: 'ghostty' } })
    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? '{}').terminal).toBe('ghostty'))

    terminalView.unmount()
    renderSettings('/?section=recovery', {
      ...initialState,
      runtime: 'desktop',
      uiPreferences: { ...DEFAULT_UI_PREFERENCES, terminal: 'ghostty' },
    })
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByText('本机数据')).toBeInTheDocument()
    expect(screen.getByText('快照历史')).toBeInTheDocument()
    expect(screen.getByText('重置 Bandi')).toBeInTheDocument()
    expect(screen.queryByText('Private Git 约束')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Agent 根目录' })).not.toBeInTheDocument()
  })

  it('Web 数据与恢复只展示受限的本机演示入口', () => {
    renderSettings('/?section=recovery')

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Agent 根目录' })).toBeInTheDocument()
    expect(screen.getByText('本机快照与恢复')).toBeInTheDocument()
    expect(screen.queryByText('快照历史')).not.toBeInTheDocument()
    expect(screen.queryByText('Private Git 约束')).not.toBeInTheDocument()
  })

  it('Web 终端偏好只保留默认终端', () => {
    renderSettings('/?section=terminal')

    expect(screen.getByRole('combobox', { name: '默认终端' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '代理模式' })).not.toBeInTheDocument()
    expect(screen.queryByText('插件安装概览')).not.toBeInTheDocument()
  })

  it('个性化草稿立即作用当前工作台，保存前不持久化', async () => {
    renderSettings('/?section=appearance')

    const savedBeforeDraft = localStorage.getItem(UI_PREFERENCES_STORAGE_KEY)
    expect(screen.queryByTestId('personalization-actions')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /暗色/ }))
    expect(document.documentElement).toHaveClass('dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
    expect(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY)).toBe(savedBeforeDraft)
    expect(screen.getByTestId('personalization-actions')).toHaveTextContent('有未保存的更改 · 仅当前设备')
    expect(screen.queryByText(/项更改尚未保存/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? '{}').theme).toBe('dark'))
    expect(screen.queryByTestId('personalization-actions')).not.toBeInTheDocument()
    expect(localStorage.getItem('bandi-settings')).toBeNull()
  })

  it('外部偏好更新不会把未操作的外观页标记为未保存', async () => {
    renderSettings('/?section=appearance', undefined, true)

    fireEvent.click(screen.getByRole('button', { name: '外部切换主题' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /暗色/ })).toHaveAttribute('aria-pressed', 'true'))
    fireEvent.click(screen.getByRole('button', { name: '外部切换终端' }))
    expect(screen.queryByTestId('personalization-actions')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '终端偏好' }))
    expect(screen.queryByRole('dialog', { name: '放弃未保存的更改？' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '默认终端' })).toBeInTheDocument()
  })

  it('真实外观修改仍会拦截离开并使用紧凑确认文案', async () => {
    renderSettings('/?section=appearance')

    fireEvent.click(screen.getByRole('button', { name: /暗色/ }))
    fireEvent.click(screen.getByRole('button', { name: '终端偏好' }))

    const dialog = screen.getByRole('dialog', { name: '放弃未保存的更改？' })
    expect(dialog).toHaveTextContent('离开后，这些更改将无法恢复。')
    expect(dialog).not.toHaveTextContent('尚未写入任何文件')
    await waitFor(() => expect(screen.getByRole('button', { name: '继续编辑' })).toHaveFocus())

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '放弃未保存的更改？' })).not.toBeInTheDocument())
    expect(screen.getByTestId('personalization-actions')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '终端偏好' }))
    fireEvent.click(screen.getByRole('button', { name: '放弃更改' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: '默认终端' })).toBeInTheDocument())
  })

  it('保存外观时保留外部更新的非外观偏好', async () => {
    renderSettings('/?section=appearance', undefined, true)

    fireEvent.click(screen.getByRole('button', { name: /暗色/ }))
    fireEvent.click(screen.getByRole('button', { name: '外部切换终端' }))
    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))

    await waitFor(() => expect(JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? '{}').theme).toBe('dark'))
    expect(JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? '{}').terminal).toBe('ghostty')
  })

  it('取消个性化草稿后恢复已保存工作台', async () => {
    renderSettings('/?section=appearance')

    fireEvent.click(screen.getByRole('button', { name: /暗色/ }))
    expect(document.documentElement).toHaveClass('dark')

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'))
    expect(screen.getByRole('button', { name: /跟随系统/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('外观连续展示三个分组和紧凑颜色面板', () => {
    renderSettings('/?section=appearance')

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    const theme = screen.getByRole('heading', { name: '主题与颜色' })
    const display = screen.getByRole('heading', { name: '字体与显示' })
    const background = screen.getByRole('heading', { name: '工作台背景' })
    expect(theme.compareDocumentPosition(display) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(display.compareDocumentPosition(background) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('display-preview')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '自定义颜色' }))
    expect(screen.getByLabelText('颜色')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /透明度/ })).toBeInTheDocument()
    expect(screen.queryByText('当前颜色')).not.toBeInTheDocument()
    expect(screen.queryByText('预览颜色')).not.toBeInTheDocument()
    expect(screen.queryByText('亮色主题')).not.toBeInTheDocument()
    expect(screen.queryByText('暗色主题')).not.toBeInTheDocument()
    expect(screen.queryByText(/对比度不足|无法保存/)).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'HEX' }), { target: { value: '#xyz' } })
    expect(screen.getByRole('textbox', { name: 'HEX' })).toHaveValue('#xyz')
    expect(screen.queryByTestId('personalization-actions')).not.toBeInTheDocument()
  })

  it('透明强调色约束后即时预览并在保存后持久化', async () => {
    renderSettings('/?section=appearance')
    fireEvent.click(screen.getByRole('button', { name: '自定义颜色' }))

    fireEvent.change(screen.getByRole('textbox', { name: 'HEX' }), { target: { value: '#000000' } })
    const opacity = screen.getByRole('slider', { name: /透明度/ })
    fireEvent.change(opacity, { target: { value: '0' } })
    const color = screen.getByRole('textbox', { name: 'HEX' }).getAttribute('value')
    const constrainedOpacity = Number(opacity.getAttribute('value'))
    expect(color).not.toBe('#000000')
    expect(constrainedOpacity).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '保存更改' })).toBeEnabled()
    expect(screen.queryByText(/对比度不足|无法保存/)).not.toBeInTheDocument()
    expect(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY)).not.toContain(`"accentOpacity":${constrainedOpacity}`)

    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? '{}')).toMatchObject({ accentColor: color, accentOpacity: constrainedOpacity }))
    expect(screen.queryByTestId('personalization-actions')).not.toBeInTheDocument()
  })

  it('二维面板支持键盘调整并让预设恢复不透明', () => {
    renderSettings('/?section=appearance')
    fireEvent.click(screen.getByRole('button', { name: '自定义颜色' }))
    expect(screen.getByLabelText('颜色')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('slider', { name: /透明度/ }), { target: { value: '80' } })
    fireEvent.click(screen.getByRole('button', { name: '蓝色' }))
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('rgb(37 99 235 / 1)')
  })

  it('恢复默认只修改草稿，保存后才写入默认偏好', async () => {
    renderSettings('/?section=appearance', {
      ...initialState,
      uiPreferences: { ...DEFAULT_UI_PREFERENCES, theme: 'dark', density: 'comfortable' },
      theme: 'dark',
    })

    const savedBeforeRestore = localStorage.getItem(UI_PREFERENCES_STORAGE_KEY)
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }))
    expect(screen.queryByRole('dialog', { name: '恢复默认外观？' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /跟随系统/ })).toHaveAttribute('aria-pressed', 'true')
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
    await waitFor(() => expect(desktopBridge.readUiAsset).toHaveBeenCalledWith('background'))
    expect(desktopBridge.readUiAsset).toHaveBeenCalledTimes(1)
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
        backgroundAsset: { kind: 'local_asset', assetId: 'background' },
      },
    })

    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }))
    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('偏好已保存，但旧图片未能清理。再次保存可重试。'))
    const saved = JSON.parse(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY) ?? '{}')
    expect(saved.backgroundAsset).toBeUndefined()
    expect(desktopBridge.deleteUiAsset).toHaveBeenCalledWith('background')

    desktopBridge.deleteUiAsset.mockClear().mockResolvedValue(undefined)
    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
    await waitFor(() => expect(desktopBridge.deleteUiAsset).toHaveBeenCalledTimes(1))
    expect(desktopBridge.deleteUiAsset).toHaveBeenCalledWith('background')
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})
