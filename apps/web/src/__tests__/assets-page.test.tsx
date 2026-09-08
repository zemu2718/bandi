// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssetDetailPage, AssetsPage } from '../pages/assets/asset-pages'
import { AppProvider, initialState } from '../state'
import * as desktopBridge from '../desktop-bridge'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderPage(initialEntry = '/assets') {
  const router = createMemoryRouter([{ path: '/assets', element: <AppProvider initialState={initialState}><AssetsPage /></AppProvider> }], { initialEntries: [initialEntry] })
  return render(<RouterProvider router={router} />)
}

describe('资产索引', () => {
  it('Desktop 只读展示真实发现事实且不提供演示写入入口', async () => {
    vi.spyOn(desktopBridge, 'isDesktopRuntime').mockReturnValue(true)
    const hash = `sha256:${'a'.repeat(64)}` as const
    const discover = vi.spyOn(desktopBridge, 'discoverConfig').mockResolvedValue({
      requestId: 'discover-assets',
      profileVersion: 'agent-package-v1',
      containers: [{ id: 'container-1', locator: { rootKind: 'managed', displayPath: 'config/skills.yaml', relativePath: 'config/skills.yaml' }, format: 'yaml', contentHash: hash, writable: true }],
      sharedAssets: [],
      assets: [{ id: 'asset-skills', containerId: 'container-1', kind: 'skills', officialScope: 'managed', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'parsed', diagnostics: [] }, { id: 'asset-invalid', containerId: 'container-1', kind: 'rules', officialScope: 'managed', assetContentHash: hash, containerContentHash: hash, writable: true, parseStatus: 'invalid', diagnostics: [] }],
      references: [{ sourceAssetId: 'asset-skills', sourceContainerId: 'container-1', referrerKind: 'agent', referrerId: 'zhouce', targetAssetId: 'skill-review', targetKind: 'skill', state: 'unresolved', sourcePath: 'config/skills.yaml' }],
      diagnostics: [{ code: 'shared_asset_root_not_initialized', severity: 'info', message: '共享资产根未初始化', remediation: '在设置中启用共享资产', path: 'shared/assets', source: 'shared-root' }],
    })

    renderPage()

    expect((await screen.findAllByText('skills.yaml')).length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('config/skills.yaml').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('说明 1 项')).toBeInTheDocument()
    expect(screen.getByText('共享资产根未初始化')).toBeInTheDocument()
    expect(screen.getByText('1 项需处理')).toBeInTheDocument()
    expect(screen.getAllByText('技能')).toHaveLength(2)
    expect(screen.getByRole('option', { name: '配置有误' })).toHaveValue('invalid')
    expect(screen.getByText('asset-skills')).not.toBeVisible()
    expect(screen.getAllByText('Bandi 可在受控范围内写入')).toHaveLength(2)
    expect(screen.getAllByText('Bandi 可在受控范围内写入')[0]).not.toBeVisible()
    expect(discover).toHaveBeenCalledWith(expect.objectContaining({ includeClaudeUserRoot: false }))
    expect(screen.getByText('共享资产尚未启用，不影响查看受管 Agent 配置')).toBeInTheDocument()
    expect(screen.getByText('共享资产根未初始化')).toBeInTheDocument()
    expect(screen.getByText('处理建议：在设置中启用共享资产')).toBeInTheDocument()
    expect(screen.getAllByText(/代码：shared_asset_root_not_initialized/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/路径：shared\/assets/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/来源：shared-root/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByText('查看详情')[0])
    expect(screen.getByText('asset-skills')).toBeInTheDocument()
    expect(screen.getAllByText('Bandi 可在受控范围内写入')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: '新建演示资产' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /管理.*Skills/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '刷新索引' }))
    await waitFor(() => expect(discover).toHaveBeenCalledTimes(2))
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

    const first = renderPage()
    expect(await screen.findByText('尚未发现受管资产')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '清除筛选' })).not.toBeInTheDocument()
    first.unmount()

    renderPage('/assets?q=missing')
    expect(await screen.findByText('没有匹配的资产')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '清除筛选' })).toBeInTheDocument()
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
