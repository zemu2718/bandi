import { describe, expect, it } from 'vitest'
import fixture from '../../../../packages/contracts/fixtures/backup-local.valid.json'
import type {
  BackupRestorePreviewDto,
  BackupRestoreResultDto,
  BackupSnapshotDto,
  CreateBackupSnapshotRequest,
  PreviewBackupRestoreRequest,
  RestoreBackupSnapshotRequest,
} from '../contracts'

const hashPattern = /^sha256:[0-9a-f]{64}$/

describe('本地 Backup 共享合同', () => {
  it('创建请求只接受稳定资产 ID，不携带路径或执行参数', () => {
    const request = fixture.createRequest as CreateBackupSnapshotRequest
    expect(request.scope.kind).toBe('files')
    expect(request.scope.assetIds).toEqual(['asset-instructions-1'])
    expect(request).not.toHaveProperty('path')
    expect(request).not.toHaveProperty('archivePath')
    expect(request).not.toHaveProperty('executable')
  })

  it('快照清单保留可信 locator、双基线和内容完整性哈希', () => {
    const snapshot = fixture.snapshot as BackupSnapshotDto
    expect(snapshot.kind).toBe('manual')
    expect(snapshot.integrity).toBe('verified')
    expect(snapshot.manifestHash).toMatch(hashPattern)
    expect(snapshot.entryCount).toBe(snapshot.entries.length)
    expect(snapshot.entries[0].locator.rootKind).toBe('managed')
    expect(snapshot.entries[0].snapshotContentHash).toMatch(hashPattern)
    expect(snapshot.entries[0].redacted).toBe(false)
  })

  it('恢复预览绑定一次性引用、当前基线和独立确认', () => {
    const previewRequest = fixture.previewRequest as PreviewBackupRestoreRequest
    const preview = fixture.restorePreview as BackupRestorePreviewDto
    const request = fixture.restoreRequest as RestoreBackupSnapshotRequest
    expect(previewRequest.snapshotId).toBe(preview.snapshotId)
    expect(preview.requiresConfirmation).toBe(true)
    expect(preview.entries[0].currentBaseline?.assetId).toBe(preview.entries[0].assetId)
    expect(request.previewRef).toBe(preview.previewRef)
    expect(request.confirmed).toBe(true)
  })

  it('恢复结果逐资产报告并保留恢复前安全快照', () => {
    const result = fixture.restoreResult as BackupRestoreResultDto
    expect(result.kind).toBe('restored')
    expect(result.preRestoreSnapshotId).toBe('backup-snapshot-pre-1')
    expect(result.entries[0]).toMatchObject({
      assetId: 'asset-instructions-1',
      status: 'restored',
    })
    expect(result.entries[0].revisionId).toBeTruthy()
  })

  it('恢复失败保留实际文件状态和后续恢复引用', () => {
    const entry: BackupRestoreResultDto['entries'][number] = {
      assetId: 'asset-permissions-1',
      status: 'save_failed',
      retryable: true,
      fileState: 'verified_written_revision_pending',
      recoveryRef: 'revision-backup-recovery-1',
    }
    expect(entry).toMatchObject({
      fileState: 'verified_written_revision_pending',
      recoveryRef: 'revision-backup-recovery-1',
    })
  })
})
