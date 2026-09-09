import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { AppDialog } from '../../components/ui/dialog'
import { ErrorNotice, errorFromCause, type UserFacingError } from '../../components/app/error-notice'
import {
  commitFactoryReset,
  previewFactoryReset,
  restartAfterFactoryReset,
  type FactoryResetPreviewDto,
} from '../../desktop-bridge'
import { MAIN_MENU_LAYOUT_STORAGE_KEY } from '../../navigation-layout'
import { useApp } from '../../state'
import {
  LEGACY_THEME_STORAGE_KEY,
  UI_PREFERENCES_STORAGE_KEY,
} from '../../ui-preferences'

const resetItems = [
  'Team 与需求',
  '受管 Agent 及其长期配置',
  '长期记忆与共享资产',
  '配置历史与本地快照',
  '工具方案、本机界面图片与偏好',
]

const targetLabels: Record<string, string> = {
  database: '领域数据库',
  databaseWal: '数据库写入日志',
  databaseShm: '数据库共享状态',
  sharedAssets: '共享资产',
  backups: '配置文件快照',
  revisions: '配置历史',
  formalMemory: '长期记忆',
  uiAssets: '本机界面图片',
  managedAgents: 'Bandi 受管 Agent 配置',
}

function resetFailureDescription(reason: unknown): string {
  const details = reason instanceof Error ? reason.message : String(reason)
  return details.includes('FACTORY_RESET_ROLLBACK_FAILED')
    ? '重置提交失败，且无法确认所有数据已回滚。请停止编辑、保留技术详情并重新打开 Bandi 后检查数据。'
    : '重置尚未提交。请重新检查重置范围后再确认。'
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
  const { state, dispatch } = useApp()
  const [preview, setPreview] = useState<FactoryResetPreviewDto>()
  const [confirmation, setConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<UserFacingError>()

  const loadPreview = async () => {
    setLoading(true)
    setError(undefined)
    try {
      setPreview(await previewFactoryReset(crypto.randomUUID()))
      setConfirmation('')
    } catch (reason) {
      setError(errorFromCause(reason, '无法检查重置范围', 'Bandi 数据没有变化。请检查 Bandi Desktop 后重试。'))
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
      if (!result.requiresRestart) throw new Error('后端未要求重新打开，重置 Bandi 未完成')
      dispatch({ type: 'FACTORY_RESET_COMMITTED' })
      clearUiPreferences()
      dispatch({ type: 'FACTORY_RESET_RESTARTING' })
      try {
        await restartAfterFactoryReset()
      } catch (reason) {
        dispatch({
          type: 'FACTORY_RESET_MANUAL_RESTART_REQUIRED',
          technicalDetails: reason instanceof Error ? reason.message : String(reason),
        })
      }
    } catch (reason) {
      setPreview(undefined)
      setConfirmation('')
      setError(errorFromCause(reason, '无法重置 Bandi', resetFailureDescription(reason)))
      setLoading(false)
    }
  }

  return <>
    <section className="panel p-5">
      <b>重置 Bandi</b>
      <p className="mt-5 text-sm leading-6 text-muted-foreground">删除 Bandi 自有数据并回到首次使用状态。此操作不可撤销，完成后 Bandi 会自动重新打开。</p>
      {state.factoryReset.status === 'legacy-database-required' && <div role="alert" className="mt-4 rounded-lg border border-warning/30 bg-warning/8 p-4 text-sm text-warning">检测到旧版开发数据，需要重置 Bandi 后才能继续使用。</div>}
      <Button variant="danger" className="mt-4" disabled={loading} onClick={loadPreview}>{loading ? '正在检查…' : '查看重置范围'}</Button>
      {error && <ErrorNotice error={error} className="mt-3" />}
    </section>

    <AppDialog open={Boolean(preview)} dismissible={!loading} onOpenChange={(open) => { if (!open && !loading) setPreview(undefined) }} title="确认重置 Bandi" description="此操作不可撤销。确认后将删除以下 Bandi 自有数据，并自动重新打开。" footer={<><Button variant="outline" disabled={loading} onClick={() => setPreview(undefined)}>取消</Button><Button variant="danger" disabled={loading || confirmation !== preview?.confirmationText || !preview?.canCommit} onClick={commit}>{loading ? '正在重置…' : '重置并重新打开'}</Button></>}>
      {preview && <div className="space-y-5">
        <section><b className="text-sm">将删除</b><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">{resetItems.map((item) => <li key={item}>{item}</li>)}</ul><details className="mt-3"><summary className="cursor-pointer text-xs text-muted-foreground">查看技术详情</summary><ul className="mt-2 space-y-1 pl-4 text-xs text-muted-foreground">{preview.targets.map((target) => <li key={target.id}><span className="font-mono">{target.id}</span> · {targetLabels[target.id] ?? target.id} · {target.state === 'present' ? '存在' : '无数据'}</li>)}</ul></details></section>
        <section><b className="text-sm">不会处理</b><p className="mt-2 text-sm leading-6 text-muted-foreground">Bandi 数据目录之外的用户文件、导入前的 Agent 文件与文件夹、AI 编程工具已有配置、凭据、Token 和钥匙串数据。</p></section>
        <label htmlFor="factory-reset-confirmation" className="block text-sm font-medium">输入“{preview.confirmationText}”确认<input id="factory-reset-confirmation" autoFocus className="mt-2 h-10 w-full px-3" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" disabled={loading} /></label>
        {error && <ErrorNotice error={error} />}
      </div>}
    </AppDialog>
  </>
}
