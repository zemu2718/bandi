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
    expect(screen.getByRole('button', { name: '刷新 Bandi 资产' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入资产' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新增资产' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('代码审查'))
    expect(screen.getByText('1 个 Agent 使用')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '周策' })).toHaveAttribute('href', '/agents/zhouce?tab=skills&asset=shared-review')
    fireEvent.click(screen.getByRole('button', { name: '刷新 Bandi 资产' }))
    await waitFor(() => expect(discover).toHaveBeenCalledTimes(2))
    expect(discover).toHaveBeenCalledWith({ requestId: 'discover-assets' })
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
    expect(await screen.findByText('星河科技还没有资产')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '新增资产' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '导入资产' })).toHaveLength(1)
    expect(screen.getByRole('tab', { name: 'Bandi 资产' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: '概览 0' })).not.toBeInTheDocument()
    expect(screen.queryByText('全部资产')).not.toBeInTheDocument()
    expect(screen.queryByText('关于 Bandi 资产')).not.toBeInTheDocument()
    expect(screen.queryByText('当前 Team 还没有 Agent')).not.toBeInTheDocument()
  })

  it('Desktop 新增 Dialog 有可见标签、错误关联并调用真实 bridge 后刷新', async () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const discover = vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue(result({ sharedAssets: [], references: [] }))
    const create = vi.spyOn(desktopBridge, 'createSharedAsset').mockResolvedValue({ kind: 'saved', requestId: 'create', asset: result().sharedAssets[0], revision: {} as never, writeReceipt: {} as never })
    renderPage(); await screen.findByText('星河科技还没有资产')
    fireEvent.click(screen.getByRole('button', { name: '新增资产' }))
    expect(screen.getByLabelText('类型')).toBeInTheDocument(); expect(screen.getByLabelText('名称')).toBeInTheDocument(); expect(screen.getByLabelText('稳定标识')).toBeInTheDocument(); expect(screen.getByLabelText('正文')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '创建资产' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请填写名称')
    expect(screen.getByLabelText('稳定标识')).toHaveAttribute('aria-describedby', 'create-shared-error')
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '代码审查' } }); fireEvent.change(screen.getByLabelText('稳定标识'), { target: { value: 'skill-review' } }); fireEvent.change(screen.getByLabelText('正文'), { target: { value: '# Review' } }); fireEvent.click(screen.getByRole('button', { name: '创建资产' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'xinghe', assetId: 'skill-review', kind: 'skill' })))
    await waitFor(() => expect(discover).toHaveBeenCalledTimes(2))
  })

  it('外部工具只在用户触发后扫描，展示 Logo 和可用操作，并在重扫失败时清除旧结果', async () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue(result())
    const capabilities = { canScan: true, canReadEntrypoint: true, canImportToBandi: true, canInstallFromBandi: false, canUpdateFromBandi: false }
    vi.spyOn(desktopBridge, 'listHostAssetCatalog').mockResolvedValue({ tools: [
      { toolId: 'claude-code', supportLevel: 'supported', reasonCode: 'supported', capabilities },
      { toolId: 'claude-desktop', supportLevel: 'unsupported', reasonCode: 'official_ui_only', capabilities: { canScan: false, canReadEntrypoint: false, canImportToBandi: false, canInstallFromBandi: false, canUpdateFromBandi: false } },
    ] })
    const packageInfo = { containerKind: 'directory' as const, entrypoint: 'SKILL.md', packageFingerprint: hash, entrypointHash: hash, fileCount: 1, totalBytes: 128 }
    const scan = vi.spyOn(desktopBridge, 'scanHostAssets')
      .mockResolvedValueOnce({
        requestId: 'scan-1', scanGeneration: 'generation-1', diagnostics: [],
        tools: [{ toolId: 'claude-code', supportLevel: 'supported', reasonCode: 'supported', capabilities, checkState: 'ready', assetCount: 2, diagnostics: [] }],
        assets: [
          { hostInstanceId: 'instructions-1', toolId: 'claude-code', rootId: 'instructions', packageKey: 'CLAUDE.md', name: 'Claude Code Instructions', kind: 'instructions', relativeLocation: 'CLAUDE.md', package: { ...packageInfo, containerKind: 'file', entrypoint: 'CLAUDE.md' }, parseStatus: 'parsed', diagnostics: [] },
          { hostInstanceId: 'skill-1', toolId: 'claude-code', rootId: 'skills', packageKey: 'review', name: '代码审查 Skill', kind: 'skill', relativeLocation: 'skills/review', package: packageInfo, parseStatus: 'parsed', diagnostics: [] },
        ],
      })
      .mockRejectedValueOnce(new Error('scan failed'))
    const { container } = renderPage('/assets?tab=external')
    expect(await screen.findByText('尚未扫描外部工具')).toBeInTheDocument()
    expect(screen.getByText(/不提供扫描/)).toBeInTheDocument()
    expect(container.querySelectorAll('img')).toHaveLength(2)
    expect(scan).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '扫描所选工具' }))
    expect(await screen.findByText('代码审查 Skill')).toBeInTheDocument()
    expect(scan).toHaveBeenCalledWith({ requestId: expect.any(String), toolIds: ['claude-code'] })
    expect(screen.getByText('Claude Code Instructions')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '查看资产' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: '导入到 Bandi' })).toHaveLength(1)
    expect(container.querySelectorAll('img')).toHaveLength(4)

    fireEvent.click(screen.getByRole('button', { name: '重新扫描' }))
    expect(await screen.findByText('扫描未完成')).toBeInTheDocument()
    expect(screen.queryByText('代码审查 Skill')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '导入到 Bandi' })).not.toBeInTheDocument()
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
