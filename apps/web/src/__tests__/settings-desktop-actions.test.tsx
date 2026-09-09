// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FactoryResetPanel } from '../pages/settings/factory-reset-panel'
import { ToolsConfigurationSection } from '../pages/settings/tools-configuration-section'
import { AppProvider, initialState, useApp } from '../state'
import { applyToolConfigurationSnapshot } from '../tool-configuration'
import { MAIN_MENU_LAYOUT_STORAGE_KEY } from '../navigation-layout'
import { LEGACY_THEME_STORAGE_KEY, UI_PREFERENCES_STORAGE_KEY } from '../ui-preferences'

const bridge = vi.hoisted(() => ({
  commitFactoryReset: vi.fn(),
  restartAfterFactoryReset: vi.fn(),
  createToolPlan: vi.fn(),
  copyToolPlan: vi.fn(),
  deleteCustomTool: vi.fn(),
  deleteToolPlan: vi.fn(),
  loadToolConfiguration: vi.fn(),
  listHostIntegrations: vi.fn(),
  previewHostIntegrationInstall: vi.fn(),
  commitHostIntegrationInstall: vi.fn(),
  previewHostIntegrationUninstall: vi.fn(),
  commitHostIntegrationUninstall: vi.fn(),
  revealHostDirectory: vi.fn(),
  previewFactoryReset: vi.fn(),
  saveCustomTool: vi.fn(),
  saveToolPlan: vi.fn(),
  selectToolPlan: vi.fn(),
}))

vi.mock('../desktop-bridge', () => bridge)

const initialSnapshot = {
  revision: 2,
  selectedPlanId: 'default',
  builtInToolIds: ['claude-code'],
  plans: [{ id: 'default', name: '默认方案', toolIds: [] }],
  customTools: [],
}

function renderTools() {
  render(
    <AppProvider initialState={{
      ...initialState,
      runtime: 'desktop',
      hydration: { ...initialState.hydration, toolConfiguration: 'succeeded' },
      ...applyToolConfigurationSnapshot(initialSnapshot),
    }}>
      <ToolsConfigurationSection />
    </AppProvider>,
  )
}

const storage = new Map<string, string>()
beforeEach(() => {
  vi.clearAllMocks()
  bridge.listHostIntegrations.mockResolvedValue([])
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

describe('Desktop 工具方案', () => {
  it('以后端返回快照创建并切换方案', async () => {
    const created = {
      ...initialSnapshot,
      revision: 3,
      selectedPlanId: 'review',
      plans: [...initialSnapshot.plans, { id: 'review', name: '评审方案', toolIds: [] }],
    }
    bridge.createToolPlan.mockResolvedValue(created)
    renderTools()

    fireEvent.click(screen.getByRole('button', { name: '新建方案' }))
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '评审方案' } })
    fireEvent.click(screen.getByRole('button', { name: '创建方案' }))

    await waitFor(() => expect(screen.getByRole('combobox', { name: '当前工具方案' })).toHaveValue('review'))
    expect(bridge.createToolPlan).toHaveBeenCalledWith(
      expect.objectContaining({ name: '评审方案', toolIds: [] }),
      2,
    )
  })

  it('按操作显示进行态和成功反馈', async () => {
    let resolve!: (value: typeof initialSnapshot) => void
    bridge.selectToolPlan.mockReturnValue(new Promise((done) => { resolve = done }))
    renderTools()
    fireEvent.change(screen.getByRole('combobox', { name: '当前工具方案' }), { target: { value: 'default' } })
    expect(screen.getByText('正在更新工具方案…')).toHaveAttribute('role', 'status')
    resolve(initialSnapshot)
    await waitFor(() => expect(screen.getByText('工具方案已切换')).toHaveAttribute('role', 'status'))
  })

  it('重名错误与名称字段关联', () => {
    renderTools()
    fireEvent.click(screen.getByRole('button', { name: '新建方案' }))
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '默认方案' } })
    const input = screen.getByRole('textbox', { name: '名称' })
    expect(input).toHaveAttribute('aria-describedby', 'tool-editor-name-error')
    expect(screen.getByText('已有名为“默认方案”的方案，请使用其他名称。')).toHaveAttribute('id', 'tool-editor-name-error')
  })

  it('写入失败时保留当前工具方案并显示错误', async () => {
    bridge.saveToolPlan.mockRejectedValue(new Error('revision conflict'))
    renderTools()

    fireEvent.click(screen.getByRole('button', { name: '加入当前方案' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('revision conflict')
    expect(screen.getByRole('combobox', { name: '当前工具方案' })).toHaveValue('default')
  })

  it('宿主入口安装先预览并使用稳定标识提交', async () => {
    const integration = {
      toolId: 'claude-code', targetId: 'claude-code-user-skill-v1', status: 'not_checked',
      installationState: 'not_installed', canInstall: true, canUninstall: false, canReveal: false,
      reason: '只检查 Bandi 集成文件；工具是否已识别该集成尚未验证',
    }
    bridge.listHostIntegrations.mockResolvedValue([integration])
    bridge.previewHostIntegrationInstall.mockResolvedValue({
      ...integration, requestId: '00000000-0000-4000-8000-000000000001', previewRef: 'preview-1', action: 'install',
      canCommit: true, requiresConfirmation: true, reason: '目标状态已复核，确认后可提交',
    })
    bridge.commitHostIntegrationInstall.mockResolvedValue({
      ...integration, requestId: '00000000-0000-4000-8000-000000000001', installationState: 'installed', changed: true,
      reason: 'Bandi 集成文件已写入并确认内容一致',
    })
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001')
    renderTools()

    fireEvent.click(await screen.findByRole('button', { name: '安装集成' }))
    expect(bridge.previewHostIntegrationInstall).toHaveBeenCalledWith({
      toolId: 'claude-code', targetId: 'claude-code-user-skill-v1', requestId: '00000000-0000-4000-8000-000000000001',
    })
    fireEvent.change(await screen.findByRole('textbox', { name: '输入“安装 Bandi 集成”确认' }), { target: { value: '安装 Bandi 集成' } })
    fireEvent.click(screen.getByRole('button', { name: '安装 Bandi 集成' }))

    await waitFor(() => expect(bridge.commitHostIntegrationInstall).toHaveBeenCalledWith({
      toolId: 'claude-code', targetId: 'claude-code-user-skill-v1', requestId: '00000000-0000-4000-8000-000000000001',
      previewRef: 'preview-1', confirmation: true,
    }))
  })

  it('固定配置目录不可用时禁用打开操作', async () => {
    bridge.listHostIntegrations.mockResolvedValue([{
      toolId: 'claude-code', targetId: 'claude-code-user-skill-v1', status: 'not_checked',
      installationState: 'not_installed', canInstall: false, canUninstall: false, canReveal: false,
      reason: '固定配置目录不存在或不是普通目录',
    }])
    renderTools()

    expect(await screen.findByRole('button', { name: '在文件管理器中显示' })).toBeDisabled()
    expect(bridge.revealHostDirectory).not.toHaveBeenCalled()
  })

  it('打开固定配置目录只提交稳定标识', async () => {
    bridge.listHostIntegrations.mockResolvedValue([{
      toolId: 'codex', targetId: 'agents-user-skill-v1', status: 'not_checked',
      installationState: 'not_installed', canInstall: true, canUninstall: false, canReveal: true,
      reason: '只检查 Bandi 集成文件；工具是否已识别该集成尚未验证',
    }])
    bridge.revealHostDirectory.mockResolvedValue({
      toolId: 'codex', targetId: 'agents-user-skill-v1',
      requestId: '00000000-0000-4000-8000-000000000001', status: 'not_checked', revealed: true,
      reason: '已在系统文件管理器中打开固定配置目录；Bandi 未读取目录内容',
    })
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001')
    renderTools()

    fireEvent.click(await screen.findByRole('button', { name: '在文件管理器中显示' }))

    await waitFor(() => expect(bridge.revealHostDirectory).toHaveBeenCalledWith({
      toolId: 'codex', targetId: 'agents-user-skill-v1', requestId: '00000000-0000-4000-8000-000000000001',
    }))
    const feedback = await screen.findByRole('status', { name: '' })
    expect(feedback).toHaveTextContent('预设安装位置已在文件管理器中显示')
    expect(feedback).toHaveTextContent('Bandi 未读取文件夹内容；工具是否已识别该集成尚未验证')
  })

  it('分开展示入口状态和工具加载状态，并只统计需要处理的入口', async () => {
    bridge.listHostIntegrations.mockResolvedValue([
      {
        toolId: 'claude-code', targetId: 'claude-code-user-skill-v1', status: 'not_checked',
        installationState: 'installed', canInstall: false, canUninstall: true, canReveal: true,
        reason: '固定入口文件与当前版本一致',
      },
      {
        toolId: 'codex', targetId: 'agents-user-skill-v1', status: 'not_checked',
        installationState: 'not_installed', canInstall: true, canUninstall: false, canReveal: true,
        reason: '固定入口尚未安装',
      },
      {
        toolId: 'gemini-cli', targetId: 'gemini-extension-v1', status: 'degraded',
        installationState: 'update_available', canInstall: true, canUninstall: true, canReveal: true,
        reason: '入口版本可更新',
      },
      {
        toolId: 'grok-build', targetId: 'grok-user-skill-v1', status: 'not_checked',
        installationState: 'foreign_collision', canInstall: false, canUninstall: false, canReveal: true,
        reason: '目标位置存在非 Bandi 文件',
      },
      {
        toolId: 'claude-desktop', targetId: 'claude-desktop-mcpb-v1', status: 'degraded',
        installationState: 'unsupported', canInstall: false, canUninstall: false, canReveal: false,
        reason: '需要在官方界面完成安装',
      },
      {
        toolId: 'opencode', targetId: 'opencode-user-skill-v1', status: 'not_checked',
        installationState: 'unknown', canInstall: false, canUninstall: false, canReveal: false,
        reason: '无法确认固定入口状态',
      },
    ])
    renderTools()

    expect(await screen.findByText('共 6 个集成 · 4 个需处理')).toBeInTheDocument()
    expect(screen.getByText('已安装')).toBeInTheDocument()
    expect(screen.getAllByText('工具是否识别该集成')).toHaveLength(6)
    expect(screen.queryByText('宿主验证')).not.toBeInTheDocument()
    expect(screen.getAllByText('尚未验证').length).toBeGreaterThan(0)
    expect(screen.getByText('有可用更新')).toBeInTheDocument()
    expect(screen.getByText('目标位置已被占用')).toBeInTheDocument()
    expect(screen.getByText('需在工具中安装')).toBeInTheDocument()
    expect(screen.getByText('无法检查')).toBeInTheDocument()
    expect(screen.getAllByText('部分能力可用')).toHaveLength(2)
    expect(screen.queryByText('已加载')).not.toBeInTheDocument()
    expect(screen.queryByText('可运行')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '需处理（4）' }))
    expect(screen.queryByText('固定入口文件与当前版本一致')).not.toBeInTheDocument()
    expect(screen.queryByText('固定入口尚未安装')).not.toBeInTheDocument()
    expect(screen.getByText('入口版本可更新')).toBeInTheDocument()
  })

  it('没有需处理入口时显示筛选空状态', async () => {
    bridge.listHostIntegrations.mockResolvedValue([{
      toolId: 'codex', targetId: 'agents-user-skill-v1', status: 'not_checked',
      installationState: 'not_installed', canInstall: true, canUninstall: false, canReveal: true,
      reason: '固定入口尚未安装',
    }])
    renderTools()

    fireEvent.click(await screen.findByRole('button', { name: '需处理（0）' }))
    expect(screen.getByText('没有需要处理的集成')).toBeInTheDocument()
    expect(screen.getByText(/工具是否已识别集成仍需单独确认/)).toBeInTheDocument()
  })

  it('重新检查失败时保留上次成功检查时间', async () => {
    bridge.listHostIntegrations.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('service unavailable'))
    renderTools()

    const checkedAt = await screen.findByText(/安装状态上次检查：/)
    const previousText = checkedAt.textContent
    fireEvent.click(screen.getByRole('button', { name: '重新检查 Bandi 集成状态' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('service unavailable')
    expect(screen.getByText(previousText ?? '')).toBeInTheDocument()
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
