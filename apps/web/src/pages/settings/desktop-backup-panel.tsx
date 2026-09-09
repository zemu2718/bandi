import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import type { BackupRestorePreviewDto, BackupRestoreResultDto, BackupSnapshotDto, Diagnostic, SourceAssetSummaryDto } from '../../contracts'
import { AppDialog } from '../../components/ui/dialog'
import { Button } from '../../components/ui/button'
import { MonoPath, StatusBadge } from '../../components/app/page'
import { DiagnosticList, ErrorNotice, errorFromCause, type UserFacingError } from '../../components/app/error-notice'
import {
  createBackupSnapshot,
  discoverConfig,
  listBackupSnapshots,
  previewBackupRestore,
  restoreBackupSnapshot,
} from '../../desktop-bridge'
import { assetKindLabel, formatDisplayTimestamp } from '../../presentation'

function requestId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

const statusLabels: Record<BackupRestorePreviewDto['entries'][number]['status'], string> = {
  ready: '可恢复',
  baseline_changed: '当前配置已被修改',
  missing_current: '当前配置缺失',
  integrity_failed: '内容校验失败',
  unavailable: '不可用',
}

const restoreStatusLabels: Record<BackupRestoreResultDto['entries'][number]['status'], string> = {
  restored: '已恢复',
  baseline_changed: '当前版本已变化',
  integrity_failed: '完整性校验失败',
  validation_failed: '配置校验失败',
  save_failed: '保存失败',
  skipped: '已跳过',
}

function Diagnostics({ items }: { items?: Diagnostic[] }) {
  return <DiagnosticList items={items} className="mt-2 text-xs" />
}

function RestoreFileState({ entry }: { entry: BackupRestoreResultDto['entries'][number] }) {
  if (!entry.fileState) return null
  const message = entry.fileState === 'unchanged'
    ? '配置文件未改变。'
    : entry.fileState === 'write_not_verified'
      ? '无法确认配置文件是否已写入。请先检查当前内容，不要直接重试。'
      : '配置文件已写入，但版本记录尚未完成。请使用下方恢复编号继续处理。'
  return <>
    <p className="mt-1 text-xs text-muted-foreground">{message}</p>
    {entry.recoveryRef && <p className="mt-1 break-all font-mono text-xs text-muted-foreground">恢复编号：{entry.recoveryRef}</p>}
    {entry.retryable === false && <p className="mt-1 text-xs text-muted-foreground">该失败不可直接重试。</p>}
  </>
}

export function DesktopBackupPanel() {
  const [snapshots, setSnapshots] = useState<BackupSnapshotDto[]>([])
  const [assets, setAssets] = useState<SourceAssetSummaryDto[]>([])
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<BackupSnapshotDto>()
  const [restoreAssetIds, setRestoreAssetIds] = useState<string[]>([])
  const [preview, setPreview] = useState<BackupRestorePreviewDto>()
  const [result, setResult] = useState<BackupRestoreResultDto>()
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<UserFacingError>()
  const createTriggerRef = useRef<HTMLButtonElement>(null)

  const writableAssets = useMemo(
    () => assets.filter((asset) => asset.writable && asset.parseStatus === 'parsed'),
    [assets],
  )

  const refresh = async () => {
    setLoading(true)
    setError(undefined)
    try {
      const [history, discovery] = await Promise.all([
        listBackupSnapshots(),
        discoverConfig({ requestId: requestId('discover-backup'), includeClaudeUserRoot: false }),
      ])
      setSnapshots(history)
      setAssets(discovery.assets)
    } catch (cause) {
      setError(errorFromCause(
        cause,
        '无法读取本地快照',
        '快照和配置没有变化。请检查 Bandi Desktop 后重新读取。',
      ))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  const closeCreate = () => {
    setCreateOpen(false)
    setSelectedAssetIds([])
    setError(undefined)
    requestAnimationFrame(() => createTriggerRef.current?.focus())
  }

  const create = async () => {
    if (!selectedAssetIds.length || saving) return
    setSaving(true)
    setError(undefined)
    try {
      const snapshot = await createBackupSnapshot({
        requestId: requestId('create-backup'),
        scope: { kind: 'files', assetIds: selectedAssetIds },
      })
      setSnapshots((current) => [snapshot, ...current.filter((item) => item.id !== snapshot.id)])
      closeCreate()
    } catch (cause) {
      setError(errorFromCause(
        cause,
        '无法创建本地快照',
        '没有创建快照。请检查所选配置和 Bandi Desktop后重试。',
      ))
    } finally {
      setSaving(false)
    }
  }

  const openRestore = (snapshot: BackupSnapshotDto) => {
    setRestoreTarget(snapshot)
    setRestoreAssetIds(snapshot.entries.map((entry) => entry.assetId))
    setPreview(undefined)
    setResult(undefined)
    setConfirmed(false)
    setError(undefined)
  }

  const closeRestore = () => {
    setRestoreTarget(undefined)
    setRestoreAssetIds([])
    setPreview(undefined)
    setResult(undefined)
    setConfirmed(false)
    setError(undefined)
  }

  const previewRestore = async () => {
    if (!restoreTarget || !restoreAssetIds.length || saving) return
    setSaving(true)
    setError(undefined)
    try {
      setPreview(await previewBackupRestore({
        requestId: requestId('preview-backup'),
        snapshotId: restoreTarget.id,
        assetIds: restoreAssetIds,
      }))
    } catch (cause) {
      setError(errorFromCause(
        cause,
        '无法检查恢复内容',
        '配置没有变化。请检查所选快照和Bandi Desktop后重试。',
      ))
    } finally {
      setSaving(false)
    }
  }

  const restore = async () => {
    if (!restoreTarget || !preview?.canRestore || !confirmed || saving) return
    setSaving(true)
    setError(undefined)
    try {
      const next = await restoreBackupSnapshot({
        requestId: requestId('restore-backup'),
        snapshotId: restoreTarget.id,
        assetIds: restoreAssetIds,
        previewRef: preview.previewRef,
        confirmed: true,
      })
      setResult(next)
      setSnapshots(await listBackupSnapshots())
    } catch (cause) {
      setError(errorFromCause(
        cause,
        '无法完成快照恢复',
        '部分配置可能已恢复。请查看恢复结果或重新读取快照，不要直接重复提交。',
      ))
    } finally {
      setSaving(false)
    }
  }

  return <div className="space-y-5">
    <section className="panel flex flex-wrap items-start justify-between gap-4 p-5">
      <div><b>快照与恢复</b><p className="mt-1 text-sm leading-6 text-muted-foreground">保存你选择的 Bandi 配置文件，需要时可从快照恢复。</p><details className="mt-1"><summary className="cursor-pointer text-xs text-muted-foreground">查看安全范围</summary><p className="mt-2 max-w-3xl text-xs leading-5 text-muted-foreground">只包含 Bandi 当前可查看且由你选中的可写配置文件。不包含 Team、需求、项目目录记录、其他 Bandi 数据或 Agent 长期记忆文件；凭据、Token、Cookie、私钥、钥匙串和执行过程也不会加入。</p></details></div>
      <Button ref={createTriggerRef} disabled={loading || !writableAssets.length} onClick={() => setCreateOpen(true)}><Plus size={15} aria-hidden="true" />创建本地快照</Button>
    </section>
    {error && <ErrorNotice error={error} />}
    <section className="panel overflow-hidden">
      <div className="border-b border-border p-5"><b>快照历史</b><p className="mt-1 text-xs text-muted-foreground">历史保存在本机；恢复前会重新校验条目并创建安全快照。</p></div>
      {loading ? <p className="p-5 text-sm text-muted-foreground">正在加载本地快照…</p> : <div className="divide-y divide-border">
        {snapshots.map((snapshot) => <div key={snapshot.id} className="grid min-w-0 gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><b>{snapshot.kind === 'pre_restore' ? '恢复前安全快照' : '手动快照'}</b><StatusBadge tone={snapshot.integrity === 'verified' ? 'success' : 'danger'}>{snapshot.integrity === 'verified' ? '清单已校验' : '清单异常'}</StatusBadge></div><p className="mt-1 text-xs text-muted-foreground">{formatDisplayTimestamp(snapshot.createdAt)} · {snapshot.entryCount} 项</p><MonoPath>{snapshot.id}</MonoPath></div>
          <Button variant="outline" size="sm" disabled={snapshot.integrity !== 'verified'} onClick={() => openRestore(snapshot)}>预览恢复</Button>
        </div>)}
        {!snapshots.length && <p className="p-5 text-sm text-muted-foreground">尚未创建本地快照。</p>}
      </div>}
    </section>

    <AppDialog open={createOpen} onOpenChange={(open) => { if (!open) closeCreate() }} title="创建本地快照" description="选择 1–256 个 Bandi 当前可查看且可写的配置文件；未选择的文件、Team 和需求等 Bandi 数据不会加入。" size="lg" footer={<><Button variant="outline" onClick={closeCreate}>取消</Button><Button disabled={!selectedAssetIds.length || saving} onClick={create}>{saving ? '创建中…' : '确认创建'}</Button></>}>
      {error && <ErrorNotice error={error} className="mb-4" />}
      <AssetChecklist assets={writableAssets} selected={selectedAssetIds} onChange={setSelectedAssetIds} />
      <p className="mt-4 text-xs leading-5 text-muted-foreground">快照正文写入 Bandi Desktop 受控目录；凭据、Token、Cookie、私钥、钥匙串和执行过程不会加入快照。</p>
    </AppDialog>

    <AppDialog open={Boolean(restoreTarget)} onOpenChange={(open) => { if (!open) closeRestore() }} title="恢复本地快照" description={restoreTarget?.id} size="lg" footer={<><Button variant="outline" onClick={closeRestore}>{result ? '关闭' : '取消'}</Button>{!result && (!preview ? <Button disabled={!restoreAssetIds.length || saving} onClick={previewRestore}>{saving ? '校验中…' : '校验并预览'}</Button> : <Button variant="danger" disabled={!preview.canRestore || !confirmed || saving} onClick={restore}>{saving ? '恢复中…' : '确认恢复'}</Button>)}</>}>
      {error && <ErrorNotice error={error} className="mb-4" />}
      {restoreTarget && !preview && <fieldset><legend className="text-sm font-medium">选择要恢复的配置</legend><div className="mt-2 max-h-72 space-y-2 overflow-auto rounded-lg border border-border p-3">{restoreTarget.entries.map((entry) => <label key={entry.assetId} className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={restoreAssetIds.includes(entry.assetId)} onChange={(event) => setRestoreAssetIds((current) => event.target.checked ? [...current, entry.assetId] : current.filter((id) => id !== entry.assetId))} /><span className="min-w-0"><b>{assetKindLabel(entry.kind)}</b><MonoPath>{entry.locator.displayPath}</MonoPath></span></label>)}</div></fieldset>}
      {preview && !result && <div className="space-y-3">{preview.entries.map((entry) => <div key={entry.assetId} className="rounded-lg border border-border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><MonoPath>{entry.assetId}</MonoPath><StatusBadge tone={entry.status === 'ready' ? 'success' : 'danger'}>{statusLabels[entry.status]}</StatusBadge></div><Diagnostics items={entry.diagnostics} /></div>)}<p className="text-xs text-muted-foreground">预览有效期至 {formatDisplayTimestamp(preview.expiresAt)}。配置将逐项恢复；如果部分项目失败，可使用自动创建的恢复前安全快照回退。</p><label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>我确认恢复这些配置。恢复仍会校验当前版本、文件格式和权限变化。</span></label></div>}
      {result && <div className="space-y-3"><StatusBadge tone={result.kind === 'restored' ? 'success' : 'warning'}>{result.kind === 'restored' ? '恢复完成' : result.kind === 'partial_failure' ? '部分恢复' : '恢复失败'}</StatusBadge><p className="text-sm text-muted-foreground">已恢复 {result.entries.filter((entry) => entry.status === 'restored').length} 项；其他条目请按下方实际状态处理。</p><p className="text-sm text-muted-foreground">恢复前安全快照：<span className="font-mono">{result.preRestoreSnapshotId}</span></p>{result.entries.map((entry) => <div key={entry.assetId} className="rounded-lg border border-border p-3 text-sm"><b>{restoreStatusLabels[entry.status]}</b><MonoPath>{entry.assetId}</MonoPath>{entry.revisionId && <p className="mt-1 text-xs text-muted-foreground">新版本：{entry.revisionId}</p>}<RestoreFileState entry={entry} /><Diagnostics items={entry.diagnostics} /></div>)}</div>}
    </AppDialog>
  </div>
}

function AssetChecklist({ assets, selected, onChange }: { assets: SourceAssetSummaryDto[]; selected: string[]; onChange: (ids: string[]) => void }) {
  return <fieldset><legend className="text-sm font-medium">配置（至少一项）</legend><div className="mt-2 max-h-72 space-y-2 overflow-auto rounded-lg border border-border p-3">{assets.map((asset) => <label key={asset.id} className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={selected.includes(asset.id)} onChange={(event) => onChange(event.target.checked ? [...selected, asset.id] : selected.filter((id) => id !== asset.id))} /><span className="min-w-0"><b>{assetKindLabel(asset.kind)}</b><MonoPath>{asset.id}</MonoPath></span></label>)}{!assets.length && <p className="text-sm text-muted-foreground">没有可加入快照的受管配置。</p>}</div></fieldset>
}
