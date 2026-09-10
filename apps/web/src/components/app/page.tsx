import { createContext, useContext, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Copy, Info } from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '../../lib'
import { useApp } from '../../state'

const PageHeaderTargetContext = createContext<HTMLElement | null>(null)

export function PageHeaderTargetProvider({ target, children }: { target: HTMLElement | null; children: ReactNode }) {
  return <PageHeaderTargetContext value={target}>{children}</PageHeaderTargetContext>
}

export function PageHeader({ title, description, action, leading }: { title: string; description?: string; action?: ReactNode; leading?: ReactNode }) {
  const target = useContext(PageHeaderTargetContext)
  const content = <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-4"><div className="flex min-w-0 items-center gap-3">{leading}<div className="min-w-0"><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{description && <p className="mt-1 max-w-4xl text-sm leading-6 text-muted-foreground">{description}</p>}</div></div>{action}</div>
  if (target) return createPortal(<div className="flex min-w-0 flex-1 flex-wrap items-center gap-4">{content}</div>, target)
  return <div className="mb-6 space-y-4">{content}</div>
}

export type Tone = 'success' | 'warning' | 'danger' | 'neutral'
export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={cn('status text-xs', tone === 'success' && 'status-good', tone === 'warning' && 'status-warn', tone === 'danger' && 'border-danger/30 bg-danger/8 text-danger', tone === 'neutral' && 'border-border bg-muted text-muted-foreground')}>{children}</span>
}

export function toneForStatus(value: string): Tone {
  if (/完整|已保存|启用|已配置|有效|已写入/.test(value)) return 'success'
  if (/冲突|危险|失败|缺少|缺失/.test(value)) return 'danger'
  if (/外部|待|未知|暂停|未/.test(value)) return 'warning'
  return 'neutral'
}

export function MonoPath({ children }: { children: ReactNode }) {
  return <code className="mono break-words [overflow-wrap:anywhere] text-xs text-muted-foreground">{children}</code>
}

export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid gap-2 border-b border-border py-3 last:border-0 sm:grid-cols-[160px_1fr]"><div className="text-sm text-muted-foreground">{label}</div><div className="min-w-0 text-sm">{children}</div></div>
}

export function EntityTabs({ tabs, active, onChange, scope = 'detail', ariaLabel = '详情页签', variant = 'underline', className, tabListClassName }: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void; scope?: string; ariaLabel?: string; variant?: 'underline' | 'segmented'; className?: string; tabListClassName?: string }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const activate = (index: number) => { const tab = tabs[(index + tabs.length) % tabs.length]; onChange(tab.id); requestAnimationFrame(() => refs.current[tab.id]?.focus()) }
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Home') activate(0)
    else if (event.key === 'End') activate(tabs.length - 1)
    else activate(index + (event.key === 'ArrowRight' ? 1 : -1))
  }
  return <div className={cn('overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', variant === 'underline' && 'mb-5 border-b border-border', className)}><div className={cn('flex min-w-max', variant === 'segmented' && 'rounded-xl bg-muted/50 p-1', tabListClassName)} role="tablist" aria-label={ariaLabel}>{tabs.map((tab, index) => { const selected = active === tab.id; return <button ref={(node) => { refs.current[tab.id] = node }} id={`${scope}-tab-${tab.id}`} aria-controls={`${scope}-panel-${tab.id}`} key={tab.id} type="button" role="tab" tabIndex={selected ? 0 : -1} aria-selected={selected} onKeyDown={(event) => onKeyDown(event, index)} onClick={() => onChange(tab.id)} style={variant === 'segmented' ? { fontWeight: selected ? 600 : 400 } : undefined} className={cn('min-h-11 px-3 text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', variant === 'underline' ? 'border-b-2 border-transparent py-3 focus-visible:ring-inset' : 'shrink-0 whitespace-nowrap rounded-lg px-4', selected && (variant === 'underline' ? 'border-foreground font-medium text-foreground' : 'bg-background text-foreground shadow-sm'))}>{tab.label}</button> })}</div></div>
}

export function EntityTabPanel({ tabId, activeTab, children, scope = 'detail', className }: { tabId: string; activeTab: string; children: ReactNode; scope?: string; className?: string }) {
  if (tabId !== activeTab) return null
  return <div id={`${scope}-panel-${tabId}`} role="tabpanel" aria-labelledby={`${scope}-tab-${tabId}`} tabIndex={0} className={className}>{children}</div>
}

export function MockBoundaryNote({ children = '所有业务更改仅在当前页面有效；不会访问本机、执行命令或写入文件。' }: { children?: ReactNode }) {
  return <div className="flex gap-3 rounded-lg border border-border bg-muted/45 p-4 text-sm leading-6 text-muted-foreground"><Info size={18} aria-hidden="true" className="mt-0.5 shrink-0" /><div>{children}</div></div>
}

export function EmptyState({ title, description, action, className }: { title: string; description?: string; action?: ReactNode; className?: string }) {
  return <div className={cn('rounded-lg border border-dashed border-border p-8 text-center', className)}><b>{title}</b>{description && <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">{description}</p>}{action && <div className="mt-4">{action}</div>}</div>
}

export function EntityNotFound({ entity, backTo }: { entity: string; backTo: string }) {
  return <div className="panel mx-auto max-w-2xl p-8 text-center"><h1 className="text-xl font-semibold">未找到{entity}</h1><p className="mt-2 text-sm text-muted-foreground">请检查链接是否正确，或返回列表重新选择。</p><Button className="mt-5" asChild><Link to={backTo}>返回列表</Link></Button></div>
}

export function PathActions({ path }: { path: string }) {
  const { dispatch } = useApp()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(path)
      dispatch({ type: 'SHOW_NOTICE', notice: { tone: 'success', title: '路径已复制', description: path } })
    } catch {
      dispatch({ type: 'SHOW_NOTICE', notice: { tone: 'error', title: '复制失败', description: '系统未允许访问剪贴板，请手动选择并复制。' } })
    }
  }
  return <Button variant="outline" size="sm" onClick={() => void copy()}><Copy size={14} aria-hidden="true" />复制路径</Button>
}
