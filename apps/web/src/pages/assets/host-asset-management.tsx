import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { AppDialog } from '../../components/ui/dialog'
import { DiagnosticList, ErrorNotice, errorFromCause, type UserFacingError } from '../../components/app/error-notice'
import { commitHostAssetImport, previewHostAssetImport, recoverSharedAssetRevision, repairSharedAssetRegistration } from '../../desktop-bridge'
import type { HostAssetImportPreviewDto, HostAssetSummaryDto } from '../../contracts'

function suggestedAssetId(packageKey: string): string {
  const id = packageKey.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 128)
  return id && id !== '.' && id !== '..' ? id : 'imported-skill'
}

function importError(cause: unknown, title: string): UserFacingError {
  const details = cause instanceof Error ? cause.message : String(cause)
  const code = ['HOST_ASSET_SOURCE_CHANGED', 'HOST_ASSET_BASELINE_CHANGED', 'HOST_ASSET_PREVIEW_EXPIRED', 'HOST_ASSET_ACTION_UNSUPPORTED', 'HOST_ASSET_REQUEST_INVALID', 'HOST_ASSET_NOT_FOUND', 'HOST_ASSET_SCAN_EXPIRED'].find((value) => details.includes(value))
  const descriptions: Record<string, string> = {
    HOST_ASSET_SOURCE_CHANGED: '外部资产在预览后发生了变化，请重新扫描再导入。',
    HOST_ASSET_BASELINE_CHANGED: '扫描后外部资产发生了变化，请重新扫描再导入。',
    HOST_ASSET_PREVIEW_EXPIRED: '导入预览已过期或已使用，请重新生成预览。',
    HOST_ASSET_ACTION_UNSUPPORTED: '当前资产不支持导入，未修改任何文件。',
    HOST_ASSET_REQUEST_INVALID: '资产标识无效，请使用字母、数字、点、短横线或下划线。',
    HOST_ASSET_NOT_FOUND: '没有找到这项外部资产，请重新扫描。',
    HOST_ASSET_SCAN_EXPIRED: '扫描结果已过期，请重新扫描后再导入。',
  }
  return errorFromCause(cause, title, code ? descriptions[code] : '导入未完成，未修改任何文件。请重新扫描后重试。')
}

export function HostAssetImportDialog({ asset, scanGeneration, teamId, open, onOpenChange, onSaved }: { asset?: HostAssetSummaryDto; scanGeneration?: string; teamId: string; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => Promise<void> }) {
  const [assetId, setAssetId] = useState('')
  const [preview, setPreview] = useState<HostAssetImportPreviewDto>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<UserFacingError>()
  const [repairAssetId, setRepairAssetId] = useState('')
  const [revisionRecovery, setRevisionRecovery] = useState<{ assetId: string; recoveryRef: string }>()
  const reset = () => { setAssetId(asset ? suggestedAssetId(asset.packageKey) : ''); setPreview(undefined); setBusy(false); setError(undefined); setRepairAssetId(''); setRevisionRecovery(undefined) }
  useEffect(reset, [asset, open])
  const close = (next: boolean) => { if (!next) reset(); onOpenChange(next) }
  const prepare = async () => {
    if (!asset || !scanGeneration || !assetId.trim()) return
    setBusy(true); setError(undefined)
    try { setPreview(await previewHostAssetImport({ requestId: crypto.randomUUID(), hostInstanceId: asset.hostInstanceId, scanGeneration, action: 'import', teamId, assetId: assetId.trim() })) }
    catch (cause) { setError(importError(cause, '无法准备导入预览')) }
    finally { setBusy(false) }
  }
  const commit = async () => {
    if (!preview) return
    setBusy(true); setError(undefined)
    try {
      const result = await commitHostAssetImport({ requestId: crypto.randomUUID(), action: 'import', previewRef: preview.previewRef, sourceFingerprint: preview.sourceFingerprint, confirmed: true })
      if (result.kind === 'saved') { close(false); await onSaved(); return }
      if (result.kind === 'registration_pending') setRepairAssetId(result.asset.id)
      if (result.kind === 'revision_pending') setRevisionRecovery({ assetId: result.asset.id, recoveryRef: result.recoveryRef })
      setError({ title: '资产已写入，仍需完成登记', description: result.kind === 'registration_pending' ? '资产副本已验证写入。修复 Team 登记后即可使用。' : '资产副本已验证写入。补记版本后即可完成导入。', technicalDetails: result.diagnostics?.map((item) => item.code).join(' · ') })
    } catch (cause) { setError(importError(cause, '导入未完成')) }
    finally { setBusy(false) }
  }
  const repair = async () => {
    setBusy(true); setError(undefined)
    try { await repairSharedAssetRegistration({ requestId: crypto.randomUUID(), assetId: repairAssetId }); close(false); await onSaved() }
    catch (cause) { setError(errorFromCause(cause, '无法修复资产登记', '资产文件未被删除，请重试。')) }
    finally { setBusy(false) }
  }
  const recover = async () => {
    if (!revisionRecovery) return
    setBusy(true); setError(undefined)
    try {
      const result = await recoverSharedAssetRevision({ requestId: crypto.randomUUID(), ...revisionRecovery })
      if (result.kind === 'saved') { close(false); await onSaved(); return }
      setError({ title: '版本仍未补记', description: '资产文件保持不变，请重试。' })
    } catch (cause) { setError(errorFromCause(cause, '无法补记资产版本', '资产文件保持不变，请重试。')) }
    finally { setBusy(false) }
  }
  return <AppDialog open={open} onOpenChange={close} title="导入到 Bandi" description="导入会创建独立的 Bandi 受管 Skill 副本；不会持续关联外部文件。" footer={<><Button variant="outline" disabled={busy} onClick={() => close(false)}>取消</Button>{repairAssetId && <Button variant="outline" disabled={busy} onClick={repair}>修复资产登记</Button>}{revisionRecovery && <Button variant="outline" disabled={busy} onClick={recover}>补记资产版本</Button>}{preview ? <Button disabled={busy || Boolean(repairAssetId || revisionRecovery)} onClick={commit}>{busy ? '正在导入…' : '确认导入'}</Button> : <Button disabled={busy || !assetId.trim()} onClick={prepare}>{busy ? '正在准备…' : '预览导入'}</Button>}</>}>
    {asset && <div className="grid gap-4 text-sm"><p><b>{asset.name}</b></p><p className="text-muted-foreground">{asset.toolId} · {asset.relativeLocation}</p><label htmlFor="host-import-asset-id" className="font-medium">Bandi 资产标识<input id="host-import-asset-id" className="mt-2 h-10 w-full px-3 font-mono" value={assetId} disabled={Boolean(preview)} onChange={(event) => setAssetId(event.target.value)} aria-describedby={error ? 'host-import-error' : 'host-import-asset-id-help'} /></label><p id="host-import-asset-id-help" className="text-xs text-muted-foreground">可调整为易识别的稳定标识，仅支持字母、数字、点、短横线和下划线。</p>{preview && <div className="rounded-lg border border-warning/30 bg-warning/5 p-4"><b>确认内容</b><p className="mt-2 leading-6">{preview.confirmationText}</p><DiagnosticList items={preview.diagnostics} className="mt-3" /></div>}{error && <div id="host-import-error"><ErrorNotice error={error} /></div>}</div>}
  </AppDialog>
}
