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
const packageFixtureState = structuredClone(initialState)

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
  it('使用 Agent 名称作为唯一页面一级标题', () => {
    renderAgent()

    expect(screen.getByRole('heading', { level: 1, name: '周策' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
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
      { kind: 'keep' },
    ))
    await waitFor(() => expect(screen.queryByDisplayValue('周策更新')).not.toBeInTheDocument())
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
      operation: { id: 'identity-retry-operation', agentId: agent.id, operationKind: 'identity_update', status: 'team_pending', createdAt: '2026-09-02T00:00:00Z' },
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
    expect(screen.getByRole('button', { name: '使用文件当前内容继续编辑' })).toBeEnabled()
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

  it('窄屏配置文件 Sheet 提供清晰层级、当前状态和键盘导航', async () => {
    renderAgent('/agents/zhouce?tab=package&path=config%2Frules.yaml', packageFixtureState)

    const trigger = screen.getByRole('button', { name: '选择文件' })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: '配置文件' })
    expect(dialog).toHaveClass('top-10', 'bottom-0')
    expect(dialog).not.toHaveClass('inset-y-0')
    expect(within(dialog).getByRole('tree')).toHaveClass('max-h-none', 'overflow-visible')
    expect(within(dialog).getByRole('tree')).not.toHaveClass('overflow-auto')
    expect(within(dialog).getByText('仅显示 Bandi 管理的配置文件')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('button', { name: '关闭' })).toHaveLength(1)
    expect(within(dialog).queryByText(/文件记录/)).not.toBeInTheDocument()

    const config = within(dialog).getByRole('treeitem', { name: 'config' })
    const rules = within(dialog).getByRole('treeitem', { name: 'rules.yaml' })
    expect(config).toHaveAttribute('aria-level', '1')
    expect(config).toHaveAttribute('aria-expanded', 'true')
    expect(rules).toHaveAttribute('aria-level', '2')
    expect(rules).toHaveAttribute('aria-selected', 'true')
    expect(rules).toHaveFocus()
    expect(within(config).getByRole('group')).toContainElement(rules)

    fireEvent.keyDown(rules, { key: 'ArrowLeft' })
    expect(config).toHaveFocus()
    fireEvent.keyDown(config, { key: 'ArrowLeft' })
    expect(config).toHaveAttribute('aria-expanded', 'false')
    expect(within(dialog).queryByRole('treeitem', { name: 'rules.yaml' })).not.toBeInTheDocument()
    fireEvent.keyDown(config, { key: 'ArrowRight' })
    expect(config).toHaveAttribute('aria-expanded', 'true')
  })

  it('选择或退出配置文件 Sheet 后恢复触发按钮焦点', async () => {
    const { router } = renderAgent('/agents/zhouce?tab=package&path=agent.yaml', packageFixtureState)
    const trigger = screen.getByRole('button', { name: '选择文件' })

    trigger.focus()
    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: '配置文件' })
    fireEvent.click(within(dialog).getByRole('treeitem', { name: 'instructions.md' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '配置文件' })).not.toBeInTheDocument())
    expect(router.state.location.search).toContain('path=instructions.md')
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    await screen.findByRole('dialog', { name: '配置文件' })
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '配置文件' })).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
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

  it('Desktop 长期 Memory 直接保存并采用服务端 revision', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = {
      ...initialState,
      runtime: 'desktop',
      agents: initialState.agents.map((item) => item.id === source.id ? {
        ...item,
        packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' },
      } : item),
    }
    const space = state.memorySpaces.find((item) => item.scopeKey.agentId === source.id)!
    const hash = `sha256:${'a'.repeat(64)}` as const
    const savedSpace = {
      id: space.id,
      scopeType: 'agent_long_term' as const,
      scopeKey: { kind: 'agent_long_term' as const, agentId: source.id },
      owner: { kind: 'agent' as const, agentId: source.id },
      visibilityPolicy: 'agent_private' as const,
      storageProfileVersion: 'memory-v4' as const,
      state: 'active' as const,
      storageLocator: { rootKind: 'managed' as const, displayPath: space.path, relativePath: 'memory/long-term.md' },
      currentRevisionId: 'memory-revision-19',
      contentHash: hash,
      updatedAt: '2026-09-09T00:00:00Z',
    }
    const save = vi.spyOn(desktopBridge, 'saveMemory').mockResolvedValue({
      kind: 'saved',
      requestId: 'save-memory',
      space: savedSpace,
      revision: {
        id: 'memory-revision-19',
        spaceId: space.id,
        parentRevisionId: space.revision,
        contentHash: hash,
        storageLocator: savedSpace.storageLocator,
        writeReceiptId: 'memory-write-19',
        writtenAt: savedSpace.updatedAt,
      },
      writeReceipt: {
        id: 'memory-write-19',
        containerId: space.id,
        previousContainerHash: hash,
        writtenContainerHash: hash,
        verifiedAt: savedSpace.updatedAt,
        atomicReplace: true,
      },
    })

    renderAgent('/agents/zhouce?tab=memory', state)
    fireEvent.change(screen.getByRole('textbox', { name: '长期记忆正文' }), { target: { value: '更新后的长期事实' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      spaceId: space.id,
      content: '更新后的长期事实',
    })))
    expect(await screen.findByRole('status')).toHaveTextContent('Agent 长期记忆已保存')
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
    const asset = { id: 'asset-1', containerId: 'container-1', kind: 'instructions', officialScope: 'managed', agentId: 'zhouce', teamId: 'xinghe', assetContentHash: `sha256:${'a'.repeat(64)}`, containerContentHash: `sha256:${'a'.repeat(64)}`, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
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
    const asset = { id: 'asset-1', containerId: 'container-1', kind: 'instructions', officialScope: 'managed', agentId: 'zhouce', teamId: 'xinghe', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
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
    const asset = { id: 'asset-1', containerId: 'container-1', kind: 'instructions', officialScope: 'managed', agentId: 'zhouce', teamId: 'xinghe', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
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
    expect(screen.getByRole('button', { name: '使用文件当前内容继续编辑' })).toBeEnabled()
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
    const asset = { id: 'context-asset', containerId: 'context-container', kind: 'context', officialScope: 'managed', agentId: 'zhouce', teamId: 'xinghe', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
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
      sharedAssets: [{ id: 'rule-common', name: '公共安全边界', kind: 'rule', teamId: 'xinghe', locator: { rootKind: 'bandi', displayPath: 'rule-common/RULE.md', relativePath: 'rule-common/RULE.md' }, contentHash: `sha256:${'4'.repeat(64)}`, containerContentHash: `sha256:${'4'.repeat(64)}`, writable: true, source: { kind: 'authored' }, parseStatus: 'parsed', diagnostics: [] }],
      agents: initialState.agents.map((item) => item.id === source.id ? {
        ...item,
        packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' },
        files: item.files.filter((file) => file.path !== 'config/rules.yaml'),
        ruleRefs: [],
      } : item),
    }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'5'.repeat(64)}` as const
    const asset = { id: 'rules-empty-asset', containerId: 'rules-empty-container', kind: 'rules', officialScope: 'managed', agentId: 'zhouce', teamId: 'xinghe', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [{ code: 'rules_not_materialized', severity: 'info', message: '尚未创建 rules.yaml' }] } satisfies import('../contracts').SourceAssetSummaryDto
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
    const asset = { id: 'rules-asset', containerId: 'rules-container', kind: 'rules', officialScope: 'managed', agentId: 'zhouce', teamId: 'xinghe', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
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
    expect(screen.getByText(/当前没有可引用的共享.*请先前往.*配置资产.*新增或导入/)).toBeInTheDocument()
  })

  it('Desktop 受管 Skills 通过发现、加载与真实保存闭环', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' }, skillRefs: ['skill-review'] } : item) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'7'.repeat(64)}` as const
    const asset = { id: 'skills-asset', containerId: 'skills-container', kind: 'skills', officialScope: 'managed', agentId: 'zhouce', teamId: 'xinghe', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
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
    const asset = { id: 'mcp-asset', containerId: 'mcp-container', kind: 'mcp', officialScope: 'managed', agentId: 'zhouce', teamId: 'xinghe', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
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
    expect(screen.getByText(/当前没有可引用的共享.*请先前往.*配置资产.*新增或导入/)).toBeInTheDocument()
  })

  it('Desktop 受管 SOP 通过发现、加载与真实保存闭环', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' }, sopRefs: ['sop-delivery'] } : item) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'d'.repeat(64)}` as const
    const asset = { id: 'sop-asset', containerId: 'sop-container', kind: 'sop', officialScope: 'managed', agentId: 'zhouce', teamId: 'xinghe', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
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

  it('权限页说明长期边界与终端执行期授权的区别', () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(false)

    renderAgent('/agents/zhouce?tab=permissions')

    expect(screen.getByText('长期权限')).toBeInTheDocument()
    expect(screen.getByText(/当前任务中的工具调用，仍需在你选择的 AI 编程工具中授权/)).toBeInTheDocument()
    expect(screen.getByText(/不会写入真实配置或批准工具调用/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '调整长期权限' })).toBeInTheDocument()
  })

  it('Desktop Permissions 在双 Agent 发现结果中只加载当前 Agent 容器', async () => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const other = initialState.agents.find((item) => item.id !== source.id)!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => ({ ...item, packageSource: { kind: 'bandi-managed', packageId: `agt_${item.id}`, strategy: 'managed' } })) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'3'.repeat(64)}` as const
    const otherAsset = { id: 'permissions-other', containerId: 'permissions-other-container', kind: 'permissions', officialScope: 'managed', agentId: 'zhouce', teamId: 'xinghe', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
    const currentAsset = { ...otherAsset, id: 'permissions-current', containerId: 'permissions-current-container' }
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({ requestId: 'discover-permissions-dual', profileVersion: 'agent-package-v1', containers: [
      { id: otherAsset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/other-permissions.yaml', relativePath: `agt_${other.id}/config/permissions.yaml` }, format: 'yaml', contentHash: hash, writable: true },
      { id: currentAsset.containerId, locator: { rootKind: 'managed', displayPath: '/tmp/current-permissions.yaml', relativePath: 'agt_zhouce/config/permissions.yaml' }, format: 'yaml', contentHash: hash, writable: true },
    ], assets: [otherAsset, currentAsset], sharedAssets: [], references: [], diagnostics: [] })
    const load = vi.spyOn(desktopBridge, 'loadConfigEditor').mockResolvedValue({ requestId: 'load-current', asset: currentAsset, canonicalContent: 'schemaVersion: 1\npermissions:\n  files: "仅当前工作区"\n  commands: "构建、测试与版本控制"\n  network: "仅已配置 MCP"\n  delegation: "仅明确服务授权范围"', redacted: false, baselineRef: { id: 'base-current', assetId: currentAsset.id, containerId: currentAsset.containerId, assetContentHash: hash, containerContentHash: hash }, diagnostics: [] })

    renderAgent('/agents/zhouce?tab=permissions', state)
    fireEvent.click(screen.getByRole('button', { name: '调整长期权限' }))

    await waitFor(() => expect(load).toHaveBeenCalledWith({ requestId: 'load-permissions-zhouce', assetId: currentAsset.id }))
    expect(screen.getByLabelText('文件写入')).toHaveValue('仅当前工作区')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([
    ['缺失', [], [], /未发现该 Agent 的可编辑 Permissions 资产/],
    ['歧义', ['permissions-a', 'permissions-b'], ['container-a', 'container-b'], /Permissions 资产.*定位存在歧义/],
  ])('Desktop Permissions 定位%s时拒绝进入编辑', async (_case, assetIds, containerIds, message) => {
    const source = initialState.agents.find((item) => item.id === 'zhouce')!
    const state: State = { ...initialState, agents: initialState.agents.map((item) => item.id === source.id ? { ...item, packageSource: { kind: 'bandi-managed', packageId: 'agt_zhouce', strategy: 'managed' } } : item) }
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'4'.repeat(64)}` as const
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({ requestId: 'discover-permissions-error', profileVersion: 'agent-package-v1', containers: containerIds.map((id) => ({ id, locator: { rootKind: 'managed' as const, displayPath: `/tmp/${id}.yaml`, relativePath: 'agt_zhouce/config/permissions.yaml' }, format: 'yaml' as const, contentHash: hash, writable: true })), assets: assetIds.map((id, index) => ({ id, containerId: containerIds[index], agentId: 'zhouce', teamId: 'xinghe', kind: 'permissions' as const, officialScope: 'managed' as const, assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed' as const, diagnostics: [] })), sharedAssets: [], references: [], diagnostics: [] })
    const load = vi.spyOn(desktopBridge, 'loadConfigEditor')

    renderAgent('/agents/zhouce?tab=permissions', state)
    fireEvent.click(screen.getByRole('button', { name: '调整长期权限' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByLabelText('文件写入')).not.toBeInTheDocument()
    expect(load).not.toHaveBeenCalled()
  })

  it('纯 Web Permissions 保持页面内存保存到当前页面边界', async () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(false)
    const save = vi.spyOn(desktopBridge, 'saveConfig')

    renderAgent('/agents/zhouce?tab=permissions')
    fireEvent.click(screen.getByRole('button', { name: '调整长期权限' }))
    fireEvent.change(screen.getByLabelText('文件写入'), { target: { value: '任意目录' } })
    fireEvent.click(screen.getByRole('button', { name: '保存到当前页面' }))

    const dialog = await screen.findByRole('dialog', { name: '确认扩大 Agent 长期权限' })
    expect(within(dialog).getByText(/仅在当前页面更新/)).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText(/输入 Agent 名称/), { target: { value: '周策' } })
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: '确认扩大长期权限' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '确认扩大 Agent 长期权限' })).not.toBeInTheDocument())
    expect(save).not.toHaveBeenCalled()
    expect(screen.getByText('任意目录')).toBeInTheDocument()
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
                formalMemory: [],
        automaticCleanup: [{ id: 'agent_indexes', label: 'Agent 索引', detail: '将自动清理 1 项' }],
        historyAndBackups: [{ id: 'config_revisions', label: '配置版本', detail: '将删除 3 个配置版本；已有备份不受影响' }],
        blockers: [],
      },
      canCommit: true,
    })
    const commit = vi.spyOn(desktopBridge, 'commitManagedAgentDeletion').mockResolvedValue({ requestId: 'delete-agent-zhouce-fixed', agentId: 'zhouce', operationId: 'operation-delete-zhouce', createdAt: '2026-09-03T10:00:00Z', status: 'completed', deletedConfigRevisions: 3, pendingCleanup: [] })

    const { router } = renderAgent('/agents/zhouce', state)
    fireEvent.click(screen.getByRole('button', { name: '预览永久删除影响' }))
    const dialog = await screen.findByRole('dialog', { name: '永久删除 周策' })
    await waitFor(() => expect(preview).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'zhouce' })))
    expect(within(dialog).getByText(/已有备份不受影响/)).toBeInTheDocument()
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
      impacts: { sharedAssetReferences: [], organizationRelationships: [], formalMemory: [], automaticCleanup: [], historyAndBackups: [], blockers: [] },
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
      impacts: { sharedAssetReferences: [], organizationRelationships: [], formalMemory: [], automaticCleanup: [], historyAndBackups: [], blockers: [{ id: 'agent_static_reference:other-agent', label: '删除阻止项', detail: 'agent_static_reference:other-agent', remediation: '先移除其他 AgentPackage 中的静态引用。' }] },
    })
    const commit = vi.spyOn(desktopBridge, 'commitManagedAgentDeletion')

    renderAgent('/agents/zhouce', state)
    fireEvent.click(screen.getByRole('button', { name: '预览永久删除影响' }))
    const dialog = await screen.findByRole('dialog', { name: '永久删除 周策' })
    expect(await within(dialog).findByText('agent_static_reference:other-agent')).toBeInTheDocument()
    expect(within(dialog).getByText('处理建议：先移除其他 AgentPackage 中的静态引用。')).toBeInTheDocument()
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
      .mockResolvedValueOnce({ requestId: 'blocked', agentId: 'zhouce', previewRef: 'blocked', confirmationText: '永久删除 周策', expiresAt, packageFingerprint: 'sha256:package', canCommit: false, impacts: { sharedAssetReferences: [], organizationRelationships: [], formalMemory: [], automaticCleanup: [], historyAndBackups: [], blockers: [{ id: 'blocker', label: '阻塞项', detail: '仍被引用' }] } })
      .mockImplementationOnce(async (request) => ({ requestId: request.requestId, agentId: 'zhouce', previewRef: 'ready', confirmationText: '永久删除 周策', expiresAt, packageFingerprint: 'sha256:package', canCommit: true, impacts: { sharedAssetReferences: [], organizationRelationships: [], formalMemory: [], automaticCleanup: [], historyAndBackups: [], blockers: [] } }))

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
    vi.spyOn(desktopBridge, 'previewManagedAgentDeletion').mockResolvedValue({ requestId: 'changed', agentId: 'zhouce', previewRef: 'changed', confirmationText: '永久删除 周策', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), packageFingerprint: 'sha256:package', canCommit: true, impacts: { sharedAssetReferences: [], organizationRelationships: [], formalMemory: [], automaticCleanup: [], historyAndBackups: [], blockers: [] } })
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
    vi.spyOn(desktopBridge, 'previewManagedAgentDeletion').mockResolvedValue({ requestId: 'delete-fails', agentId: 'zhouce', previewRef: 'fails-preview', confirmationText: '永久删除 周策', expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(), packageFingerprint: 'sha256:package', canCommit: true, impacts: { sharedAssetReferences: [], organizationRelationships: [], formalMemory: [], automaticCleanup: [], historyAndBackups: [], blockers: [] } })
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
    const asset = { id: 'context-asset', containerId: 'context-container', kind: 'context', officialScope: 'managed', agentId: 'zhouce', teamId: 'xinghe', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] } satisfies import('../contracts').SourceAssetSummaryDto
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
    expect(screen.getByRole('button', { name: '使用文件当前内容继续编辑' })).toBeEnabled()
  })
})
