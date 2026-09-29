import { useEffect, useState } from 'react'
import type { FullAgent } from '../../domain'
import { isDesktopRuntime, readAgentAvatar } from '../../desktop-bridge'
import { cn } from '../../lib'

export function AgentAvatar({ agent, className }: { agent: Pick<FullAgent, 'id' | 'name' | 'avatarPath'>; className?: string }) {
  const [url, setUrl] = useState<string>()

  useEffect(() => {
    if (!agent.avatarPath || !isDesktopRuntime()) {
      setUrl(undefined)
      return
    }
    let disposed = false
    let loaded: string | undefined
    void readAgentAvatar(agent.id).then((value) => {
      loaded = value
      if (disposed && value) URL.revokeObjectURL(value)
      else setUrl(value)
    }).catch(() => setUrl(undefined))
    return () => {
      disposed = true
      if (loaded) URL.revokeObjectURL(loaded)
    }
  }, [agent.avatarPath, agent.id])

  return <span className={cn('grid size-8 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted font-semibold', className)} aria-hidden="true">{url ? <img src={url} alt="" className="size-full object-cover" /> : agent.name.slice(0, 1)}</span>
}
