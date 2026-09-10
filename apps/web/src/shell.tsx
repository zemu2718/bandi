import { useCallback, useEffect, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleX,
  Info,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  Moon,
  Settings,
  Sun,
  ClipboardList,
  Workflow,
  Wrench,
} from 'lucide-react'
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { PageHeaderTargetProvider } from './components/app/page'
import { Button } from './components/ui/button'
import { Tooltip } from './components/ui/tooltip'
import { GlobalSheets } from './sheets'
import { useApp } from './state'
import { cn } from './lib'
import { executeAppCommand, isAppCommandId, type AppCommandId } from './app-commands'
import { isDesktopRuntime, listenForDesktopCommands, readUiAsset, setDesktopTitle } from './desktop-bridge'
import { useEditorSession } from './editor-session'
import { formatWindowTitle, resolveRouteMetadata } from './route-metadata'
import { getConfigurationStatusSummary } from './domain-selectors'
import { resolveTeamIdentity } from './team-identity'

const nav = [
  ['/tasks', '需求池', ClipboardList],
  ['/agents', 'Agent', Bot],
  ['/assets', '配置资产', Workflow],
  ['/tools', 'AI 工具', Wrench],
] as const

type HistoryBounds = { index: number; maxIndex: number }

function readRouterHistoryIndex() {
  const index = window.history.state?.idx
  return Number.isSafeInteger(index) && index >= 0 ? index as number : undefined
}

function useMediaQuery(query: string) {
  const getMatches = () => typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(query).matches
  const [matches, setMatches] = useState(getMatches)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])

  return matches
}

const railLinkClass = ({ isActive, expanded }: { isActive: boolean; expanded: boolean }) => cn(
  'relative flex min-h-10 w-full shrink-0 items-center gap-3 rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  expanded ? 'px-3' : 'justify-center px-0',
  isActive && 'bg-foreground text-background hover:bg-foreground hover:text-background',
)

const menuContentClass = 'z-50 min-w-40 rounded-lg border border-border bg-card p-1 text-sm text-foreground shadow-lg'
const menuItemClass = 'flex min-h-9 cursor-default select-none items-center rounded-md px-2.5 outline-none data-[highlighted]:bg-muted data-[highlighted]:text-foreground'

function TeamSwitcher({ expanded }: { expanded: boolean }) {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()
  const current = state.teams.find((team) => team.id === state.currentTeamId)
  if (!current) return null
  const label = `切换 Team，当前为${current.name}`
  const identity = resolveTeamIdentity(current)
  const trigger = <DropdownMenu.Trigger asChild>
    <Button variant="ghost" className={cn('min-h-10 w-full gap-3 rounded-xl px-2.5', !expanded && 'justify-center px-0')} aria-label={label}>
      <span className="grid size-10 shrink-0 place-items-center rounded-xl text-xs font-semibold" style={{ backgroundColor: identity.color, color: identity.foreground }} aria-hidden="true">{identity.mark}</span>
      {expanded && <><span className="min-w-0 flex-1 truncate text-left text-sm font-medium">{current.name}</span><ChevronDown size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" /></>}
    </Button>
  </DropdownMenu.Trigger>
  return <DropdownMenu.Root>
    {expanded ? trigger : <Tooltip content={label} side="right" triggerClassName="w-full">{trigger}</Tooltip>}
    <DropdownMenu.Portal>
      <DropdownMenu.Content align="start" side="right" sideOffset={8} className={menuContentClass}>
        <DropdownMenu.Label className="px-2.5 py-1.5 text-xs text-muted-foreground">选择 Team</DropdownMenu.Label>
        {state.teams.map((team) => {
          const teamIdentity = resolveTeamIdentity(team)
          return <DropdownMenu.Item key={team.id} className={`${menuItemClass} gap-2.5`} onSelect={() => {
            dispatch({ type: 'SELECT_TEAM', teamId: team.id })
            navigate('/agents')
          }}><span className="grid size-7 shrink-0 place-items-center rounded-lg text-[10px] font-semibold" style={{ backgroundColor: teamIdentity.color, color: teamIdentity.foreground }} aria-hidden="true">{teamIdentity.mark}</span><span className="min-w-0 flex-1 truncate">{team.name}</span>{team.id === current.id && <span className="ml-3 text-xs text-muted-foreground">当前</span>}</DropdownMenu.Item>
        })}
        <DropdownMenu.Separator className="my-1 h-px bg-border" />
        <DropdownMenu.Item className={menuItemClass} onSelect={() => navigate(`/organization/teams/${encodeURIComponent(current.id)}`)}>管理当前 Team</DropdownMenu.Item>
        <DropdownMenu.Item className={menuItemClass} onSelect={() => dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'organization', entity: 'team', mode: 'create', returnTo: '/agents' } })}>新建 Team</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
}

function RailNavigation({ expanded }: { expanded: boolean }) {
  return <nav className="flex w-full flex-col gap-2" aria-label="一级导航">
    {nav.map(([to, label, Icon]) => {
      const link = <NavLink to={to} aria-label={label} className={(props) => railLinkClass({ ...props, expanded })}>
        <Icon size={18} className="shrink-0" aria-hidden="true" />
        {expanded && <span className="truncate text-sm font-medium">{label}</span>}
      </NavLink>
      return expanded ? <div key={to}>{link}</div> : <Tooltip key={to} content={label} side="right" triggerClassName="w-full">{link}</Tooltip>
    })}
  </nav>
}

export function Shell() {
  const { state, dispatch, effectiveUiPreferences, effectiveTheme, uiPreviewAssets } = useApp()
  const resetTerminal = ['committed', 'restarting', 'manual-restart-required'].includes(state.factoryReset.status)
  const isWideViewport = useMediaQuery('(min-width: 1280px)')
  const canFitExpandedMenu = useMediaQuery('(min-width: 960px)')
  const [savedAssets, setSavedAssets] = useState<{ background?: string }>({})
  const [primaryMenuExpanded, setPrimaryMenuExpanded] = useState(isWideViewport)
  const [pageHeaderTarget, setPageHeaderTarget] = useState<HTMLDivElement | null>(null)
  const [historyBounds, setHistoryBounds] = useState<HistoryBounds>(() => {
    const index = readRouterHistoryIndex()
    return { index: index ?? 0, maxIndex: index ?? 0 }
  })
  const location = useLocation()
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const canGoBack = historyBounds.index > 0
  const canGoForward = historyBounds.index >= 0 && historyBounds.index < historyBounds.maxIndex
  const startupRedirectEligible = useRef(location.pathname === '/')
  const startupRouteDecided = useRef(location.pathname !== '/')
  const pendingHistoryDelta = useRef<-1 | 1 | undefined>(undefined)
  const editor = useEditorSession()
  const metadata = resolveRouteMetadata(`${location.pathname}${location.search}`, {
    agents: state.agents,
    teams: state.teams,
    assets: state.assets,
  })
  const title = metadata.title
  const configurationStatus = getConfigurationStatusSummary(state)
  const backgroundUrl = uiPreviewAssets?.background === null ? undefined : uiPreviewAssets?.background ?? savedAssets.background
  const runCommand = useCallback((command: AppCommandId) => {
    if (resetTerminal) return
    if (command === 'navigation.back' && canGoBack) pendingHistoryDelta.current = -1
    if (command === 'navigation.forward' && canGoForward) pendingHistoryDelta.current = 1
    executeAppCommand(command, { navigate, dispatch, editor, effectiveTheme, canGoBack, canGoForward })
  }, [canGoBack, canGoForward, dispatch, editor, effectiveTheme, navigate, resetTerminal])

  useEffect(() => {
    if (!isDesktopRuntime()) return
    let disposed = false
    let loaded: { background?: string } = {}
    readUiAsset('background').then((background) => {
      loaded = { background }
      if (disposed) {
        if (background) URL.revokeObjectURL(background)
      } else setSavedAssets(loaded)
    }).catch(() => undefined)
    return () => {
      disposed = true
      if (loaded.background) URL.revokeObjectURL(loaded.background)
    }
  }, [state.uiPreferences.backgroundAsset])

  useEffect(() => {
    if (!canFitExpandedMenu) setPrimaryMenuExpanded(false)
  }, [canFitExpandedMenu])

  useEffect(() => {
    if (!state.notice?.duration) return
    const id = state.notice.id
    const timer = window.setTimeout(() => dispatch({ type: 'CLEAR_NOTICE', id }), state.notice.duration)
    return () => window.clearTimeout(timer)
  }, [dispatch, state.notice])

  useEffect(() => {
    const windowTitle = formatWindowTitle(title)
    document.title = windowTitle
    void setDesktopTitle(windowTitle).catch(() => undefined)
  }, [title])

  const previousLocationKey = useRef(location.key)
  useEffect(() => {
    if (previousLocationKey.current === location.key) return
    previousLocationKey.current = location.key
    setHistoryBounds((current) => {
      const routerIndex = readRouterHistoryIndex()
      if (routerIndex !== undefined) {
        if (navigationType === 'PUSH') return { index: routerIndex, maxIndex: routerIndex }
        return { index: routerIndex, maxIndex: Math.max(current.maxIndex, routerIndex) }
      }
      if (navigationType === 'PUSH') {
        const index = current.index + 1
        return { index, maxIndex: index }
      }
      if (navigationType === 'POP') {
        const delta = pendingHistoryDelta.current
        pendingHistoryDelta.current = undefined
        if (!delta) return current
        return { ...current, index: Math.max(0, Math.min(current.maxIndex, current.index + delta)) }
      }
      return current
    })
  }, [location.key, navigationType])

  useEffect(() => {
    if (state.factoryReset.status !== 'legacy-database-required') return
    if (`${location.pathname}${location.search}` !== '/settings?section=recovery&tab=reset') {
      navigate('/settings?section=recovery&tab=reset', { replace: true })
    }
  }, [location.pathname, location.search, navigate, state.factoryReset.status])

  useEffect(() => {
    if (resetTerminal || startupRouteDecided.current) return
    if (location.pathname !== '/') {
      startupRedirectEligible.current = false
      startupRouteDecided.current = true
      return
    }
    if (configurationStatus.phase === 'loading') return
    startupRouteDecided.current = true
    if (startupRedirectEligible.current && configurationStatus.phase === 'healthy' && state.agents.length) {
      navigate('/agents', { replace: true })
    }
  }, [configurationStatus.phase, location.pathname, navigate, resetTerminal, state.agents.length])

  useEffect(() => {
    if (resetTerminal) return
    let disposed = false
    let unlisten: () => void = () => undefined
    void listenForDesktopCommands((payload) => {
      if (isAppCommandId(payload)) runCommand(payload)
    }).then((cleanup) => {
      if (disposed) cleanup()
      else unlisten = cleanup
    }).catch(() => undefined)
    return () => {
      disposed = true
      unlisten()
    }
  }, [resetTerminal, runCommand])

  useEffect(() => {
    if (resetTerminal) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      if (!isDesktopRuntime() && event.code === 'BracketLeft' && canGoBack) {
        event.preventDefault()
        runCommand('navigation.back')
        return
      }
      if (!isDesktopRuntime() && event.code === 'BracketRight' && canGoForward) {
        event.preventDefault()
        runCommand('navigation.forward')
        return
      }
      if (event.key === ',') {
        event.preventDefault()
        runCommand('navigation.settings')
        return
      }
      if (event.key.toLowerCase() === 's' && editor?.canSave) {
        event.preventDefault()
        runCommand('editor.save')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canGoBack, canGoForward, editor?.canSave, resetTerminal, runCommand])

  if (resetTerminal) {
    const resetState = state.factoryReset
    const manual = resetState.status === 'manual-restart-required'
    const technicalDetails = manual ? resetState.technicalDetails : undefined
    return <main className="grid min-h-screen place-items-center bg-background p-6 text-foreground">
      <section className="panel w-full max-w-xl p-6 sm:p-10" role={manual ? 'alert' : 'status'} aria-live={manual ? 'assertive' : 'polite'}>
        <div className="label">Bandi 已重置</div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{manual ? '请重新打开 Bandi' : 'Bandi 正在重新打开…'}</h1>
        <p className="mt-4 text-sm leading-7 text-muted-foreground">{manual ? '未能自动重新打开。请关闭当前窗口，然后重新打开 Bandi。当前窗口已停止所有编辑和操作。' : '正在完成安全清理并回到首次使用页面，请稍候。'}</p>
        {technicalDetails && <details className="mt-4 text-xs text-muted-foreground"><summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">查看技术详情</summary><p className="mt-2 break-words font-mono [overflow-wrap:anywhere]">{technicalDetails}</p></details>}
      </section>
    </main>
  }

  return (
    <div className="relative min-h-screen text-foreground">
      <div className="fixed inset-x-0 top-0 z-40 flex h-10 items-center border-b border-border bg-background/94 pl-20 pr-2 backdrop-blur">
        <Tooltip content={primaryMenuExpanded ? '收起侧栏' : '展开侧栏'} side="bottom">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label={primaryMenuExpanded ? '收起侧栏' : '展开侧栏'}
            aria-expanded={primaryMenuExpanded}
            onClick={() => setPrimaryMenuExpanded((expanded) => !expanded)}
          >
            {primaryMenuExpanded ? <PanelLeftClose size={17} className="-translate-y-0.5" aria-hidden="true" /> : <PanelLeftOpen size={17} className="-translate-y-0.5" aria-hidden="true" />}
          </Button>
        </Tooltip>
        <div className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
        <nav className="flex shrink-0 items-center" aria-label="浏览历史">
          <Tooltip content="后退（⌘[）" side="bottom">
            <Button variant="ghost" size="icon" className="size-11 shrink-0 text-muted-foreground hover:text-foreground" aria-label="后退" disabled={!canGoBack} onClick={() => runCommand('navigation.back')}>
              <ChevronLeft size={18} aria-hidden="true" />
            </Button>
          </Tooltip>
          <Tooltip content="前进（⌘]）" side="bottom">
            <Button variant="ghost" size="icon" className="size-11 shrink-0 text-muted-foreground hover:text-foreground" aria-label="前进" disabled={!canGoForward} onClick={() => runCommand('navigation.forward')}>
              <ChevronRight size={18} aria-hidden="true" />
            </Button>
          </Tooltip>
        </nav>
        <div className="min-w-0 flex-1 self-stretch" data-tauri-drag-region />
        <nav className="flex shrink-0 items-center gap-1" aria-label="全局工具">
          <Tooltip content="使用指南" side="bottom" triggerClassName="mr-2"><Button variant="ghost" size="icon" aria-label="使用指南" onClick={() => dispatch({ type: 'OPEN_DIALOG', dialog: { kind: 'usage-guide', topic: metadata.guideTopic ?? 'quick-start' } })}><CircleHelp size={17} aria-hidden="true" /></Button></Tooltip>
          <Tooltip content={effectiveTheme === 'light' ? '切换到深色' : '切换到浅色'} side="bottom"><Button variant="ghost" size="icon" aria-label={effectiveTheme === 'light' ? '切换到深色' : '切换到浅色'} onClick={() => runCommand('theme.toggle')}>{effectiveTheme === 'light' ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}</Button></Tooltip>
          <Tooltip content="设置" side="bottom"><Button asChild variant="ghost" size="icon"><Link to="/settings" aria-label="设置"><Settings size={17} aria-hidden="true" /></Link></Button></Tooltip>
        </nav>
      </div>
      {backgroundUrl && <><img src={backgroundUrl} alt="" aria-hidden="true" className="pointer-events-none fixed inset-0 size-full" style={{ objectFit: effectiveUiPreferences.backgroundFit }} /><div className="pointer-events-none fixed inset-0 bg-background" style={{ opacity: effectiveUiPreferences.backgroundDim / 100 }} /></>}
      <div
        data-primary-menu-layout={primaryMenuExpanded ? 'expanded' : 'compact'}
        className="relative flex min-h-screen bg-background pt-10"
      >
        <aside className={cn('sticky top-10 z-30 flex h-[calc(100vh-2.5rem)] shrink-0 flex-col border-r border-border bg-card p-2 transition-[width]', primaryMenuExpanded ? 'w-52' : 'w-14')} aria-label="Bandi 配置管理">
          <div className="mb-5 w-full">
            <TeamSwitcher expanded={primaryMenuExpanded} />
          </div>
          <RailNavigation expanded={primaryMenuExpanded} />
        </aside>

        <div className="min-w-0 flex-1 bg-background/90">
          <header className="sticky top-0 z-20 flex min-h-20 flex-wrap items-center gap-4 border-b border-border bg-background/94 px-6 py-3 backdrop-blur max-[1280px]:px-4 max-sm:gap-2 max-sm:px-3">
            <div ref={setPageHeaderTarget} className="flex min-w-0 flex-1 flex-wrap items-center gap-4 max-sm:basis-full" />
            {location.pathname !== '/' && (configurationStatus.phase === 'pending' || configurationStatus.phase === 'failed') && <Button asChild variant="outline" size="sm" className="max-sm:w-full"><Link to="/"><CircleAlert size={16} aria-hidden="true" />{configurationStatus.phase === 'failed' ? '配置读取失败' : `配置状态 · ${configurationStatus.items.length} 项`}</Link></Button>}
          </header>
          <main className="shell-main mx-auto max-w-[1420px]"><PageHeaderTargetProvider target={pageHeaderTarget}><Outlet /></PageHeaderTargetProvider></main>
        </div>
      </div>

      {state.notice && (() => {
        const Icon = state.notice.tone === 'success' ? CircleCheck : state.notice.tone === 'error' ? CircleX : state.notice.tone === 'warning' ? CircleAlert : Info
        return <div role={state.notice.tone === 'error' ? 'alert' : 'status'} aria-live={state.notice.tone === 'error' ? 'assertive' : 'polite'} className={cn('fixed bottom-5 right-5 z-[70] flex max-w-md gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-xl', state.notice.tone === 'success' && 'border-success/30', state.notice.tone === 'warning' && 'border-warning/30', state.notice.tone === 'error' && 'border-danger/30', state.notice.tone === 'info' && 'border-border')}>
          <Icon aria-hidden="true" className={cn('mt-0.5 shrink-0', state.notice.tone === 'success' && 'text-success', state.notice.tone === 'warning' && 'text-warning', state.notice.tone === 'error' && 'text-danger', state.notice.tone === 'info' && 'text-muted-foreground')} size={18} />
          <div className="min-w-0 flex-1"><b>{state.notice.title}</b>{state.notice.description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{state.notice.description}</p>}</div>
          <Button variant="ghost" size="icon" className="-mr-2 -mt-2" aria-label="关闭通知" onClick={() => dispatch({ type: 'CLEAR_NOTICE', id: state.notice?.id })}><X size={16} aria-hidden="true" /></Button>
        </div>
      })()}
      <GlobalSheets />
    </div>
  )
}
