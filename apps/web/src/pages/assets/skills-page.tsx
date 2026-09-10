import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { EmptyState, EntityTabPanel, EntityTabs, MockBoundaryNote, PageHeader, StatusBadge, toneForStatus } from '../../components/app/page'
import { Button } from '../../components/ui/button'
import { AppDialog } from '../../components/ui/dialog'
import type { FullAsset } from '../../domain'
import { getSkillReferences, isSkillAsset, skillInstallationStatusLabels, type SkillAction } from '../../skill-installation'
import { useApp } from '../../state'

const views = [['browse', '浏览'], ['installed', '已安装'], ['updates', '可更新']] as const

type SkillView = typeof views[number][0]

export function SkillsPage() {
  const { state } = useApp()
  const [params, setParams] = useSearchParams()
  const [action, setAction] = useState<{ asset: FullAsset; action: SkillAction }>()
  const rawView = params.get('view')
  const view: SkillView = views.some(([id]) => id === rawView) ? rawView as SkillView : 'browse'
  const query = params.get('q') ?? ''
  const source = params.get('source') ?? ''
  const set = (key: string, value: string) => { const next = new URLSearchParams(params); if (value && !(key === 'view' && value === 'browse')) next.set(key, value); else next.delete(key); setParams(next) }
  useEffect(() => {
    if (!rawView || view === rawView) return
    const next = new URLSearchParams(params)
    next.delete('view')
    setParams(next, { replace: true })
  }, [params, rawView, setParams, view])
  const skills = useMemo(() => state.assets.filter(isSkillAsset).filter((asset) => (!query || `${asset.name} ${asset.summary}`.toLowerCase().includes(query.toLowerCase())) && (!source || asset.skill.source.kind === source) && (view === 'installed' ? asset.skill.installation.status !== 'available' : view === 'updates' ? asset.skill.installation.status === 'update-available' : true)), [query, source, state.assets, view])
  if (state.runtime === 'desktop') return <><PageHeader title="技能" description="Desktop 当前只提供受管配置资产的只读索引。" /><MockBoundaryNote>请返回资产索引查看已发现的技能配置；当前不提供安装、更新、回滚或卸载。</MockBoundaryNote></>
  const content = <section className="panel overflow-hidden"><div className="grid gap-3 border-b border-border p-4 sm:grid-cols-[1fr_220px]"><label className="relative"><span className="sr-only">搜索技能</span><Search className="absolute left-3 top-3 text-muted-foreground" size={16} aria-hidden="true" /><input aria-label="搜索技能" value={query} onChange={(event) => set('q', event.target.value)} className="h-10 w-full pl-9 pr-3" placeholder="搜索名称或摘要…" /></label><label><span className="sr-only">技能来源</span><select aria-label="技能来源" value={source} onChange={(event) => set('source', event.target.value)} className="h-10 w-full px-3"><option value="">全部来源</option><option value="local">本地</option><option value="git">Git</option><option value="marketplace">Marketplace 演示</option></select></label></div>{skills.length ? <div className="divide-y divide-border">{skills.map((asset) => { const skill = asset.skill; const refs = getSkillReferences(state.agents, asset.id); return <div key={asset.id} className="grid gap-4 p-5 lg:grid-cols-[1fr_auto]"><div><div className="flex flex-wrap items-center gap-2"><Link to={`/assets/${asset.id}`} className="font-semibold hover:underline">{asset.name}</Link><StatusBadge tone={toneForStatus(skill.installation.status)}>{skillInstallationStatusLabels[skill.installation.status]}</StatusBadge>{skill.source.kind === 'marketplace' && <StatusBadge tone="neutral">预置演示</StatusBadge>}{skill.delivery.kind === 'plugin' && <StatusBadge tone="neutral">由插件提供</StatusBadge>}</div><p className="mt-2 text-sm text-muted-foreground">{asset.summary}</p><p className="mt-2 text-xs text-muted-foreground">{sourceLabel(asset)} · 当前 {skill.installation.installedVersion ?? '未安装'} · 可用 {skill.installation.availableVersion} · 已在 {refs.length} 处使用</p></div><div className="flex flex-wrap items-center gap-2">{skill.installation.status === 'available' && <Button size="sm" onClick={() => setAction({ asset, action: 'install' })}>模拟安装</Button>}{skill.installation.status === 'update-available' && <Button size="sm" onClick={() => setAction({ asset, action: 'update' })}>模拟更新</Button>}{skill.installation.status !== 'available' && skill.installation.previousVersions.length > 0 && <Button size="sm" variant="outline" onClick={() => setAction({ asset, action: 'rollback' })}>模拟回滚</Button>}{skill.installation.status !== 'available' && <Button size="sm" variant="outline" onClick={() => setAction({ asset, action: 'uninstall' })}>模拟卸载</Button>}</div></div> })}</div> : <div className="p-5"><EmptyState title="没有匹配的技能" description="请调整视图、来源或搜索条件。" /></div>}<MockBoundaryNote>所有来源和 Marketplace 内容均为预置演示数据；不会下载、安装、更新、删除文件或执行脚本。</MockBoundaryNote></section>

  return <><PageHeader title="技能" description="浏览、审查和管理技能；分配给 Agent 后，仍需在其技能配置中明确保存。" /><EntityTabs tabs={views.map(([id, label]) => ({ id, label }))} active={view} onChange={(next) => set('view', next)} scope="skills-view" ariaLabel="技能视图" variant="segmented" className="mb-5 w-fit max-w-full" /><EntityTabPanel tabId={view} activeTab={view} scope="skills-view">{content}</EntityTabPanel>{action && <SkillActionDialog asset={action.asset} action={action.action} onClose={() => setAction(undefined)} />}</>
}

export function SkillActionDialog({ asset, action, onClose }: { asset: FullAsset; action: SkillAction; onClose: () => void }) {
  const { state, dispatch } = useApp()
  const [understood, setUnderstood] = useState(false)
  const skill = asset.skill!
  const [version, setVersion] = useState(skill.installation.previousVersions[0] ?? '')
  const references = getSkillReferences(state.agents, asset.id)
  const label = { install: '安装', update: '更新', rollback: '回滚', uninstall: '卸载' }[action]
  const submit = () => { dispatch({ type: 'APPLY_SKILL_ACTION', skillId: asset.id, action, version: action === 'rollback' ? version : undefined }); onClose() }
  const disabled = !understood || (action === 'rollback' && !version)

  return <AppDialog open onOpenChange={(open) => { if (!open) onClose() }} title={`模拟${label} ${asset.name}`} description="先审查来源、权限和影响；确认只更新当前页面。" size="lg" footer={<><Button variant="outline" onClick={onClose}>取消</Button><Button variant={action === 'uninstall' ? 'danger' : 'default'} disabled={disabled} onClick={submit}>确认模拟{label}</Button></>}><div className="grid gap-4 sm:grid-cols-2"><Review title="来源" values={[sourceLabel(asset), `当前版本 ${skill.installation.installedVersion ?? '未安装'}`, `可用版本 ${skill.installation.availableVersion}`]} /><Review title="声明权限" values={skill.review.permissions} /><Review title="影响" values={[...skill.review.impact, references.length ? `${references.length} 个使用位置保持不变${action === 'uninstall' ? '，但该技能将不可用' : ''}` : '当前没有使用位置']} /><Review title="文件范围" values={skill.review.files} /></div>{action === 'rollback' && <label className="mt-5 block text-sm font-medium">目标历史版本<select className="mt-2 h-10 w-full px-3" value={version} onChange={(event) => setVersion(event.target.value)}>{skill.installation.previousVersions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}{action === 'uninstall' && references.length > 0 && <div role="alert" className="mt-5 rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm"><b>卸载后将保留 {references.length} 个使用位置</b><p className="mt-1 text-muted-foreground">Bandi 不会自动修改 Agent 通用配置或工作区专属配置，但该技能将不可用。</p></div>}<label className="mt-5 flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} /><span>我已查看来源、权限和影响，并了解不会操作真实文件、运行脚本或自动分配给 Agent。</span></label></AppDialog>
}

const sourceLabel = (asset: FullAsset) => { const source = asset.skill?.source; if (!source) return '未知来源'; if (source.kind === 'local') return `本地 · ${source.path}`; if (source.kind === 'git') return `Git · ${source.repository}@${source.ref}`; return `${source.provider} · Marketplace 预置演示` }
function Review({ title, values }: { title: string; values: string[] }) { return <section className="rounded-lg border border-border p-4"><b className="text-sm">{title}</b><ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">{values.map((item) => <li key={item}>· {item}</li>)}</ul></section> }
