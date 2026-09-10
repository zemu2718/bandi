// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssetDetailPage, AssetsPage } from '../pages/assets/asset-pages'
import { AppProvider, initialState } from '../state'
import * as desktopBridge from '../desktop-bridge'
import type { DiscoveryResult } from '../contracts'

const NativeRequest = globalThis.Request
const hash = `sha256:${'a'.repeat(64)}` as const
const result = (changes: Partial<DiscoveryResult> = {}): DiscoveryResult => ({
  requestId: 'discover-assets', profileVersion: 'agent-package-v1', containers: [], assets: [],
  sharedAssets: [{ id: 'shared-review', name: '代码审查', kind: 'skill', teamId: 'xinghe', locator: { rootKind: 'bandi', displayPath: 'shared-review/SKILL.md', relativePath: 'shared-review/SKILL.md' }, contentHash: hash, containerContentHash: hash, writable: true, source: { kind: 'authored' }, currentRevisionId: 'revision-1', parseStatus: 'parsed', diagnostics: [] }],
  references: [{ sourceAssetId: 'asset-skills', sourceContainerId: 'container-1', referrerKind: 'agent', referrerId: 'zhouce', targetAssetId: 'shared-review', targetKind: 'skill', state: 'resolved', targetTeamId: 'xinghe', sourcePath: 'config/skills.yaml' }], diagnostics: [], ...changes,
})

beforeEach(() => { vi.stubGlobal('Request', class extends NativeRequest { constructor(input: RequestInfo | URL, init?: RequestInit) { super(input, { ...init, signal: undefined }) } }) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function renderPage(initialEntry = '/assets') {
  const router = createMemoryRouter([{ path: '/assets', element: <AppProvider initialState={initialState}><AssetsPage /></AppProvider> }], { initialEntries: [initialEntry] })
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('资产索引', () => {
  it('Desktop 只展示独立共享资产、真实操作和去重后的 Agent 使用关系', async () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const discover = vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue(result({
      assets: [{ id: 'asset-skills', containerId: 'container-1', kind: 'skills', officialScope: 'managed', agentId: 'zhouce', teamId: 'xinghe', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] }],
      references: [...result().references, { ...result().references[0], sourceAssetId: 'asset-skills-copy' }],
    }))
    renderPage()
    expect(await screen.findByText('代码审查')).toBeInTheDocument()
    expect(screen.queryByText('skills.yaml')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '概览 1' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Skills 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '扫描资产' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入文件' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新增资产' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('代码审查'))
    expect(screen.getByText('1 个 Agent 使用')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '周策' })).toHaveAttribute('href', '/agents/zhouce?tab=skills&asset=shared-review')
    fireEvent.click(screen.getByRole('button', { name: '扫描资产' }))
    await waitFor(() => expect(discover).toHaveBeenCalledTimes(2))
    expect(discover).toHaveBeenCalledWith(expect.objectContaining({ includeClaudeUserRoot: false }))
  })

  it('Desktop 保留分类深链、搜索、筛选和键盘切换', async () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue(result())
    const { router } = renderPage('/assets?tab=skills&q=missing')
    expect(await screen.findByRole('tab', { name: 'Skills 1' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('没有匹配的共享资产')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }))
    await waitFor(() => expect(router.state.location.search).toBe('?tab=skills'))
    expect(screen.getByText('代码审查')).toBeInTheDocument()
    const tab = screen.getByRole('tab', { name: 'Skills 1' }); fireEvent.keyDown(tab, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'MCP 0' })).toHaveFocus())
  })

  it('Desktop 空资产池可直接新增，不要求先创建 Agent', async () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue(result({ sharedAssets: [], references: [] }))
    renderPage()
    expect(await screen.findByText('共享资产池还是空的')).toBeInTheDocument()
    expect(screen.queryByText('当前 Team 还没有 Agent')).not.toBeInTheDocument()
  })

  it('Desktop 新增 Dialog 有可见标签、错误关联并调用真实 bridge 后刷新', async () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const discover = vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue(result({ sharedAssets: [], references: [] }))
    const create = vi.spyOn(desktopBridge, 'createSharedAsset').mockResolvedValue({ kind: 'saved', requestId: 'create', asset: result().sharedAssets[0], revision: {} as never, writeReceipt: {} as never })
    renderPage(); await screen.findByText('共享资产池还是空的')
    fireEvent.click(screen.getAllByRole('button', { name: '新增资产' })[0])
    expect(screen.getByLabelText('类型')).toBeInTheDocument(); expect(screen.getByLabelText('名称')).toBeInTheDocument(); expect(screen.getByLabelText('稳定标识')).toBeInTheDocument(); expect(screen.getByLabelText('正文')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '创建资产' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请填写名称')
    expect(screen.getByLabelText('稳定标识')).toHaveAttribute('aria-describedby', 'create-shared-error')
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '代码审查' } }); fireEvent.change(screen.getByLabelText('稳定标识'), { target: { value: 'skill-review' } }); fireEvent.change(screen.getByLabelText('正文'), { target: { value: '# Review' } }); fireEvent.click(screen.getByRole('button', { name: '创建资产' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'xinghe', assetId: 'skill-review', kind: 'skill' })))
    await waitFor(() => expect(discover).toHaveBeenCalledTimes(2))
  })

  it('Web 保留明确的页面内存演示入口且不调用 discovery', () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(false); const discover = vi.spyOn(desktopBridge, 'discoverConfig'); renderPage()
    expect(screen.getByRole('button', { name: '新建演示资产' })).toBeInTheDocument(); expect(screen.getByRole('link', { name: '管理演示技能' })).toBeInTheDocument(); expect(discover).not.toHaveBeenCalled()
  })

  it('SOP 编辑字段有可见标签、错误关联和零步骤空态', () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(false)
    const emptySop = { ...initialState.assets.find((asset) => asset.kind === 'SOP')!, id: 'empty-sop', steps: [] }
    const router = createMemoryRouter([{ path: '/assets/:id', element: <AppProvider initialState={{ ...initialState, assets: [...initialState.assets, emptySop] }}><AssetDetailPage /></AppProvider> }], { initialEntries: ['/assets/empty-sop?tab=steps'] })
    render(<RouterProvider router={router} />); expect(screen.getByText('还没有 SOP 步骤')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: '编辑 SOP' })); fireEvent.click(screen.getByRole('button', { name: '添加步骤' })); expect(screen.getByLabelText('责任主体')).toHaveAttribute('aria-describedby', expect.stringMatching(/owner-error$/))
  })
})
