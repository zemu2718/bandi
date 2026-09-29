// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostAssetSummaryDto } from '../contracts'
import * as desktopBridge from '../desktop-bridge'
import { HostAssetImportDialog } from '../pages/assets/host-asset-management'

vi.mock('../desktop-bridge', () => ({
  previewHostAssetImport: vi.fn(),
  commitHostAssetImport: vi.fn(),
  repairSharedAssetRegistration: vi.fn(),
  recoverSharedAssetRevision: vi.fn(),
}))

const hash = `sha256:${'a'.repeat(64)}` as const
const asset: HostAssetSummaryDto = {
  hostInstanceId: 'host-review',
  toolId: 'claude-code',
  rootId: 'skills',
  packageKey: 'Code Review / 中文',
  name: '代码审查',
  kind: 'skill',
  relativeLocation: 'skills/review',
  package: { containerKind: 'directory', entrypoint: 'SKILL.md', packageFingerprint: hash, entrypointHash: hash, fileCount: 1, totalBytes: 128 },
  parseStatus: 'parsed',
  diagnostics: [],
}

const preview = {
  requestId: 'preview-request',
  hostInstanceId: asset.hostInstanceId,
  scanGeneration: 'scan-1',
  action: 'import' as const,
  teamId: 'team-product',
  assetId: 'custom-review',
  previewRef: 'preview-1',
  expiresAt: '2026-09-10T12:00:00Z',
  confirmationText: '确认导入代码审查',
  sourceFingerprint: hash,
  diagnostics: [],
}

function renderDialog(open = true) {
  const props = { asset, scanGeneration: 'scan-1', teamId: 'team-product', open, onOpenChange: vi.fn(), onSaved: vi.fn().mockResolvedValue(undefined) }
  return { ...render(<HostAssetImportDialog {...props} />), props }
}

beforeEach(() => {
  vi.mocked(desktopBridge.previewHostAssetImport).mockReset().mockResolvedValue(preview)
  vi.mocked(desktopBridge.commitHostAssetImport).mockReset()
  vi.mocked(desktopBridge.repairSharedAssetRegistration).mockReset()
  vi.mocked(desktopBridge.recoverSharedAssetRevision).mockReset()
})

afterEach(cleanup)

describe('外部资产导入 Dialog', () => {
  it('提交用户编辑后的 canonical assetId', async () => {
    renderDialog()
    const input = await screen.findByLabelText('Bandi 资产标识')
    expect(input).toHaveValue('code-review')

    fireEvent.change(input, { target: { value: 'custom-review' } })
    fireEvent.click(screen.getByRole('button', { name: '预览导入' }))

    await waitFor(() => expect(desktopBridge.previewHostAssetImport).toHaveBeenCalledWith(expect.objectContaining({
      hostInstanceId: 'host-review', scanGeneration: 'scan-1', action: 'import', teamId: 'team-product', assetId: 'custom-review',
    })))
    expect(await screen.findByText('确认导入代码审查')).toBeInTheDocument()
  })

  it('关闭并重开时清除预览和旧输入', async () => {
    const { rerender, props } = renderDialog()
    const input = await screen.findByLabelText('Bandi 资产标识')
    fireEvent.change(input, { target: { value: 'old-value' } })
    fireEvent.click(screen.getByRole('button', { name: '预览导入' }))
    expect(await screen.findByText('确认导入代码审查')).toBeInTheDocument()

    rerender(<HostAssetImportDialog {...props} open={false} />)
    rerender(<HostAssetImportDialog {...props} open />)

    expect(await screen.findByLabelText('Bandi 资产标识')).toHaveValue('code-review')
    expect(screen.queryByText('确认导入代码审查')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '预览导入' })).toBeInTheDocument()
  })

  it('确认导入期间阻止重复提交并在成功后刷新', async () => {
    let resolveCommit!: (value: Awaited<ReturnType<typeof desktopBridge.commitHostAssetImport>>) => void
    vi.mocked(desktopBridge.commitHostAssetImport).mockReturnValue(new Promise((resolve) => { resolveCommit = resolve }))
    const { props } = renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: '预览导入' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认导入' }))
    expect(screen.getByRole('button', { name: '正在导入…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '正在导入…' }))
    expect(desktopBridge.commitHostAssetImport).toHaveBeenCalledTimes(1)

    resolveCommit({ kind: 'saved', requestId: 'commit', asset: {} as never, revision: {} as never, writeReceipt: {} as never })
    await waitFor(() => expect(props.onSaved).toHaveBeenCalledTimes(1))
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('来源变化时给出可执行提示', async () => {
    vi.mocked(desktopBridge.commitHostAssetImport).mockRejectedValue(new Error('HOST_ASSET_SOURCE_CHANGED'))
    renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: '预览导入' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认导入' }))
    expect(await screen.findByText('外部资产在预览后发生了变化，请重新扫描再导入。')).toBeInTheDocument()
  })

  it('登记待修复时只提供登记修复动作', async () => {
    vi.mocked(desktopBridge.commitHostAssetImport).mockResolvedValue({ kind: 'registration_pending', requestId: 'commit', asset: { id: 'skill-review' } as never, fileState: 'verified_written_registration_pending', diagnostics: [] })
    vi.mocked(desktopBridge.repairSharedAssetRegistration).mockResolvedValue({} as never)
    const { props } = renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: '预览导入' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认导入' }))
    const repair = await screen.findByRole('button', { name: '修复资产登记' })
    expect(screen.getByRole('button', { name: '确认导入' })).toBeDisabled()
    fireEvent.click(repair)
    await waitFor(() => expect(desktopBridge.repairSharedAssetRegistration).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'skill-review' })))
    expect(props.onSaved).toHaveBeenCalledTimes(1)
  })

  it('版本待补记时使用 recoveryRef 完成恢复', async () => {
    vi.mocked(desktopBridge.commitHostAssetImport).mockResolvedValue({ kind: 'revision_pending', requestId: 'commit', asset: { id: 'skill-review' } as never, fileState: 'verified_written_revision_pending', recoveryRef: 'recovery-1', diagnostics: [] })
    vi.mocked(desktopBridge.recoverSharedAssetRevision).mockResolvedValue({ kind: 'saved', requestId: 'recover', asset: {} as never, revision: {} as never, writeReceipt: {} as never })
    const { props } = renderDialog()
    fireEvent.click(await screen.findByRole('button', { name: '预览导入' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认导入' }))
    fireEvent.click(await screen.findByRole('button', { name: '补记资产版本' }))
    await waitFor(() => expect(desktopBridge.recoverSharedAssetRevision).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'skill-review', recoveryRef: 'recovery-1' })))
    expect(props.onSaved).toHaveBeenCalledTimes(1)
  })
})
