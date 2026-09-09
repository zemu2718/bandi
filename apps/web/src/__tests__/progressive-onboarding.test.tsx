// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HomePage } from '../pages/home-page'
import { OrganizationPage } from '../pages/organization/organization-pages'
import { GlobalSheets } from '../sheets'
import { AppProvider, initialState, type State } from '../state'

const desktopBridge = vi.hoisted(() => ({
  desktop: false,
  loadLongTermDomainSnapshotV4: vi.fn(),
  discoverConfig: vi.fn(),
  loadToolConfiguration: vi.fn(),
  listAgents: vi.fn(),
  listAgentRecoveryOperations: vi.fn(),
  continueAgentRecovery: vi.fn(),
}))

vi.mock('../desktop-bridge', () => ({
  isDesktopRuntime: () => desktopBridge.desktop,
  listAgents: desktopBridge.listAgents,
  discoverConfig: desktopBridge.discoverConfig,
  listManagedAgents: () => Promise.resolve([]),
  loadLongTermDomainSnapshotV4: desktopBridge.loadLongTermDomainSnapshotV4,
  loadToolConfiguration: desktopBridge.loadToolConfiguration,
  listAgentRecoveryOperations: desktopBridge.listAgentRecoveryOperations,
  continueAgentRecovery: desktopBridge.continueAgentRecovery,
}))

const storage = new Map<string, string>()
const NativeRequest = globalThis.Request
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  storage.clear()
  desktopBridge.desktop = false
  desktopBridge.listAgents.mockReset()
  desktopBridge.loadLongTermDomainSnapshotV4.mockReset().mockResolvedValue({ schemaVersion: 4, teams: [], taskBriefs: [] })
  desktopBridge.discoverConfig.mockReset().mockResolvedValue({ requestId: 'hydrate-shared-assets', profileVersion: 'agent-package-v1', containers: [], assets: [], sharedAssets: [], references: [], diagnostics: [] })
  desktopBridge.loadToolConfiguration.mockReset().mockResolvedValue({ revision: 0, selectedPlanId: 'default', builtInToolIds: [], plans: [{ id: 'default', name: '默认方案', toolIds: [] }], customTools: [] })
  desktopBridge.listAgentRecoveryOperations.mockReset()
  desktopBridge.continueAgentRecovery.mockReset()
  desktopBridge.listAgents.mockResolvedValue({ agents: [], diagnostics: [] })
  desktopBridge.listAgentRecoveryOperations.mockResolvedValue([])
  vi.stubGlobal('Request', class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, { ...init, signal: undefined })
    }
  })
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

function renderRoutes(initialEntry: string, state: State) {
  const router = createMemoryRouter([{
    path: '/',
    element: <AppProvider initialState={state}><Outlet /><GlobalSheets /></AppProvider>,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'organization', element: <OrganizationPage /> },
      { path: 'agents', element: <div>Agent 列表</div> },
      { path: 'agents/:id', element: <div>Agent 详情</div> },
    ],
  }], { initialEntries: [initialEntry] })
  return { ...render(<RouterProvider router={router} />), router }
}

const emptyState: State = {
  ...initialState,
  teams: [],
}

describe('渐进式首次体验', () => {
  it('重新读取完成前保留已有诊断', async () => {
    desktopBridge.desktop = true
    const nextAgents = deferred<{ agents: never[]; diagnostics: never[] }>()
    const diagnostic = { code: 'agent-config-invalid', severity: 'error' as const, message: '配置不符合 schema' }
    desktopBridge.listAgents
      .mockResolvedValueOnce({ agents: [], diagnostics: [diagnostic] })
      .mockReturnValueOnce(nextAgents.promise)
    const router = createMemoryRouter([{ path: '/', element: <AppProvider><HomePage /></AppProvider> }], { initialEntries: ['/'] })
    render(<RouterProvider router={router} />)

    expect(await screen.findByText('配置不符合 schema')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    expect(screen.getByText('配置不符合 schema')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '读取中…' })).toBeDisabled()

    nextAgents.resolve({ agents: [], diagnostics: [] })
    await waitFor(() => expect(screen.queryByText('配置不符合 schema')).not.toBeInTheDocument())
  })

  it('Desktop 持久展示多项读取失败并允许重试', async () => {
    desktopBridge.desktop = true
    desktopBridge.listAgents.mockRejectedValueOnce(new Error('agent root unavailable')).mockResolvedValue({ agents: [], diagnostics: [] })
    desktopBridge.loadLongTermDomainSnapshotV4.mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue({ schemaVersion: 4, teams: [], taskBriefs: [] })
    desktopBridge.listAgentRecoveryOperations.mockImplementation(() => new Promise(() => undefined))
    const router = createMemoryRouter([{ path: '/', element: <AppProvider><HomePage /></AppProvider> }], { initialEntries: ['/'] })
    render(<RouterProvider router={router} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('无法完整读取本机配置')
    expect(alert).toHaveTextContent('agent root unavailable')
    expect(alert).toHaveTextContent('database unavailable')
    expect(alert).toHaveTextContent('仍在读取')
    expect(alert).not.toHaveTextContent('页面顶部错误提示')

    desktopBridge.listAgentRecoveryOperations.mockResolvedValue([])
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    expect(await screen.findByRole('heading', { name: '先新建或导入一个长期 Agent' })).toBeInTheDocument()
    expect(desktopBridge.listAgents).toHaveBeenCalledTimes(2)
  })

  it('首页可继续未完成 Agent 配置，blocked 状态只允许查看', async () => {
    const pending = {
      id: 'operation-pending',
      agentId: initialState.agents[0].id,
      operationKind: 'create' as const,
      status: 'team_pending' as const,
      createdAt: '2026-09-02T00:00:00Z',
    }
    desktopBridge.continueAgentRecovery.mockResolvedValue({
      operation: { ...pending, status: 'completed' },
      agent: initialState.agents[0],
    })
    renderRoutes('/', {
      ...initialState,
      onboarding: { status: 'completed' },
      agentRecoveryOperations: [pending, { ...pending, id: 'operation-blocked', agentId: initialState.agents[1].id, status: 'blocked' }],
    })

    expect(screen.getAllByText('Agent 配置尚未完整保存')).toHaveLength(2)
    expect(screen.getByRole('link', { name: '查看 Agent' })).toHaveAttribute('href', `/agents/${initialState.agents[1].id}`)
    fireEvent.click(screen.getByRole('button', { name: '继续修复' }))

    await waitFor(() => expect(screen.getAllByText('Agent 配置尚未完整保存')).toHaveLength(1))
    expect(desktopBridge.continueAgentRecovery).toHaveBeenCalledWith('operation-pending')
  })

  it('无 Agent 时优先显示待处理恢复，而不是首次欢迎', () => {
    renderRoutes('/', {
      ...emptyState,
      agents: [],
      agentRecoveryOperations: [{ id: 'operation-pending', agentId: 'missing-agent', operationKind: 'create', status: 'team_pending', createdAt: '2026-09-08T00:00:00Z' }],
    })

    expect(screen.getByText('Agent 配置尚未完整保存')).toBeInTheDocument()
    expect(screen.getByText('1 项')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '先新建或导入一个长期 Agent' })).not.toBeInTheDocument()
  })

  it('正常配置状态只保留查看 Agent', () => {
    const healthyAgents = initialState.agents.map((agent) => ({
      ...agent,
      files: agent.files.map((file) => ({ ...file, status: '已同步' })),
    }))
    renderRoutes('/', {
      ...initialState,
      onboarding: { status: 'completed' },
      agents: healthyAgents,
      agentDiagnostics: [],
      agentRecoveryOperations: [],
    })

    expect(screen.getByRole('heading', { name: '配置状态' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看 Agent' })).toHaveAttribute('href', '/agents')
    expect(screen.queryByText('快捷入口')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '新建 Agent' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '需求池' })).not.toBeInTheDocument()
  })

  it('Team 空状态只保留一个创建入口', () => {
    renderRoutes('/organization', emptyState)

    expect(screen.getAllByRole('button', { name: '创建 Team' })).toHaveLength(1)
    expect(screen.getByText('还没有 Team')).toBeInTheDocument()
  })

  it('首次使用从 Agent 导入或创建开始', () => {
    renderRoutes('/', { ...emptyState, agents: [] })

    expect(screen.getByRole('heading', { name: '先新建或导入一个长期 Agent' })).toBeInTheDocument()
    expect(screen.getByText('无需预先配置额外组织层级。')).toBeInTheDocument()
    expect(screen.getByText(/按 Team 管理每个 Agent 独立的受管配置、长期 Memory 和版本历史/)).toBeInTheDocument()
    expect(screen.getByText(/当前仅支持 Claude Code 的 \.claude\/agents\/\*\.md 文件/)).toBeInTheDocument()
    expect(screen.getByText(/浏览器演示不会读取或写入本机文件/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '新建 Agent' })).toHaveAttribute('href', '/agents/new')
    expect(screen.getByRole('link', { name: '导入 Agent' })).toHaveAttribute('href', '/agents/new?mode=import')
  })

})
