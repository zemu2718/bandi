// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FactoryResetPanel } from '../pages/settings/factory-reset-panel'
import { ToolsPage } from '../pages/tools/tools-page'
import { AppProvider, initialState, useApp } from '../state'
import { MAIN_MENU_LAYOUT_STORAGE_KEY } from '../navigation-layout'
import { LEGACY_THEME_STORAGE_KEY, UI_PREFERENCES_STORAGE_KEY } from '../ui-preferences'

const bridge = vi.hoisted(() => ({
  isDesktopRuntime: () => true,
  commitFactoryReset: vi.fn(),
  restartAfterFactoryReset: vi.fn(),
  listAiToolHostStatuses: vi.fn(),
  openAiToolInstallPage: vi.fn(),
  revealAiToolConfigLocation: vi.fn(),
  previewAiToolUpgrade: vi.fn(),
  commitAiToolUpgrade: vi.fn(),
  previewFactoryReset: vi.fn(),
}))

vi.mock('../desktop-bridge', () => bridge)

const hostStatuses = initialState.aiClients.map((client) => ({
  toolId: client.id,
  availability: client.id === 'claude-code' ? 'installed' : 'not_found',
  contextMode: client.id === 'claude-code' ? 'initial_prompt' : 'manual_context',
  configLocationLabel: `~/.config/${client.id}`,
  canRevealConfig: client.id === 'claude-code',
  canOpenOfficialInstallPage: true,
  reasonCode: client.id === 'claude-code' ? 'TOOL_INSTALLED' : 'TOOL_NOT_FOUND',
  currentVersion: client.id === 'claude-code' ? '1.0.0' : null,
  latestVersion: client.id === 'claude-code' ? '2.0.0' : null,
  installSource: client.id === 'claude-code' ? 'npm' : 'not_applicable',
  versionState: client.id === 'claude-code' ? 'update_available' : 'unknown',
  canUpgrade: client.id === 'claude-code',
  versionReasonCode: client.id === 'claude-code' ? 'update_available' : 'version_unknown',
  installationCount: client.id === 'claude-code' ? 1 : 0,
}))

function renderTools() {
  render(
    <AppProvider initialState={{ ...initialState, runtime: 'desktop' }}>
      <ToolsPage />
    </AppProvider>,
  )
}

const storage = new Map<string, string>()
beforeEach(() => {
  vi.clearAllMocks()
  bridge.listAiToolHostStatuses.mockResolvedValue(hostStatuses)
  storage.clear()
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

describe('Desktop AI 工具', () => {
  it('按本机状态筛选，并以稳定标识打开官方入口和配置位置', async () => {
    bridge.openAiToolInstallPage.mockResolvedValue({ toolId: 'codex', requestId: '00000000-0000-4000-8000-000000000001', outcome: 'open_requested' })
    bridge.revealAiToolConfigLocation.mockResolvedValue({ toolId: 'claude-code', requestId: '00000000-0000-4000-8000-000000000001', outcome: 'revealed' })
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001')
    renderTools()

    expect((await screen.findAllByText('Claude Code')).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '已检测到' }))
    expect(screen.getAllByText('Claude Code')).toHaveLength(2)
    expect(screen.queryByText('ChatGPT')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '在文件管理器中显示' }))
    await waitFor(() => expect(bridge.revealAiToolConfigLocation).toHaveBeenCalledWith({
      toolId: 'claude-code', requestId: '00000000-0000-4000-8000-000000000001',
    }))

    fireEvent.click(screen.getByRole('button', { name: '未检测到' }))
    fireEvent.click(screen.getByRole('button', { name: /ChatGPT/ }))
    fireEvent.click(screen.getByRole('button', { name: '查看官方安装方式' }))
    await waitFor(() => expect(bridge.openAiToolInstallPage).toHaveBeenCalledWith({
      toolId: 'codex', requestId: '00000000-0000-4000-8000-000000000001',
    }))
  })

  it('单项升级先预览确认，只提交稳定标识并在完成后刷新', async () => {
    bridge.previewAiToolUpgrade.mockResolvedValue({
      toolId: 'claude-code', requestId: '00000000-0000-4000-8000-000000000001',
      previewRef: 'upgrade-1', currentVersion: '1.0.0', latestVersion: '2.0.0', installSource: 'npm',
      confirmationText: '确认将工具从 1.0.0 升级到 2.0.0',
    })
    bridge.commitAiToolUpgrade.mockResolvedValue({
      toolId: 'claude-code', requestId: '00000000-0000-4000-8000-000000000001',
      outcome: 'updated', previousVersion: '1.0.0', currentVersion: '2.0.0',
    })
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001')
    renderTools()

    fireEvent.click(await screen.findByRole('button', { name: '升级到 2.0.0' }))
    expect(await screen.findByRole('dialog', { name: '升级 Claude Code' })).toBeInTheDocument()
    expect(screen.getByText('确认将工具从 1.0.0 升级到 2.0.0')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认升级' }))

    await waitFor(() => expect(bridge.commitAiToolUpgrade).toHaveBeenCalledWith({
      toolId: 'claude-code', requestId: '00000000-0000-4000-8000-000000000001',
      previewRef: 'upgrade-1', confirmation: true,
    }))
    expect(JSON.stringify(bridge.commitAiToolUpgrade.mock.lastCall)).not.toMatch(/path|executable|argv|source|packageName/i)
    await waitFor(() => expect(bridge.listAiToolHostStatuses).toHaveBeenCalledTimes(2))
  })

})

describe('重置 Bandi 面板', () => {
  function ResetStatus() {
    const { state } = useApp()
    return <output aria-label="重置状态">{state.factoryReset.status}</output>
  }

  function renderResetPanel() {
    render(
      <AppProvider initialState={{ ...initialState, runtime: 'desktop' }}>
        <FactoryResetPanel />
        <ResetStatus />
      </AppProvider>,
    )
  }

  const preview = {
    requestId: 'reset-1',
    previewRef: 'preview-1',
    expiresAt: '2026-09-03T12:00:00Z',
    confirmationText: '重置 Bandi',
    targets: [
      { id: 'database', kind: 'file', state: 'present' },
      { id: 'databaseWal', kind: 'file', state: 'present' },
      { id: 'databaseShm', kind: 'file', state: 'absent' },
    ],
    canCommit: true,
  }

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(UI_PREFERENCES_STORAGE_KEY, '{}')
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, 'dark')
    localStorage.setItem(MAIN_MENU_LAYOUT_STORAGE_KEY, '[]')
    localStorage.setItem('unrelated-key', 'keep')
    bridge.previewFactoryReset.mockResolvedValue(preview)
  })

  async function openAndConfirm() {
    fireEvent.click(screen.getByRole('button', { name: '查看重置范围' }))
    const input = await screen.findByRole('textbox', { name: '输入“重置 Bandi”确认' })
    expect(screen.queryByText(preview.expiresAt, { exact: false })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重置并重新打开' })).toBeDisabled()
    fireEvent.change(input, { target: { value: '重置 Bandi' } })
    fireEvent.click(screen.getByRole('button', { name: '重置并重新打开' }))
  }

  it('默认按用户对象展示删除范围并按需显示技术目标', async () => {
    renderResetPanel()
    fireEvent.click(screen.getByRole('button', { name: '查看重置范围' }))

    expect(await screen.findByText('Team 与需求')).toBeInTheDocument()
    expect(screen.queryByText('数据库写入日志')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('查看技术详情'))
    expect(screen.getByText(/databaseWal/)).toBeInTheDocument()
  })

  it('提交期间不可关闭确认对话框', async () => {
    bridge.commitFactoryReset.mockReturnValue(new Promise(() => undefined))
    renderResetPanel()

    await openAndConfirm()

    const dialog = screen.getByRole('dialog', { name: '确认重置 Bandi' })
    expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: '确认重置 Bandi' })).toBeInTheDocument()
  })

  it('提交成功后只清理三个白名单偏好并请求重新打开', async () => {
    bridge.commitFactoryReset.mockResolvedValue({ requiresRestart: true })
    bridge.restartAfterFactoryReset.mockReturnValue(new Promise(() => undefined))
    renderResetPanel()

    await openAndConfirm()

    await waitFor(() => expect(bridge.restartAfterFactoryReset).toHaveBeenCalledTimes(1))
    expect(screen.getByLabelText('重置状态')).toHaveTextContent('restarting')
    expect(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(LEGACY_THEME_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem(MAIN_MENU_LAYOUT_STORAGE_KEY)).toBeNull()
    expect(localStorage.getItem('unrelated-key')).toBe('keep')
    expect(bridge.commitFactoryReset).toHaveBeenCalledWith({
      requestId: 'reset-1',
      previewRef: 'preview-1',
      confirmationText: '重置 Bandi',
    })
  })

  it('提交失败时不清理任何偏好', async () => {
    bridge.commitFactoryReset.mockRejectedValue(new Error('目标已变化'))
    renderResetPanel()

    await openAndConfirm()

    expect(await screen.findByRole('alert')).toHaveTextContent('目标已变化')
    expect(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY)).not.toBeNull()
    expect(localStorage.getItem(LEGACY_THEME_STORAGE_KEY)).toBe('dark')
    expect(localStorage.getItem(MAIN_MENU_LAYOUT_STORAGE_KEY)).toBe('[]')
    expect(localStorage.getItem('unrelated-key')).toBe('keep')
    expect(bridge.restartAfterFactoryReset).not.toHaveBeenCalled()
    expect(screen.getByLabelText('重置状态')).toHaveTextContent('idle')
  })

  it('后端未要求重新打开时不接受为已完成', async () => {
    bridge.commitFactoryReset.mockResolvedValue({ requiresRestart: false })
    renderResetPanel()

    await openAndConfirm()

    expect(await screen.findByRole('alert')).toHaveTextContent('重置尚未提交')
    expect(bridge.restartAfterFactoryReset).not.toHaveBeenCalled()
    expect(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY)).not.toBeNull()
    expect(screen.getByLabelText('重置状态')).toHaveTextContent('idle')
  })

  it('自动重新打开失败时保留已提交终态', async () => {
    bridge.commitFactoryReset.mockResolvedValue({ requiresRestart: true })
    bridge.restartAfterFactoryReset.mockRejectedValue(new Error('restart failed'))
    renderResetPanel()

    await openAndConfirm()

    await waitFor(() => expect(screen.getByLabelText('重置状态')).toHaveTextContent('manual-restart-required'))
    expect(bridge.restartAfterFactoryReset).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(UI_PREFERENCES_STORAGE_KEY)).toBeNull()
  })

  it('回滚失败时不保证数据保持原状', async () => {
    bridge.commitFactoryReset.mockRejectedValue(new Error('FACTORY_RESET_ROLLBACK_FAILED: rollback failed'))
    renderResetPanel()

    await openAndConfirm()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('无法确认所有数据已回滚')
    expect(alert).toHaveTextContent('停止编辑')
    expect(alert).not.toHaveTextContent('重置尚未提交')
  })
})
