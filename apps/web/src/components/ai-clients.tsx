import { AppWindow, ChevronDown, Settings } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import chatGptLogo from '../assets/ai-clients/chatgpt.png'
import claudeLogo from '../assets/ai-clients/claude.svg'
import geminiCliLogo from '../assets/ai-clients/gemini-cli.png'
import grokBuildLogo from '../assets/ai-clients/grok-build.webp'
import hermesLogo from '../assets/ai-clients/hermes.png'
import openClawLogo from '../assets/ai-clients/openclaw.svg'
import openCodeLogo from '../assets/ai-clients/opencode.svg'
import piLogo from '../assets/ai-clients/pi.svg'
import { launchDescriptor } from '../client-adapters'
import { cn } from '../lib'
import type { AiClient, AiClientKind } from '../mock'
import { useApp } from '../state'
import { Button } from './ui/button'

const logoMap: Record<AiClientKind, string> = {
  'claude-code': claudeLogo,
  'claude-desktop': claudeLogo,
  codex: chatGptLogo,
  'gemini-cli': geminiCliLogo,
  'grok-build': grokBuildLogo,
  opencode: openCodeLogo,
  openclaw: openClawLogo,
  hermes: hermesLogo,
  pi: piLogo,
}

export function AiClientIcon({ client, size = 18, tile = false }: { client: AiClient; size?: number; tile?: boolean }) {
  const [failed, setFailed] = useState(false)
  const logo = logoMap[client.kind]
  if (failed) return <span aria-hidden="true" className={cn('grid shrink-0 place-items-center border border-current/20 bg-current/8 font-semibold leading-none', tile ? 'rounded-[22%]' : 'rounded-[5px]')} style={{ width: size, height: size, fontSize: Math.max(7, Math.round(size * 0.36)) }}>{client.shortName}</span>
  return <img src={logo} alt="" aria-hidden="true" width={size} height={size} onError={() => setFailed(true)} className={cn('shrink-0 object-cover', tile && 'rounded-[22%] border border-black/5 bg-white')} />
}

export function supportsClientLaunch(client: AiClient): boolean {
  return Boolean(launchDescriptor(client.id))
}

const launchMenuContentClass = 'z-[60] min-w-72 max-w-[calc(100vw-24px)] rounded-lg border border-border bg-card p-1.5 text-card-foreground shadow-xl'
const launchMenuItemClass = 'flex min-h-12 cursor-default items-center gap-3 rounded-md px-2.5 py-2 outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-muted'

export function AiClientLaunchAction({ agentId, agentName, disabled = false, className, variant = 'default', compact = false }: { agentId?: string; agentName?: string; disabled?: boolean; className?: string; variant?: 'default' | 'outline' | 'ghost'; compact?: boolean }) {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const clients = state.aiClients
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])
  const openClient = (client: AiClient) => {
    setMenuOpen(false)
    dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'client-guide', clientId: client.id, agentId } })
  }
  const item = (client: AiClient) => <button key={client.id} type="button" role="menuitem" disabled={disabled} className={`${launchMenuItemClass} w-full text-left`} onClick={() => openClient(client)}><AiClientIcon client={client} size={22} /><span className="min-w-0"><b className="block text-sm">{client.name}</b><small className="block text-muted-foreground">{disabled ? '当前 Agent 不能接受新指令' : agentName ? `使用 ${agentName} 继续` : '选择 Agent 与可选上下文'}</small></span></button>
  if (clients.length === 1) {
    const client = clients[0]
    const disabledReason = disabled ? '当前 Agent 已停用或归档，不能接受新指令' : undefined
    return <Button className={className} variant={variant} disabled={disabled} title={disabledReason} aria-label={disabledReason} onClick={() => openClient(client)}><AiClientIcon client={client} size={16} /><span>{compact ? client.name : agentName ? `使用 ${agentName} 继续` : `在 ${client.name} 中继续`}</span></Button>
  }
  return <div ref={menuRef} className="relative inline-flex"><Button className={className} variant={variant} disabled={disabled} title={disabled ? '当前 Agent 已停用或归档，不能接受新指令' : undefined} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>{compact && <AppWindow size={16} aria-hidden="true" />}<span>{agentName ? `使用 ${agentName} 继续` : compact ? '选择 AI 工具' : '选择 AI 编程工具'}</span><ChevronDown size={15} aria-hidden="true" /></Button>{menuOpen && <div role="menu" className={`absolute right-0 top-full mt-1.5 ${launchMenuContentClass}`}><div className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold text-muted-foreground">选择 AI 编程工具</div>{clients.map(item)}<div className="my-1 h-px bg-border" /><button type="button" role="menuitem" className={`${launchMenuItemClass} w-full text-left`} onClick={() => navigate('/tools')}><Settings size={18} aria-hidden="true" /><span className="text-sm font-medium">管理 AI 编程工具</span></button></div>}</div>
}
