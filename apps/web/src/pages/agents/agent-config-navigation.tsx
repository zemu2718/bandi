import { FileCode2 } from 'lucide-react'
import { type AgentConfigSection, type AgentFileAssociation } from '../../agent-config-projection'
import { StatusBadge, toneForStatus } from '../../components/app/page'

const managementGroups: Array<{ label: string; items: Array<{ id: Exclude<AgentConfigSection, 'package'>; label: string }> }> = [
  { label: '核心定义', items: [{ id: 'overview', label: '概览' }, { id: 'identity', label: '身份与职责' }, { id: 'instructions', label: '主指令' }] },
  { label: '能力与知识', items: [{ id: 'context', label: '上下文' }, { id: 'skills', label: '技能' }, { id: 'memory', label: '长期记忆' }, { id: 'rules', label: '规则' }, { id: 'mcp', label: '工具连接' }] },
  { label: '权限设置', items: [{ id: 'permissions', label: '权限' }] },
  { label: '流程', items: [{ id: 'sop', label: '标准流程' }] },
]

export function AgentConfigNavigation({ active, onSelect }: { active: Exclude<AgentConfigSection, 'package'>; onSelect: (section: AgentConfigSection) => void }) {
  return <>
    <nav aria-label="Agent 配置领域" className="hidden space-y-4 xl:block">
      {managementGroups.map((group) => <div key={group.label}><div className="label mb-1.5 px-2">{group.label}</div><div className="space-y-0.5">{group.items.map((item) => <button key={item.id} type="button" aria-current={active === item.id ? 'page' : undefined} onClick={() => onSelect(item.id)} className={`flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active === item.id ? 'bg-foreground font-medium text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>{item.label}</button>)}</div></div>)}
    </nav>
    <label className="block text-sm font-medium xl:hidden">配置领域<select value={active} onChange={(event) => onSelect(event.target.value as AgentConfigSection)} className="mt-2 min-h-11 w-full px-3">{managementGroups.map((group) => <optgroup key={group.label} label={group.label}>{group.items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></label>
  </>
}

export function AgentConfigFilesNav({ files, selectedPath, onStructured, onSelect }: { files: AgentFileAssociation[]; selectedPath?: string; onStructured: () => void; onSelect: (path: string) => void }) {
  return <>
    <nav aria-label="当前配置关联文件" className="hidden border-t border-border pt-4 xl:block">
      <div className="label mb-3 px-2">关联文件</div>
      <button type="button" aria-current={!selectedPath ? 'page' : undefined} onClick={onStructured} className={`flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${!selectedPath ? 'bg-muted font-medium' : 'hover:bg-muted'}`}><FileCode2 size={15} aria-hidden="true" />结构化配置</button>
      {files.map(({ file }) => <button key={file.path} type="button" aria-current={selectedPath === file.path ? 'page' : undefined} onClick={() => onSelect(file.path)} className={`mt-1 flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedPath === file.path ? 'bg-muted font-medium' : 'hover:bg-muted'}`}><span className="min-w-0 truncate font-mono text-xs">{file.path}</span><StatusBadge tone={toneForStatus(file.status)}>{file.status}</StatusBadge></button>)}
      {!files.length && <p className="px-3 py-2 text-xs text-muted-foreground">当前配置没有关联文件。</p>}
    </nav>
    <label className="mt-4 block text-sm font-medium xl:hidden">查看内容<select value={selectedPath ?? ''} onChange={(event) => event.target.value ? onSelect(event.target.value) : onStructured()} className="mt-2 min-h-11 w-full px-3"><option value="">结构化配置</option>{files.map(({ file }) => <option key={file.path} value={file.path}>{file.path}</option>)}</select></label>
  </>
}
