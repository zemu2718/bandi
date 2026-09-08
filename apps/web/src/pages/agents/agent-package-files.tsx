import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, ChevronRight, File, Folder, ListTree, RefreshCw } from 'lucide-react'
import { buildAgentPackageTree, type AgentPackageNode } from '../../agent-package'
import type { AgentFile, FullAgent } from '../../domain'
import type { AgentFileView, AgentProjectionContext } from '../../agent-config-projection'
import { EmptyState, MockBoundaryNote, MonoPath, StatusBadge } from '../../components/app/page'
import { Button } from '../../components/ui/button'
import { Sheet } from '../../components/ui/sheet'
import { useApp } from '../../state'
import { AgentConfigFileViewer } from './agent-config-file-viewer'

export function AgentPackageBrowser({ agent, context, path, view, onSelect, onView }: { agent: FullAgent; context: AgentProjectionContext; path?: string; view: AgentFileView; onSelect: (path: string) => void; onView: (view: AgentFileView) => void }) {
  const { state, hydrateDesktop } = useApp()
  const [treeOpen, setTreeOpen] = useState(false)
  const compatibilityLabel = { current: 'v1 · 当前兼容', legacy: '旧版 · 只读', future: '更高版本 · 只读', unverified: '未验证 · 只读' }[agent.packageSchema.compatibility]
  const compatibilityTone = agent.packageSchema.compatibility === 'current' ? 'success' : 'warning'
  const sourceDetails = {
    'bandi-managed': { label: 'Bandi Desktop 创建', note: '目录来自 Bandi Desktop 已加载的受管配置。' },
    'claude-agent-import': { label: 'Claude Agent 受管副本', note: '目录是导入后的 Bandi 受管副本；原始 Claude Agent 文件保持只读。' },
    'bandi-demo': { label: '当前页面演示', note: '目录只展示当前页面中的文件记录，不读取或写入本机文件。' },
    'external-reference': { label: '历史外部只读引用', note: '这里只展示历史记录，未读取对应目录内容，也不再支持添加。' },
  }[agent.packageSource.kind]
  if (!agent.files.length) {
    const managed = agent.packageSource.kind === 'bandi-managed' || agent.packageSource.kind === 'claude-agent-import'
    const empty = agent.packageSource.kind === 'external-reference'
      ? { title: '历史外部目录未被读取', description: '此记录仅展示历史引用位置。Bandi 不扫描该目录，也不再支持添加，因此不会显示文件树。' }
      : agent.packageSource.kind === 'bandi-demo'
        ? { title: '当前演示没有文件记录', description: '这里只展示当前页面中的文件记录，不代表本机 Agent 配置，也不会读取或创建文件。' }
        : { title: '尚未读取到配置文件', description: '当前受管目录未返回可展示的配置文件。重新读取只会更新当前显示，不会创建、补齐或修改文件。' }
    const loading = state.hydration.managedAgents === 'loading'
    return <div className="space-y-4"><div className="flex flex-wrap gap-2"><StatusBadge tone={compatibilityTone}>{compatibilityLabel}</StatusBadge><StatusBadge tone={agent.packageSource.kind === 'external-reference' ? 'warning' : 'success'}>{sourceDetails.label}</StatusBadge></div><MonoPath>{agent.packagePath}</MonoPath><EmptyState title={empty.title} description={empty.description} action={managed ? <Button onClick={hydrateDesktop} disabled={loading}><RefreshCw size={16} aria-hidden="true" />{loading ? '读取中…' : '重新读取'}</Button> : undefined} /></div>
  }
  const selectFromSheet = (nextPath: string) => { onSelect(nextPath); setTreeOpen(false) }
  const tree = <><AgentPackageTree files={agent.files} selectedPath={path} onSelect={onSelect} ariaLabel={`${agent.name} Agent 配置目录`} /><div className="p-3 pt-0"><MockBoundaryNote>{sourceDetails.note}</MockBoundaryNote></div></>
  return <div className="min-w-0"><div className="mb-4 flex flex-wrap items-center justify-between gap-3 xl:hidden"><Button variant="outline" onClick={() => setTreeOpen(true)}><ListTree size={16} aria-hidden="true" />选择文件</Button>{path && <MonoPath>{path}</MonoPath>}</div><div className="grid min-w-0 gap-5 xl:grid-cols-[280px_minmax(0,1fr)]"><aside aria-label="Agent 配置目录" className="panel hidden min-w-0 overflow-hidden xl:block"><div className="border-b border-border px-4 py-4"><div className="label">Agent 配置</div><div className="mt-2 flex flex-wrap gap-2"><StatusBadge tone={compatibilityTone}>{compatibilityLabel}</StatusBadge><StatusBadge tone={agent.packageSource.kind === 'external-reference' ? 'warning' : 'success'}>{sourceDetails.label}</StatusBadge></div><div className="mt-3 space-y-1 text-xs text-muted-foreground"><p>{agent.files.length} 个文件</p><MonoPath>{agent.packagePath}</MonoPath></div></div>{tree}</aside><section aria-label="文件内容" className="min-w-0">{path ? <AgentConfigFileViewer agent={agent} context={context} path={path} view={view} onView={onView} embedded /> : <div className="panel p-5 text-sm text-muted-foreground">选择一个文件查看结构化预览或只读源码。</div>}</section></div><Sheet open={treeOpen} onOpenChange={setTreeOpen} title="选择配置文件" description={`${agent.name} · ${agent.files.length} 个文件记录`} side="left" navigation><AgentPackageTree files={agent.files} selectedPath={path} onSelect={selectFromSheet} ariaLabel={`${agent.name} 配置文件选择`} /><MockBoundaryNote>{sourceDetails.note}</MockBoundaryNote></Sheet></div>
}

export function AgentPackageTree({ files, selectedPath, onSelect, ariaLabel }: { files: AgentFile[]; selectedPath?: string; onSelect: (path: string) => void; ariaLabel: string }) {
  const tree = useMemo(() => buildAgentPackageTree(files), [files])
  const [expanded, setExpanded] = useState(() => new Set(selectedPath ? ancestorPaths(selectedPath) : ['config', 'memory']))
  const visibleNodes = useMemo(() => flattenVisibleNodes(tree, expanded), [expanded, tree])
  const [focusedPath, setFocusedPath] = useState(selectedPath ?? visibleNodes[0]?.path)
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>())
  const typeahead = useRef({ value: '', at: 0 })

  useEffect(() => {
    if (!selectedPath) return
    setExpanded((current) => new Set([...current, ...ancestorPaths(selectedPath)]))
    setFocusedPath(selectedPath)
  }, [selectedPath])

  useEffect(() => {
    if (!visibleNodes.some((item) => item.path === focusedPath)) setFocusedPath(visibleNodes[0]?.path)
  }, [focusedPath, visibleNodes])

  const toggle = (path: string, open?: boolean) => setExpanded((current) => {
    const next = new Set(current)
    const shouldOpen = open ?? !next.has(path)
    if (shouldOpen) next.add(path)
    else next.delete(path)
    return next
  })
  const focusNode = (path: string) => {
    setFocusedPath(path)
    buttonRefs.current.get(path)?.focus()
  }
  const onTreeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, node: AgentPackageNode) => {
    const index = visibleNodes.findIndex((item) => item.path === node.path)
    if (event.key === 'ArrowDown' && index < visibleNodes.length - 1) focusNode(visibleNodes[index + 1].path)
    else if (event.key === 'ArrowUp' && index > 0) focusNode(visibleNodes[index - 1].path)
    else if (event.key === 'Home' && visibleNodes[0]) focusNode(visibleNodes[0].path)
    else if (event.key === 'End' && visibleNodes.at(-1)) focusNode(visibleNodes.at(-1)!.path)
    else if (event.key === 'ArrowRight' && node.kind === 'directory') {
      if (!expanded.has(node.path)) toggle(node.path, true)
      else if (node.children[0]) focusNode(node.children[0].path)
    } else if (event.key === 'ArrowLeft') {
      if (node.kind === 'directory' && expanded.has(node.path)) toggle(node.path, false)
      else {
        const parentPath = node.path.split('/').slice(0, -1).join('/')
        if (parentPath) focusNode(parentPath)
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (node.kind === 'directory') toggle(node.path)
      else onSelect(node.path)
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now()
      const value = now - typeahead.current.at > 700 ? event.key : `${typeahead.current.value}${event.key}`
      typeahead.current = { value: value.toLocaleLowerCase(), at: now }
      const candidates = [...visibleNodes.slice(index + 1), ...visibleNodes.slice(0, index + 1)]
      const match = candidates.find((item) => item.name.toLocaleLowerCase().startsWith(typeahead.current.value))
      if (match) focusNode(match.path)
    } else return
    event.preventDefault()
  }

  if (!tree.length) return <p className="p-3 text-sm text-muted-foreground">当前 Agent 配置没有文件记录。</p>
  return <div role="tree" aria-label={ariaLabel} className="max-h-[430px] overflow-auto p-2">{tree.map((node) => <TreeNode key={node.path} node={node} level={1} expanded={expanded} selectedPath={selectedPath} focusedPath={focusedPath} buttonRefs={buttonRefs.current} onToggle={toggle} onSelect={onSelect} onFocus={setFocusedPath} onKeyDown={onTreeKeyDown} />)}</div>
}

function ancestorPaths(path: string): string[] {
  const segments = path.split('/')
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'))
}

function flattenVisibleNodes(nodes: AgentPackageNode[], expanded: Set<string>): AgentPackageNode[] {
  return nodes.flatMap((node) => [node, ...(node.kind === 'directory' && expanded.has(node.path) ? flattenVisibleNodes(node.children, expanded) : [])])
}

type TreeNodeProps = {
  node: AgentPackageNode
  level: number
  expanded: Set<string>
  selectedPath?: string
  focusedPath?: string
  buttonRefs: Map<string, HTMLButtonElement>
  onToggle: (path: string, open?: boolean) => void
  onSelect: (path: string) => void
  onFocus: (path: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, node: AgentPackageNode) => void
}

function TreeNode({ node, level, expanded, selectedPath, focusedPath, buttonRefs, onToggle, onSelect, onFocus, onKeyDown }: TreeNodeProps) {
  const open = expanded.has(node.path)
  const Icon = node.kind === 'directory' ? Folder : File
  return <div><button ref={(element) => { if (element) buttonRefs.set(node.path, element); else buttonRefs.delete(node.path) }} type="button" role="treeitem" aria-level={level} aria-expanded={node.kind === 'directory' ? open : undefined} aria-selected={node.kind === 'file' ? selectedPath === node.path : undefined} tabIndex={focusedPath === node.path ? 0 : -1} onFocus={() => onFocus(node.path)} onKeyDown={(event) => onKeyDown(event, node)} onClick={() => node.kind === 'directory' ? onToggle(node.path) : onSelect(node.path)} className={`flex min-h-11 w-full items-center gap-2 rounded-md pr-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedPath === node.path ? 'bg-foreground text-background' : ''}`} style={{ paddingLeft: `${(level - 1) * 16 + 8}px` }}>{node.kind === 'directory' ? open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" /> : <span className="w-3.5" />}<Icon size={15} aria-hidden="true" /><span className="truncate">{node.name}</span></button>{node.kind === 'directory' && open && <div role="group">{node.children.map((child) => <TreeNode key={child.path} node={child} level={level + 1} expanded={expanded} selectedPath={selectedPath} focusedPath={focusedPath} buttonRefs={buttonRefs} onToggle={onToggle} onSelect={onSelect} onFocus={onFocus} onKeyDown={onKeyDown} />)}</div>}</div>
}
