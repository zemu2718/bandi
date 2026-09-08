// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopBackupPanel } from '../pages/settings/desktop-backup-panel'
import type { BackupSnapshotDto, DiscoveryResult } from '../contracts'

const bridge = vi.hoisted(() => ({
  createBackupSnapshot: vi.fn(),
  discoverConfig: vi.fn(),
  listBackupSnapshots: vi.fn(),
  previewBackupRestore: vi.fn(),
  restoreBackupSnapshot: vi.fn(),
}))

vi.mock('../desktop-bridge', () => bridge)

const hash = `sha256:${'a'.repeat(64)}` as const
const snapshot: BackupSnapshotDto = {
  id: 'backup-snapshot-1',
  kind: 'manual',
  scope: 'files',
  createdAt: '2026-09-01T00:00:00Z',
  entryCount: 1,
  manifestHash: hash,
  integrity: 'verified',
  entries: [{
    assetId: 'asset-instructions-1',
    containerId: 'container-1',
    kind: 'instructions',
    locator: { rootKind: 'managed', displayPath: 'Agent Alpha / instructions.md', relativePath: 'agt_alpha/instructions.md' },
    assetContentHash: hash,
    containerContentHash: hash,
    snapshotContentHash: hash,
    sizeBytes: 8,
    redacted: false,
  }],
}
const discovery: DiscoveryResult = {
  requestId: 'discover',
  profileVersion: 'agent-package-v1',
  containers: [],
  assets: [{
    id: 'asset-instructions-1',
    containerId: 'container-1',
    kind: 'instructions',
    officialScope: 'managed',
    assetContentHash: hash,
    containerContentHash: hash,
    writable: true,
    parseStatus: 'parsed',
    diagnostics: [],
  }],
  sharedAssets: [],
  references: [],
  diagnostics: [],
}

beforeEach(() => {
  bridge.createBackupSnapshot.mockReset().mockResolvedValue(snapshot)
  bridge.discoverConfig.mockReset().mockResolvedValue(discovery)
  bridge.listBackupSnapshots.mockReset().mockResolvedValue([snapshot])
  bridge.previewBackupRestore.mockReset().mockResolvedValue({
    requestId: 'preview-1',
    previewRef: 'preview-ref-1',
    snapshotId: snapshot.id,
    expiresAt: '2026-09-01T00:10:00Z',
    entries: [{ assetId: 'asset-instructions-1', status: 'ready', snapshotContentHash: hash }],
    canRestore: true,
    requiresConfirmation: true,
  })
  bridge.restoreBackupSnapshot.mockReset().mockResolvedValue({
    kind: 'restored',
    requestId: 'restore-1',
    snapshotId: snapshot.id,
    preRestoreSnapshotId: 'backup-pre-1',
    entries: [{ assetId: 'asset-instructions-1', status: 'restored', revisionId: 'revision-1' }],
  })
  vi.stubGlobal('crypto', { randomUUID: () => 'request-1' })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Desktop Backup 面板', () => {
  it('准确说明快照只包含 Bandi 发现并选中的受管配置文件', async () => {
    render(<DesktopBackupPanel />)

    expect(await screen.findByText(/保存所选受管配置文件/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('查看安全范围'))
    expect(screen.getByText(/只包含 Bandi 当前发现并由你选中的可写受管配置文件/)).toBeInTheDocument()
    expect(screen.getByText(/不包含 Team、部门、岗位、项目目录记录、跨部门服务、领域数据或正式记忆文件/)).toBeInTheDocument()
    expect(screen.getByText(/凭据、Token、Cookie、私钥、钥匙串和执行过程也不会加入/)).toBeInTheDocument()
  })

  it('从本地服务加载历史，并只用稳定资产 ID 创建快照', async () => {
    render(<DesktopBackupPanel />)
    await screen.findByText('手动快照')
    expect(screen.queryByText(snapshot.createdAt)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '创建本地快照' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /主指令/ }))
    fireEvent.click(screen.getByRole('button', { name: '确认创建' }))

    await waitFor(() => expect(bridge.createBackupSnapshot).toHaveBeenCalledWith({
      requestId: 'create-backup-request-1',
      scope: { kind: 'files', assetIds: ['asset-instructions-1'] },
    }))
    const request = bridge.createBackupSnapshot.mock.calls[0][0]
    expect(request).not.toHaveProperty('path')
    expect(request).not.toHaveProperty('archivePath')
  })

  it('创建失败时在创建对话框内显示错误', async () => {
    bridge.createBackupSnapshot.mockRejectedValue(new Error('snapshot write failed'))
    render(<DesktopBackupPanel />)
    await screen.findByText('手动快照')

    fireEvent.click(screen.getByRole('button', { name: '创建本地快照' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /主指令/ }))
    fireEvent.click(screen.getByRole('button', { name: '确认创建' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('无法创建本地快照')
    expect(screen.getByRole('dialog')).toContainElement(screen.getByRole('alert'))
  })

  it('恢复预览失败时在恢复对话框内显示错误', async () => {
    bridge.previewBackupRestore.mockRejectedValue(new Error('preview failed'))
    render(<DesktopBackupPanel />)
    await screen.findByText('手动快照')

    fireEvent.click(screen.getByRole('button', { name: '预览恢复' }))
    fireEvent.click(screen.getByRole('button', { name: '校验并预览' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('无法检查恢复内容')
    expect(screen.getByRole('dialog')).toContainElement(screen.getByRole('alert'))
  })

  it('先校验预览和独立确认，再展示安全快照与 Revision 结果', async () => {
    render(<DesktopBackupPanel />)
    await screen.findByText('手动快照')
    fireEvent.click(screen.getByRole('button', { name: '预览恢复' }))
    fireEvent.click(screen.getByRole('button', { name: '校验并预览' }))
    await screen.findByText('可恢复')
    expect(screen.queryByText('2026-09-01T00:10:00Z', { exact: false })).not.toBeInTheDocument()

    const restoreButton = screen.getByRole('button', { name: '确认恢复' })
    expect(restoreButton).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /我确认恢复这些配置资产/ }))
    fireEvent.click(restoreButton)

    await screen.findByText('恢复完成')
    expect(screen.getByText(/backup-pre-1/)).toBeInTheDocument()
    expect(screen.getByText(/revision-1/)).toBeInTheDocument()
    expect(bridge.restoreBackupSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      snapshotId: snapshot.id,
      assetIds: ['asset-instructions-1'],
      previewRef: 'preview-ref-1',
      confirmed: true,
    }))
  })

  it('不可恢复预览禁用提交并展示校验失败', async () => {
    bridge.previewBackupRestore.mockResolvedValue({
      requestId: 'preview-1',
      previewRef: 'preview-ref-1',
      snapshotId: snapshot.id,
      expiresAt: '2026-09-01T00:10:00Z',
      entries: [{ assetId: 'asset-instructions-1', status: 'integrity_failed', snapshotContentHash: hash }],
      canRestore: false,
      requiresConfirmation: true,
    })
    render(<DesktopBackupPanel />)
    await screen.findByText('手动快照')
    fireEvent.click(screen.getByRole('button', { name: '预览恢复' }))
    fireEvent.click(screen.getByRole('button', { name: '校验并预览' }))

    expect(await screen.findByText('完整性失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认恢复' })).toBeDisabled()
  })

  it('按真实文件状态展示恢复失败，不保证其余条目保持原状', async () => {
    bridge.restoreBackupSnapshot.mockResolvedValue({
      kind: 'restore_failed',
      requestId: 'restore-1',
      snapshotId: snapshot.id,
      preRestoreSnapshotId: 'backup-pre-1',
      entries: [{
        assetId: 'asset-instructions-1',
        status: 'save_failed',
        retryable: false,
        fileState: 'verified_written_revision_pending',
        recoveryRef: 'recovery-1',
      }],
    })
    render(<DesktopBackupPanel />)
    await screen.findByText('手动快照')
    fireEvent.click(screen.getByRole('button', { name: '预览恢复' }))
    fireEvent.click(screen.getByRole('button', { name: '校验并预览' }))
    await screen.findByText('可恢复')
    fireEvent.click(screen.getByRole('checkbox', { name: /我确认恢复这些配置资产/ }))
    fireEvent.click(screen.getByRole('button', { name: '确认恢复' }))

    expect(await screen.findByText('恢复失败')).toBeInTheDocument()
    expect(screen.getByText('保存失败')).toBeInTheDocument()
    expect(screen.getByText(/目标文件已写入，但版本记录尚未完成/)).toBeInTheDocument()
    expect(screen.getByText(/recovery-1/)).toBeInTheDocument()
    expect(screen.getByText(/不可直接重试/)).toBeInTheDocument()
    expect(screen.queryByText(/保持原状/)).not.toBeInTheDocument()
  })
})
