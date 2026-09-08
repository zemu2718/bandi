import { useState } from 'react'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { AiClientIcon, supportsClientLaunch } from '../../components/ai-clients'
import { Button } from '../../components/ui/button'
import { AppDialog } from '../../components/ui/dialog'
import {
  copyToolPlan,
  createToolPlan,
  deleteCustomTool,
  deleteToolPlan,
  loadToolConfiguration,
  saveCustomTool,
  saveToolPlan,
  selectToolPlan,
} from '../../desktop-bridge'
import { useApp } from '../../state'
import { environmentToPlan } from '../../tool-configuration'

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

export function ToolsConfigurationSection() {
  const { state, dispatch } = useApp()
  const [editor, setEditor] = useState<'new' | 'copy' | 'rename' | 'custom'>()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const current = state.configurationEnvironments.find((item) => item.id === state.currentConfigurationEnvironmentId)
  const revision = state.toolConfiguration.revision
  const sync = (snapshot: Awaited<ReturnType<typeof loadToolConfiguration>>, message?: string) => dispatch({ type: 'SYNC_TOOL_CONFIGURATION', snapshot, message })
  const run = async (operation: () => Promise<Awaited<ReturnType<typeof loadToolConfiguration>>>, message?: string) => {
    setBusy(true); setError(''); setFeedback('')
    try { sync(await operation(), message); setFeedback(message ?? '工具方案已切换'); setEditor(undefined); setName('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  if (state.hydration.toolConfiguration === 'loading') return <section className="panel p-5" role="status">正在加载工具方案…</section>
  if (state.hydration.toolConfiguration === 'failed') return <section className="panel p-5"><b>工具方案加载失败</b><p role="alert" className="mt-2 text-sm text-danger">{state.hydrationErrors.toolConfiguration}</p><Button className="mt-4" variant="outline" onClick={() => run(loadToolConfiguration)}>重试</Button></section>
  if (!current) return <section className="panel p-5" role="alert">当前工具方案不存在，请重新加载。</section>
  const duplicate = state.configurationEnvironments.some((item) => item.id !== (editor === 'rename' ? current.id : '') && item.name.toLowerCase() === name.trim().toLowerCase()) || state.aiClients.some((item) => editor === 'custom' && item.name.toLowerCase() === name.trim().toLowerCase())
  const submitLabel = editor === 'rename' ? '保存名称' : editor === 'custom' ? '添加工具' : editor === 'copy' ? '复制方案' : '创建方案'
  const submit = () => {
    const normalized = name.trim(); if (!normalized || duplicate) return
    if (editor === 'rename') return void run(() => saveToolPlan({ ...environmentToPlan(current), name: normalized }, revision), '工具方案已重命名')
    if (editor === 'custom') return void run(() => saveCustomTool({ id: `custom-${slug(normalized) || crypto.randomUUID()}`, name: normalized }, revision), '自定义工具已添加')
    const id = `${slug(normalized) || 'plan'}-${crypto.randomUUID().slice(0, 8)}`
    return void run(() => editor === 'copy' ? copyToolPlan(current.id, id, normalized, revision) : createToolPlan({ id, name: normalized, toolIds: [] }, revision), '工具方案已创建')
  }
  return <>
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border p-5"><div><b>工具方案</b><p className="mt-1 text-sm text-muted-foreground">只保存 Bandi 管理哪些工具，不修改宿主工具配置。</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => setEditor('copy')}><Copy size={15} aria-hidden="true" />复制方案</Button><Button size="sm" disabled={busy} onClick={() => setEditor('new')}><Plus size={15} aria-hidden="true" />新建方案</Button></div></div>
      <div className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"><label className="text-sm font-medium">当前方案<select className="mt-2 h-10 w-full px-3" value={current.id} disabled={busy} onChange={(event) => run(() => selectToolPlan(event.target.value, revision))}>{state.configurationEnvironments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => { setName(current.name); setEditor('rename') }}>重命名</Button><Button size="sm" variant="outline" disabled={state.configurationEnvironments.length === 1 || busy} onClick={() => run(() => deleteToolPlan(current.id, revision), '工具方案已删除')}><Trash2 size={15} aria-hidden="true" />{busy ? '处理中…' : '删除方案'}</Button></div></div>
      {busy && <p role="status" className="mx-5 mb-5 text-sm text-muted-foreground">正在更新工具方案…</p>}{feedback && !busy && <p role="status" className="mx-5 mb-5 text-sm text-success">{feedback}</p>}{error && <p role="alert" className="mx-5 mb-5 text-sm text-danger">{error}</p>}
    </section>
    <section className="panel overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-4 border-b border-border p-5"><div><b>要管理的 AI 编程工具</b><p className="mt-1 text-sm text-muted-foreground">未探测安装状态；自定义工具不具备上下文启动能力。</p></div><Button size="sm" variant="outline" onClick={() => setEditor('custom')}><Plus size={15} aria-hidden="true" />自定义工具</Button></div><div className="divide-y divide-border">{state.aiClients.map((client) => { const selected = current.clientIds.includes(client.id); return <div key={client.id} className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="flex items-center gap-3"><AiClientIcon client={client} size={36} tile /><span><b className="block">{client.name}</b><small className="text-muted-foreground">{supportsClientLaunch(client) ? '支持选择 Agent 与可选上下文' : '仅管理配置'}</small></span></div><div className="flex flex-wrap justify-end gap-2">{client.kind === 'custom' && <Button size="sm" variant="outline" disabled={selected || busy} onClick={() => run(() => deleteCustomTool(client.id, revision), '自定义工具已删除')}>删除</Button>}<Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => saveToolPlan({ ...environmentToPlan(current), toolIds: selected ? current.clientIds.filter((id) => id !== client.id) : [...current.clientIds, client.id] }, revision), selected ? '工具已移出方案' : '工具已加入方案')}>{selected ? '从方案移除' : '加入工具方案'}</Button></div></div> })}</div></section>
    <AppDialog open={Boolean(editor)} onOpenChange={(open) => { if (!open && !busy) { setEditor(undefined); setName(''); setError('') } }} title={editor === 'rename' ? '重命名工具方案' : editor === 'custom' ? '添加自定义工具' : editor === 'copy' ? '复制当前工具方案' : '新建工具方案'} footer={<><Button variant="outline" disabled={busy} onClick={() => setEditor(undefined)}>取消</Button><Button disabled={busy || !name.trim() || duplicate} onClick={submit}>{busy ? `${submitLabel}中…` : submitLabel}</Button></>}><label htmlFor="tool-editor-name" className="block text-sm font-medium">名称<input id="tool-editor-name" autoFocus className="mt-2 h-10 w-full px-3" value={name} onChange={(event) => setName(event.target.value)} aria-invalid={duplicate || undefined} aria-describedby={duplicate ? 'tool-editor-name-error' : undefined} /></label>{duplicate && <p id="tool-editor-name-error" className="mt-2 text-xs text-danger">已有名为“{name.trim()}”的{editor === 'custom' ? '工具' : '方案'}，请使用其他名称。</p>}{error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}</AppDialog>
  </>
}
