import { ArrowLeft, Code2, Copy, Eye, History } from 'lucide-react'
import { agentFilePreview, getAgentFileAssociation, type AgentFileView, type AgentProjectionContext } from '../../agent-config-projection'
import { agentFileSource } from '../../agent-file-source'
import { Button } from '../../components/ui/button'
import { FieldRow, MockBoundaryNote, MonoPath, PathActions } from '../../components/app/page'
import type { FullAgent } from '../../domain'
import { useApp } from '../../state'
import { listConfigRevisions } from '../../config-revisions'

export function AgentConfigFileViewer({ agent, context, path, view, onView, onBack, embedded = false }: { agent: FullAgent; context: AgentProjectionContext; path: string; view: AgentFileView; onView: (view: AgentFileView) => void; onBack?: () => void; embedded?: boolean }) {
  const { state, dispatch } = useApp()
  const association = getAgentFileAssociation(agent, path)
  if (!association) return <div role="status" className="panel border-warning/30 p-5"><b>文件不存在</b><p className="mt-2 text-sm text-muted-foreground">链接指向的文件不在当前 Agent 配置记录中。</p>{onBack && <Button className="mt-4" variant="outline" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" />返回结构化配置</Button>}</div>
  const preview = agentFilePreview(agent, context, path)
  const source = agentFileSource(agent, context, path)
  const sourceDetails = {
    'bandi-managed': { label: 'Bandi Desktop 受管配置', note: '只读源码根据 Bandi Desktop 已加载的受管配置生成。' },
    'managed-agent-import': { label: '已导入的 Agent 受管副本', note: '源码来自导入后的 Bandi 受管副本；原始 Agent 文件不会被修改。' },
    'claude-agent-import': { label: 'Claude Agent 受管副本（旧记录）', note: '源码来自已导入的 Bandi 受管副本；原始 Claude Agent 文件不会被修改。' },
    'bandi-demo': { label: '当前页面演示', note: '只读源码根据当前页面中的配置生成，不读取或写入本机文件。' },
    'external-reference': { label: '历史外部只读引用', note: '仅展示历史记录，未读取对应目录内容，也不再支持添加。' },
  }[agent.packageSource.kind]
  const revisions = listConfigRevisions(state.configRevisions, { ownerType: 'agent', ownerId: agent.id, path })
  const previewText = preview
    ? [preview.title, preview.description, preview.notice, ...preview.fields.map((field) => `${field.label}：${Array.isArray(field.value) ? field.value.join('；') || '无' : field.value || '无'}`)].filter(Boolean).join('\n')
    : ''
  const copyContent = view === 'preview' ? previewText : source.status === 'available' ? source.content : ''
  const copyCurrentView = async () => {
    try {
      await navigator.clipboard.writeText(copyContent)
      dispatch({ type: 'SHOW_NOTICE', notice: { tone: 'success', title: `${view === 'preview' ? '预览' : '源码'}已复制`, description: path } })
    } catch {
      dispatch({ type: 'SHOW_NOTICE', notice: { tone: 'error', title: '复制失败', description: '系统未允许访问剪贴板，请手动选择并复制。' } })
    }
  }

  return <div className={`${embedded ? '' : 'panel p-5'} min-w-0`}>
    <section aria-label={`${path.split('/').at(-1)} 文件查看器`} className="panel min-w-0 overflow-hidden">
      <header className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/20 px-5 py-2"><div className="flex min-w-0 items-baseline gap-3"><h2 className="truncate font-mono text-base font-semibold">{path.split('/').at(-1)}</h2><span className="shrink-0 text-xs text-muted-foreground">{association.file.type}</span></div><div className="flex items-center gap-1"><Button variant="ghost" size="icon" aria-label={`复制当前${view === 'preview' ? '预览' : '源码'}`} title={copyContent ? undefined : '当前内容不可用'} disabled={!copyContent} onClick={() => void copyCurrentView()}><Copy size={17} aria-hidden="true" /></Button><Button variant="ghost" size="icon" aria-label={revisions.length ? `查看历史，共 ${revisions.length} 个版本` : '当前文件暂无版本'} disabled={!revisions.length} title={revisions.length ? undefined : '当前文件尚无配置版本'} onClick={() => dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'config-history', ownerType: 'agent', ownerId: agent.id, path } })}><History size={16} aria-hidden="true" /></Button></div></header>
      <div className="flex h-12 items-end gap-6 border-b border-border bg-muted/10 px-5" role="tablist" aria-label="文件查看模式">{onBack && <Button className="mb-1" variant="ghost" size="sm" onClick={onBack}><ArrowLeft size={15} aria-hidden="true" />返回</Button>}<button type="button" role="tab" aria-selected={view === 'preview'} aria-pressed={view === 'preview'} onClick={() => onView('preview')} className={`relative inline-flex h-12 items-center gap-2 px-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === 'preview' ? 'text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground' : 'text-muted-foreground hover:text-foreground'}`}><Eye size={16} aria-hidden="true" />预览</button><button type="button" role="tab" aria-selected={view === 'source'} aria-pressed={view === 'source'} onClick={() => onView('source')} className={`relative inline-flex h-12 items-center gap-2 px-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === 'source' ? 'text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground' : 'text-muted-foreground hover:text-foreground'}`}><Code2 size={16} aria-hidden="true" />源码</button></div>
      <div className="min-w-0 border-t border-transparent p-5 sm:p-6">{view === 'preview' ? preview ? <article><h3 className="text-lg font-semibold">{preview.title}</h3><p className="mt-1 text-sm leading-6 text-muted-foreground">{preview.description}</p>{preview.notice && <div role="status" className="mt-4 rounded-lg border border-warning/30 bg-warning/8 p-3 text-sm">{preview.notice}</div>}<div className="mt-5">{preview.fields.map((field) => <FieldRow key={field.label} label={field.label}>{Array.isArray(field.value) ? field.value.length ? field.value.join('；') : '无' : field.value || '无'}</FieldRow>)}</div></article> : <p className="text-sm text-muted-foreground">当前文件没有结构化预览。</p> : source.status === 'available' ? <><MockBoundaryNote>{sourceDetails.note}</MockBoundaryNote><div className="mt-4 min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-muted/35"><div className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{source.language} · 只读</div><pre className="max-w-full overflow-x-auto p-4 text-[13px] leading-6"><code>{source.content}</code></pre></div></> : <div role="status" className="rounded-lg border border-warning/30 bg-warning/8 p-5"><b>源码不可用</b><p className="mt-2 text-sm text-muted-foreground">{source.message}</p></div>}<details className="mt-8 border-t border-border pt-2"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">完整路径与来源</summary><div className="pb-2 pt-1"><FieldRow label="完整路径"><MonoPath>{`${agent.packagePath}${path}`}</MonoPath></FieldRow><FieldRow label="来源">{sourceDetails.label}</FieldRow><div className="mt-5"><PathActions path={`${agent.packagePath}${path}`} /></div></div></details></div>
    </section>
  </div>
}
