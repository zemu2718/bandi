// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssetDetailPage, AssetsPage } from '../pages/assets/asset-pages'
import { AppProvider, initialState } from '../state'
import * as desktopBridge from '../desktop-bridge'

const NativeRequest = globalThis.Request

beforeEach(() => {
  vi.stubGlobal('Request', class extends NativeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, { ...init, signal: undefined })
    }
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderPage(initialEntry = '/assets') {
  const router = createMemoryRouter([{ path: '/assets', element: <AppProvider initialState={initialState}><AssetsPage /></AppProvider> }], { initialEntries: [initialEntry] })
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('资产索引', () => {
  it('Desktop 只读展示真实发现事实且不提供演示写入入口', async () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'a'.repeat(64)}` as const
    const discover = vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({
      requestId: 'discover-assets',
      profileVersion: 'agent-package-v1',
      containers: [{ id: 'container-1', locator: { rootKind: 'managed', displayPath: 'config/skills.yaml', relativePath: 'config/skills.yaml' }, format: 'yaml', contentHash: hash, writable: true }],
      sharedAssets: [{ id: 'shared-review', kind: 'skill', teamId: 'xinghe', locator: { rootKind: 'bandi', displayPath: 'shared/skills/review', relativePath: 'skills/review' }, contentHash: hash, parseStatus: 'parsed', diagnostics: [] }],
      assets: [{ id: 'asset-skills', containerId: 'container-1', kind: 'skills', officialScope: 'managed', agentId: 'zhouce', teamId: 'xinghe', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] }, { id: 'asset-invalid', containerId: 'container-1', kind: 'rules', officialScope: 'managed', agentId: 'zhouce', teamId: 'xinghe', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'invalid', diagnostics: [] }, { id: 'other-team', containerId: 'container-1', kind: 'mcp', officialScope: 'managed', agentId: 'other', teamId: 'studio', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] }],
      references: [{ sourceAssetId: 'asset-skills', sourceContainerId: 'container-1', referrerKind: 'agent', referrerId: 'zhouce', targetAssetId: 'skill-review', targetKind: 'skill', state: 'unresolved', sourcePath: 'config/skills.yaml' }],
      diagnostics: [{ code: 'shared_asset_root_not_initialized', severity: 'info', message: '共享资产根未初始化', remediation: '在设置中启用共享资产', path: 'shared/assets', source: 'shared-root' }],
    })

    renderPage()

    expect((await screen.findAllByText('skills.yaml')).length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('config/skills.yaml').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('其他说明 1 项')).toBeInTheDocument()
    expect(screen.getByText('共享资产根未初始化')).not.toBeVisible()
    expect(screen.getAllByText(/1 项需处理/, { exact: false }).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/技能/, { exact: false }).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('review')).toBeInTheDocument()
    expect(screen.queryByText('other-team')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /shared-review/ })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '概览 3' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Skills 2' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'MCP 0' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('筛选'))
    expect(screen.getByRole('option', { name: '配置有误' })).toHaveValue('invalid')
    expect(screen.getByText('asset-skills')).not.toBeVisible()
    expect(screen.getAllByText('Bandi 可在受控范围内写入')[0]).not.toBeVisible()
    expect(discover).toHaveBeenCalledWith(expect.objectContaining({ includeClaudeUserRoot: false }))
    fireEvent.click(screen.getAllByText('skills.yaml')[0])
    expect(screen.getByText('asset-skills')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '打开 周策 的技能配置' })).toHaveAttribute('href', '/agents/zhouce?tab=skills')
    expect(screen.queryByRole('button', { name: '新建演示资产' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /管理.*Skills/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /扫描|导入|新增|更新|安装/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'MCP 0' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'MCP 0' })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByText('当前 Team 还没有 MCP 配置')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Skills 2' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Skills 2' })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.queryByText('rules.yaml')).not.toBeInTheDocument()
    expect(screen.getAllByText('skills.yaml').length).toBeGreaterThanOrEqual(1)

    const skillsTab = screen.getByRole('tab', { name: 'Skills 2' })
    fireEvent.keyDown(skillsTab, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'MCP 0' })).toHaveFocus())
    fireEvent.keyDown(screen.getByRole('tab', { name: 'MCP 0' }), { key: 'Home' })
    await waitFor(() => expect(screen.getByRole('tab', { name: '概览 3' })).toHaveFocus())
    fireEvent.keyDown(screen.getByRole('tab', { name: '概览 3' }), { key: 'End' })
    await waitFor(() => expect(screen.getByRole('tab', { name: '其他 0' })).toHaveFocus())

    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(discover).toHaveBeenCalledTimes(2))
  })

  it('Desktop 支持分类深链、非法分类回退和清除筛选保留分类', async () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'b'.repeat(64)}` as const
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({
      requestId: 'discover-assets',
      profileVersion: 'agent-package-v1',
      containers: [{ id: 'container-mcp', locator: { rootKind: 'managed', displayPath: 'config/mcp.yaml', relativePath: 'config/mcp.yaml' }, format: 'yaml', contentHash: hash, writable: true }],
      sharedAssets: [],
      assets: [{ id: 'asset-mcp', containerId: 'container-mcp', kind: 'mcp', officialScope: 'managed', agentId: 'zhouce', teamId: 'xinghe', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] }],
      references: [],
      diagnostics: [],
    })

    const { router, unmount } = renderPage('/assets?tab=mcp&q=missing')
    expect(await screen.findByRole('tab', { name: 'MCP 1' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('没有匹配的配置资产')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    await waitFor(() => expect(router.state.location.search).toBe('?tab=mcp'))
    expect(await screen.findByText('mcp.yaml')).toBeInTheDocument()
    unmount()

    renderPage('/assets?tab=unknown')
    expect(await screen.findByRole('tab', { name: '概览 1' })).toHaveAttribute('aria-selected', 'true')
  })

  it('Desktop 区分未发现资产和筛选无结果', async () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({
      requestId: 'discover-assets',
      profileVersion: 'agent-package-v1',
      containers: [],
      sharedAssets: [],
      assets: [],
      references: [],
      diagnostics: [],
    })

    renderPage('/assets?q=missing')
    expect(await screen.findByText('还没有可查看的配置资产')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '搜索配置资产' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '清除筛选' })).not.toBeInTheDocument()
  })

  it('Web 保留明确的页面内存演示入口且不调用 discovery', () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(false)
    const discover = vi.spyOn(desktopBridge, 'discoverConfig')

    renderPage()

    expect(screen.getByRole('button', { name: '新建演示资产' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '管理演示技能' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '技能' })).toHaveValue('Skill')
    expect(discover).not.toHaveBeenCalled()
  })

  it('SOP 编辑字段有可见标签、错误关联和零步骤空态', () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(false)
    const emptySop = { ...initialState.assets.find((asset) => asset.kind === 'SOP')!, id: 'empty-sop', steps: [] }
    const router = createMemoryRouter([{ path: '/assets/:id', element: <AppProvider initialState={{ ...initialState, assets: [...initialState.assets, emptySop] }}><AssetDetailPage /></AppProvider> }], { initialEntries: ['/assets/empty-sop?tab=steps'] })
    render(<RouterProvider router={router} />)
    expect(screen.getByText('还没有 SOP 步骤')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '编辑 SOP' }))
    fireEvent.click(screen.getByRole('button', { name: '添加步骤' }))
    expect(screen.getByLabelText('标题')).toBeInTheDocument()
    expect(screen.getByLabelText('目标')).toBeInTheDocument()
    expect(screen.getByLabelText('责任主体')).toHaveAttribute('aria-describedby', expect.stringMatching(/owner-error$/))
    expect(screen.getByLabelText('依赖步骤 ID（逗号分隔）')).toBeInTheDocument()
  })
})
