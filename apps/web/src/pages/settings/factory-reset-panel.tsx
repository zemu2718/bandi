import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { AppDialog } from '../../components/ui/dialog'
import { ErrorNotice, errorFromCause, type UserFacingError } from '../../components/app/error-notice'
import {
  commitFactoryReset,
  previewFactoryReset,
  type FactoryResetPreviewDto,
} from '../../desktop-bridge'
import { MAIN_MENU_LAYOUT_STORAGE_KEY } from '../../navigation-layout'
import { formatDisplayTimestamp } from '../../presentation'
import {
  LEGACY_THEME_STORAGE_KEY,
  UI_PREFERENCES_STORAGE_KEY,
} from '../../ui-preferences'

const preservedItems = [
  '用户自己的外部目录和文件',
  '历史外部 Agent 目录记录与 Agent 导入来源',
  'Claude Code、Codex、凭据和其他宿主配置',
]

const targetLabels: Record<string, string> = {
  database: '领域数据库',
  databaseWal: '数据库写入日志',
  databaseShm: '数据库共享状态',
  sharedAssets: '共享资产',
  backups: '配置文件快照',
  revisions: '配置历史',
  formalMemory: '正式记忆',
  uiAssets: '本机界面图片',
  managedAgents: 'Bandi 受管 Agent 配置',
}

const databaseTargetIds = new Set(['database', 'databaseWal', 'databaseShm'])

function resetTargets(preview: FactoryResetPreviewDto): Array<{ id: string; label: string; state: 'present' | 'absent' }> {
  const databaseTargets = preview.targets.filter((target) => databaseTargetIds.has(target.id))
  return [
    ...(databaseTargets.length ? [{ id: 'localData', label: 'Bandi 本机数据', state: databaseTargets.some((target) => target.state === 'present') ? 'present' as const : 'absent' as const }] : []),
    ...preview.targets.filter((target) => !databaseTargetIds.has(target.id)).map((target) => ({ ...target, label: targetLabels[target.id] ?? target.id })),
  ]
}

function resetFailureDescription(reason: unknown): string {
  const details = reason instanceof Error ? reason.message : String(reason)
  return details.includes('FACTORY_RESET_ROLLBACK_FAILED')
    ? '恢复提交失败，且无法确认所有数据已回滚。请停止编辑、保留技术详情并重启 Bandi 后检查数据。'
    : '恢复尚未提交。请重新检查恢复范围后再确认。'
}

function clearUiPreferences() {
  try {
    localStorage.removeItem(UI_PREFERENCES_STORAGE_KEY)
    localStorage.removeItem(LEGACY_THEME_STORAGE_KEY)
    localStorage.removeItem(MAIN_MENU_LAYOUT_STORAGE_KEY)
  } catch {
    // WebView 禁止存储时无需阻塞已提交的后端重置。
  }
}

export function FactoryResetPanel() {
  const [preview, setPreview] = useState<FactoryResetPreviewDto>()
  const [confirmation, setConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<UserFacingError>()
  const [committed, setCommitted] = useState(false)

  const loadPreview = async () => {
    setLoading(true)
    setError(undefined)
    try {
      setPreview(await previewFactoryReset(crypto.randomUUID()))
      setConfirmation('')
    } catch (reason) {
      setError(errorFromCause(
        reason,
        '无法检查恢复范围',
        'Bandi 数据没有变化。请检查本地服务后重试。',
      ))
    } finally {
      setLoading(false)
    }
  }

  const commit = async () => {
    if (!preview) return
    setLoading(true)
    setError(undefined)
    try {
      const result = await commitFactoryReset({
        requestId: preview.requestId,
        previewRef: preview.previewRef,
        confirmationText: confirmation,
      })
      if (!result.requiresRestart) throw new Error('后端未要求重启，恢复出厂状态未完成')
      clearUiPreferences()
      setCommitted(true)
      setPreview(undefined)
    } catch (reason) {
      setPreview(undefined)
      setConfirmation('')
      setError(errorFromCause(
        reason,
        '无法恢复出厂状态',
        resetFailureDescription(reason),
      ))
    } finally {
      setLoading(false)
    }
  }

  return <>
    <section className="panel p-5">
      <b>恢复出厂状态</b>
      <p className="mt-5 text-sm leading-6 text-muted-foreground">将 Bandi 自有的受管 Agent、组织索引、配置历史和本机设置恢复到首次启动状态。配置文件快照不能作为完整回滚点。</p>
      {committed
        ? <div role="status" className="mt-4 rounded-lg border border-warning/30 bg-warning/8 p-4 text-sm text-warning">恢复已提交。请立即重启 Bandi；当前窗口不应继续编辑。</div>
        : <Button variant="danger" className="mt-4" disabled={loading} onClick={loadPreview}>{loading ? '正在检查…' : '预览恢复范围'}</Button>}
      {error && <ErrorNotice error={error} className="mt-3" />}
    </section>

    <AppDialog open={Boolean(preview)} onOpenChange={(open) => { if (!open && !loading) setPreview(undefined) }} title="确认恢复出厂状态" description="此操作会隔离 Bandi 自有数据，并要求重启应用。" footer={<><Button variant="outline" disabled={loading} onClick={() => setPreview(undefined)}>取消</Button><Button variant="danger" disabled={loading || confirmation !== preview?.confirmationText || !preview?.canCommit} onClick={commit}>{loading ? '正在提交…' : '确认恢复'}</Button></>}>
      {preview && <div className="space-y-5">
        <section><b className="text-sm">会重置</b><ul className="mt-2 space-y-2 text-sm text-muted-foreground">{resetTargets(preview).map((target) => <li key={target.id} className="flex justify-between gap-4 rounded-md border border-border px-3 py-2"><span>{target.label}</span><span>{target.state === 'present' ? '存在' : '无数据'}</span></li>)}</ul><details className="mt-2"><summary className="cursor-pointer text-xs text-muted-foreground">查看技术目标</summary><ul className="mt-2 space-y-1 pl-4 text-xs text-muted-foreground">{preview.targets.map((target) => <li key={target.id}><span className="font-mono">{target.id}</span> · {targetLabels[target.id] ?? target.id} · {target.state === 'present' ? '存在' : '无数据'}</li>)}</ul></details></section>
        <section><b className="text-sm">会保留</b><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{preservedItems.map((item) => <li key={item}>{item}</li>)}</ul></section>
        <label htmlFor="factory-reset-confirmation" className="block text-sm font-medium">输入“{preview.confirmationText}”确认<input id="factory-reset-confirmation" autoFocus className="mt-2 h-10 w-full px-3" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
        <p className="text-xs text-muted-foreground">预览有效至 {formatDisplayTimestamp(preview.expiresAt)}；目标发生变化后需要重新预览。</p>
        {error && <ErrorNotice error={error} />}
      </div>}
    </AppDialog>
  </>
}
