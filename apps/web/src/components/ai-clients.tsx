import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { AppWindow, ChevronDown, Plus, Settings, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import claudeLogo from '../assets/ai-clients/claude.svg'
import openClawLogo from '../assets/ai-clients/openclaw.svg'
import openCodeLogo from '../assets/ai-clients/opencode.svg'
import piLogo from '../assets/ai-clients/pi.svg'
import { launchDescriptor } from '../client-adapters'
import { cn } from '../lib'
import type { AiClient, AiClientKind } from '../mock'
import { useApp } from '../state'
import { Button } from './ui/button'
import { Tooltip } from './ui/tooltip'

const logoMap: Partial<Record<AiClientKind, string>> = {
  'claude-code': claudeLogo,
  'claude-desktop': claudeLogo,
  opencode: openCodeLogo,
  openclaw: openClawLogo,
  pi: piLogo,
}

export function AiClientIcon({ client, size = 18, tile = false }: { client: AiClient; size?: number; tile?: boolean }) {
  const [failed, setFailed] = useState(false)
  const logo = logoMap[client.kind]
  if (!logo || failed) return <span aria-hidden="true" className={cn('grid shrink-0 place-items-center border border-current/20 bg-current/8 font-semibold leading-none', tile ? 'rounded-[22%]' : 'rounded-[5px]')} style={{ width: size, height: size, fontSize: Math.max(7, Math.round(size * 0.36)) }}>{client.shortName}</span>
  return <img src={logo} alt="" aria-hidden="true" width={size} height={size} onError={() => setFailed(true)} className={cn('shrink-0 object-cover', tile && 'rounded-[22%]')} />
}

export function supportsClientLaunch(client: AiClient): boolean {
  return Boolean(launchDescriptor(client.id))
}

const launchMenuContentClass = 'z-[60] min-w-72 max-w-[calc(100vw-24px)] rounded-lg border border-border bg-card p-1.5 text-card-foreground shadow-xl'
const launchMenuItemClass = 'flex min-h-12 cursor-default items-center gap-3 rounded-md px-2.5 py-2 outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-muted'

export function AiClientLaunchAction({ agentId, agentName, disabled = false, className, variant = 'default', compact = false }: { agentId?: string; agentName?: string; disabled?: boolean; className?: string; variant?: 'default' | 'outline' | 'ghost'; compact?: boolean }) {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const environment = state.configurationEnvironments.find((item) => item.id === state.currentConfigurationEnvironmentId)
  const clients = (environment?.clientIds ?? []).map((id) => state.aiClients.find((client) => client.id === id)).filter((client): client is AiClient => Boolean(client))
  const openClient = (client: AiClient) => supportsClientLaunch(client)
    ? dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'client-guide', clientId: client.id, agentId } })
    : navigate('/settings?section=tools')
  if (!clients.length) return <Button className={className} variant={variant} disabled={disabled} title={disabled ? '当前 Agent 已停用或归档，不能接受新指令' : undefined} onClick={() => navigate('/settings?section=tools')}><AppWindow size={16} aria-hidden="true" /><span>{compact ? '选择 AI 工具' : '选择要管理的 AI 编程工具'}</span></Button>
  if (clients.length === 1) {
    const client = clients[0]
    const launch = supportsClientLaunch(client)
    const disabledReason = disabled ? '当前 Agent 已停用或归档，不能接受新指令' : undefined
    return <Button className={className} variant={variant} disabled={disabled} title={disabledReason} aria-label={disabledReason} onClick={() => openClient(client)}><AiClientIcon client={client} size={16} /><span>{compact ? client.name : launch ? agentName ? `使用 ${agentName} 继续` : `在 ${client.name} 中继续` : `查看 ${client.name} 配置`}</span></Button>
  }
  const launchClients = clients.filter(supportsClientLaunch)
  const configClients = clients.filter((client) => !supportsClientLaunch(client))
  const item = (client: AiClient) => {
    const launch = supportsClientLaunch(client)
    return <DropdownMenu.Item key={client.id} disabled={disabled} className={launchMenuItemClass} onSelect={() => openClient(client)}><AiClientIcon client={client} size={22} /><span className="min-w-0"><b className="block text-sm">{client.name}</b><small className="block text-muted-foreground">{disabled ? '当前 Agent 不能接受新指令' : launch ? agentName ? `使用 ${agentName} 继续` : '选择 Agent 与可选上下文' : '仅管理配置 · 暂不支持直接打开'}</small></span></DropdownMenu.Item>
  }
  return <DropdownMenu.Root><DropdownMenu.Trigger asChild><Button className={className} variant={variant} disabled={disabled} title={disabled ? '当前 Agent 已停用或归档，不能接受新指令' : undefined}>{compact && <AppWindow size={16} aria-hidden="true" />}<span>{agentName ? `使用 ${agentName} 继续` : compact ? '选择 AI 工具' : '选择 AI 编程工具'}</span><ChevronDown size={15} aria-hidden="true" /></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={6} className={launchMenuContentClass}>{launchClients.length > 0 && <><DropdownMenu.Label className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-muted-foreground">可继续使用</DropdownMenu.Label>{launchClients.map(item)}</>}{configClients.length > 0 && <>{launchClients.length > 0 && <DropdownMenu.Separator className="my-1 h-px bg-border" />}<DropdownMenu.Label className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-muted-foreground">仅配置</DropdownMenu.Label>{configClients.map(item)}</>}<DropdownMenu.Separator className="my-1 h-px bg-border" /><DropdownMenu.Item className={launchMenuItemClass} onSelect={() => navigate('/settings?section=tools')}><Settings size={18} aria-hidden="true" /><span className="text-sm font-medium">管理 AI 编程工具</span></DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
}

function addCustomClient(name: string, clients: AiClient[], dispatch: ReturnType<typeof useApp>['dispatch']) {
  const normalizedName = name.trim()
  const slug = normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  dispatch({ type: 'ADD_CUSTOM_AI_CLIENT', client: { id: `custom-${slug || 'client'}-${clients.filter((client) => client.kind === 'custom').length + 1}`, kind: 'custom', name: normalizedName, shortName: normalizedName.slice(0, 2).toUpperCase(), description: '用户添加的自定义演示工具', detection: 'not-checked', persistence: 'memory-only' } })
}

function CustomClientDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { state, dispatch } = useApp()
  const [name, setName] = useState('')
  const normalizedName = name.trim()
  const duplicate = state.aiClients.some((client) => client.name.toLowerCase() === normalizedName.toLowerCase())
  const close = () => { setName(''); onOpenChange(false) }
  const submit = () => { if (!normalizedName || duplicate) return; addCustomClient(normalizedName, state.aiClients, dispatch); close() }
  return <Dialog.Root open={open} onOpenChange={(next) => next ? onOpenChange(true) : close()}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[60] bg-black/35 backdrop-blur-[2px]" /><Dialog.Content className="fixed left-1/2 top-1/2 z-[70] w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-2xl outline-none"><div className="flex items-start justify-between gap-4"><div><Dialog.Title className="text-lg font-semibold">添加自定义 AI 编程工具</Dialog.Title><Dialog.Description className="mt-1 text-sm leading-6 text-muted-foreground">这里只记录 Bandi 要管理的工具，不会安装、检查或连接这些工具。</Dialog.Description></div><Tooltip content="关闭" side="left"><Dialog.Close className="rounded-md p-2 text-muted-foreground hover:bg-muted" aria-label="关闭"><X size={18} /></Dialog.Close></Tooltip></div><label htmlFor="custom-client-name" className="mt-5 block text-sm font-medium">工具名称</label><input id="custom-client-name" autoFocus className="mt-2 h-10 w-full px-3" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit() }} aria-invalid={duplicate || undefined} aria-describedby={duplicate ? 'custom-client-error' : undefined} />{duplicate && normalizedName && <p id="custom-client-error" className="mt-2 text-xs text-danger">该工具名称已存在。</p>}<div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={close}>取消</Button><Button disabled={!normalizedName || duplicate} onClick={submit}>添加</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>
}

export function AiClientManagementSection() {
  const { state, dispatch } = useApp()
  const [customOpen, setCustomOpen] = useState(false)
  const customTriggerRef = useRef<HTMLButtonElement>(null)
  const environment = state.configurationEnvironments.find((item) => item.id === state.currentConfigurationEnvironmentId) ?? state.configurationEnvironments[0]
  const setCustomDialogOpen = (open: boolean) => {
    setCustomOpen(open)
    if (!open) requestAnimationFrame(() => customTriggerRef.current?.focus())
  }
  return <><section className="panel overflow-hidden"><div className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-5 py-4"><div><b>AI 编程工具</b><p className="mt-1 text-xs text-muted-foreground">这里只记录当前配置方案管理哪些工具，不表示工具已经安装或可以使用。</p></div><div className="flex flex-wrap items-end gap-2"><label className="text-xs font-medium">当前配置方案<select aria-label="当前配置方案" className="mt-1 block h-9 min-w-40 px-3 text-sm" value={environment?.id ?? ''} onChange={(event) => dispatch({ type: 'SELECT_CONFIGURATION_ENVIRONMENT', environmentId: event.target.value })}>{state.configurationEnvironments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><Button ref={customTriggerRef} size="sm" onClick={() => setCustomOpen(true)}><Plus size={15} />添加工具</Button></div></div><div className="border-b border-warning/20 bg-warning/8 px-5 py-3 text-xs text-warning">尚未检查这台电脑上的工具；配置方案与加入状态仅在当前页面有效。</div><div className="divide-y divide-border">{state.aiClients.map((client) => { const registered = environment?.clientIds.includes(client.id) ?? false; const launch = supportsClientLaunch(client); return <div key={client.id} className="grid gap-4 px-5 py-4 sm:grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)_auto] sm:items-center"><div className="flex items-center gap-3"><span className="grid size-10 shrink-0 place-items-center"><AiClientIcon client={client} size={40} tile /></span><div><b className="block">{client.name}</b><span className="text-xs text-muted-foreground">{launch ? '可选择 Agent 与上下文 · 尚未检查是否已安装' : '仅管理配置 · 暂不支持直接打开'}</span></div></div><div className="text-xs leading-5 text-muted-foreground"><div>{client.description}</div><div>{registered ? `已纳入“${environment?.name}”` : `未纳入“${environment?.name}”`}</div></div><div className="flex flex-wrap justify-end gap-2"><Button variant="outline" size="sm" onClick={() => environment && dispatch({ type: 'SET_ENVIRONMENT_CLIENT_REGISTRATION', environmentId: environment.id, clientId: client.id, registered: !registered })}>{registered ? '从方案移除' : '加入配置方案'}</Button></div></div> })}</div><CustomClientDialog open={customOpen} onOpenChange={setCustomDialogOpen} /></section></>
}
