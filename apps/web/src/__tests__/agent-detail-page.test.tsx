// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorSessionProvider } from '../editor-session'
import { AgentDetailPage } from '../pages/agents/agent-detail-page'
import { GlobalSheets } from '../sheets'
import { AppProvider, initialState, useApp, type State } from '../state'
import * as desktopBridge from '../desktop-bridge'
import type { DiscoveryResult, LoadEditorResult } from '../contracts'

const NativeRequest = globalThis.Request

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } })
  vi.stubGlobal('Request', class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, { ...init, signal: undefined })
    }
  })
})

function NoticeProbe() {
  const { state } = useApp()
  if (!state.notice) return null
  return <output role={state.notice.tone === 'error' ? 'alert' : 'status'}>{state.notice.title} {state.notice.description}</output>
}

function renderAgent(initialEntry = '/agents/zhouce', state?: State) {
  const router = createMemoryRouter([{
    path: '/agents/:id',
    element: <AppProvider initialState={state}><EditorSessionProvider><AgentDetailPage /><GlobalSheets /><NoticeProbe /></EditorSessionProvider></AppProvider>,
  }, {
    path: '/agents',
    element: <div>Agent 列表</div>,
  }], { initialEntries: [initialEntry] })
  return { router, ...render(<RouterProvider router={router} />) }
}

function AgentListProbe() {
  const { state } = useApp()
  return <><div>Agent 列表</div><NoticeProbe /><output data-testid="remaining-agent">{state.agents.some((item) => item.id === 'zhouce') ? '存在' : '已移除'}</output><output data-testid="delete-recovery">{state.agentRecoveryOperations.map((item) => `${item.id}:${item.status}`).join(',')}</output></>
}

function renderAgentWithPersistentState(state: State) {
  const router = createMemoryRouter([{
    path: '/agents/:id',
    element: <EditorSessionProvider><AgentDetailPage /><GlobalSheets /><NoticeProbe /></EditorSessionProvider>,
  }, {
    path: '/agents',
    element: <AgentListProbe />,
  }], { initialEntries: ['/agents/zhouce'] })
  return { router, ...render(<AppProvider initialState={state}><RouterProvider router={router} /></AppProvider>) }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Agent 双模式配置工作台', () => {
  it('默认以身份和配置健康度呈现管理概览', () => {
    renderAgent()

    expect(screen.getByRole('heading', { name: '周策', level: 2 })).toBeInTheDocument()
    expect(screen.getByText(/研发/)).toBeInTheDocument()
    expect(screen.getByText('把已确认产品目标交付为可验证的软件成果。')).toBeInTheDocument()
    expect(screen.getAllByText(/\.bandi\/agents\/agt_zhouce/)).toHaveLength(2)
    expect(screen.getByRole('tab', { name: '管理视图' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '原始文件' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByRole('region', { name: 'Agent 摘要' })).not.toBeInTheDocument()
    expect(screen.queryByText('岗位使命')).not.toBeInTheDocument()
    expect(screen.getByText('配置状态')).toBeInTheDocument()
    expect(screen.getByText('最近保存')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Agent 配置领域' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '概览' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '主指令' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '主指令 Instructions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: '当前配置关联文件' })).not.toBeInTheDocument()
  })

  it.each([
    ['外部引用', { kind: 'external-reference' as const, externalPath: '/tmp/external', strategy: 'reference-only' as const }, { compatibility: 'unverified' as const }],
    ['旧版受管包', { kind: 'bandi-managed' as const, packageId: 'agt_zhouce', strategy: 'managed' as const }, { schemaVersion: 0, compatibility: 'legacy' as const }],
    ['未来版受管包', { kind: 'bandi-managed' as const, packageId: 'agt_zhouce', strategy: 'managed' as const }, { schemaVersion: 2, compatibility: 'future' as const }],
  ])('Desktop %s 的配置领域保持只读', (_label, packageSource, packageSchema) => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = {
      ...initialState,
      runtime: 'desktop',
      agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource, packageSchema } : item),
    }

    renderAgent('/agents/zhouce?tab=identity', state)

    expect(screen.getByRole('heading', { name: '当前 Agent 配置不可编辑' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '编辑' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '预览永久删除影响' })).not.toBeInTheDocument()
  })

  it('身份编辑只从身份与职责领域内进入', async () => {
    const { router } = renderAgent()

    expect(screen.queryByRole('link', { name: '编辑身份与职责' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '身份与职责' }))
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }))

    expect(screen.getByDisplayValue('周策')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()
    expect(router.state.location.search).toBe('?tab=identity')
  })

  it('身份页短显示并复制完整 Agent ID', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const longId = 'agent-550e8400-e29b-41d4-a716-446655440000'
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? { ...item, id: longId } : item) }

    renderAgent(`/agents/${longId}?tab=identity`, state)

    expect(screen.getByText('agent-55…0000')).toHaveAttribute('title', longId)
    fireEvent.click(screen.getByRole('button', { name: '复制完整 Agent ID' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(longId))
    expect(await screen.findByRole('status')).toHaveTextContent('Agent ID 已复制')
  })

  it('Agent ID 复制失败时保留可手动复制的完整值', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'))
    renderAgent('/agents/zhouce?tab=identity')

    fireEvent.click(screen.getByRole('button', { name: '复制完整 Agent ID' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('系统未允许访问剪贴板')
    expect(screen.getByText('zhouce')).toHaveAttribute('title', 'zhouce')
  })

  it('身份编辑阻止低质量名称和重名，并保存裁剪后的名称', async () => {
    renderAgent('/agents/zhouce?tab=identity')
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const input = screen.getByDisplayValue('周策')

    fireEvent.change(input, { target: { value: '123456' } })
    expect(screen.getByText('名称不能全部是数字。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: initialState.agents.find((item) => item.id !== 'zhouce')!.name } })
    expect(screen.getByText('已有同名 Agent，请使用其他名称。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()
  })

  it('Desktop 受管身份从磁盘加载基线并保存 revision', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = {
      ...initialState,
      agents: initialState.agents.map((item) => item.id === source.id ? {
        ...item,
        packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' },
      } : item),
    }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'d'.repeat(64)}` as const
    const baselineRef = { id: 'identity-baseline', assetId: 'identity-asset', containerId: 'identity-container', assetContentHash: hash, containerContentHash: hash }
    vi.spyOn(desktopBridge, 'loadManagedAgentIdentity').mockResolvedValue({ assetId: 'identity-asset', containerId: 'identity-container', locator: { rootKind: 'managed', displayPath: '/tmp/agent.yaml' }, canonicalContent: 'schemaVersion: 1\nid: zhouce\n', baselineRef })
    const save = vi.spyOn(desktopBridge, 'commitManagedAgentIdentity').mockImplementation(async (_requestId, agent) => ({
      operation: { id: 'identity-operation', agentId: agent.id, operationKind: 'identity_update', status: 'completed', createdAt: '2026-09-02T00:00:00Z' },
      agent,
    }))

    renderAgent('/agents/zhouce?tab=identity', state)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(await screen.findByDisplayValue('周策')).toBeInTheDocument()
    fireEvent.change(screen.getByDisplayValue('周策'), { target: { value: '周策更新' } })
    fireEvent.click(await screen.findByRole('button', { name: '保存' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith(
      expect.stringMatching(/^save-identity-zhouce-/),
      expect.objectContaining({ id: 'zhouce', name: '周策更新' }),
      expect.stringContaining('name: "周策更新"'),
      baselineRef,
      'schemaVersion: 1\nid: zhouce\n',
      source.serviceGrants,
      { kind: 'keep' },
    ))
    await waitFor(() => expect(screen.queryByDisplayValue('周策更新')).not.toBeInTheDocument())
  })

  it('Desktop 受管身份同步部门成员与跨部门服务', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const targetDepartment = initialState.departments.find((item) => item.id !== source.primaryDepartmentId && item.teamId === source.teamId)!
    const state: State = {
      ...initialState,
      agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' } } : item),
    }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'1'.repeat(64)}` as const
    const baselineRef = { id: 'identity-org-base', assetId: 'identity-asset', containerId: 'identity-container', assetContentHash: hash, containerContentHash: hash }
    vi.spyOn(desktopBridge, 'loadManagedAgentIdentity').mockResolvedValue({ assetId: 'identity-asset', containerId: 'identity-container', locator: { rootKind: 'managed', displayPath: '/tmp/agent.yaml' }, canonicalContent: 'schemaVersion: 1\nid: zhouce\n', baselineRef })
    const commit = vi.spyOn(desktopBridge, 'commitManagedAgentIdentity').mockImplementation(async (_requestId, agent) => ({
      operation: { id: 'identity-org-operation', agentId: agent.id, operationKind: 'identity_update', status: 'completed', createdAt: '2026-09-02T00:00:00Z' },
      agent,
    }))

    renderAgent('/agents/zhouce?tab=identity', state)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    await screen.findByDisplayValue('周策')
    fireEvent.change(screen.getByDisplayValue('研发部'), { target: { value: targetDepartment.id } })
    fireEvent.click(screen.getByRole('button', { name: '添加服务' }))
    const capabilityInputs = screen.getAllByLabelText('服务能力')
    fireEvent.change(capabilityInputs.at(-1)!, { target: { value: '配置审查、发布复核' } })
    fireEvent.change(screen.getAllByRole('textbox', { name: '禁止事项（每行一项）' }).at(-1)!, { target: { value: '不得扩大权限\n  不得绕过审批  ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1))
    expect(commit).toHaveBeenCalledWith(
      expect.stringMatching(/^save-identity-zhouce-/),
      expect.objectContaining({ id: source.id, primaryDepartmentId: targetDepartment.id }),
      expect.any(String),
      baselineRef,
      expect.any(String),
      expect.arrayContaining([expect.objectContaining({
        capabilities: ['配置审查', '发布复核'],
        prohibitions: ['不得扩大权限', '不得绕过审批'],
        status: 'active',
      })]),
      { kind: 'keep' },
    )
    await waitFor(() => expect(screen.getByText(/发布复核/)).toBeInTheDocument())
  })

  it('Desktop 身份半成功立即进入全局待处理并复用同一请求 ID', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = {
      ...initialState,
      agents: initialState.agents.map((item) => item.id === source.id ? {
        ...item,
        packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' },
      } : item),
    }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'2'.repeat(64)}` as const
    const baselineRef = { id: 'identity-retry-base', assetId: 'identity-asset', containerId: 'identity-container', assetContentHash: hash, containerContentHash: hash }
    vi.spyOn(desktopBridge, 'loadManagedAgentIdentity').mockResolvedValue({ assetId: 'identity-asset', containerId: 'identity-container', locator: { rootKind: 'managed', displayPath: '/tmp/agent.yaml' }, canonicalContent: 'schemaVersion: 1\nid: zhouce\n', baselineRef })
    const commit = vi.spyOn(desktopBridge, 'commitManagedAgentIdentity').mockImplementation(async (_requestId, agent) => ({
      operation: { id: 'identity-retry-operation', agentId: agent.id, operationKind: 'identity_update', status: 'organization_pending', createdAt: '2026-09-02T00:00:00Z' },
    }))

    renderAgent('/agents/zhouce?tab=identity', state)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const name = await screen.findByDisplayValue('周策')
    fireEvent.change(name, { target: { value: '周策更新' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('配置状态中的待处理项继续修复')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(2))
    expect(commit.mock.calls[0][0]).toBe(commit.mock.calls[1][0])
  })

  it('Desktop 受管身份外部变化保留草稿并展示三方 manifest', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' } } : item) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'e'.repeat(64)}` as const
    const baselineRef = { id: 'identity-base', assetId: 'identity-asset', containerId: 'identity-container', assetContentHash: hash, containerContentHash: hash }
    vi.spyOn(desktopBridge, 'loadManagedAgentIdentity').mockResolvedValue({ assetId: 'identity-asset', containerId: 'identity-container', locator: { rootKind: 'managed', displayPath: '/tmp/agent.yaml' }, canonicalContent: 'name: "周策"\n', baselineRef })
    vi.spyOn(desktopBridge, 'commitManagedAgentIdentity').mockResolvedValue({
      operation: { id: 'identity-conflict-operation', agentId: source.id, operationKind: 'identity_update', status: 'prepared', createdAt: '2026-09-02T00:00:00Z' },
      identityResult: { kind: 'baseline_changed', requestId: 'save-identity-zhouce', assetId: 'identity-asset', containerId: 'identity-container', locator: { rootKind: 'managed', displayPath: '/tmp/agent.yaml' }, base: { content: 'name: "周策"\n', assetContentHash: hash, containerContentHash: hash, redacted: false }, current: { content: 'name: "磁盘更新"\n', assetContentHash: hash, containerContentHash: hash, redacted: false }, proposed: { content: 'name: "周策更新"\n', assetContentHash: hash, containerContentHash: hash, redacted: false }, diagnostics: [{ code: 'baseline_changed', severity: 'warning', message: '已发生外部变化' }] },
    })

    renderAgent('/agents/zhouce?tab=identity', state)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const name = await screen.findByDisplayValue('周策')
    fireEvent.change(name, { target: { value: '周策更新' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('已被外部修改')
    expect(screen.getByRole('alert')).toHaveTextContent('Bandi 不会覆盖当前文件')
    expect(screen.getByDisplayValue('周策更新')).toBeInTheDocument()
    expect(screen.getByText('name: "磁盘更新"')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '基于当前内容重新编辑' })).toBeEnabled()
  })

  it('Desktop 受管身份读取历史并恢复为新版本', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const managed = { ...source, packageSource: { kind: 'bandi-managed' as const, packageId: 'agt_zhouce', strategy: 'managed' as const } }
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? managed : item) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'f'.repeat(64)}` as const
    const baselineRef = { id: 'identity-base', assetId: 'identity-asset', containerId: 'identity-container', assetContentHash: hash, containerContentHash: hash }
    vi.spyOn(desktopBridge, 'loadManagedAgentIdentity').mockResolvedValue({ assetId: 'identity-asset', containerId: 'identity-container', locator: { rootKind: 'managed', displayPath: '/tmp/agent.yaml' }, canonicalContent: 'name: "当前"\n', baselineRef })
    vi.spyOn(desktopBridge, 'listConfigRevisions').mockResolvedValue([{ id: 'identity-old', assetId: 'identity-asset', containerId: 'identity-container', locator: { rootKind: 'managed', displayPath: '/tmp/agent.yaml' }, assetContentHash: hash, containerContentHash: hash, sourceAssetBaselineHash: hash, sourceContainerBaselineHash: hash, redacted: false, writeReceiptId: 'receipt-old', savedAt: '2026-08-31T00:00:00Z', summary: '保存身份与职责', confirmationRefs: [] }])
    vi.spyOn(desktopBridge, 'readConfigRevisionContent').mockResolvedValue('name: "历史"\n')
    const restore = vi.spyOn(desktopBridge, 'restoreManagedAgentIdentity').mockResolvedValue({ kind: 'unchanged', requestId: 'restore-identity-zhouce', agent: managed, baselineRef })

    renderAgent('/agents/zhouce?tab=identity', state)
    fireEvent.click(screen.getByRole('button', { name: '版本历史' }))
    expect(await screen.findByRole('dialog', { name: '身份与职责版本历史' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '恢复为新版本' }))

    await waitFor(() => expect(restore).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'identity-asset', revisionId: 'identity-old', confirmed: true })))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '身份与职责版本历史' })).not.toBeInTheDocument())
  })

  it('Desktop Agent 长期 Memory 创建真实候选并进入审核', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = {
      ...initialState,
      agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' } } : item),
    }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'a'.repeat(64)}` as const
    const baseline = { id: 'memory-base', assetId: 'memory-agent-zhouce', containerId: 'memory-agent-zhouce', assetContentHash: hash, containerContentHash: hash }
    vi.spyOn(desktopBridge, 'discoverEligibleMemorySpaces').mockResolvedValue({ requestId: 'discover-memory-zhouce', spaces: [{ id: 'memory-agent-zhouce', scopeType: 'agent_long_term', scopeKey: { kind: 'agent_long_term', agentId: 'zhouce' }, owner: { kind: 'agent' as const, agentId: 'zhouce' }, stewardAgentId: 'zhouce', reviewPrincipal: { kind: 'agent' as const, agentId: 'zhiheng' }, reviewPolicy: 'independent_reviewer', visibilityPolicy: 'agent_private', storageProfileVersion: 'memory-v3', state: 'active', storageLocator: { rootKind: 'managed', displayPath: 'memory/long-term.md', relativePath: 'memory/long-term.md' }, contentHash: hash, updatedAt: '2026-09-01T00:00:00Z' }], diagnostics: [] })
    vi.spyOn(desktopBridge, 'listMemoryReviews').mockResolvedValue([])
    const create = vi.spyOn(desktopBridge, 'createMemoryCandidate').mockImplementation(async (request) => ({
      requestId: request.requestId,
      space: { id: 'memory-agent-zhouce', scopeType: 'agent_long_term', scopeKey: { kind: 'agent_long_term' as const, agentId: 'zhouce' }, owner: { kind: 'agent' as const, agentId: 'zhouce' }, stewardAgentId: 'zhouce', reviewPrincipal: { kind: 'agent' as const, agentId: 'zhiheng' }, reviewPolicy: 'independent_reviewer', visibilityPolicy: 'agent_private', storageProfileVersion: 'memory-v3', state: 'active', storageLocator: { rootKind: 'managed', displayPath: 'memory/long-term.md', relativePath: 'memory/long-term.md' }, contentHash: hash, updatedAt: '2026-09-01T00:00:00Z' },
      candidate: { id: request.candidateId, spaceId: 'memory-agent-zhouce', proposerAgentId: 'zhouce', reviewPrincipal: { kind: 'agent' as const, agentId: 'zhiheng' }, source: request.source, summary: request.summary, proposedContent: request.proposedContent, proposedContentHash: hash, submittedBaseline: baseline, status: 'pending_review', version: 1, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' },
      currentContent: '当前正式内容',
    }))
    vi.spyOn(desktopBridge, 'loadMemoryReview').mockImplementation(async (requestId, candidateId) => {
      const created = create.mock.results[0]?.value
      const bundle = await created
      return { ...bundle, requestId, candidate: { ...bundle.candidate, id: candidateId } }
    })

    renderAgent('/agents/zhouce?tab=memory', state)
    fireEvent.change(await screen.findByLabelText('目标记忆范围'), { target: { value: 'memory-agent-zhouce' } })
    fireEvent.change(screen.getByLabelText('建议写回的完整内容'), { target: { value: '新的正式内容' } })
    fireEvent.click(screen.getByRole('button', { name: '提交修改建议' }))

    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ spaceId: 'memory-agent-zhouce', proposerAgentId: 'zhouce', proposedContent: '新的正式内容' })))
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('reviewerAgentId')
    const candidateButton = await screen.findByRole('button', { name: /正式记忆修改/ })
    fireEvent.click(candidateButton)
    expect(await screen.findByRole('dialog', { name: /审核正式记忆修改建议/ })).toBeInTheDocument()
    expect(screen.getByText('新的正式内容')).toBeInTheDocument()
  })

  it('Desktop 启动时静默恢复正式 Memory 候选', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = {
      ...initialState,
      notice: { id: 'existing-notice', tone: 'info', title: '原有通知' },
      agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' } } : item),
      memoryCandidates: initialState.memoryCandidates.filter((item) => item.spaceId !== 'memory-agent-zhouce'),
    }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'c'.repeat(64)}` as const
    vi.spyOn(desktopBridge, 'discoverEligibleMemorySpaces').mockResolvedValue({ requestId: 'discover-memory-zhouce', spaces: [{ id: 'memory-agent-zhouce', scopeType: 'agent_long_term', scopeKey: { kind: 'agent_long_term', agentId: 'zhouce' }, owner: { kind: 'agent' as const, agentId: 'zhouce' }, stewardAgentId: 'zhouce', reviewPrincipal: { kind: 'agent' as const, agentId: 'zhiheng' }, reviewPolicy: 'independent_reviewer', visibilityPolicy: 'agent_private', storageProfileVersion: 'memory-v3', state: 'active', storageLocator: { rootKind: 'managed', displayPath: 'memory/long-term.md', relativePath: 'memory/long-term.md' }, contentHash: hash, updatedAt: '2026-09-01T00:00:00Z' }], diagnostics: [] })
    vi.spyOn(desktopBridge, 'listMemoryReviews').mockResolvedValue([{
      requestId: 'list-memory-zhouce',
      space: { id: 'memory-agent-zhouce', scopeType: 'agent_long_term', scopeKey: { kind: 'agent_long_term' as const, agentId: 'zhouce' }, owner: { kind: 'agent' as const, agentId: 'zhouce' }, stewardAgentId: 'zhouce', reviewPrincipal: { kind: 'agent' as const, agentId: 'zhiheng' }, reviewPolicy: 'independent_reviewer', visibilityPolicy: 'agent_private', storageProfileVersion: 'memory-v3', state: 'active', storageLocator: { rootKind: 'managed', displayPath: 'memory/long-term.md', relativePath: 'memory/long-term.md' }, currentRevisionId: 'memory-revision-1', contentHash: hash, updatedAt: '2026-09-01T00:00:00Z' },
      candidate: { id: 'candidate-hydrated', spaceId: 'memory-agent-zhouce', proposerAgentId: 'zhouce', reviewPrincipal: { kind: 'agent' as const, agentId: 'zhiheng' }, source: { kind: 'manual', label: 'test' }, summary: '重启恢复候选', proposedContent: '正式内容', proposedContentHash: hash, submittedBaseline: { id: 'base', assetId: 'memory-agent-zhouce', containerId: 'memory-agent-zhouce', assetContentHash: hash, containerContentHash: hash }, status: 'written', version: 3, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:01:00Z' },
      currentContent: '正式内容',
    }])

    renderAgent('/agents/zhouce?tab=memory', state)

    expect(await screen.findByText('candidate-hydrated')).toBeInTheDocument()
    expect(screen.getByText('已保存为正式版本')).toBeInTheDocument()
    expect(screen.queryByText('正式记忆候选已创建')).not.toBeInTheDocument()
  })

  it('Desktop 正式 Memory revision pending 可补记且不重复批准', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = {
      ...initialState,
      agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' } } : item),
      memoryCandidates: [{ id: 'memory-candidate-recovery', spaceId: 'memory-agent-zhouce', proposerAgentId: 'zhouce', reviewPrincipal: { kind: 'agent' as const, agentId: 'zhiheng' }, summary: '正式记忆修改', current: '旧内容', proposed: '新内容', status: '待审核' }],
    }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'b'.repeat(64)}` as const
    const baseline = { id: 'memory-base', assetId: 'memory-agent-zhouce', containerId: 'memory-agent-zhouce', assetContentHash: hash, containerContentHash: hash }
    const candidate = { id: 'memory-candidate-recovery', spaceId: 'memory-agent-zhouce', proposerAgentId: 'zhouce', reviewPrincipal: { kind: 'agent' as const, agentId: 'zhiheng' }, source: { kind: 'manual' as const, label: 'test' }, summary: '正式记忆修改', proposedContent: '新内容', proposedContentHash: hash, submittedBaseline: baseline, status: 'pending_review' as const, version: 1, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' }
    const bundle = { requestId: 'load', space: { id: 'memory-agent-zhouce', scopeType: 'agent_long_term' as const, scopeKey: { kind: 'agent_long_term' as const, agentId: 'zhouce' }, owner: { kind: 'agent' as const, agentId: 'zhouce' }, stewardAgentId: 'zhouce', reviewPrincipal: { kind: 'agent' as const, agentId: 'zhiheng' }, reviewPolicy: 'independent_reviewer' as const, visibilityPolicy: 'agent_private' as const, storageProfileVersion: 'memory-v3' as const, state: 'active' as const, storageLocator: { rootKind: 'managed' as const, displayPath: 'memory/long-term.md', relativePath: 'memory/long-term.md' }, contentHash: hash, updatedAt: '2026-09-01T00:00:00Z' }, candidate, currentContent: '旧内容' }
    vi.spyOn(desktopBridge, 'discoverEligibleMemorySpaces').mockResolvedValue({ requestId: 'discover-memory-zhouce', spaces: [bundle.space], diagnostics: [] })
    vi.spyOn(desktopBridge, 'listMemoryReviews').mockResolvedValue([])
    vi.spyOn(desktopBridge, 'loadMemoryReview').mockResolvedValue(bundle)
    const decision = { id: 'decision-1', candidateId: candidate.id, actorPrincipal: { kind: 'agent' as const, agentId: 'zhiheng' }, decision: 'approve' as const, decidedAt: '2026-09-01T00:01:00Z' }
    const receipt = { id: 'receipt-1', containerId: candidate.spaceId, previousContainerHash: hash, writtenContainerHash: hash, verifiedAt: '2026-09-01T00:01:00Z', atomicReplace: true }
    const review = vi.spyOn(desktopBridge, 'reviewMemoryCandidate').mockResolvedValue({ kind: 'revision_pending', requestId: 'review', candidate: { ...candidate, status: 'revision_pending', version: 2 }, decision, writeReceipt: receipt, recoveryRef: 'revision-1', diagnostics: [{ code: 'memory_revision_pending', severity: 'warning', message: '版本待补记' }] })
    const recover = vi.spyOn(desktopBridge, 'recoverMemoryRevision').mockResolvedValue({ kind: 'saved', requestId: 'recover', candidate: { ...candidate, status: 'written', version: 3 }, decision, revision: { id: 'revision-1', spaceId: candidate.spaceId, candidateId: candidate.id, reviewDecisionId: decision.id, proposerAgentId: 'zhouce', reviewPrincipal: { kind: 'agent' as const, agentId: 'zhiheng' }, sourceContentHash: hash, contentHash: hash, storageLocator: bundle.space.storageLocator, writeReceiptId: receipt.id, writtenAt: receipt.verifiedAt }, writeReceipt: receipt })

    renderAgent('/agents/zhouce?tab=memory', state)
    fireEvent.click(await screen.findByRole('button', { name: /正式记忆修改/ }))
    await screen.findByText('新内容')
    fireEvent.click(screen.getByRole('button', { name: '批准并写入正式记忆' }))
    expect(await screen.findByText(/记忆版本尚待补记/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '补记记忆版本' }))

    await waitFor(() => expect(recover).toHaveBeenCalledWith({ requestId: 'recover-memory-memory-candidate-recovery', candidateId: candidate.id, recoveryRef: 'revision-1' }))
    expect(review).toHaveBeenCalledTimes(1)
    expect((await screen.findAllByText('revision-1')).length).toBeGreaterThan(0)
  })

  it('Web 正式 Memory 审核保持页面内存演示且不调用 Desktop bridge', async () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(false)
    const review = vi.spyOn(desktopBridge, 'reviewMemoryCandidate')
    const load = vi.spyOn(desktopBridge, 'loadMemoryReview')
    renderAgent('/agents/zhouce?tab=memory', {
      ...initialState,
      memoryCandidates: [{ id: 'memory-candidate-web', spaceId: 'mem-agent-zhouce', proposerAgentId: 'zhouce', reviewPrincipal: { kind: 'agent', agentId: 'zhiheng' }, summary: '记录已确认的 API 方案', current: '旧内容', proposed: '新内容', status: '待审核' }],
    })
    fireEvent.click(screen.getByRole('button', { name: /记录已确认的 API 方案/ }))
    expect(await screen.findByText(/浏览器演示/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '要求修改' }))
    expect(review).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
  })

  it('双模式 Tab 支持循环键盘切换并同步 URL 与面板', async () => {
    renderAgent()
    const management = screen.getByRole('tab', { name: '管理视图' })
    const packageTab = screen.getByRole('tab', { name: '原始文件' })

    expect(management).toHaveAttribute('aria-controls', 'agent-mode-panel-management')
    expect(screen.getByRole('tabpanel', { name: '管理视图' })).toBeInTheDocument()

    fireEvent.keyDown(management, { key: 'ArrowLeft' })
    await waitFor(() => expect(packageTab).toHaveFocus())
    await waitFor(() => expect(packageTab).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByRole('tabpanel', { name: '原始文件' })).toBeInTheDocument()

    fireEvent.keyDown(packageTab, { key: 'Home' })
    await waitFor(() => expect(management).toHaveFocus())
    expect(management).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(management, { key: 'End' })
    await waitFor(() => expect(packageTab).toHaveFocus())
    fireEvent.keyDown(packageTab, { key: 'ArrowRight' })
    await waitFor(() => expect(management).toHaveFocus())
  })

  it('关闭窄屏文件选择后恢复触发按钮焦点', async () => {
    renderAgent('/agents/zhouce?tab=package')

    const trigger = screen.getByRole('button', { name: '选择文件' })
    trigger.focus()
    fireEvent.click(trigger)
    await waitFor(() => expect(screen.getByRole('dialog', { name: '选择配置文件' })).toBeInTheDocument())

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('受管 AgentPackage 未返回文件时提供安全重新读取', () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = {
      ...initialState,
      runtime: 'desktop',
      agents: initialState.agents.map((item) => item.id === source.id ? {
        ...item,
        files: [],
        packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' },
      } : item),
    }

    renderAgent('/agents/zhouce?tab=package', state)

    expect(screen.getByText('尚未读取到配置文件')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新读取' })).toBeInTheDocument()
    expect(screen.queryByRole('tree')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '选择文件' })).not.toBeInTheDocument()
    expect(screen.queryByText('选择一个文件查看结构化预览或只读源码。')).not.toBeInTheDocument()
  })

  it.each([
    ['历史外部引用', { kind: 'external-reference' as const, externalPath: '/tmp/external', strategy: 'reference-only' as const }, { compatibility: 'unverified' as const }, '历史外部目录未被读取'],
    ['Web 演示', { kind: 'bandi-demo' as const, strategy: 'create-demo' as const }, { schemaVersion: 1, compatibility: 'current' as const }, '当前演示没有文件记录'],
  ])('%s 的空 AgentPackage 不提供系统读取操作', (_label, packageSource, packageSchema, title) => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = {
      ...initialState,
      agents: initialState.agents.map((item) => item.id === source.id ? { ...item, files: [], packageSource, packageSchema } : item),
    }

    renderAgent('/agents/zhouce?tab=package', state)

    expect(screen.getByText(title)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重新读取' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tree')).not.toBeInTheDocument()
  })

  it('AgentPackage 深链展示文件树和默认文件', () => {
    renderAgent('/agents/zhouce?tab=package&path=agent.yaml&view=preview')

    expect(screen.getByRole('tab', { name: '原始文件' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tree', { name: '周策 Agent 配置目录' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'agent.yaml' })).toBeInTheDocument()
    expect(screen.queryByText('关联文件')).not.toBeInTheDocument()
  })

  it('保留源码深链并提供结构化预览切换', () => {
    renderAgent('/agents/zhouce?tab=package&path=config%2Frules.yaml&view=source')

    expect(screen.getByRole('tab', { name: '原始文件' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/只读源码根据当前页面中的配置生成/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '预览' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('tab', { name: '源码' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('复制当前源码到系统剪贴板', async () => {
    renderAgent('/agents/zhouce?tab=package&path=config%2Frules.yaml&view=source')

    fireEvent.click(screen.getByRole('button', { name: '复制当前源码' }))

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('rule-common')))
    expect(await screen.findByRole('status')).toHaveTextContent('源码已复制')
  })

  it('剪贴板拒绝时报告真实失败', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'))
    renderAgent('/agents/zhouce?tab=package&path=agent.yaml&view=preview')

    fireEvent.click(screen.getByRole('button', { name: '复制当前预览' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('复制失败')
  })

  it('文件树使用 roving tabindex 并声明完整树语义', () => {
    renderAgent('/agents/zhouce?tab=package&path=agent.yaml&view=preview')
    const tree = screen.getByRole('tree', { name: '周策 Agent 配置目录' })
    const items = within(tree).getAllByRole('treeitem')
    expect(items.filter((item) => item.tabIndex === 0)).toHaveLength(1)
    expect(within(tree).getByRole('treeitem', { name: /agent.yaml/ })).toHaveAttribute('aria-selected', 'true')
    expect(items.some((item) => item.hasAttribute('aria-expanded'))).toBe(true)
  })

  it('Instructions 编辑态注册草稿并保留未保存内容', () => {
    renderAgent('/agents/zhouce?tab=instructions')
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const editor = screen.getByRole('textbox', { name: '主指令正文' })
    fireEvent.change(editor, { target: { value: '尚未保存的新正文' } })

    expect(editor).toHaveValue('尚未保存的新正文')
    expect(screen.getByRole('button', { name: '保存到当前页面' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '取消' })).toBeEnabled()
  })

  it('Desktop 受管 Instructions 通过发现、加载与真实保存闭环', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = {
      ...initialState,
      agents: initialState.agents.map((item) => item.id === source.id ? {
        ...item,
        packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' },
      } : item),
    }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const asset = { id: 'asset-1', containerId: 'container-1', kind: 'instructions', officialScope: 'managed', assetContentHash: `sha256:${'a'.repeat(64)}`, containerContentHash: `sha256:${'a'.repeat(64)}`, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
    const discovery: DiscoveryResult = { requestId: 'discover-zhouce', profileVersion: 'agent-package-v1', containers: [{ id: 'container-1', locator: { rootKind: 'managed', displayPath: '/tmp/instructions.md', relativePath: 'agt_zhouce/instructions.md' }, format: 'markdown', contentHash: asset.containerContentHash, writable: true }], assets: [asset], sharedAssets: [], references: [], diagnostics: [] }
    const loaded: LoadEditorResult = { requestId: 'load-zhouce', asset, canonicalContent: '# Disk\n', redacted: false, baselineRef: { id: 'base-1', assetId: asset.id, containerId: asset.containerId, assetContentHash: asset.assetContentHash, containerContentHash: asset.containerContentHash }, diagnostics: [] }
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue(discovery)
    vi.spyOn(desktopBridge, 'loadConfigEditor').mockResolvedValue(loaded)
    const save = vi.spyOn(desktopBridge, 'saveConfig').mockResolvedValue({ kind: 'unchanged', requestId: 'save-zhouce', asset })

    renderAgent('/agents/zhouce?tab=instructions', state)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(await screen.findByRole('textbox', { name: '主指令正文' })).toHaveValue('# Disk\n')
    fireEvent.change(screen.getByRole('textbox', { name: '主指令正文' }), { target: { value: '# Updated\n' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'asset-1', baseContent: '# Disk\n', change: { kind: 'instructions', value: '# Updated\n' } })))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '主指令正文' })).not.toBeInTheDocument())
  })

  it('Desktop Instructions 读取真实历史并恢复为新版本', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' } } : item) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'c'.repeat(64)}` as const
    const asset = { id: 'asset-1', containerId: 'container-1', kind: 'instructions', officialScope: 'managed', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
    const loaded: LoadEditorResult = { requestId: 'load-history', asset, canonicalContent: '# Current\n', redacted: false, baselineRef: { id: 'base-1', assetId: asset.id, containerId: asset.containerId, assetContentHash: hash, containerContentHash: hash }, diagnostics: [] }
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({ requestId: 'discover-history', profileVersion: 'agent-package-v1', containers: [{ id: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/instructions.md', relativePath: 'agt_zhouce/instructions.md' }, format: 'markdown', contentHash: hash, writable: true }], assets: [asset], sharedAssets: [], references: [], diagnostics: [] })
    vi.spyOn(desktopBridge, 'loadConfigEditor').mockResolvedValue(loaded)
    vi.spyOn(desktopBridge, 'listConfigRevisions').mockResolvedValue([{ id: 'revision-old', assetId: asset.id, containerId: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/instructions.md' }, assetContentHash: hash, containerContentHash: hash, sourceAssetBaselineHash: hash, sourceContainerBaselineHash: hash, redacted: false, writeReceiptId: 'receipt-old', savedAt: '2026-08-31T00:00:00Z', summary: '保存 Instructions', confirmationRefs: [] }])
    vi.spyOn(desktopBridge, 'readConfigRevisionContent').mockResolvedValue('# Historical\n')
    const restore = vi.spyOn(desktopBridge, 'restoreConfigRevision').mockResolvedValue({ kind: 'saved', requestId: 'restore-zhouce', asset, revision: { id: 'revision-restored', assetId: asset.id, containerId: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/instructions.md' }, assetContentHash: hash, containerContentHash: hash, sourceAssetBaselineHash: hash, sourceContainerBaselineHash: hash, redacted: false, writeReceiptId: 'receipt-restored', savedAt: '2026-08-31T00:01:00Z', summary: '恢复自 revision-old', confirmationRefs: [], restoredFromRevisionId: 'revision-old' }, writeReceipt: { id: 'receipt-restored', containerId: asset.containerId, previousContainerHash: hash, writtenContainerHash: hash, verifiedAt: '2026-08-31T00:01:00Z', atomicReplace: true } })

    renderAgent('/agents/zhouce?tab=instructions', state)
    fireEvent.click(screen.getByRole('button', { name: '版本历史' }))
    expect(await screen.findByRole('dialog', { name: '主指令版本历史' })).toBeInTheDocument()
    expect(screen.getByText('# Historical')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '恢复为新版本' }))

    await waitFor(() => expect(restore).toHaveBeenCalledWith(expect.objectContaining({ assetId: asset.id, revisionId: 'revision-old', baseContent: '# Current\n', confirmed: true })))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '主指令版本历史' })).not.toBeInTheDocument())
  })

  it('Desktop Instructions 外部变化保留草稿并展示三方内容', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' } } : item) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'b'.repeat(64)}` as const
    const asset = { id: 'asset-1', containerId: 'container-1', kind: 'instructions', officialScope: 'managed', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({ requestId: 'discover-zhouce', profileVersion: 'agent-package-v1', containers: [{ id: 'container-1', locator: { rootKind: 'managed', displayPath: '/tmp/instructions.md', relativePath: 'agt_zhouce/instructions.md' }, format: 'markdown', contentHash: hash, writable: true }], assets: [asset], sharedAssets: [], references: [], diagnostics: [] })
    vi.spyOn(desktopBridge, 'loadConfigEditor').mockResolvedValue({ requestId: 'load-zhouce', asset, canonicalContent: '# Base\n', redacted: false, baselineRef: { id: 'base-1', assetId: asset.id, containerId: asset.containerId, assetContentHash: hash, containerContentHash: hash }, diagnostics: [] })
    vi.spyOn(desktopBridge, 'saveConfig').mockResolvedValue({ kind: 'baseline_changed', requestId: 'save-zhouce', assetId: asset.id, containerId: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/instructions.md' }, base: { content: '# Base\n', assetContentHash: hash, containerContentHash: hash, redacted: false }, current: { content: '# Current\n', assetContentHash: hash, containerContentHash: hash, redacted: false }, proposed: { content: '# Proposed\n', assetContentHash: hash, containerContentHash: hash, redacted: false }, diagnostics: [{ code: 'baseline_changed', severity: 'warning', message: '已发生外部变化' }] })

    renderAgent('/agents/zhouce?tab=instructions', state)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const editor = await screen.findByRole('textbox', { name: '主指令正文' })
    fireEvent.change(editor, { target: { value: '# Proposed\n' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('已被外部修改')
    expect(screen.getByRole('alert')).toHaveTextContent('Bandi 不会覆盖当前文件')
    expect(screen.getByRole('textbox', { name: '主指令正文' })).toHaveValue('# Proposed\n')
    expect(screen.getByText('# Base')).toBeInTheDocument()
    expect(screen.getByText('# Current')).toBeInTheDocument()
    expect(screen.getAllByText('# Proposed')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '基于当前内容重新编辑' })).toBeEnabled()
  })

  it('纯 Web Context 保持页面内存保存到当前页面边界', async () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(false)
    renderAgent('/agents/zhouce?tab=context')
    expect(screen.getByText(/当前页面保存位置/)).toBeInTheDocument()
    expect(screen.getByText('200,000 Token')).toBeInTheDocument()
    expect(screen.getByText(/约 160,000 Token/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(await screen.findByLabelText('规划上下文窗口（Token）'), { target: { value: '256000' } })
    fireEvent.change(screen.getByDisplayValue(80), { target: { value: '95' } })
    expect(screen.getByText(/约在 243,200 Token/)).toBeInTheDocument()
    expect(screen.getByText(/当前尚未应用到 Claude Code/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存到当前页面' })).toBeEnabled()
  })

  it('Desktop 受管 Context 通过发现、加载与真实保存闭环', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' } } : item) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'4'.repeat(64)}` as const
    const asset = { id: 'context-asset', containerId: 'context-container', kind: 'context', officialScope: 'managed', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
    const base = 'schemaVersion: 1\ncontextPolicy:\n  enabled: true\n  triggerRatio: 0.8\n  targetRatio: 0.5\n  protectRecentTurns: 6\n  protectOpeningTurns: 2\noutputProfileId: ""\noutputParameterBindings: []'
    const baselineRef = { id: 'context-base', assetId: asset.id, containerId: asset.containerId, assetContentHash: hash, containerContentHash: hash }
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({ requestId: 'discover-context', profileVersion: 'agent-package-v1', containers: [{ id: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/context.yaml', relativePath: 'agt_zhouce/config/context.yaml' }, format: 'yaml', contentHash: hash, writable: true }], assets: [asset], sharedAssets: [], references: [], diagnostics: [] })
    vi.spyOn(desktopBridge, 'loadConfigEditor').mockResolvedValue({ requestId: 'load-context', asset, canonicalContent: base, redacted: false, baselineRef, diagnostics: [] })
    const save = vi.spyOn(desktopBridge, 'saveConfig').mockResolvedValue({ kind: 'unchanged', requestId: 'save-context-zhouce', asset })

    renderAgent('/agents/zhouce?tab=context', state)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(await screen.findByDisplayValue(80)).toHaveValue(80)
    fireEvent.change(screen.getByLabelText('规划上下文窗口（Token）'), { target: { value: '256000' } })
    fireEvent.change(screen.getByDisplayValue(80), { target: { value: '85' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ assetId: asset.id, baseContent: base, change: expect.objectContaining({ kind: 'context', value: expect.stringMatching(/triggerRatio: 0\.85[\s\S]*contextWindowTokens: 256000/) }) })))
    await waitFor(() => expect(screen.queryByLabelText('触发比例（%）')).not.toBeInTheDocument())
  })

  it('纯 Web Rules 保持页面内存保存到当前页面边界', async () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(false)
    renderAgent('/agents/zhouce?tab=rules')
    expect(screen.getByText(/当前页面保存位置/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.getByRole('button', { name: '保存到当前页面' })).toBeEnabled()
  })

  it('Desktop 受管 Rules 缺失时可从空配置开始并在保存时创建', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = {
      ...initialState,
      runtime: 'desktop',
      agents: initialState.agents.map((item) => item.id === source.id ? {
        ...item,
        packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' },
        files: item.files.filter((file) => file.path !== 'config/rules.yaml'),
        ruleRefs: [],
      } : item),
    }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'5'.repeat(64)}` as const
    const asset = { id: 'rules-empty-asset', containerId: 'rules-empty-container', kind: 'rules', officialScope: 'managed', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [{ code: 'rules_not_materialized', severity: 'info', message: '尚未创建 rules.yaml' }] } satisfies import('../contracts').SourceAssetSummaryDto
    const base = 'schemaVersion: 1\nrules:\n  []\n'
    const baselineRef = { id: 'rules-empty-base', assetId: asset.id, containerId: asset.containerId, assetContentHash: hash, containerContentHash: hash, targetExists: false }
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({ requestId: 'discover-rules-empty', profileVersion: 'agent-package-v1', containers: [{ id: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/rules.yaml', relativePath: 'agt_zhouce/config/rules.yaml' }, format: 'yaml', contentHash: hash, writable: true }], assets: [asset], sharedAssets: [], references: [], diagnostics: [] })
    vi.spyOn(desktopBridge, 'loadConfigEditor').mockResolvedValue({ requestId: 'load-rules-empty', asset, canonicalContent: base, redacted: false, baselineRef, diagnostics: asset.diagnostics })
    const save = vi.spyOn(desktopBridge, 'saveConfig').mockResolvedValue({ kind: 'unchanged', requestId: 'save-rules-zhouce', asset })

    renderAgent('/agents/zhouce?tab=rules', state)
    expect(screen.getByText('尚未创建规则配置文件')).toBeInTheDocument()
    expect(screen.getByText(/首次产生变更并保存时会安全创建 config\/rules.yaml/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '开始配置' }))
    const checkbox = await screen.findByRole('checkbox', { name: /添加/ })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ assetId: asset.id, expectedBaseline: expect.objectContaining({ targetExists: false }), baseContent: base, change: expect.objectContaining({ kind: 'rules', value: expect.stringContaining('rules:') }) })))
  })

  it('Desktop 受管 Rules 通过发现、加载与真实保存闭环', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' }, ruleRefs: ['rule-common'] } : item) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'6'.repeat(64)}` as const
    const asset = { id: 'rules-asset', containerId: 'rules-container', kind: 'rules', officialScope: 'managed', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
    const base = 'schemaVersion: 1\nrules:\n  - "rule-common"'
    const baselineRef = { id: 'rules-base', assetId: asset.id, containerId: asset.containerId, assetContentHash: hash, containerContentHash: hash }
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({ requestId: 'discover-rules', profileVersion: 'agent-package-v1', containers: [{ id: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/rules.yaml', relativePath: 'agt_zhouce/config/rules.yaml' }, format: 'yaml', contentHash: hash, writable: true }], assets: [asset], sharedAssets: [], references: [], diagnostics: [] })
    vi.spyOn(desktopBridge, 'loadConfigEditor').mockResolvedValue({ requestId: 'load-rules', asset, canonicalContent: base, redacted: false, baselineRef, diagnostics: [] })
    const save = vi.spyOn(desktopBridge, 'saveConfig').mockResolvedValue({ kind: 'saved', requestId: 'save-rules-zhouce', asset, revision: { id: 'revision-rules', assetId: asset.id, containerId: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/rules.yaml' }, assetContentHash: hash, containerContentHash: hash, sourceAssetBaselineHash: hash, sourceContainerBaselineHash: hash, redacted: false, writeReceiptId: 'receipt-rules', savedAt: '2026-08-31T12:00:00Z', summary: '保存 Rule 引用', confirmationRefs: [] }, writeReceipt: { id: 'receipt-rules', containerId: asset.containerId, previousContainerHash: hash, writtenContainerHash: hash, verifiedAt: '2026-08-31T12:00:00Z', atomicReplace: true } })

    renderAgent('/agents/zhouce?tab=rules', state)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const checkbox = await screen.findByRole('checkbox', { name: /移除/ })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ assetId: asset.id, baseContent: base, change: expect.objectContaining({ kind: 'rules', value: expect.stringContaining('rules:') }) })))
  })

  it('纯 Web Skills 保持页面内存保存到当前页面边界', async () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(false)
    renderAgent('/agents/zhouce?tab=skills')
    expect(screen.getByText(/当前页面保存位置/)).toHaveTextContent('config/skills.yaml')
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.getByRole('button', { name: '保存到当前页面' })).toBeEnabled()
  })

  it('Desktop 没有共享 Skill 时显示明确空状态', () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = {
      ...initialState,
      runtime: 'desktop',
      hydration: { ...initialState.hydration, sharedAssets: 'succeeded' },
      assets: [],
      agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' } } : item),
    }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)

    renderAgent('/agents/zhouce?tab=skills', state)

    expect(screen.getByText('暂无可引用的技能')).toBeInTheDocument()
    expect(screen.getByText(/当前没有可引用的共享.*Desktop 暂不支持创建或导入/)).toBeInTheDocument()
  })

  it('Desktop 受管 Skills 通过发现、加载与真实保存闭环', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' }, skillRefs: ['skill-review'] } : item) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'7'.repeat(64)}` as const
    const asset = { id: 'skills-asset', containerId: 'skills-container', kind: 'skills', officialScope: 'managed', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
    const base = 'schemaVersion: 1\nskills:\n  - "skill-review"'
    const baselineRef = { id: 'skills-base', assetId: asset.id, containerId: asset.containerId, assetContentHash: hash, containerContentHash: hash }
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({ requestId: 'discover-skills', profileVersion: 'agent-package-v1', containers: [{ id: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/skills.yaml', relativePath: 'agt_zhouce/config/skills.yaml' }, format: 'yaml', contentHash: hash, writable: true }], assets: [asset], sharedAssets: [], references: [], diagnostics: [] })
    vi.spyOn(desktopBridge, 'loadConfigEditor').mockResolvedValue({ requestId: 'load-skills', asset, canonicalContent: base, redacted: false, baselineRef, diagnostics: [] })
    const save = vi.spyOn(desktopBridge, 'saveConfig').mockResolvedValue({ kind: 'saved', requestId: 'save-skills-zhouce', asset, revision: { id: 'revision-skills', assetId: asset.id, containerId: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/skills.yaml' }, assetContentHash: hash, containerContentHash: hash, sourceAssetBaselineHash: hash, sourceContainerBaselineHash: hash, redacted: false, writeReceiptId: 'receipt-skills', savedAt: '2026-08-31T12:00:00Z', summary: '保存 Skill 引用', confirmationRefs: [] }, writeReceipt: { id: 'receipt-skills', containerId: asset.containerId, previousContainerHash: hash, writtenContainerHash: hash, verifiedAt: '2026-08-31T12:00:00Z', atomicReplace: true } })

    renderAgent('/agents/zhouce?tab=skills', state)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const checkbox = await screen.findByRole('checkbox', { name: /移除/ })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ assetId: asset.id, baseContent: base, change: expect.objectContaining({ kind: 'skills', value: expect.stringContaining('skills:') }) })))
  })

  it('纯 Web MCP 保持页面内存保存到当前页面边界', async () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(false)
    renderAgent('/agents/zhouce?tab=mcp')
    expect(screen.getByText(/当前页面保存位置/)).toHaveTextContent('config/mcp.yaml')
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.getByRole('button', { name: '保存到当前页面' })).toBeEnabled()
  })

  it('Desktop 受管 MCP 通过发现、加载与真实保存闭环', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' }, mcpRefs: ['mcp-bandi'] } : item) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'8'.repeat(64)}` as const
    const asset = { id: 'mcp-asset', containerId: 'mcp-container', kind: 'mcp', officialScope: 'managed', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
    const base = 'schemaVersion: 1\nmcp:\n  - "mcp-bandi"'
    const baselineRef = { id: 'mcp-base', assetId: asset.id, containerId: asset.containerId, assetContentHash: hash, containerContentHash: hash }
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({ requestId: 'discover-mcp', profileVersion: 'agent-package-v1', containers: [{ id: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/mcp.yaml', relativePath: 'agt_zhouce/config/mcp.yaml' }, format: 'yaml', contentHash: hash, writable: true }], assets: [asset], sharedAssets: [], references: [], diagnostics: [] })
    vi.spyOn(desktopBridge, 'loadConfigEditor').mockResolvedValue({ requestId: 'load-mcp', asset, canonicalContent: base, redacted: false, baselineRef, diagnostics: [] })
    const save = vi.spyOn(desktopBridge, 'saveConfig').mockResolvedValue({ kind: 'saved', requestId: 'save-mcp-zhouce', asset, revision: { id: 'revision-mcp', assetId: asset.id, containerId: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/mcp.yaml' }, assetContentHash: hash, containerContentHash: hash, sourceAssetBaselineHash: hash, sourceContainerBaselineHash: hash, redacted: false, writeReceiptId: 'receipt-mcp', savedAt: '2026-08-31T12:00:00Z', summary: '保存 MCP 引用', confirmationRefs: [] }, writeReceipt: { id: 'receipt-mcp', containerId: asset.containerId, previousContainerHash: hash, writtenContainerHash: hash, verifiedAt: '2026-08-31T12:00:00Z', atomicReplace: true } })

    renderAgent('/agents/zhouce?tab=mcp', state)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const checkbox = await screen.findByRole('checkbox', { name: /移除/ })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ assetId: asset.id, baseContent: base, change: expect.objectContaining({ kind: 'mcp', value: expect.stringContaining('mcp:') }) })))
  })

  it('纯 Web SOP 保持页面内存保存到当前页面边界', async () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(false)
    const save = vi.spyOn(desktopBridge, 'saveConfig')
    renderAgent('/agents/zhouce?tab=sop')
    expect(screen.getByText(/当前页面保存位置/)).toHaveTextContent('config/sop.yaml')
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.getByRole('button', { name: '保存到当前页面' })).toBeEnabled()
    expect(save).not.toHaveBeenCalled()
  })

  it('Desktop 没有共享 SOP 时显示明确空状态', () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = {
      ...initialState,
      runtime: 'desktop',
      hydration: { ...initialState.hydration, sharedAssets: 'succeeded' },
      assets: [],
      agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' }, files: item.files.some((file) => file.path === 'config/sop.yaml') ? item.files : [...item.files, { path: 'config/sop.yaml', type: 'SOP', status: '已保存', scope: { kind: 'agent-root' } }] } : item),
    }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)

    renderAgent('/agents/zhouce?tab=sop', state)

    expect(screen.getByText('暂无可引用的SOP')).toBeInTheDocument()
    expect(screen.getByText(/当前没有可引用的共享.*Desktop 暂不支持创建或导入/)).toBeInTheDocument()
  })

  it('Desktop 受管 SOP 通过发现、加载与真实保存闭环', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' }, sopRefs: ['sop-delivery'] } : item) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'d'.repeat(64)}` as const
    const asset = { id: 'sop-asset', containerId: 'sop-container', kind: 'sop', officialScope: 'managed', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
    const base = 'schemaVersion: 1\nsop:\n  - "sop-delivery"'
    const baselineRef = { id: 'sop-base', assetId: asset.id, containerId: asset.containerId, assetContentHash: hash, containerContentHash: hash }
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({ requestId: 'discover-sop', profileVersion: 'agent-package-v1', containers: [{ id: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/sop.yaml', relativePath: 'agt_zhouce/config/sop.yaml' }, format: 'yaml', contentHash: hash, writable: true }], assets: [asset], sharedAssets: [], references: [], diagnostics: [] })
    vi.spyOn(desktopBridge, 'loadConfigEditor').mockResolvedValue({ requestId: 'load-sop', asset, canonicalContent: base, redacted: false, baselineRef, diagnostics: [] })
    const save = vi.spyOn(desktopBridge, 'saveConfig').mockResolvedValue({ kind: 'saved', requestId: 'save-sop-zhouce', asset, revision: { id: 'revision-sop', assetId: asset.id, containerId: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/sop.yaml' }, assetContentHash: hash, containerContentHash: hash, sourceAssetBaselineHash: hash, sourceContainerBaselineHash: hash, redacted: false, writeReceiptId: 'receipt-sop', savedAt: '2026-09-01T00:00:00Z', summary: '保存 SOP 引用', confirmationRefs: [] }, writeReceipt: { id: 'receipt-sop', containerId: asset.containerId, previousContainerHash: hash, writtenContainerHash: hash, verifiedAt: '2026-09-01T00:00:00Z', atomicReplace: true } })

    renderAgent('/agents/zhouce?tab=sop', state)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /移除/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ assetId: asset.id, baseContent: base, change: expect.objectContaining({ kind: 'sop', value: expect.stringContaining('sop:') }) })))
  })

  it('纯 Web Orchestration 与 Hook/Command 保持页面内存保存到当前页面边界', async () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(false)
    const save = vi.spyOn(desktopBridge, 'saveConfig')
    renderAgent('/agents/zhouce?tab=collaboration')
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.getByRole('button', { name: '保存到当前页面' })).toBeEnabled()
    expect(save).not.toHaveBeenCalled()
  })

  it('Desktop 受管 Orchestration 通过发现、加载与真实保存闭环', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' } } : item) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'e'.repeat(64)}` as const
    const asset = { id: 'orchestration-asset', containerId: 'orchestration-container', kind: 'orchestration', officialScope: 'managed', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
    const base = `schemaVersion: 1\norchestration: ${JSON.stringify(source.orchestrationPolicy)}`
    const baselineRef = { id: 'orchestration-base', assetId: asset.id, containerId: asset.containerId, assetContentHash: hash, containerContentHash: hash }
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({ requestId: 'discover-orchestration', profileVersion: 'agent-package-v1', containers: [{ id: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/orchestration.yaml', relativePath: 'agt_zhouce/config/orchestration.yaml' }, format: 'yaml', contentHash: hash, writable: true }], assets: [asset], sharedAssets: [], references: [], diagnostics: [] })
    vi.spyOn(desktopBridge, 'loadConfigEditor').mockResolvedValue({ requestId: 'load-orchestration', asset, canonicalContent: base, redacted: false, baselineRef, diagnostics: [] })
    const save = vi.spyOn(desktopBridge, 'saveConfig').mockResolvedValue({ kind: 'saved', requestId: 'save-orchestration-zhouce', asset, revision: { id: 'revision-orchestration', assetId: asset.id, containerId: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/orchestration.yaml' }, assetContentHash: hash, containerContentHash: hash, sourceAssetBaselineHash: hash, sourceContainerBaselineHash: hash, redacted: false, writeReceiptId: 'receipt-orchestration', savedAt: '2026-09-01T00:00:00Z', summary: '保存静态编排策略', confirmationRefs: [] }, writeReceipt: { id: 'receipt-orchestration', containerId: asset.containerId, previousContainerHash: hash, writtenContainerHash: hash, verifiedAt: '2026-09-01T00:00:00Z', atomicReplace: true } })

    renderAgent('/agents/zhouce?tab=collaboration', state)
    const collaboration = screen.getByRole('heading', { name: '长期协作与委派边界' }).closest('section')!
    fireEvent.click(within(collaboration).getByRole('button', { name: '编辑' }))
    const depth = await screen.findByLabelText('最大委派深度')
    fireEvent.change(depth, { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ assetId: asset.id, baseContent: base, change: expect.objectContaining({ kind: 'orchestration', value: expect.stringContaining('orchestration:') }) })))
  })

  it('Desktop 受管 Hook 通过发现、参数校验与真实保存闭环', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? { ...item, hookRefs: [], packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' } } : item) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'f'.repeat(64)}` as const
    const asset = { id: 'hooks-asset', containerId: 'hooks-container', kind: 'hooks', officialScope: 'managed', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
    const base = 'schemaVersion: 1\nhooks: []'
    const baselineRef = { id: 'hooks-base', assetId: asset.id, containerId: asset.containerId, assetContentHash: hash, containerContentHash: hash }
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({ requestId: 'discover-hooks', profileVersion: 'agent-package-v1', containers: [{ id: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/hooks.yaml', relativePath: 'agt_zhouce/config/hooks.yaml' }, format: 'yaml', contentHash: hash, writable: true }], assets: [asset], sharedAssets: [], references: [], diagnostics: [] })
    vi.spyOn(desktopBridge, 'loadConfigEditor').mockResolvedValue({ requestId: 'load-hooks', asset, canonicalContent: base, redacted: false, baselineRef, diagnostics: [] })
    const save = vi.spyOn(desktopBridge, 'saveConfig').mockResolvedValue({ kind: 'saved', requestId: 'save-hooks-zhouce', asset, revision: { id: 'revision-hooks', assetId: asset.id, containerId: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/hooks.yaml' }, assetContentHash: hash, containerContentHash: hash, sourceAssetBaselineHash: hash, sourceContainerBaselineHash: hash, redacted: false, writeReceiptId: 'receipt-hooks', savedAt: '2026-09-01T00:00:00Z', summary: '保存 Hook 引用', confirmationRefs: [] }, writeReceipt: { id: 'receipt-hooks', containerId: asset.containerId, previousContainerHash: hash, writtenContainerHash: hash, verifiedAt: '2026-09-01T00:00:00Z', atomicReplace: true } })

    renderAgent('/agents/zhouce?tab=collaboration', state)
    const hookPanel = screen.getByText('钩子引用', { selector: 'b' }).closest('section')!
    fireEvent.click(within(hookPanel).getByRole('button', { name: '编辑' }))
    const hook = await within(hookPanel).findByRole('checkbox', { name: '配置保存声明' })
    fireEvent.click(hook)
    fireEvent.click(within(hookPanel).getByRole('checkbox', { name: /覆盖包含配置路径/ }))
    fireEvent.click(within(hookPanel).getByRole('checkbox', { name: '否' }))
    fireEvent.click(within(hookPanel).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ assetId: asset.id, baseContent: base, change: expect.objectContaining({ kind: 'hooks', value: expect.stringContaining('"parameterId":"include-path"') }) })))
  })

  it('Desktop 受管 Command 通过发现、参数校验与真实保存闭环', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? { ...item, commandRefs: [], packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' } } : item) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'8'.repeat(64)}` as const
    const asset = { id: 'commands-asset', containerId: 'commands-container', kind: 'commands', officialScope: 'managed', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
    const base = 'schemaVersion: 1\ncommands: []'
    const baselineRef = { id: 'commands-base', assetId: asset.id, containerId: asset.containerId, assetContentHash: hash, containerContentHash: hash }
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({ requestId: 'discover-commands', profileVersion: 'agent-package-v1', containers: [{ id: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/commands.yaml', relativePath: 'agt_zhouce/config/commands.yaml' }, format: 'yaml', contentHash: hash, writable: true }], assets: [asset], sharedAssets: [], references: [], diagnostics: [] })
    vi.spyOn(desktopBridge, 'loadConfigEditor').mockResolvedValue({ requestId: 'load-commands', asset, canonicalContent: base, redacted: false, baselineRef, diagnostics: [] })
    const save = vi.spyOn(desktopBridge, 'saveConfig').mockResolvedValue({ kind: 'saved', requestId: 'save-commands-zhouce', asset, revision: { id: 'revision-commands', assetId: asset.id, containerId: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/commands.yaml' }, assetContentHash: hash, containerContentHash: hash, sourceAssetBaselineHash: hash, sourceContainerBaselineHash: hash, redacted: false, writeReceiptId: 'receipt-commands', savedAt: '2026-09-01T00:00:00Z', summary: '保存 Command 引用', confirmationRefs: [] }, writeReceipt: { id: 'receipt-commands', containerId: asset.containerId, previousContainerHash: hash, writtenContainerHash: hash, verifiedAt: '2026-09-01T00:00:00Z', atomicReplace: true } })

    renderAgent('/agents/zhouce?tab=collaboration', state)
    const commandPanel = screen.getByText('命令引用', { selector: 'b' }).closest('section')!
    fireEvent.click(within(commandPanel).getByRole('button', { name: '编辑' }))
    const command = await within(commandPanel).findByRole('checkbox', { name: '配置审计命令' })
    fireEvent.click(command)
    fireEvent.click(within(commandPanel).getByRole('checkbox', { name: /覆盖检查范围/ }))
    fireEvent.change(within(commandPanel).getByRole('combobox', { name: '检查范围' }), { target: { value: 'project' } })
    fireEvent.click(within(commandPanel).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ assetId: asset.id, baseContent: base, change: expect.objectContaining({ kind: 'commands', value: expect.stringContaining('"parameterId":"scope"') }) })))
  })

  it('权限页说明长期边界与终端执行期授权的区别', () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(false)

    renderAgent('/agents/zhouce?tab=permissions')

    expect(screen.getByText('长期权限边界')).toBeInTheDocument()
    expect(screen.getByText(/实际工具调用仍由 Claude Code 在终端中按当前任务请求授权/)).toBeInTheDocument()
    expect(screen.getByText(/不会写入真实配置或授权终端操作/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '调整长期边界' })).toBeInTheDocument()
  })

  it('Desktop Permissions 在双 Agent 发现结果中只加载当前 Agent 容器', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const other = initialState.agents.find((item) => item.id !== source.id)!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => ({ ...item, packageSource: { kind: 'bandi-managed', packageId: `agt_${item.id}`, strategy: 'managed' } })) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'3'.repeat(64)}` as const
    const otherAsset = { id: 'permissions-other', containerId: 'permissions-other-container', kind: 'permissions', officialScope: 'managed', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
    const currentAsset = { ...otherAsset, id: 'permissions-current', containerId: 'permissions-current-container' }
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({ requestId: 'discover-permissions-dual', profileVersion: 'agent-package-v1', containers: [
      { id: otherAsset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/other-permissions.yaml', relativePath: `agt_${other.id}/config/permissions.yaml` }, format: 'yaml', contentHash: hash, writable: true },
      { id: currentAsset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/current-permissions.yaml', relativePath: 'agt_zhouce/config/permissions.yaml' }, format: 'yaml', contentHash: hash, writable: true },
    ], assets: [otherAsset, currentAsset], sharedAssets: [], references: [], diagnostics: [] })
    const load = vi.spyOn(desktopBridge, 'loadConfigEditor').mockResolvedValue({ requestId: 'load-current', asset: currentAsset, canonicalContent: 'schemaVersion: 1\npermissions:\n  files: "仅当前工作区"\n  commands: "构建、测试与版本控制"\n  network: "仅已配置 MCP"\n  delegation: "仅明确服务授权范围"', redacted: false, baselineRef: { id: 'base-current', assetId: currentAsset.id, containerId: currentAsset.containerId, assetContentHash: hash, containerContentHash: hash }, diagnostics: [] })

    renderAgent('/agents/zhouce?tab=permissions', state)
    fireEvent.click(screen.getByRole('button', { name: '调整长期边界' }))

    await waitFor(() => expect(load).toHaveBeenCalledWith({ requestId: 'load-permissions-zhouce', assetId: currentAsset.id }))
  })

  it.each([
    ['缺失', [], [], /未发现该 Agent 的可编辑 Permissions 资产/],
    ['歧义', ['permissions-a', 'permissions-b'], ['container-a', 'container-b'], /Permissions 资产.*定位存在歧义/],
  ])('Desktop Permissions 定位%s时拒绝进入编辑', async (_case, assetIds, containerIds, message) => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' } } : item) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'4'.repeat(64)}` as const
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({ requestId: 'discover-permissions-error', profileVersion: 'agent-package-v1', containers: containerIds.map((id) => ({ id, locator: { rootKind: 'managed' as const, displayPath: `/tmp/${id}.yaml`, relativePath: 'agt_zhouce/config/permissions.yaml' }, format: 'yaml' as const, contentHash: hash, writable: true })), assets: assetIds.map((id, index) => ({ id, containerId: containerIds[index], kind: 'permissions' as const, officialScope: 'managed' as const, assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed' as const, diagnostics: [] })), sharedAssets: [], references: [], diagnostics: [] })
    const load = vi.spyOn(desktopBridge, 'loadConfigEditor')

    renderAgent('/agents/zhouce?tab=permissions', state)
    fireEvent.click(screen.getByRole('button', { name: '调整长期边界' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByLabelText('文件写入')).not.toBeInTheDocument()
    expect(load).not.toHaveBeenCalled()
  })

  it('纯 Web Permissions 保持页面内存保存到当前页面边界', async () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(false)
    const save = vi.spyOn(desktopBridge, 'saveConfig')

    renderAgent('/agents/zhouce?tab=permissions')
    fireEvent.click(screen.getByRole('button', { name: '调整长期边界' }))
    fireEvent.change(screen.getByLabelText('文件写入'), { target: { value: '任意目录' } })
    fireEvent.click(screen.getByRole('button', { name: '保存到当前页面' }))

    const dialog = await screen.findByRole('dialog', { name: '确认扩大 Agent 长期权限' })
    expect(within(dialog).getByText(/仅在当前页面更新/)).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText(/输入 Agent 名称/), { target: { value: '周策' } })
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: '确认扩大长期边界' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '确认扩大 Agent 长期权限' })).not.toBeInTheDocument())
    expect(save).not.toHaveBeenCalled()
    expect(screen.getByText('任意目录')).toBeInTheDocument()
  })

  it('Desktop Permissions 扩大权限通过一次性 challenge 确认', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' } } : item) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'9'.repeat(64)}` as const
    const proposedHash = `sha256:${'a'.repeat(64)}` as const
    const asset = { id: 'permissions-asset', containerId: 'permissions-container', kind: 'permissions', officialScope: 'managed', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
    const base = 'schemaVersion: 1\npermissions:\n  files: "仅当前工作区"\n  commands: "构建、测试与版本控制"\n  network: "仅已配置 MCP"\n  delegation: "仅明确服务授权范围"'
    const baselineRef = { id: 'permissions-base', assetId: asset.id, containerId: asset.containerId, assetContentHash: hash, containerContentHash: hash }
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({ requestId: 'discover-permissions', profileVersion: 'agent-package-v1', containers: [{ id: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/permissions.yaml', relativePath: 'agt_zhouce/config/permissions.yaml' }, format: 'yaml', contentHash: hash, writable: true }], assets: [asset], sharedAssets: [], references: [], diagnostics: [] })
    vi.spyOn(desktopBridge, 'loadConfigEditor').mockResolvedValue({ requestId: 'load-permissions', asset, canonicalContent: base, redacted: false, baselineRef, diagnostics: [] })
    const save = vi.spyOn(desktopBridge, 'saveConfig')
      .mockResolvedValueOnce({ kind: 'confirmation_required', requestId: 'save-permissions-zhouce', challenge: { id: 'confirmation-permissions', assetId: asset.id, proposedContentHash: proposedHash, expiresAt: '2026-08-31T12:10:00Z', reason: '扩大 Agent 长期权限边界' }, diagnostics: [{ code: 'permission_expansion_confirmation_required', severity: 'warning', message: '扩大 Agent 长期权限必须独立确认' }] })
      .mockResolvedValueOnce({ kind: 'saved', requestId: 'save-permissions-zhouce', asset, revision: { id: 'revision-permissions', assetId: asset.id, containerId: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/permissions.yaml' }, assetContentHash: proposedHash, containerContentHash: proposedHash, sourceAssetBaselineHash: hash, sourceContainerBaselineHash: hash, redacted: false, writeReceiptId: 'receipt-permissions', savedAt: '2026-08-31T12:00:00Z', summary: '保存长期权限边界', confirmationRefs: ['confirmation-permissions'] }, writeReceipt: { id: 'receipt-permissions', containerId: asset.containerId, previousContainerHash: hash, writtenContainerHash: proposedHash, verifiedAt: '2026-08-31T12:00:00Z', atomicReplace: true } })

    renderAgent('/agents/zhouce?tab=permissions', state)
    fireEvent.click(screen.getByRole('button', { name: '调整长期边界' }))
    fireEvent.change(await screen.findByLabelText('文件写入'), { target: { value: '任意目录' } })
    fireEvent.click(screen.getByRole('button', { name: '保存长期边界' }))

    const dialog = await screen.findByRole('dialog', { name: '确认扩大 Agent 长期权限' })
    fireEvent.change(within(dialog).getByLabelText(/输入 Agent 名称/), { target: { value: '周策' } })
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: '确认扩大长期边界' }))

    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save).toHaveBeenNthCalledWith(1, expect.objectContaining({ assetId: asset.id, confirmationRef: undefined, change: expect.objectContaining({ kind: 'permissions', value: expect.stringContaining('files: "任意目录"') }) }))
    expect(save).toHaveBeenNthCalledWith(2, expect.objectContaining({ assetId: asset.id, confirmationRef: 'confirmation-permissions' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '确认扩大 Agent 长期权限' })).not.toBeInTheDocument())
  })

  it('Desktop Permissions 恢复到更宽边界时再次要求 challenge', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const managed = { ...source, permissions: { ...source.permissions, files: '只读当前工作区' }, packageSource: { kind: 'bandi-managed' as const, packageId: 'agt_zhouce', strategy: 'managed' as const } }
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? managed : item) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'b'.repeat(64)}` as const
    const targetHash = `sha256:${'c'.repeat(64)}` as const
    const asset = { id: 'permissions-restore-asset', containerId: 'permissions-restore-container', kind: 'permissions', officialScope: 'managed', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
    const current = 'schemaVersion: 1\npermissions:\n  files: "只读当前工作区"\n  commands: "构建、测试与版本控制"\n  network: "仅已配置 MCP"\n  delegation: "仅明确服务授权范围"'
    const target = current.replace('只读当前工作区', '任意目录')
    const baselineRef = { id: 'permissions-restore-base', assetId: asset.id, containerId: asset.containerId, assetContentHash: hash, containerContentHash: hash }
    const revision = { id: 'revision-permissions-wide', assetId: asset.id, containerId: asset.containerId, locator: { rootKind: 'managed' as const, displayPath: '/tmp/permissions.yaml' }, assetContentHash: targetHash, containerContentHash: targetHash, sourceAssetBaselineHash: hash, sourceContainerBaselineHash: hash, redacted: false, writeReceiptId: 'receipt-wide', savedAt: '2026-08-31T11:00:00Z', summary: '历史宽权限', confirmationRefs: ['old-confirmation'] }
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({ requestId: 'discover-permissions-restore', profileVersion: 'agent-package-v1', containers: [{ id: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/permissions.yaml', relativePath: 'agt_zhouce/config/permissions.yaml' }, format: 'yaml', contentHash: hash, writable: true }], assets: [asset], sharedAssets: [], references: [], diagnostics: [] })
    vi.spyOn(desktopBridge, 'loadConfigEditor').mockResolvedValue({ requestId: 'load-permissions-restore', asset, canonicalContent: current, redacted: false, baselineRef, diagnostics: [] })
    vi.spyOn(desktopBridge, 'listConfigRevisions').mockResolvedValue([revision])
    vi.spyOn(desktopBridge, 'readConfigRevisionContent').mockResolvedValue(target)
    const restore = vi.spyOn(desktopBridge, 'restoreConfigRevision')
      .mockResolvedValueOnce({ kind: 'confirmation_required', requestId: 'restore-permissions-zhouce', challenge: { id: 'confirmation-restore-permissions', assetId: asset.id, proposedContentHash: targetHash, expiresAt: '2026-08-31T12:10:00Z', reason: '扩大 Agent 长期权限边界' }, diagnostics: [{ code: 'permission_expansion_confirmation_required', severity: 'warning', message: '扩大 Agent 长期权限必须独立确认' }] })
      .mockResolvedValueOnce({ kind: 'saved', requestId: 'restore-permissions-zhouce', asset, revision: { ...revision, id: 'revision-permissions-restored', restoredFromRevisionId: revision.id, confirmationRefs: ['confirmation-restore-permissions'] }, writeReceipt: { id: 'receipt-restored', containerId: asset.containerId, previousContainerHash: hash, writtenContainerHash: targetHash, verifiedAt: '2026-08-31T12:00:00Z', atomicReplace: true } })

    renderAgent('/agents/zhouce?tab=permissions', state)
    fireEvent.click(screen.getByRole('button', { name: '版本历史' }))
    const history = await screen.findByRole('dialog', { name: '长期权限版本历史' })
    fireEvent.click(within(history).getByRole('checkbox'))
    fireEvent.click(within(history).getByRole('button', { name: '恢复为新版本' }))

    const confirmation = await screen.findByRole('dialog', { name: '确认扩大 Agent 长期权限' })
    fireEvent.change(within(confirmation).getByLabelText(/输入 Agent 名称/), { target: { value: '周策' } })
    fireEvent.click(within(confirmation).getByRole('checkbox'))
    fireEvent.click(within(confirmation).getByRole('button', { name: '确认扩大长期边界' }))

    await waitFor(() => expect(restore).toHaveBeenCalledTimes(2))
    expect(restore).toHaveBeenNthCalledWith(1, expect.objectContaining({ revisionId: revision.id, confirmationRef: undefined }))
    expect(restore).toHaveBeenNthCalledWith(2, expect.objectContaining({ revisionId: revision.id, confirmationRef: 'confirmation-restore-permissions' }))
  })

  it('Desktop current 受管 Agent 通过精确确认后永久删除', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = {
      ...initialState,
      runtime: 'desktop',
      agents: initialState.agents.map((item) => item.id === source.id ? {
        ...item,
        status: 'archived',
        packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' },
        packageSchema: { schemaVersion: 1, compatibility: 'current' },
      } : item),
    }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const preview = vi.spyOn(desktopBridge, 'previewManagedAgentDeletion').mockResolvedValue({
      requestId: 'delete-agent-zhouce-fixed',
      agentId: 'zhouce',
      previewRef: 'preview-delete-zhouce',
      confirmationText: '永久删除 周策',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      packageFingerprint: 'sha256:package',
      impacts: {
        sharedAssetReferences: [],
        organizationRelationships: [],
        reviewResponsibilities: [],
        formalMemory: [],
        automaticCleanup: [{ id: 'department_memberships', label: '部门成员索引', detail: '将自动清理 1 项' }],
        historyAndBackups: [{ id: 'config_revisions', label: '配置版本', detail: '将删除 3 项 ConfigRevision；独立 Backup 不变' }],
        blockers: [],
      },
      canCommit: true,
    })
    const commit = vi.spyOn(desktopBridge, 'commitManagedAgentDeletion').mockResolvedValue({ requestId: 'delete-agent-zhouce-fixed', agentId: 'zhouce', operationId: 'operation-delete-zhouce', createdAt: '2026-09-03T10:00:00Z', status: 'completed', deletedConfigRevisions: 3, pendingCleanup: [] })

    const { router } = renderAgent('/agents/zhouce', state)
    fireEvent.click(screen.getByRole('button', { name: '预览永久删除影响' }))
    const dialog = await screen.findByRole('dialog', { name: '永久删除 周策' })
    await waitFor(() => expect(preview).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'zhouce' })))
    expect(within(dialog).getByText(/独立 备份 不变/)).toBeInTheDocument()
    expect(within(dialog).queryByText(/ConfigRevision|Backup|2026-09-03T12:00:00Z/)).not.toBeInTheDocument()
    const confirmation = within(dialog).getByLabelText(/输入“永久删除 周策”确认/)
    const deleteButton = within(dialog).getByRole('button', { name: '永久删除' })
    fireEvent.change(confirmation, { target: { value: '永久删除 周策 ' } })
    expect(deleteButton).toBeDisabled()
    fireEvent.change(confirmation, { target: { value: '永久删除 周策' } })
    fireEvent.click(deleteButton)

    await waitFor(() => expect(commit).toHaveBeenCalledWith({ requestId: 'delete-agent-zhouce-fixed', agentId: 'zhouce', previewRef: 'preview-delete-zhouce', confirmationText: '永久删除 周策' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/agents'))
  })

  it('删除已提交但仍待清理时移除 Agent 并保留继续清理入口', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = {
      ...initialState,
      runtime: 'desktop',
      agents: initialState.agents.map((item) => item.id === source.id ? {
        ...item,
        status: 'archived',
        packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' },
        packageSchema: { schemaVersion: 1, compatibility: 'current' },
      } : item),
    }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    vi.spyOn(desktopBridge, 'previewManagedAgentDeletion').mockResolvedValue({
      requestId: 'delete-cleanup-pending', agentId: 'zhouce', previewRef: 'cleanup-preview', confirmationText: '永久删除 周策', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), packageFingerprint: 'sha256:package', canCommit: true,
      impacts: { sharedAssetReferences: [], organizationRelationships: [], reviewResponsibilities: [], formalMemory: [], automaticCleanup: [], historyAndBackups: [], blockers: [] },
    })
    vi.spyOn(desktopBridge, 'commitManagedAgentDeletion').mockResolvedValue({
      requestId: 'delete-cleanup-pending',
      agentId: 'zhouce',
      operationId: 'operation-delete-zhouce',
      createdAt: '2026-09-03T10:00:00Z',
      status: 'cleanup_pending',
      deletedConfigRevisions: 0,
      safeReason: 'Agent 配置已删除，但部分配置版本仍待清理。请勿重复删除。',
      pendingCleanup: ['清理配置版本'],
    })

    const { router } = renderAgentWithPersistentState(state)
    fireEvent.click(screen.getByRole('button', { name: '预览永久删除影响' }))
    const dialog = await screen.findByRole('dialog', { name: '永久删除 周策' })
    fireEvent.change(within(dialog).getByLabelText(/输入“永久删除 周策”确认/), { target: { value: '永久删除 周策' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '永久删除' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/agents'))
    expect(screen.getByTestId('remaining-agent')).toHaveTextContent('已移除')
    expect(screen.getByTestId('delete-recovery')).toHaveTextContent('operation-delete-zhouce:database_committed')
    const notice = screen.getByText(/部分配置版本仍待清理/).closest('output')
    expect(notice).toHaveTextContent('Agent 配置已删除')
    expect(notice).toHaveTextContent('请勿重复删除')
  })

  it('删除预览存在 blocker 时展示解除建议并禁止提交', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = {
      ...initialState,
      agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' }, packageSchema: { schemaVersion: 1, compatibility: 'current' } } : item),
    }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    vi.spyOn(desktopBridge, 'previewManagedAgentDeletion').mockResolvedValue({
      requestId: 'delete-blocked', agentId: 'zhouce', previewRef: 'blocked-preview', confirmationText: '永久删除 周策', expiresAt: '2026-09-03T12:00:00Z', packageFingerprint: 'sha256:package', canCommit: false,
      impacts: { sharedAssetReferences: [], organizationRelationships: [], reviewResponsibilities: [], formalMemory: [], automaticCleanup: [], historyAndBackups: [], blockers: [{ id: 'agent_static_reference:other-agent', label: '删除阻止项', detail: 'agent_static_reference:other-agent', remediation: '先移除其他 AgentPackage 中的静态引用。' }] },
    })
    const commit = vi.spyOn(desktopBridge, 'commitManagedAgentDeletion')

    renderAgent('/agents/zhouce', state)
    fireEvent.click(screen.getByRole('button', { name: '预览永久删除影响' }))
    const dialog = await screen.findByRole('dialog', { name: '永久删除 周策' })
    expect(await within(dialog).findByText('agent_static_reference:other-agent')).toBeInTheDocument()
    expect(within(dialog).getByText('解除建议：先移除其他 AgentPackage 中的静态引用。')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: '永久删除' })).not.toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/输入“/)).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '重新检查' })).toBeInTheDocument()
    expect(commit).not.toHaveBeenCalled()
  })

  it('重新检查使用新的请求 ID，并在可提交时聚焦确认输入', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed' as const, packageId: 'agt_zhouce', strategy: 'managed' as const }, packageSchema: { schemaVersion: 1, compatibility: 'current' as const } } : item) }
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()
    const preview = vi.spyOn(desktopBridge, 'previewManagedAgentDeletion')
      .mockResolvedValueOnce({ requestId: 'blocked', agentId: 'zhouce', previewRef: 'blocked', confirmationText: '永久删除 周策', expiresAt, packageFingerprint: 'sha256:package', canCommit: false, impacts: { sharedAssetReferences: [], organizationRelationships: [], reviewResponsibilities: [], formalMemory: [], automaticCleanup: [], historyAndBackups: [], blockers: [{ id: 'blocker', label: '阻塞项', detail: '仍被引用' }] } })
      .mockImplementationOnce(async (request) => ({ requestId: request.requestId, agentId: 'zhouce', previewRef: 'ready', confirmationText: '永久删除 周策', expiresAt, packageFingerprint: 'sha256:package', canCommit: true, impacts: { sharedAssetReferences: [], organizationRelationships: [], reviewResponsibilities: [], formalMemory: [], automaticCleanup: [], historyAndBackups: [], blockers: [] } }))

    renderAgent('/agents/zhouce', state)
    fireEvent.click(screen.getByRole('button', { name: '预览永久删除影响' }))
    const dialog = await screen.findByRole('dialog', { name: '永久删除 周策' })
    fireEvent.click(await within(dialog).findByRole('button', { name: '重新检查' }))

    await waitFor(() => expect(preview).toHaveBeenCalledTimes(2))
    expect(preview.mock.calls[0][0].requestId).not.toBe(preview.mock.calls[1][0].requestId)
    const confirmation = await within(dialog).findByLabelText(/输入“永久删除 周策”确认/)
    await waitFor(() => expect(confirmation).toHaveFocus())
  })

  it('删除目标变化后清除旧确认并只提供重新检查', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed' as const, packageId: 'agt_zhouce', strategy: 'managed' as const }, packageSchema: { schemaVersion: 1, compatibility: 'current' as const } } : item) }
    vi.spyOn(desktopBridge, 'previewManagedAgentDeletion').mockResolvedValue({ requestId: 'changed', agentId: 'zhouce', previewRef: 'changed', confirmationText: '永久删除 周策', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), packageFingerprint: 'sha256:package', canCommit: true, impacts: { sharedAssetReferences: [], organizationRelationships: [], reviewResponsibilities: [], formalMemory: [], automaticCleanup: [], historyAndBackups: [], blockers: [] } })
    vi.spyOn(desktopBridge, 'commitManagedAgentDeletion').mockRejectedValue(new Error('AGENT_DELETE_TARGET_CHANGED: 删除目标或影响已变化，请重新预览'))

    renderAgent('/agents/zhouce', state)
    fireEvent.click(screen.getByRole('button', { name: '预览永久删除影响' }))
    const dialog = await screen.findByRole('dialog', { name: '永久删除 周策' })
    fireEvent.change(await within(dialog).findByLabelText(/输入“永久删除 周策”确认/), { target: { value: '永久删除 周策' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '永久删除' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('删除目标已变化')
    expect(within(dialog).getByText(/Agent 配置没有变化/)).toBeInTheDocument()
    expect(within(dialog).getByText(/AGENT_DELETE_TARGET_CHANGED/)).toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/输入“/)).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: '永久删除' })).not.toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '重新检查' })).toHaveFocus())
  })

  it('删除提交失败时保留详情页且不移除 Agent', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? { ...item, status: 'archived' as const, packageSource: { kind: 'bandi-managed' as const, packageId: 'agt_zhouce', strategy: 'managed' as const }, packageSchema: { schemaVersion: 1, compatibility: 'current' as const } } : item) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    vi.spyOn(desktopBridge, 'previewManagedAgentDeletion').mockResolvedValue({ requestId: 'delete-fails', agentId: 'zhouce', previewRef: 'fails-preview', confirmationText: '永久删除 周策', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), packageFingerprint: 'sha256:package', canCommit: true, impacts: { sharedAssetReferences: [], organizationRelationships: [], reviewResponsibilities: [], formalMemory: [], automaticCleanup: [], historyAndBackups: [], blockers: [] } })
    vi.spyOn(desktopBridge, 'commitManagedAgentDeletion').mockRejectedValue(new Error('AgentPackage 已变化，请重新预览'))

    const { router } = renderAgent('/agents/zhouce', state)
    fireEvent.click(screen.getByRole('button', { name: '预览永久删除影响' }))
    const dialog = await screen.findByRole('dialog', { name: '永久删除 周策' })
    fireEvent.change(within(dialog).getByLabelText(/输入“永久删除 周策”确认/), { target: { value: '永久删除 周策' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '永久删除' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('AgentPackage 已变化，请重新预览')
    expect(router.state.location.pathname).toBe('/agents/zhouce')
    expect(within(dialog).getByRole('heading', { name: '永久删除 周策' })).toBeInTheDocument()
  })

  it('Desktop Context 外部变化保留草稿并展示三方 YAML', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' } } : item) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'5'.repeat(64)}` as const
    const asset = { id: 'context-asset', containerId: 'context-container', kind: 'context', officialScope: 'managed', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
    const base = 'schemaVersion: 1\ncontextPolicy:\n  enabled: true\n  triggerRatio: 0.8\n  targetRatio: 0.5\n  protectRecentTurns: 6\n  protectOpeningTurns: 2\noutputProfileId: ""\noutputParameterBindings: []'
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({ requestId: 'discover-context', profileVersion: 'agent-package-v1', containers: [{ id: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/context.yaml', relativePath: 'agt_zhouce/config/context.yaml' }, format: 'yaml', contentHash: hash, writable: true }], assets: [asset], sharedAssets: [], references: [], diagnostics: [] })
    vi.spyOn(desktopBridge, 'loadConfigEditor').mockResolvedValue({ requestId: 'load-context', asset, canonicalContent: base, redacted: false, baselineRef: { id: 'context-base', assetId: asset.id, containerId: asset.containerId, assetContentHash: hash, containerContentHash: hash }, diagnostics: [] })
    vi.spyOn(desktopBridge, 'saveConfig').mockResolvedValue({ kind: 'baseline_changed', requestId: 'save-context-zhouce', assetId: asset.id, containerId: asset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/context.yaml' }, base: { content: base, assetContentHash: hash, containerContentHash: hash, redacted: false }, current: { content: base.replace('triggerRatio: 0.8', 'triggerRatio: 0.9'), assetContentHash: hash, containerContentHash: hash, redacted: false }, proposed: { content: base.replace('triggerRatio: 0.8', 'triggerRatio: 0.85'), assetContentHash: hash, containerContentHash: hash, redacted: false }, diagnostics: [{ code: 'baseline_changed', severity: 'warning', message: '已发生外部变化' }] })

    renderAgent('/agents/zhouce?tab=context', state)
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.change(await screen.findByDisplayValue(80), { target: { value: '85' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('已被外部修改')
    expect(screen.getByRole('alert')).toHaveTextContent('Bandi 不会覆盖当前文件')
    expect(screen.getByDisplayValue(85)).toHaveValue(85)
    expect(screen.getByText(/triggerRatio: 0.9/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '基于当前内容重新编辑' })).toBeEnabled()
  })
})
